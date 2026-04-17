/**
 * Transform Claude-enriched trending data into Project[] for Remotion.
 *
 * Claude's scheduled task writes data/enriched-trending.json ~30 min before
 * the daily workflow runs. That file is the single source of truth for both
 * the ranked list and the per-project copy (description / detail / narration).
 *
 * Input:  data/enriched-trending.json
 * Output: output/trending-data.json
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const outputDir = join(rootDir, "output");
const enrichedPath = join(rootDir, "data", "enriched-trending.json");

const REQUIRED_FIELDS = [
  "rank",
  "fullName",
  "name",
  "url",
  "stars",
  "todayStars",
  "description",
  "detail",
  "narration",
];

function loadEnrichedData() {
  if (!existsSync(enrichedPath)) {
    throw new Error(
      `data/enriched-trending.json not found. Claude's enrichment task must run before this script.`
    );
  }

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
    throw new Error(
      `Enriched data is dated ${enriched.date}, outside ±1 day window (${[...acceptable].join(", ")}). Re-run Claude's enrichment task.`
    );
  }

  const projects = enriched.projects || [];
  if (projects.length === 0) {
    throw new Error("Enriched data contains no projects.");
  }

  for (const p of projects) {
    for (const field of REQUIRED_FIELDS) {
      if (p[field] === undefined || p[field] === null) {
        // `language` is optional elsewhere; keep it truly optional.
        throw new Error(
          `Project #${p.rank ?? "?"} (${p.fullName ?? "unknown"}) is missing required field "${field}".`
        );
      }
    }
  }

  console.log(
    `Loaded enriched data (dated ${enriched.date}) for ${projects.length} projects.`
  );
  return projects;
}

async function main() {
  const enrichedProjects = loadEnrichedData();

  const projects = enrichedProjects.map((p) => ({
    rank: p.rank,
    name: p.name,
    fullName: p.fullName,
    description: p.description,
    detail: p.detail,
    narration: p.narration,
    stars: p.stars,
    todayStars: p.todayStars,
    language: p.language ?? undefined,
    url: p.url,
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
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
