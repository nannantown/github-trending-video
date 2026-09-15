/**
 * Generate platform-specific captions from trending data.
 * Reads optimization hints (if available) to improve hashtags.
 *
 * YouTube title/description are individualized per day (TOP1 repo name +
 * what it does) — see scripts/youtube-caption.mjs for the rationale
 * (2026-09-14 distribution experiment). The Instagram caption is unchanged
 * (locked by scripts/generate-caption.test.mjs against origin/main output).
 * Control arm (legacy title + description): YT_TITLE_TEMPLATE=standard
 *
 * Input:  output/trending-data.json, output/optimization-hints.json (optional)
 * Output: output/captions.json
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { buildYouTubeMetadata, resolveTitleTemplate } from "./youtube-caption.mjs";

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

export function generateHashtags(projects, hints) {
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

export function generateYouTubeCaption(
  data,
  dateStr,
  hints,
  titleTemplate = resolveTitleTemplate(process.env.YT_TITLE_TEMPLATE)
) {
  const { projects } = data;
  const hashtags = generateHashtags(projects, hints);

  // Experiment arm is pinned via YT_TITLE_TEMPLATE (not hint-driven) — see youtube-caption.mjs.
  if (hints?.recommendedTitleTemplate && hints.recommendedTitleTemplate !== titleTemplate) {
    console.log(
      `  (hints recommend "${hints.recommendedTitleTemplate}" — ignored, experiment pins "${titleTemplate}")`
    );
  }

  const { title, description, fallback } = buildYouTubeMetadata(projects, dateStr, hashtags, titleTemplate);
  return {
    title,
    titleTemplate,
    description,
    tags: hashtags.map((h) => h.replace("#", "")),
    categoryId: "28", // Science & Technology
    ...(fallback ? { fallback } : {}),
  };
}

export function generateInstagramCaption(data, dateStr, hints) {
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

// Run only when executed directly (post-sns.mjs spawns `node scripts/generate-caption.mjs`);
// importing the module (tests) must not read or write files.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
