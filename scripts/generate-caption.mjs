/**
 * Generate platform-specific captions from trending data.
 * Reads optimization hints (if available) to improve hashtags and titles.
 *
 * Input:  output/trending-data.json, output/optimization-hints.json (optional)
 * Output: output/captions.json
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
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

function loadOptimizationHints() {
  const hintsPath = join(outputDir, "optimization-hints.json");
  if (!existsSync(hintsPath)) return null;
  try {
    return JSON.parse(readFileSync(hintsPath, "utf-8"));
  } catch {
    return null;
  }
}

function generateHashtags(projects, hints) {
  let base;

  if (hints?.recommendedHashtags && hints.recommendedHashtags.length > 0) {
    // Use optimized hashtags from analytics
    base = hints.recommendedHashtags.map((h) =>
      h.startsWith("#") ? h : `#${h}`
    );
    console.log(`  Using optimized hashtags (${base.length} tags)`);
  } else {
    // Default hashtags
    base = [
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
  }

  // Add language-specific tags
  const langs = new Set(projects.map((p) => p.language).filter(Boolean));
  for (const lang of langs) {
    const tag = `#${lang}`;
    if (!base.includes(tag)) {
      base.push(tag);
    }
  }

  // Remove dropped hashtags
  if (hints?.droppedHashtags?.length > 0) {
    const dropped = new Set(
      hints.droppedHashtags.map((h) => (h.startsWith("#") ? h : `#${h}`))
    );
    base = base.filter((h) => !dropped.has(h));
  }

  return base;
}

function generateTitle(data, dateStr, hints) {
  const template = hints?.recommendedTitleTemplate || "standard";
  const topProject = data.projects[0];

  switch (template) {
    case "highlight":
      // Highlight top project name and star count
      return `${topProject.name} +${topProject.todayStars.toLocaleString()}stars! GitHub Trending TOP5｜${dateStr.full} #Shorts`;

    case "emoji":
      return `GitHub Trending TOP5｜${dateStr.full} #Shorts`;

    case "standard":
    default:
      return `【GitHub Trending】今日の注目リポジトリ TOP5｜${dateStr.full} #Shorts`;
  }
}

function generateYouTubeCaption(data, dateStr, hints) {
  const { projects } = data;
  const hashtags = generateHashtags(projects, hints);
  const title = generateTitle(data, dateStr, hints);
  const titleTemplate = hints?.recommendedTitleTemplate || "standard";

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
    titleTemplate,
    description: lines.join("\n"),
    tags: hashtags.map((h) => h.replace("#", "")),
    categoryId: "28", // Science & Technology
  };
}

function generateInstagramCaption(data, dateStr, hints) {
  const { projects } = data;
  const hashtags = generateHashtags(projects, hints);

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

  // Load optimization hints (from fetch-stats.mjs, if available)
  const hints = loadOptimizationHints();
  if (hints) {
    console.log(`  Optimization hints loaded (${hints.videoCount} videos analyzed)`);
    console.log(`  Recommended title template: ${hints.recommendedTitleTemplate}`);
  }

  const captions = {
    date: dateStr,
    youtube: generateYouTubeCaption(data, dateStr, hints),
    instagram: generateInstagramCaption(data, dateStr, hints),
  };

  const outputPath = join(outputDir, "captions.json");
  writeFileSync(outputPath, JSON.stringify(captions, null, 2));
  console.log(`Captions → ${outputPath}`);
  console.log(`  YouTube title: ${captions.youtube.title}`);
  console.log(`  Title template: ${captions.youtube.titleTemplate}`);
  console.log(`  Instagram: ${captions.instagram.length} chars`);
}

main();
