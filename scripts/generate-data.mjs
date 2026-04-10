/**
 * Transform raw trending data into full Project[] with Japanese text.
 * - Translates English descriptions to Japanese via Google Translate
 * - Generates narration text for TTS
 * Input:  output/raw-trending.json
 * Output: output/trending-data.json
 */

import translate from "google-translate-api-x";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "..", "output");

function formatStarsJa(n) {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, "") + "万";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "千";
  return n.toString();
}

async function translateToJa(text) {
  if (!text) return "";
  try {
    const res = await translate(text, { from: "en", to: "ja" });
    return res.text;
  } catch (err) {
    console.error(`  Translation failed: ${err.message}, using original`);
    return text;
  }
}

/**
 * Build a richer description by combining the repo's tagline with
 * key info extracted from the README excerpt.
 * Produces a "what it does + when to use it" style description.
 */
function buildRichDescription(repo) {
  const base = repo.description || repo.name;
  const readme = repo.readmeExcerpt || "";

  if (!readme || readme.length < 30) return base;

  // Extract key phrases from README that add value beyond the tagline
  // Look for "what/how/why" sentences, feature lists, use-case descriptions
  const sentences = readme
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.length > 20 && s.length < 200)
    .filter((s) => {
      const lower = s.toLowerCase();
      // Skip boilerplate / badge / install instructions
      if (lower.includes("npm install")) return false;
      if (lower.includes("pip install")) return false;
      if (lower.includes("license")) return false;
      if (lower.includes("contributing")) return false;
      if (lower.includes("table of contents")) return false;
      if (lower.match(/^(v\d|version)/)) return false;
      return true;
    });

  // Pick the most informative sentence that's different from the tagline
  let bestExtra = "";
  for (const sentence of sentences) {
    // Skip if too similar to the existing description
    if (base.toLowerCase().includes(sentence.toLowerCase().slice(0, 30)))
      continue;
    bestExtra = sentence;
    break;
  }

  if (bestExtra) {
    // Combine: original description + extra context from README
    return `${base}. ${bestExtra}`;
  }

  return base;
}

function generateNarration(repo, jaDesc) {
  const starsJa = formatStarsJa(repo.stars);
  const todayJa = repo.todayStars.toLocaleString();
  // Trim jaDesc to keep narration concise
  const shortDesc = jaDesc.length > 60 ? jaDesc.slice(0, 57) + "..." : jaDesc;
  return `第${repo.rank}位、${repo.name}。${shortDesc}。累計${starsJa}スター、今日${todayJa}スター獲得。`;
}

function generateDetail(repo, jaDesc, jaReadmeExtra) {
  const starsJa = formatStarsJa(repo.stars);
  const todayJa = repo.todayStars.toLocaleString();

  const parts = [];

  // Use the richer description for the detail text
  if (jaReadmeExtra && jaReadmeExtra.length > 10) {
    parts.push(jaReadmeExtra + "。");
  } else {
    parts.push(jaDesc + "。");
  }

  if (repo.todayStars >= 2000) {
    parts.push(`本日+${todayJa}スターの爆発的な伸びを記録。`);
  } else if (repo.todayStars >= 1000) {
    parts.push(`本日+${todayJa}スターと急上昇中。`);
  } else {
    parts.push(`本日+${todayJa}スター獲得。`);
  }
  parts.push(`累計${starsJa}スター。`);
  return parts.join("");
}

async function main() {
  const rawPath = join(outputDir, "raw-trending.json");
  const raw = JSON.parse(readFileSync(rawPath, "utf-8"));

  console.log("Building rich descriptions & translating to Japanese...\n");

  const projects = [];
  for (const repo of raw) {
    // Build richer description from tagline + README
    const richDesc = buildRichDescription(repo);
    const simpleDesc = repo.description || repo.name;

    process.stdout.write(`  #${repo.rank} ${repo.name}: translating... `);

    // Translate the main (short) description
    const jaDesc = await translateToJa(simpleDesc);

    // Translate the richer description (for detail/narration)
    let jaRichDesc = "";
    if (richDesc !== simpleDesc) {
      await new Promise((r) => setTimeout(r, 300));
      jaRichDesc = await translateToJa(richDesc);
      console.log(`\n    Rich: ${jaRichDesc.slice(0, 80)}...`);
    } else {
      console.log(jaDesc);
    }

    projects.push({
      rank: repo.rank,
      name: repo.name,
      fullName: repo.fullName,
      description: jaDesc,
      detail: generateDetail(repo, jaDesc, jaRichDesc),
      narration: generateNarration(repo, jaRichDesc || jaDesc),
      stars: repo.stars,
      todayStars: repo.todayStars,
      language: repo.language,
      url: repo.url,
    });

    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 300));
  }

  const data = {
    openingNarration:
      "今日のGitHub Trending。注目リポジトリトップ5を紹介します。",
    endingNarration:
      "以上、今日のGitHub Trendingでした。フォローといいねで、毎朝のトレンドをチェックしましょう。",
    projects,
  };

  const outputPath = join(outputDir, "trending-data.json");
  writeFileSync(outputPath, JSON.stringify(data, null, 2));
  console.log(`\nGenerated ${projects.length} projects → ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
