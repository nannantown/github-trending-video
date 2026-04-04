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

function generateNarration(repo, jaDesc) {
  const starsJa = formatStarsJa(repo.stars);
  const todayJa = repo.todayStars.toLocaleString();
  // Trim jaDesc to keep narration concise (first sentence or up to 50 chars)
  const shortDesc = jaDesc.length > 60 ? jaDesc.slice(0, 57) + "..." : jaDesc;
  return `第${repo.rank}位、${repo.name}。${shortDesc}。累計${starsJa}スター、今日${todayJa}スター獲得。`;
}

function generateDetail(repo, jaDesc) {
  const starsJa = formatStarsJa(repo.stars);
  const todayJa = repo.todayStars.toLocaleString();

  const parts = [jaDesc + "。"];
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

  console.log("Translating descriptions to Japanese...\n");

  const projects = [];
  for (const repo of raw) {
    const desc = repo.description || repo.name;
    process.stdout.write(`  #${repo.rank} ${repo.name}: translating... `);
    const jaDesc = await translateToJa(desc);
    console.log(jaDesc);

    projects.push({
      rank: repo.rank,
      name: repo.name,
      fullName: repo.fullName,
      description: jaDesc,
      detail: generateDetail(repo, jaDesc),
      narration: generateNarration(repo, jaDesc),
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
