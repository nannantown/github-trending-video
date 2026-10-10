/** Merge a day's platform results without replacing the other platform or metrics. */
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { summarizeThumbnail } from "./youtube-variant.mjs";

export function recordUpload({ rootDir, metadata, state }) {
  const path = join(rootDir, "data/performance-history.json");
  const history = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : { schemaVersion: 1, videos: [], optimizationLog: [] };
  let entry = history.videos.find((video) => video.date === state.date);
  if (!entry) {
    const projects = metadata.trendingData.projects;
    entry = {
      date: state.date, videoId: null, videoUrl: null,
      title: metadata.captions.youtube?.title || "",
      titleTemplate: metadata.captions.youtube?.titleTemplate || "standard",
      hashtags: metadata.captions.youtube?.tags || [],
      languages: [...new Set(projects.map((p) => p.language).filter(Boolean))],
      projects: projects.map((p) => p.fullName),
      durationSeconds: Math.round(Object.values(metadata.audioDurations || {}).reduce((sum, d) => sum + d, 0)),
      discovery: metadata.discovery || null,
      stats: { views: 0, likes: 0, comments: 0, updatedAt: null },
      instagram: null,
    };
    history.videos.push(entry);
  }
  // Partial runs (including IG-only runs) never clear known IDs or analytics.
  entry.posting = structuredClone(state.platforms);
  const yt = state.platforms.youtube;
  if (yt?.videoId) {
    if (entry.videoId && entry.videoId !== yt.videoId) throw new Error("Conflicting YouTube ID for date");
    entry.videoId = yt.videoId;
    entry.videoUrl = yt.videoUrl;
    if (yt.title) entry.title = yt.title;
    if (yt.titleTemplate) entry.titleTemplate = yt.titleTemplate;
    if (yt.openingVariant) entry.ytOpening = yt.openingVariant;
    if (yt.thumbnail) entry.ytThumbnail = summarizeThumbnail(yt.thumbnail);
  }
  const ig = state.platforms.instagram;
  if (ig?.mediaId) {
    if (entry.instagram?.mediaId && entry.instagram.mediaId !== ig.mediaId) throw new Error("Conflicting Instagram ID for date");
    entry.instagram = {
      permalink: null, views: null, reach: null, likes: null, comments: null,
      shares: null, saved: null, updatedAt: null,
      ...entry.instagram, mediaId: ig.mediaId,
    };
  }
  writeFileSync(`${path}.tmp`, JSON.stringify(history, null, 2));
  renameSync(`${path}.tmp`, path);
  return entry;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  const date = process.argv.find((arg) => arg.startsWith("--date="))?.slice(7);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw new Error("Explicit --date=YYYY-MM-DD required");
  const compact = date.replaceAll("-", "");
  recordUpload({ rootDir,
    metadata: JSON.parse(readFileSync(join(rootDir, `output/trending-${compact}-metadata.json`), "utf8")),
    state: JSON.parse(readFileSync(join(rootDir, `data/posting/${date}.json`), "utf8")),
  });
}
