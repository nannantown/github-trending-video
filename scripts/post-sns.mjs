/** Daily posting: archive the exact bundle, then journal each platform separately. */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { argPath, resolveYouTubeUpload } from "./youtube-variant.mjs";
import { uploadInstagram } from "./upload-instagram.mjs";
import { validateDate, statePath, loadState, saveBundle, validateBundle, metadataName, createStore, attemptInstagram, withDateLock } from "./posting-state.mjs";

export function dateFromVideo(video) {
  const match = /^trending-(\d{4})(\d{2})(\d{2})\.mp4$/.exec(basename(video));
  if (!match) throw new Error("Explicit shared trending-YYYYMMDD.mp4 required");
  return validateDate(`${match[1]}-${match[2]}-${match[3]}`);
}
const readJSON = (path) => JSON.parse(readFileSync(path, "utf8"));

export function archiveBundle({ rootDir, date, video, env }) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY) throw new Error("Release archival credentials missing; refusing unarchived posting");
  const compact = date.replaceAll("-", "");
  const assets = [video, join(rootDir, "output", metadataName(date))];
  const cover = video.replace(/\.mp4$/, "-cover.jpg");
  if (existsSync(cover)) assets.push(cover);
  // No clobber: a rerun must never replace the original video/metadata archive.
  execFileSync("gh", ["release", "create", `v${compact}`, ...assets,
    "--repo", env.GITHUB_REPOSITORY, "--title", `GitHub Trending ${compact}`,
    "--notes", `Auto-generated trending video for ${date}`, "--latest"],
  { cwd: rootDir, env: { ...env, GH_TOKEN: env.GITHUB_TOKEN }, stdio: "inherit" });
}

function youtubeChild({ rootDir, date, video, openingVariant, thumbnail, env }) {
  const args = ["scripts/upload-youtube.mjs", `--video=${video}`, `--date=${date}`, `--opening-variant=${openingVariant}`];
  if (thumbnail) args.push(`--thumbnail=${thumbnail}`);
  execFileSync(process.execPath, args, { cwd: rootDir, env: { ...env, POSTING_YOUTUBE_ATTEMPT: date }, stdio: "inherit" });
  return loadState(rootDir, date).platforms.youtube;
}

export async function postDaily({ rootDir, date, video, captions, trendingData, audioDurations, discovery,
  youtubeUpload, env = process.env, archive = archiveBundle, uploadYouTube = youtubeChild,
  uploadIG = uploadInstagram, checkpoint }) {
  return withDateLock({ rootDir, date }, async () => {
    validateDate(date);
    if (dateFromVideo(video) !== date) throw new Error("Video date mismatch");
    if (existsSync(statePath(rootDir, date))) throw new Error("Posting journal already exists; use the guarded Instagram retry");
    const history = existsSync(join(rootDir, "data/performance-history.json")) ? readJSON(join(rootDir, "data/performance-history.json")) : { videos: [] };
    if (history.videos.some((v) => v.date === date && (v.videoId || v.instagram?.mediaId))) throw new Error("Date already has a known post; refusing duplicate");
    const { metadata, metadataSha256 } = saveBundle({ rootDir, date, video, captions, trendingData, audioDurations, discovery });
    const state = { schemaVersion: 1, journalId: randomUUID(), date, videoSha256: metadata.videoSha256, metadataSha256,
      platforms: { youtube: { status: "not_started" }, instagram: { status: "not_started" } } };
    validateBundle({ rootDir, date, state });
    const store = createStore({ rootDir, date, metadata, state, checkpoint });
    store.persist();
    await archive({ rootDir, date, video, env });
    const failed = [];

    if (env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET && env.YOUTUBE_REFRESH_TOKEN) {
      store.update("youtube", { status: "in_progress", phase: "uploading", safeToRetry: false, attemptId: randomUUID(), attempts: 1 });
      try {
        const result = await uploadYouTube({ rootDir, date, ...youtubeUpload, env,
          onEvent: (event) => store.update("youtube", event) });
        if (!result?.videoId) throw new Error("YouTube response missing video ID");
        store.update("youtube", { ...result, status: "succeeded", safeToRetry: false });
      } catch (error) {
        // The child journals its ID immediately after insert, before thumbnail work.
        const recorded = loadState(rootDir, date).platforms.youtube;
        store.update("youtube", recorded.videoId ? recorded : {
          status: "unknown", safeToRetry: false, reason: "upload_result_unknown",
        });
        console.error(`YouTube upload failed: ${error.message}`);
        failed.push("youtube");
      }
    } else store.update("youtube", { status: "skipped", reason: "credentials_missing", safeToRetry: false });

    if (env.INSTAGRAM_ACCESS_TOKEN && env.INSTAGRAM_USER_ID && env.FACEBOOK_PAGE_ID) {
      try {
        await attemptInstagram({ store, video, caption: metadata.captions.instagram, env, upload: uploadIG });
      } catch (error) {
        console.error(`Instagram upload failed: ${error.message}`);
        failed.push("instagram");
      }
    } else store.update("instagram", { status: "skipped", reason: "credentials_missing", safeToRetry: false });

    console.log(`Posting results: youtube=${state.platforms.youtube.status}, instagram=${state.platforms.instagram.status}`);
    if (failed.length) throw new Error(`SNS upload failed: ${failed.join(", ")}`);
    return state;
  });
}

async function main() {
  const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  const output = join(rootDir, "output");
  const video = argPath(process.argv, "video", rootDir);
  if (!video || !existsSync(video)) throw new Error("Explicit --video=<shared video> required");
  const date = dateFromVideo(video);
  if (existsSync(statePath(rootDir, date))) throw new Error("Posting journal already exists; use guarded Instagram retry");
  execFileSync(process.execPath, ["scripts/generate-caption.mjs"], { cwd: rootDir, stdio: "inherit" });
  const enriched = readJSON(join(rootDir, "data/enriched-trending.json"));
  await postDaily({ rootDir, date, video,
    captions: readJSON(join(output, "captions.json")),
    trendingData: readJSON(join(output, "trending-data.json")),
    audioDurations: readJSON(join(output, "audio-durations.json")),
    discovery: enriched.discovery || null,
    youtubeUpload: resolveYouTubeUpload({ sharedVideo: video, youtubeVideo: argPath(process.argv, "youtube-video", rootDir) }),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(`SNS posting stopped: ${error.message}`); process.exitCode = 1; });
}
