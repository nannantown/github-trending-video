/**
 * Upload video to Instagram Reels via Facebook Graph API.
 *
 * Required environment variables:
 *   INSTAGRAM_ACCESS_TOKEN  - Long-lived User Access Token
 *   INSTAGRAM_USER_ID       - Instagram Business/Creator Account ID
 *   VIDEO_PUBLIC_URL         - Publicly accessible URL of the video
 *                              (set by post-sns.mjs after creating GitHub Release)
 *
 * The Instagram Content Publishing API requires a publicly accessible video URL.
 * This script expects the URL to be provided via environment variable or --url argument.
 *
 * Usage:
 *   node scripts/upload-instagram.mjs --url=https://example.com/video.mp4
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "..", "output");

const GRAPH_API_BASE = "https://graph.facebook.com/v22.0";

// Polling config
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 60; // 5 minutes max

async function graphPost(path, params) {
  const url = new URL(`${GRAPH_API_BASE}${path}`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(
      `Graph API error: ${data.error.message} (code: ${data.error.code})`
    );
  }
  return data;
}

async function graphGet(path, params) {
  const url = new URL(`${GRAPH_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    throw new Error(
      `Graph API error: ${data.error.message} (code: ${data.error.code})`
    );
  }
  return data;
}

function getVideoUrl() {
  // Check --url= argument
  const arg = process.argv.find((a) => a.startsWith("--url="));
  if (arg) return arg.split("=").slice(1).join("=");

  // Check environment variable
  if (process.env.VIDEO_PUBLIC_URL) return process.env.VIDEO_PUBLIC_URL;

  return null;
}

async function waitForMediaReady(igUserId, containerId, accessToken) {
  console.log("  Waiting for media processing...");

  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    const status = await graphGet(`/${containerId}`, {
      fields: "status_code,status",
      access_token: accessToken,
    });

    const code = status.status_code;
    console.log(`  [${i + 1}/${POLL_MAX_ATTEMPTS}] Status: ${code}`);

    if (code === "FINISHED") {
      return true;
    }

    if (code === "ERROR" || code === "EXPIRED") {
      throw new Error(
        `Media processing failed: ${code} - ${status.status || "unknown"}`
      );
    }

    // IN_PROGRESS or PUBLISHED - wait and retry
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error("Media processing timed out after 5 minutes");
}

async function main() {
  const { INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID } = process.env;

  if (!INSTAGRAM_ACCESS_TOKEN || !INSTAGRAM_USER_ID) {
    console.log("Instagram: credentials not configured, skipping upload.");
    console.log("  Set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_USER_ID");
    return { skipped: true };
  }

  const videoUrl = getVideoUrl();
  if (!videoUrl) {
    console.log("Instagram: no video URL provided, skipping upload.");
    console.log("  Set VIDEO_PUBLIC_URL or pass --url=<url>");
    return { skipped: true };
  }

  console.log(`Instagram: uploading Reel`);
  console.log(`  Video URL: ${videoUrl}`);

  // Load captions
  const captions = JSON.parse(
    readFileSync(join(outputDir, "captions.json"), "utf-8")
  );
  const caption = captions.instagram;
  console.log(`  Caption: ${caption.substring(0, 80)}...`);

  // Step 1: Create media container
  console.log("  Creating media container...");
  const container = await graphPost(`/${INSTAGRAM_USER_ID}/media`, {
    media_type: "REELS",
    video_url: videoUrl,
    caption,
    share_to_feed: true,
    access_token: INSTAGRAM_ACCESS_TOKEN,
  });

  const containerId = container.id;
  console.log(`  Container ID: ${containerId}`);

  // Step 2: Wait for processing
  await waitForMediaReady(INSTAGRAM_USER_ID, containerId, INSTAGRAM_ACCESS_TOKEN);

  // Step 3: Publish
  console.log("  Publishing...");
  const published = await graphPost(`/${INSTAGRAM_USER_ID}/media_publish`, {
    creation_id: containerId,
    access_token: INSTAGRAM_ACCESS_TOKEN,
  });

  const mediaId = published.id;
  console.log(`  Published! Media ID: ${mediaId}`);

  return { mediaId };
}

main()
  .then((result) => {
    if (result && !result.skipped) {
      console.log(`Instagram upload complete: Media ID ${result.mediaId}`);
    }
  })
  .catch((err) => {
    console.error("Instagram upload failed:", err.message);
    process.exit(1);
  });
