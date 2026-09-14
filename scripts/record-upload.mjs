/**
 * Record upload metadata to performance history.
 * Reads upload-result.json + trending-data.json + captions.json
 * and appends a new entry to data/performance-history.json.
 *
 * Non-blocking: failures here don't affect the pipeline.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { summarizeThumbnail } from "./youtube-variant.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const outputDir = join(rootDir, "output");
const historyPath = join(rootDir, "data", "performance-history.json");
const enrichedPath = join(rootDir, "data", "enriched-trending.json");

function readJSON(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

function main() {
  // Read upload result
  const uploadResult = readJSON(join(outputDir, "upload-result.json"));
  if (!uploadResult || !uploadResult.videoId) {
    console.log("record-upload: no upload-result.json found, skipping.");
    return;
  }

  // Read trending data for project info
  const trendingData = readJSON(join(outputDir, "trending-data.json"));

  // Read captions for hashtags/title info
  const captions = readJSON(join(outputDir, "captions.json"));

  // Read audio durations for video length
  const audioDurations = readJSON(join(outputDir, "audio-durations.json"));

  // Read enriched content for discovery metadata (Meta-PDCA input)
  const enriched = readJSON(enrichedPath);

  // Instagram Media ID written by upload-instagram.mjs (absent if IG skipped/failed;
  // fetch-stats.mjs then restores it by date-matching)
  // A corrupt file must not cost the day's whole entry (incl. YouTube videoId).
  let igResult = null;
  try {
    igResult = readJSON(join(outputDir, "instagram-result.json"));
  } catch (err) {
    console.error(`record-upload: unreadable instagram-result.json (${err.message}), instagram: null`);
  }

  // Calculate total duration
  let durationSeconds = 0;
  if (audioDurations) {
    durationSeconds = Object.values(audioDurations).reduce(
      (sum, d) => sum + d,
      0
    );
  }

  // Build video entry
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const entry = {
    videoId: uploadResult.videoId,
    videoUrl: uploadResult.videoUrl,
    date: dateStr,
    // upload-result.json holds what was actually uploaded (the legacy metadata if
    // YouTube rejected the experiment's title and the upload was retried).
    title: uploadResult.title || captions?.youtube?.title || "",
    titleTemplate: uploadResult.titleTemplate || captions?.youtube?.titleTemplate || "standard", // "top1" = 2026-09-14 experiment arm
    // 2026-09-14 YouTube distribution experiment B (YouTube upload only):
    // "top1" = YouTube-only render with the TOP1 opening, "brand" = shared video.
    ytOpening: uploadResult.openingVariant || "brand",
    ytThumbnail: summarizeThumbnail(uploadResult.thumbnail), // "set" | "skipped:<why>" | "error:<reason>" | null
    hashtags: captions?.youtube?.tags || [],
    languages: trendingData?.projects
      ? [...new Set(trendingData.projects.map((p) => p.language).filter(Boolean))]
      : [],
    projects: trendingData?.projects
      ? trendingData.projects.map((p) => p.fullName)
      : [],
    durationSeconds: Math.round(durationSeconds),
    discovery: enriched?.discovery || null,
    stats: {
      views: 0,
      likes: 0,
      comments: 0,
      updatedAt: null,
    },
    // Metrics are filled by fetch-stats.mjs (IG insights lag up to 48h)
    instagram: igResult?.mediaId
      ? {
          mediaId: igResult.mediaId,
          permalink: null,
          views: null,
          reach: null,
          likes: null,
          comments: null,
          shares: null,
          saved: null,
          updatedAt: null,
        }
      : null,
  };

  // Load or initialize history
  let history = readJSON(historyPath);
  if (!history) {
    history = { schemaVersion: 1, videos: [], optimizationLog: [] };
  }

  // Avoid duplicates (same date)
  history.videos = history.videos.filter((v) => v.date !== dateStr);

  // Append
  history.videos.push(entry);

  // Keep last 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  history.videos = history.videos.filter((v) => v.date >= cutoffStr);

  // Write
  writeFileSync(historyPath, JSON.stringify(history, null, 2));
  console.log(`record-upload: recorded ${entry.videoId} (${dateStr})`);
  console.log(`  Title: ${entry.title}`);
  console.log(`  Languages: ${entry.languages.join(", ")}`);
  console.log(`  Instagram: ${entry.instagram ? entry.instagram.mediaId : "no media id (restored later by fetch-stats)"}`);
  if (entry.discovery) {
    console.log(`  Discovery: ${entry.discovery.method} (${entry.discovery.description || "no description"})`);
  } else {
    console.log(`  Discovery: null (no metadata in enriched file)`);
  }
  console.log(`  History: ${history.videos.length} videos tracked`);
}

main();
