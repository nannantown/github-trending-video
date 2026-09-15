/**
 * Upload video to YouTube Shorts via YouTube Data API v3.
 *
 * Required environment variables:
 *   YOUTUBE_CLIENT_ID      - OAuth 2.0 Client ID
 *   YOUTUBE_CLIENT_SECRET  - OAuth 2.0 Client Secret
 *   YOUTUBE_REFRESH_TOKEN  - OAuth 2.0 Refresh Token
 *
 * Optional:
 *   YT_SET_THUMBNAIL=false - skip the custom-thumbnail step (experiment B kill switch)
 *
 * Usage:
 *   node scripts/upload-youtube.mjs --video=output/trending-20260405.mp4
 *     [--opening-variant=top1|brand]   recorded in upload-result.json (experiment B arm)
 *     [--thumbnail=output/trending-20260405-youtube-cover.jpg]
 */

import { google } from "googleapis";
import { readFileSync, writeFileSync, createReadStream, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { switchOn } from "./yt-experiment-switches.mjs";
import { openingVariantForFile } from "./youtube-variant.mjs";
import { errorReasons, insertWithLegacyFallback } from "./youtube-upload.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "..", "output");

// thumbnails.set accepts image/jpeg or image/png up to 2 MB
// (https://developers.google.com/youtube/v3/docs/thumbnails/set).
const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
// The Instagram upload runs after this script; a hanging thumbnail request must not eat the job budget.
const THUMBNAIL_TIMEOUT_MS = 30 * 1000;

function getVideoPath() {
  const arg = process.argv.find((a) => a.startsWith("--video="));
  if (arg) {
    const p = arg.split("=")[1];
    // If absolute path, use as-is; otherwise resolve relative to project root
    return p.startsWith("/") ? p : join(__dirname, "..", p);
  }

  // Auto-detect: find latest trending-YYYYMMDD.mp4
  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  return join(outputDir, `trending-${dateStr}.mp4`);
}

function argValue(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : undefined;
}

function resolvePath(p) {
  return p.startsWith("/") ? p : join(__dirname, "..", p);
}

/**
 * Experiment B (2026-09-14): best-effort day-specific thumbnail — the frame-60
 * still of the YouTube-only render (9:16, TOP1 repo name in frame). Only
 * attempted when post-sns.mjs passes --thumbnail (i.e. the YouTube render
 * exists). Non-blocking: any failure is logged and the upload still counts.
 *
 * Expected failure mode: 403 `forbidden`. YouTube Help (answer/72431, checked
 * 2026-09-14) says custom thumbnails for Shorts require a verified account and
 * are rolling out to YouTube Partner Program creators first; the API docs do
 * not mention Shorts. The result is recorded in performance-history
 * (`ytThumbnail`) so we learn whether it applies to this channel. The first
 * frame of the YouTube render carries the TOP1 name either way.
 */
async function setThumbnail(youtube, videoId, thumbnailPath) {
  if (!switchOn(process.env.YT_SET_THUMBNAIL, "YT_SET_THUMBNAIL")) {
    console.log("  Thumbnail: skipped (YT_SET_THUMBNAIL is off)");
    return { skipped: "disabled" };
  }
  if (!thumbnailPath) {
    console.log("  Thumbnail: skipped (no YouTube cover — YouTube keeps its auto-picked frame)");
    return { skipped: "no-thumbnail" };
  }
  const coverPath = resolvePath(thumbnailPath);
  if (!existsSync(coverPath)) {
    console.log(`  Thumbnail: skipped (no cover image at ${coverPath})`);
    return { skipped: "no-cover" };
  }
  const size = statSync(coverPath).size;
  if (size > THUMBNAIL_MAX_BYTES) {
    console.log(`  Thumbnail: skipped (cover is ${size} bytes, limit ${THUMBNAIL_MAX_BYTES})`);
    return { skipped: "too-large" };
  }

  try {
    await youtube.thumbnails.set(
      {
        videoId,
        media: { mimeType: "image/jpeg", body: createReadStream(coverPath) },
      },
      { timeout: THUMBNAIL_TIMEOUT_MS }
    );
    console.log(`  Thumbnail: set from ${coverPath} (${size} bytes)`);
    return { set: true };
  } catch (err) {
    const reasons = errorReasons(err);
    console.error(
      `  Thumbnail: failed (non-blocking): ${err.message}${reasons.length ? ` [${reasons.join(", ")}]` : ""}`
    );
    if (reasons.includes("forbidden")) {
      console.error(
        "  Thumbnail: this channel cannot set custom thumbnails on Shorts yet (verified account required; rolling out to YPP creators first). Upload is unaffected."
      );
    }
    return { error: err.message, reasons: reasons.join(", ") };
  }
}

async function main() {
  const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN } =
    process.env;

  if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET || !YOUTUBE_REFRESH_TOKEN) {
    console.log("YouTube: credentials not configured, skipping upload.");
    console.log(
      "  Set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN"
    );
    return { skipped: true };
  }

  const videoPath = getVideoPath();
  console.log(`YouTube: uploading ${videoPath}`);

  // Load captions
  const captions = JSON.parse(
    readFileSync(join(outputDir, "captions.json"), "utf-8")
  );
  const yt = captions.youtube;
  const metadata = {
    title: yt.title,
    description: yt.description,
    tags: yt.tags,
    categoryId: yt.categoryId,
    titleTemplate: yt.titleTemplate || "standard",
  };

  // Set up OAuth2 client
  const oauth2 = new google.auth.OAuth2(
    YOUTUBE_CLIENT_ID,
    YOUTUBE_CLIENT_SECRET,
    "urn:ietf:wg:oauth:2.0:oob"
  );
  oauth2.setCredentials({ refresh_token: YOUTUBE_REFRESH_TOKEN });

  const youtube = google.youtube({ version: "v3", auth: oauth2 });

  const openingVariant = argValue("opening-variant") || openingVariantForFile(videoPath);
  const thumbnailPath = argValue("thumbnail") || null;

  // Upload video
  console.log(`  Title: ${metadata.title}`);
  console.log(`  Title template: ${metadata.titleTemplate}`);
  console.log(`  Opening variant: ${openingVariant}`);
  console.log(`  Uploading...`);

  // The experiment must never cost the day's upload: if YouTube rejects the
  // individualized title/description, retry once with the legacy metadata.
  const { res, metadata: uploaded } = await insertWithLegacyFallback({
    youtube,
    videoPath,
    metadata,
    fallback: yt.fallback,
  });

  const videoId = res.data.id;
  const videoUrl = `https://youtube.com/shorts/${videoId}`;
  console.log(`  Uploaded! ${videoUrl}`);

  // Persist upload result for analytics tracking — right after the insert, so
  // the day's videoId is recorded even if the thumbnail step below fails.
  const resultPath = join(outputDir, "upload-result.json");
  const uploadResult = {
    videoId,
    videoUrl,
    uploadedAt: new Date().toISOString(),
    title: uploaded.title,
    titleTemplate: uploaded.titleTemplate,
    openingVariant,
    thumbnail: null,
  };
  writeFileSync(resultPath, JSON.stringify(uploadResult, null, 2));

  // Experiment B: day-specific thumbnail (non-blocking, time-boxed)
  uploadResult.thumbnail = await setThumbnail(youtube, videoId, thumbnailPath);
  writeFileSync(resultPath, JSON.stringify(uploadResult, null, 2));

  return { videoId, videoUrl };
}

main()
  .then((result) => {
    if (result && !result.skipped) {
      console.log(`YouTube upload complete: ${result.videoUrl}`);
    }
  })
  .catch((err) => {
    console.error("YouTube upload failed:", err.message);
    // gaxios 7 keeps the API's error list in the response body, not on err.errors.
    const reasons = errorReasons(err);
    if (reasons.length) console.error(`  reasons: ${reasons.join(", ")}`);
    process.exit(1);
  });
