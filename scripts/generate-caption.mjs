/**
 * Generate platform-specific captions from trending data.
 * Input:  output/trending-data.json
 * Output: output/captions.json
 *
 * Produces:
 *   - YouTube title + description
 *   - Instagram caption
 *   - Common hashtags
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "..", "output");

function getDateStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return { full: `${y}/${m}/${day}`, compact: `${y}${m}${day}` };
}

function generateHashtags(projects) {
  const base = [
    "#GitHubTrending",
    "#GitHub",
    "#プログラミング",
    "#エンジニア",
    "#Tech",
    "#開発",
    "#OSS",
    "#オープンソース",
    "#Shorts",
  ];

  // Add language-specific tags
  const langs = new Set(projects.map((p) => p.language).filter(Boolean));
  for (const lang of langs) {
    base.push(`#${lang}`);
  }

  return base;
}

function generateYouTubeCaption(data, dateStr) {
  const { projects } = data;
  const hashtags = generateHashtags(projects);

  // Title: max 100 chars, include #Shorts
  const title = `【GitHub Trending】今日の注目リポジトリ TOP5｜${dateStr.full} #Shorts`;

  // Description
  const lines = [
    `${dateStr.full} の GitHub Trending 上位5リポジトリを紹介します。`,
    "",
    "--- 本日のランキング ---",
    "",
  ];

  for (const p of projects) {
    lines.push(`${p.rank}. ${p.fullName}`);
    lines.push(`   ${p.description}`);
    lines.push(`   ${p.stars.toLocaleString()} stars (+${p.todayStars.toLocaleString()} today)`);
    lines.push(`   ${p.url}`);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("毎朝 GitHub Trending をチェックして、最新のトレンドをキャッチしよう。");
  lines.push("チャンネル登録 & いいね お願いします。");
  lines.push("");
  lines.push(hashtags.join(" "));

  return {
    title,
    description: lines.join("\n"),
    tags: hashtags.map((h) => h.replace("#", "")),
    categoryId: "28", // Science & Technology
  };
}

function generateInstagramCaption(data, dateStr) {
  const { projects } = data;
  const hashtags = generateHashtags(projects);

  const lines = [
    `${dateStr.full} GitHub Trending TOP5`,
    "",
  ];

  for (const p of projects) {
    const starsK =
      p.stars >= 10000
        ? `${(p.stars / 1000).toFixed(1)}k`
        : p.stars >= 1000
          ? `${(p.stars / 1000).toFixed(1)}k`
          : `${p.stars}`;
    lines.push(`${p.rank}. ${p.fullName} (${starsK} stars)`);
  }

  lines.push("");
  lines.push("毎朝 GitHub Trending をお届けします。");
  lines.push("フォロー & いいね で最新トレンドをチェック!");
  lines.push("");
  lines.push(hashtags.join(" "));

  return lines.join("\n");
}

function main() {
  const dataPath = join(outputDir, "trending-data.json");
  const data = JSON.parse(readFileSync(dataPath, "utf-8"));
  const dateStr = getDateStr();

  const captions = {
    date: dateStr,
    youtube: generateYouTubeCaption(data, dateStr),
    instagram: generateInstagramCaption(data, dateStr),
  };

  const outputPath = join(outputDir, "captions.json");
  writeFileSync(outputPath, JSON.stringify(captions, null, 2));
  console.log(`Captions → ${outputPath}`);
  console.log(`  YouTube title: ${captions.youtube.title}`);
  console.log(`  Instagram: ${captions.instagram.length} chars`);
}

main();
