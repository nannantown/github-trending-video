/**
 * The YouTube thumbnail is the Instagram Reels cover — the same picture on both
 * (owner decision 2026-10-28: 「YouTube のサムネイル…インスタグラムのサムネイルと同じにしようか」).
 *
 * Instagram takes the cover from the shared video (trending-YYYYMMDD.mp4) at `thumb_offset`.
 * post-sns.mjs cuts the frame at that same offset out of that same file with ffmpeg and hands
 * it to upload-youtube.mjs (thumbnails.set) — also on days YouTube gets its own TOP1-opening
 * render, so the YouTube video may differ but its thumbnail is Instagram's cover. The Instagram
 * post itself is untouched: upload-instagram.mjs reads the offset from here, same value as before.
 *
 * Primary sources (read 2026-10-28):
 * - Instagram Graph API, IG User Media: thumb_offset is the "Location, in milliseconds, of the
 *   video or reel frame to be used as the cover thumbnail image" (default 0; cover_url wins).
 * - YouTube Data API thumbnails.set (page updated 2026-10-15): image/jpeg or image/png, up to
 *   50 MB; 403 forbidden when the user may not set custom thumbnails.
 * - YouTube Help answer/72431: Shorts thumbnails 9:16, at least 640 px high; the account must be
 *   verified. The 1080×1920 frame is already 9:16, so it is sent as is (no crop, no letterbox).
 */
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";

const FFMPEG_TIMEOUT_MS = 60_000;

/** thumb_offset exactly as Instagram has always received it (string, ms; default 7000). */
export function instagramThumbOffset(env = process.env) {
  return String(env.INSTAGRAM_THUMB_OFFSET_MS ?? 7000);
}

/**
 * Cut the frame at offsetMs out of video into out (JPEG). Returns its size in bytes.
 * Throws when ffmpeg fails or no frame came out (e.g. the offset is past the end).
 */
export function extractCoverFrame({ video, offsetMs, out, exec = execFileSync }) {
  if (!Number.isFinite(offsetMs) || offsetMs < 0) throw new Error(`invalid cover offset: ${offsetMs}`);
  rmSync(out, { force: true }); // a frame left by an earlier run must never be sent
  // -ss before -i seeks, then decodes up to the exact timestamp (frame-accurate when decoding).
  try {
    exec("ffmpeg", ["-y", "-v", "error", "-ss", (offsetMs / 1000).toFixed(3), "-i", video, "-frames:v", "1", "-q:v", "2", out],
      { stdio: ["ignore", "inherit", "inherit"], timeout: FFMPEG_TIMEOUT_MS });
  } catch (err) {
    throw new Error(`no frame at ${offsetMs} ms in ${video} (ffmpeg: ${String(err.message).split("\n")[0]})`);
  }
  const bytes = existsSync(out) ? statSync(out).size : 0;
  if (!bytes) throw new Error(`no frame at ${offsetMs} ms in ${video}`);
  return bytes;
}

/** trending-YYYYMMDD.mp4 → trending-YYYYMMDD-ig-cover.jpg (the artifact's *-cover.jpg glob keeps it). */
export function igCoverPathFor(sharedVideo) {
  return sharedVideo.replace(/\.mp4$/, "-ig-cover.jpg");
}

/**
 * The thumbnail to hand upload-youtube.mjs: the Instagram cover frame of the shared video, or
 * null (YouTube then keeps its own frame). Never throws — the upload must not depend on it.
 */
export function instagramCoverForYouTube({ video, env = process.env, extract = extractCoverFrame, logError = console.error }) {
  const offsetMs = Number(instagramThumbOffset(env));
  const out = igCoverPathFor(video);
  try {
    extract({ video, offsetMs, out });
    return out;
  } catch (err) {
    logError(`  Thumbnail: no Instagram cover frame (YouTube keeps its own frame): ${err.message}`);
    return null;
  }
}
