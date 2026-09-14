/**
 * YouTube-only video variant — 2026-09-14 distribution experiment B.
 *
 * The daily video used to be one file shared by Instagram and YouTube.
 * Instagram performs well (median ~900–1,300 views) and is the control for
 * this experiment, so it must not change. The "day-specific first frame" for
 * YouTube therefore lives in a second render of the same props with
 * openingVariant="top1":
 *
 *   output/trending-YYYYMMDD.mp4                shared render → Instagram (unchanged)
 *   output/trending-YYYYMMDD-cover.jpg          shared cover  → GitHub Release (unchanged)
 *   output/trending-YYYYMMDD-youtube.mp4        TOP1 opening  → YouTube
 *   output/trending-YYYYMMDD-youtube-cover.jpg  frame 60 of the YouTube render → thumbnails.set
 *
 * When the YouTube render is missing (render failed, out of time budget, or
 * YT_OPENING_HOOK off) YouTube falls back to the shared video, so the daily
 * upload never depends on the experiment.
 */

import { existsSync } from "fs";
import { join } from "path";

export const YOUTUBE_VARIANT_SUFFIX = "-youtube";

/**
 * Minimum time budget worth starting the YouTube render with. On ubuntu-latest
 * the shared render takes ~85s + ~20s encode + ~2s still (2026-09-14 run).
 */
export const MIN_VARIANT_BUDGET_MS = 150 * 1000;

/** Same normalization as pipeline.mjs Step 4b, so both files differ only in the opening. */
const NORMALIZE_ARGS =
  "-c:v libx264 -pix_fmt yuv420p -profile:v high -level 4.0 -crf 20 -preset fast -c:a copy -movflags +faststart";

/** trending-YYYYMMDD.mp4 → trending-YYYYMMDD-cover.jpg (same rule for both renders). */
export function coverPathFor(videoPath) {
  return videoPath.replace(/\.mp4$/, "-cover.jpg");
}

/** trending-YYYYMMDD.mp4 → trending-YYYYMMDD-youtube.mp4 */
export function youtubeVideoPathFor(sharedVideoPath) {
  return sharedVideoPath.replace(/\.mp4$/, `${YOUTUBE_VARIANT_SUFFIX}.mp4`);
}

export function isYouTubeVariantFile(path) {
  return /(^|\/)trending-\d{8}-youtube\.mp4$/.test(String(path ?? ""));
}

/** The shared (Instagram) render only — never a -youtube or .raw intermediate. */
export function isSharedVideoFile(path) {
  return /(^|\/)trending-\d{8}\.mp4$/.test(String(path ?? ""));
}

/** Opening arm of a file, for manual uploads that do not pass --opening-variant. */
export function openingVariantForFile(path) {
  return isYouTubeVariantFile(path) ? "top1" : "brand";
}

/** `--name=path` → absolute path (relative paths resolve against baseDir), or null. */
export function argPath(argv, name, baseDir) {
  const prefix = `--${name}=`;
  const arg = argv.find((a) => a.startsWith(prefix));
  if (!arg) return null;
  const p = arg.slice(prefix.length);
  if (!p) return null;
  return p.startsWith("/") ? p : join(baseDir, p);
}

/**
 * What post-sns.mjs hands to upload-youtube.mjs.
 *
 * @param {object} args
 * @param {string} args.sharedVideo   the Instagram / shared render
 * @param {string|null} [args.youtubeVideo]  the YouTube render, if the pipeline produced one
 * @param {(p: string) => boolean} [args.exists]
 * @returns {{ video: string, openingVariant: "top1"|"brand", thumbnail: string|null, fellBack: boolean }}
 */
export function resolveYouTubeUpload({ sharedVideo, youtubeVideo = null, exists = existsSync }) {
  if (youtubeVideo && exists(youtubeVideo)) {
    const cover = coverPathFor(youtubeVideo);
    return {
      video: youtubeVideo,
      openingVariant: "top1",
      thumbnail: exists(cover) ? cover : null,
      fellBack: false,
    };
  }
  // The shared cover is the brand frame (same every day), so it is never used
  // as the YouTube thumbnail — YouTube keeps its auto-picked frame instead.
  return {
    video: sharedVideo,
    openingVariant: "brand",
    thumbnail: null,
    fellBack: Boolean(youtubeVideo),
  };
}

/**
 * pipeline.mjs Step 4d: render + normalize the YouTube-only video and its
 * cover within the time budget. Never throws. Returns the YouTube video path,
 * or null when YouTube must fall back to the shared video.
 *
 * @param {object} args
 * @param {object} args.inputProps     the shared render's props
 * @param {string} args.sharedVideo    e.g. "output/trending-20260914.mp4"
 * @param {string} args.outputDir      where input-props-youtube.json is written
 * @param {number} args.deadline       epoch ms by which all of this must be done
 * @param {(cmd: string, opts?: object) => void} args.run  execSync-style runner (throws on failure/timeout)
 * @param {(path: string, data: string) => void} args.writeFile
 */
export function renderYouTubeVariant({
  inputProps,
  sharedVideo,
  outputDir,
  deadline,
  run,
  writeFile,
  now = Date.now,
  log = console.log,
  logError = console.error,
  minBudgetMs = MIN_VARIANT_BUDGET_MS,
}) {
  const video = youtubeVideoPathFor(sharedVideo);
  const raw = video.replace(/\.mp4$/, ".raw.mp4");
  const cover = coverPathFor(video);
  const left = () => deadline - now();

  if (left() < minBudgetMs) {
    log(
      `YouTube variant skipped: ${Math.max(0, Math.round(left() / 1000))}s left of the time budget (needs ${Math.round(minBudgetMs / 1000)}s) — YouTube uses the shared video.`
    );
    return null;
  }

  const budget = (step) => {
    const ms = left();
    if (ms < 1000) throw new Error(`time budget exhausted before ${step}`);
    return ms;
  };
  const remove = (path) => {
    try {
      run(`rm -f "${path}"`);
    } catch (err) {
      logError(`cleanup of ${path} failed: ${err.message}`);
    }
  };

  let rendered = false;
  try {
    const propsPath = join(outputDir, "input-props-youtube.json");
    writeFile(propsPath, JSON.stringify({ ...inputProps, openingVariant: "top1" }));
    run(`npx remotion render TrendingVideo "${raw}" --props="${propsPath}"`, { timeout: budget("render") });
    run(`ffmpeg -y -i "${raw}" ${NORMALIZE_ARGS} "${video}"`, { timeout: budget("encode") });
    rendered = true;

    try {
      run(`npx remotion still TrendingVideo "${cover}" --frame=60 --props="${propsPath}"`, {
        timeout: budget("cover"),
      });
    } catch (err) {
      logError(`YouTube cover render failed (non-blocking — no custom thumbnail today): ${err.message}`);
      remove(cover);
    }
  } catch (err) {
    logError(`YouTube variant render failed (non-blocking — YouTube falls back to the shared video): ${err.message}`);
    // A half-written file must never be picked up as the YouTube upload.
    remove(video);
  } finally {
    remove(raw);
  }
  return rendered ? video : null;
}

/** Compact, history-friendly form of upload-youtube.mjs's thumbnail result. */
export function summarizeThumbnail(result) {
  if (!result) return null;
  if (result.set) return "set";
  if (result.skipped) return `skipped:${result.skipped}`;
  if (result.error !== undefined) return result.reasons ? `error:${result.reasons}` : "error";
  return null;
}
