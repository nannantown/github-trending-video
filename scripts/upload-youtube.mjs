/**
 * Upload video to YouTube Shorts via YouTube Data API v3.
 *
 * Required environment variables:
 *   YOUTUBE_CLIENT_ID      - OAuth 2.0 Client ID
 *   YOUTUBE_CLIENT_SECRET  - OAuth 2.0 Client Secret
 *   YOUTUBE_REFRESH_TOKEN  - OAuth 2.0 Refresh Token
 *
 * Usage:
 *   node scripts/upload-youtube.mjs --video=output/trending-20260405.mp4
 */

import { google } from "googleapis";
import { readFileSync, writeFileSync, createReadStream } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "..", "output");

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
  const { title, description, tags, categoryId } = captions.youtube;

  // Set up OAuth2 client
  const oauth2 = new google.auth.OAuth2(
    YOUTUBE_CLIENT_ID,
    YOUTUBE_CLIENT_SECRET,
    "urn:ietf:wg:oauth:2.0:oob"
  );
  oauth2.setCredentials({ refresh_token: YOUTUBE_REFRESH_TOKEN });

  const youtube = google.youtube({ version: "v3", auth: oauth2 });

  // Upload video
  console.log(`  Title: ${title}`);
  console.log(`  Uploading...`);

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title,
        description,
        tags,
        categoryId,
        defaultLanguage: "ja",
        defaultAudioLanguage: "ja",
      },
      status: {
        privacyStatus: "public",
        selfDeclaredMadeForKids: false,
        madeForKids: false,
      },
    },
    media: {
      body: createReadStream(videoPath),
    },
  });

  const videoId = res.data.id;
  const videoUrl = `https://youtube.com/shorts/${videoId}`;
  console.log(`  Uploaded! ${videoUrl}`);

  // Persist upload result for analytics tracking
  const uploadResult = { videoId, videoUrl, uploadedAt: new Date().toISOString() };
  writeFileSync(join(outputDir, "upload-result.json"), JSON.stringify(uploadResult, null, 2));

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
    if (err.errors) {
      for (const e of err.errors) {
        console.error(`  - ${e.reason}: ${e.message}`);
      }
    }
    process.exit(1);
  });
