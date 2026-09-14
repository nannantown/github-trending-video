/**
 * Full pipeline: scrape → generate data → generate audio → render video
 * Usage: node scripts/pipeline.mjs
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { switchOn } from "./yt-experiment-switches.mjs";
import { renderYouTubeVariant } from "./youtube-variant.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

// Step 4d (YouTube-only render) must be finished this long after the pipeline
// starts. daily-video.yml runs the job with timeout-minutes: 20; setup before
// this script takes ~1 min (2026-09-14: 40s) and posting needs up to ~7 min
// (Instagram waits up to 5 min for media processing), so 20 − 2 − 8 = 10 min.
// A normal day finishes Step 4d ~4 min after start. Keep in sync with the
// workflow's timeout-minutes.
const YOUTUBE_VARIANT_DEADLINE_MS = 10 * 60 * 1000;
const outputDir = join(rootDir, "output");

function run(cmd, opts = {}) {
  console.log(`\n>>> ${cmd}\n`);
  execSync(cmd, { cwd: rootDir, stdio: "inherit", ...opts });
}

function runSafe(cmd, label) {
  try {
    run(cmd);
  } catch (err) {
    console.error(`${label} failed (non-blocking): ${err.message}`);
  }
}

function main() {
  const startedAt = Date.now();
  mkdirSync(outputDir, { recursive: true });

  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

  // Step 0: Fetch past video stats & generate optimization hints
  console.log("=== Step 0: Fetch Stats & Optimize ===");
  runSafe("node scripts/fetch-stats.mjs", "fetch-stats");

  // Step 1: Generate Japanese data from Claude-enriched input
  // (No scraping — data/enriched-trending.json is the single source of truth,
  //  produced by Claude's scheduled task ~30 min before this workflow runs.)
  console.log("\n=== Step 1: Generate Data ===");
  run("node scripts/generate-data.mjs");

  // Step 2: Generate TTS audio + BGM
  console.log("\n=== Step 2: Generate Audio ===");
  run("node scripts/generate-audio.mjs --data=output/trending-data.json");
  run("node scripts/generate-bgm.mjs");

  // Step 3: Build input props for Remotion
  console.log("\n=== Step 3: Build Input Props ===");
  const trendingData = JSON.parse(
    readFileSync(join(outputDir, "trending-data.json"), "utf-8")
  );
  const audioDurations = JSON.parse(
    readFileSync(join(outputDir, "audio-durations.json"), "utf-8")
  );
  const subtitles = JSON.parse(
    readFileSync(join(outputDir, "subtitles.json"), "utf-8")
  );

  const inputProps = {
    projects: trendingData.projects,
    audioDurations,
    subtitles,
  };

  const propsPath = join(outputDir, "input-props.json");
  writeFileSync(propsPath, JSON.stringify(inputProps));
  console.log(`Input props → ${propsPath}`);

  // Step 4: Render video (to intermediate file — Remotion emits yuvj420p
  //         despite Config.setPixelFormat("yuv420p"); Instagram Reels rejects
  //         yuvj420p with ProcessingFailedError during media processing.
  //         Step 4b re-encodes to yuv420p as a guaranteed normalization pass.)
  const rawFile = `output/trending-${dateStr}.raw.mp4`;
  const outputFile = `output/trending-${dateStr}.mp4`;
  console.log(`\n=== Step 4: Render Video → ${rawFile} ===`);
  run(`npx remotion render TrendingVideo "${rawFile}" --props="${propsPath}"`);

  console.log(`\n=== Step 4b: Normalize to yuv420p → ${outputFile} ===`);
  run(
    `ffmpeg -y -i "${rawFile}" -c:v libx264 -pix_fmt yuv420p -profile:v high -level 4.0 -crf 20 -preset fast -c:a copy -movflags +faststart "${outputFile}"`
  );
  run(`rm -f "${rawFile}"`);

  // Step 4c: Render cover image (frame 60 = ~2s into opening, all fade-ins
  //          complete: date + brand title + divider + subtitle all visible).
  //          Uploaded to GitHub Release and passed as cover_url to IG so the
  //          profile-grid thumbnail shows branded content, not a black frame.
  //          Non-blocking: if still render fails, pipeline continues and IG
  //          falls back to thumb_offset=7000ms.
  const coverFile = `output/trending-${dateStr}-cover.jpg`;
  console.log(`\n=== Step 4c: Render Cover Image → ${coverFile} ===`);
  runSafe(
    `npx remotion still TrendingVideo "${coverFile}" --frame=60 --props="${propsPath}"`,
    "render-cover"
  );

  // Step 4d: YouTube-only render (2026-09-14 distribution experiment B).
  //          Same props + openingVariant="top1": the day's TOP1 repo is on
  //          screen from frame 0, so YouTube no longer receives a first second
  //          (and auto-thumbnail) that is identical every day. The shared
  //          render above stays exactly as it was and goes to Instagram.
  //          Its frame-60 still becomes the YouTube thumbnail.
  //          Non-blocking and time-boxed (YOUTUBE_VARIANT_DEADLINE_MS): on any
  //          failure or timeout YouTube falls back to the shared video, so the
  //          Instagram post is never delayed past the job budget by this step.
  let youtubeVideoFile = null;
  if (switchOn(process.env.YT_OPENING_HOOK, "YT_OPENING_HOOK")) {
    console.log(`\n=== Step 4d: Render YouTube Variant (TOP1 opening) → output/trending-${dateStr}-youtube.mp4 ===`);
    youtubeVideoFile = renderYouTubeVariant({
      inputProps,
      sharedVideo: outputFile,
      outputDir,
      deadline: startedAt + YOUTUBE_VARIANT_DEADLINE_MS,
      run,
      writeFile: writeFileSync,
    });
  } else {
    console.log(
      `\n=== Step 4d: YouTube variant skipped (YT_OPENING_HOOK is off) — YouTube uses the shared video ===`
    );
  }

  // Step 5: Post to SNS (optional - skips if credentials not configured)
  const snsEnabled = process.env.SNS_POST_ENABLED === "true";
  if (snsEnabled) {
    console.log(`\n=== Step 5: Post to SNS ===`);
    const youtubeArg = youtubeVideoFile ? ` --youtube-video="${youtubeVideoFile}"` : "";
    run(`node scripts/post-sns.mjs --video="${outputFile}"${youtubeArg}`);
  } else {
    console.log(`\n=== Step 5: SNS posting skipped (set SNS_POST_ENABLED=true to enable) ===`);
  }

  // Step 6: Record upload for analytics tracking
  if (snsEnabled) {
    console.log(`\n=== Step 6: Record Upload ===`);
    runSafe("node scripts/record-upload.mjs", "record-upload");
  }

  console.log(`\n=== Done! ${outputFile} ===`);
}

main();
