/**
 * Upload video to Instagram Reels via Facebook Graph API (resumable upload).
 *
 * Required environment variables:
 *   INSTAGRAM_ACCESS_TOKEN  - Long-lived User Access Token
 *   INSTAGRAM_USER_ID       - Instagram Business/Creator Account ID
 *   FACEBOOK_PAGE_ID        - Facebook Page ID linked to the IG Business Account.
 *                             We derive a Page Access Token from the user token
 *                             at runtime and use it for /media and /media_publish,
 *                             because IG content publishing through a Business
 *                             Portfolio-owned Page returns (#10) Missing Permission
 *                             when called with a plain User token.
 *
 * Usage:
 *   node scripts/upload-instagram.mjs --file=output/trending-20260417.mp4
 *   node scripts/upload-instagram.mjs --url=https://example.com/video.mp4
 *
 * --file uses the resumable upload path (recommended — avoids IG's URL
 * fetcher which frequently rejects valid external URLs with the generic
 * "Media upload has failed" 2207076 error).
 * --url falls back to URL-based upload (kept for backwards compatibility).
 */

import { readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "..", "output");

const GRAPH_API_BASE = "https://graph.facebook.com/v22.0";

const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 60;

// Thumbnail is taken from this offset (ms) within the video.
// Default 7000ms lands on the first content card, past the ~5.5s opening —
// avoids the near-black fade-in at frame 0 that IG picks otherwise.
const DEFAULT_THUMB_OFFSET_MS = 7000;
const THUMB_OFFSET_MS = Number(
  process.env.INSTAGRAM_THUMB_OFFSET_MS ?? DEFAULT_THUMB_OFFSET_MS
);

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

function getArg(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (arg) return arg.split("=").slice(1).join("=");
  return null;
}

function getVideoSource() {
  const file = getArg("file");
  if (file) return { type: "file", value: file };
  const url = getArg("url") || process.env.VIDEO_PUBLIC_URL;
  if (url) return { type: "url", value: url };
  return null;
}

async function waitForMediaReady(containerId, accessToken) {
  console.log("  Waiting for media processing...");
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    const status = await graphGet(`/${containerId}`, {
      fields: "status_code,status",
      access_token: accessToken,
    });
    const code = status.status_code;
    console.log(`  [${i + 1}/${POLL_MAX_ATTEMPTS}] Status: ${code}`);
    if (code === "FINISHED") return true;
    if (code === "ERROR" || code === "EXPIRED") {
      throw new Error(
        `Media processing failed: ${code} - ${status.status || "unknown"}`
      );
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("Media processing timed out after 5 minutes");
}

async function derivePageAccessToken(pageId, userToken) {
  const data = await graphGet(`/${pageId}`, {
    fields: "access_token",
    access_token: userToken,
  });
  if (!data.access_token) {
    throw new Error(
      `Could not derive Page Access Token for page ${pageId}.`
    );
  }
  return data.access_token;
}

async function createResumableContainer(igUserId, pageToken, caption) {
  const form = new URLSearchParams({
    media_type: "REELS",
    upload_type: "resumable",
    caption,
    thumb_offset: String(THUMB_OFFSET_MS),
    access_token: pageToken,
  });
  const res = await fetch(`${GRAPH_API_BASE}/${igUserId}/media`, {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(
      `Graph API error: ${data.error.message} (code: ${data.error.code})`
    );
  }
  if (!data.id || !data.uri) {
    throw new Error(
      `Resumable container response missing id/uri: ${JSON.stringify(data)}`
    );
  }
  return data;
}

async function uploadVideoBinary(uploadUri, filePath, accessToken) {
  const fileSize = statSync(filePath).size;
  const fileBytes = readFileSync(filePath);
  const res = await fetch(uploadUri, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${accessToken}`,
      offset: "0",
      file_size: String(fileSize),
    },
    body: fileBytes,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Upload returned non-JSON (${res.status}): ${text}`);
  }
  if (!res.ok || data.error) {
    throw new Error(
      `Binary upload failed (${res.status}): ${JSON.stringify(data)}`
    );
  }
  return data;
}

async function uploadViaResumable(igUserId, pageToken, filePath, caption) {
  console.log("  Creating resumable container...");
  const { id: containerId, uri: uploadUri } = await createResumableContainer(
    igUserId,
    pageToken,
    caption
  );
  console.log(`  Container ID: ${containerId}`);
  console.log(
    `  Uploading ${(statSync(filePath).size / 1024 / 1024).toFixed(1)} MB...`
  );
  await uploadVideoBinary(uploadUri, filePath, pageToken);
  return containerId;
}

async function uploadViaUrl(igUserId, pageToken, videoUrl, caption) {
  console.log("  Creating URL-based container...");
  const container = await graphPost(`/${igUserId}/media`, {
    media_type: "REELS",
    video_url: videoUrl,
    caption,
    share_to_feed: true,
    thumb_offset: THUMB_OFFSET_MS,
    access_token: pageToken,
  });
  console.log(`  Container ID: ${container.id}`);
  return container.id;
}

async function main() {
  const { INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID, FACEBOOK_PAGE_ID } =
    process.env;

  if (!INSTAGRAM_ACCESS_TOKEN || !INSTAGRAM_USER_ID || !FACEBOOK_PAGE_ID) {
    console.log("Instagram: credentials not configured, skipping upload.");
    console.log(
      "  Set INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID, FACEBOOK_PAGE_ID"
    );
    return { skipped: true };
  }

  const source = getVideoSource();
  if (!source) {
    console.log("Instagram: no video source provided, skipping upload.");
    console.log("  Pass --file=<path> or --url=<url>");
    return { skipped: true };
  }

  console.log(`Instagram: uploading Reel via ${source.type}`);
  console.log(`  Source: ${source.value}`);

  const captions = JSON.parse(
    readFileSync(join(outputDir, "captions.json"), "utf-8")
  );
  const caption = captions.instagram;
  console.log(`  Caption: ${caption.substring(0, 80)}...`);

  console.log("  Deriving Page Access Token...");
  const pageToken = await derivePageAccessToken(
    FACEBOOK_PAGE_ID,
    INSTAGRAM_ACCESS_TOKEN
  );

  let containerId;
  if (source.type === "file") {
    containerId = await uploadViaResumable(
      INSTAGRAM_USER_ID,
      pageToken,
      source.value,
      caption
    );
  } else {
    containerId = await uploadViaUrl(
      INSTAGRAM_USER_ID,
      pageToken,
      source.value,
      caption
    );
  }

  await waitForMediaReady(containerId, pageToken);

  console.log("  Publishing...");
  const published = await graphPost(`/${INSTAGRAM_USER_ID}/media_publish`, {
    creation_id: containerId,
    access_token: pageToken,
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
