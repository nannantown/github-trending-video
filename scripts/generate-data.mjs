/**
 * Transform raw trending data into full Project[] with Japanese text.
 * - Uses Claude-enriched Japanese descriptions from data/enriched-trending.json
 * - Falls back to a minimal Japanese template when enrichment is missing
 *   (no external translation service — Google Translate is unreliable in CI)
 * Input:  output/raw-trending.json
 * Output: output/trending-data.json
 */

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

    // Accept enrichment dated within ±1 day of today (JST) to tolerate
    // timezone drift between the Claude enrichment task and the workflow run.
    const fmt = (ms) => {
      const d = new Date(ms);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const now = Date.now();
    const acceptable = new Set([fmt(now - 86400000), fmt(now), fmt(now + 86400000)]);

    if (!acceptable.has(enriched.date)) {
      console.log(`  Enriched data is from ${enriched.date}, outside ±1 day window (${[...acceptable].join(", ")}). Skipping.`);
      return null;
    }

    const map = {};
    for (const p of enriched.projects || []) {
      map[p.fullName] = p;
    }
    console.log(`  Loaded enriched data (dated ${enriched.date}) for ${Object.keys(map).length} projects (by Claude)`);
    return map;
  } catch (err) {
    console.error(`  Failed to load enriched data: ${err.message}`);
    return null;
  }
}

async function main() {
  const rawPath = join(outputDir, "raw-trending.json");
  const raw = JSON.parse(readFileSync(rawPath, "utf-8"));

  const enrichedMap = loadEnrichedData();
  if (enrichedMap) {
    console.log("Using Claude-enriched descriptions!\n");
  } else {
    console.log("No enriched data available — using minimal Japanese fallback.\n");
  }

  const projects = [];
  for (const repo of raw) {
    const enriched = enrichedMap?.[repo.fullName];

    if (enriched) {
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
      // Minimal fallback when enrichment is missing for this repo.
      // No external translation service — use a deterministic Japanese template.
      console.warn(`  #${repo.rank} ${repo.name}: no enrichment, using minimal template`);
      const safeName = repo.name.replace(/[_\-]/g, " ");
      const simpleJa = `注目のリポジトリ「${safeName}」`;
      projects.push({
        rank: repo.rank,
        name: repo.name,
        fullName: repo.fullName,
        description: simpleJa,
        detail: generateDetail(repo, simpleJa, ""),
        narration: generateNarration(repo, simpleJa),
        stars: repo.stars,
        todayStars: repo.todayStars,
        language: repo.language,
        url: repo.url,
      });
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
