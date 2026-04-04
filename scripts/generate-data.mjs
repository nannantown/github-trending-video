/**
 * Transform raw trending data into full Project[] with Japanese text.
 * Input:  output/raw-trending.json
 * Output: output/trending-data.json
 */

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

function generateNarration(repo) {
  const langPart = repo.language ? `${repo.language}で書かれた` : "";
  const desc = repo.description || repo.name;
  const starsJa = formatStarsJa(repo.stars);
  const todayJa = repo.todayStars.toLocaleString();

  return `第${repo.rank}位、${repo.name}。${langPart}${desc}。累計${starsJa}スター、今日${todayJa}スター獲得。`;
}

function main() {
  const rawPath = join(outputDir, "raw-trending.json");
  const raw = JSON.parse(readFileSync(rawPath, "utf-8"));

  const projects = raw.map((repo) => ({
    rank: repo.rank,
    name: repo.name,
    fullName: repo.fullName,
    description: repo.description || repo.name,
    detail: repo.description || "",
    narration: generateNarration(repo),
    stars: repo.stars,
    todayStars: repo.todayStars,
    language: repo.language,
    url: repo.url,
  }));

  const data = {
    openingNarration:
      "今日のGitHub Trending。注目リポジトリトップ5を紹介します。",
    endingNarration:
      "以上、今日のGitHub Trendingでした。フォローといいねで、毎朝のトレンドをチェックしましょう。",
    projects,
  };

  const outputPath = join(outputDir, "trending-data.json");
  writeFileSync(outputPath, JSON.stringify(data, null, 2));

  console.log(`Generated ${projects.length} projects → ${outputPath}`);
  projects.forEach((p) => console.log(`  #${p.rank} ${p.name}: ${p.narration}`));
}

main();
