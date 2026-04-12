/**
 * Transform raw trending data into full Project[] with Japanese text.
 * - Translates English descriptions to Japanese via Google Translate
 * - Generates narration text for TTS
 * Input:  output/raw-trending.json
 * Output: output/trending-data.json
 */

import translate from "google-translate-api-x";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const outputDir = join(rootDir, "output");
const enrichedPath = join(rootDir, "data", "enriched-trending.json");

function formatStarsJa(n) {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, "") + "万";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "千";
  return n.toString();
}

function cleanSourceForTranslation(text) {
  return text
    // Remove "BrandName - " prefix (e.g. "OmX - Oh My codeX: ...")
    .replace(/^[A-Za-z0-9\s_\-\.!]+\s*[-:]\s*/g, "")
    // Remove parenthetical abbreviations (e.g. "(TTS)", "(LLM)")
    .replace(/\([A-Z]{2,}\)/g, "")
    // Simplify "X for Y" patterns that translate awkwardly
    .replace(/\. An alternative to .+\.?$/, ".")
    .trim();
}

async function translateToJa(text) {
  if (!text) return "";
  try {
    const cleaned = cleanSourceForTranslation(text);
    const res = await translate(cleaned || text, { from: "en", to: "ja" });
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

function cleanForTTS(text) {
  return text
    // Remove "BrandName - " or "BrandName: " prefix patterns
    .replace(/^[A-Za-z0-9\s_\-\.]+\s*[-:：]\s*/, "")
    // Remove URLs
    .replace(/https?:\/\/\S+/g, "")
    // Remove empty parentheses
    .replace(/\(\s*\)/g, "")
    // Replace " - " with 、
    .replace(/\s*-\s*/g, "、")
    // Collapse multiple spaces/punctuation
    .replace(/\s+/g, " ")
    .replace(/[。、]{2,}/g, "。")
    .replace(/^[。、\s]+/, "")
    .trim();
}

function truncateAtSentence(text, maxLen) {
  if (text.length <= maxLen) return text;

  // Try to cut at a sentence boundary (。)
  const cutPoint = text.lastIndexOf("。", maxLen);
  if (cutPoint > 15) return text.slice(0, cutPoint + 1);

  // Try to cut at a comma or 、
  const commaPoint = text.lastIndexOf("、", maxLen);
  if (commaPoint > 15) return text.slice(0, commaPoint) + "。";

  // Try to cut at a space
  const spacePoint = text.lastIndexOf(" ", maxLen);
  if (spacePoint > 15) return text.slice(0, spacePoint) + "。";

  // Last resort: cut and close with 。
  return text.slice(0, maxLen - 1) + "。";
}

function generateNarration(repo, jaDesc) {
  const starsJa = formatStarsJa(repo.stars);
  const todayJa = repo.todayStars.toLocaleString();

  // Clean description for TTS readability
  const cleaned = cleanForTTS(jaDesc);
  const shortDesc = truncateAtSentence(cleaned, 60);

  return `第${repo.rank}位。${shortDesc} 累計${starsJa}スター、今日${todayJa}スター獲得。`;
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

/**
 * Try to load enriched data from Claude Code's scheduled task.
 * Returns a map of fullName -> { description, detail, narration } if available.
 */
function loadEnrichedData() {
  if (!existsSync(enrichedPath)) return null;

  try {
    const enriched = JSON.parse(readFileSync(enrichedPath, "utf-8"));
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    // Only use if it's today's data
    if (enriched.date !== todayStr) {
      console.log(`  Enriched data is from ${enriched.date}, not today (${todayStr}). Skipping.`);
      return null;
    }

    const map = {};
    for (const p of enriched.projects || []) {
      map[p.fullName] = p;
    }
    console.log(`  Loaded enriched data for ${Object.keys(map).length} projects (by Claude)`);
    return map;
  } catch (err) {
    console.error(`  Failed to load enriched data: ${err.message}`);
    return null;
  }
}

async function main() {
  const rawPath = join(outputDir, "raw-trending.json");
  const raw = JSON.parse(readFileSync(rawPath, "utf-8"));

  // Check for Claude-enriched data (from scheduled task at 7:30)
  const enrichedMap = loadEnrichedData();
  if (enrichedMap) {
    console.log("Using Claude-enriched descriptions!\n");
  } else {
    console.log("No enriched data available, falling back to translate + README...\n");
  }

  const projects = [];
  for (const repo of raw) {
    const enriched = enrichedMap?.[repo.fullName];

    if (enriched) {
      // Use Claude's hand-crafted descriptions
      console.log(`  #${repo.rank} ${repo.name}: using enriched data`);

      projects.push({
        rank: repo.rank,
        name: repo.name,
        fullName: repo.fullName,
        description: enriched.description,
        detail: enriched.detail || enriched.description,
        narration: enriched.narration || `第${repo.rank}位。${truncateAtSentence(cleanForTTS(enriched.description), 60)} 累計${formatStarsJa(repo.stars)}スター。`,
        stars: repo.stars,
        todayStars: repo.todayStars,
        language: repo.language,
        url: repo.url,
      });
    } else {
      // Fallback: translate + README extraction
      const richDesc = buildRichDescription(repo);
      const simpleDesc = repo.description || repo.name;

      process.stdout.write(`  #${repo.rank} ${repo.name}: translating... `);

      const jaDesc = await translateToJa(simpleDesc);

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

      await new Promise((r) => setTimeout(r, 300));
    }
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
