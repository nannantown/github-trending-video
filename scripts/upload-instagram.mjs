/** Instagram Reels transport. The tracked orchestrators own the posting journal. */
import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

const GRAPH_API_BASE = "https://graph.facebook.com/v22.0";

export async function uploadInstagram({
  source, caption, env = process.env, onEvent,
  fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pollAttempts = 60,
}) {
  const { INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID, FACEBOOK_PAGE_ID } = env;
  if (!INSTAGRAM_ACCESS_TOKEN || !INSTAGRAM_USER_ID || !FACEBOOK_PAGE_ID) throw new Error("Instagram credentials missing");
  if (!onEvent) throw new Error("Tracked posting callback required");
  if (!source || typeof caption !== "string" || !caption.trim()) throw new Error("Video source/caption missing");
  if (source.type === "file" && statSync(source.value).size === 0) throw new Error("Empty video");
  const thumbOffset = String(env.INSTAGRAM_THUMB_OFFSET_MS ?? 7000);

  async function graph(path, params, method = "GET", form = false) {
    const url = new URL(`${GRAPH_API_BASE}${path}`);
    const opts = { method, signal: AbortSignal.timeout(30_000) };
    if (method === "GET") {
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    } else if (form) opts.body = new URLSearchParams(params);
    else {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(params);
    }
    const res = await fetchImpl(url, opts);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(`Graph API error (${res.status}): ${data.error?.message || "request failed"}`);
    return data;
  }

  const page = await graph(`/${FACEBOOK_PAGE_ID}`, { fields: "access_token", access_token: INSTAGRAM_ACCESS_TOKEN });
  if (!page.access_token) throw new Error("Could not derive Page Access Token");
  const pageToken = page.access_token;
  let containerId;
  if (source.type === "file") {
    // Retrying binary processing failures is safe: no media_publish has happened.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const container = await graph(`/${INSTAGRAM_USER_ID}/media`, {
        media_type: "REELS", upload_type: "resumable", caption,
        thumb_offset: thumbOffset, access_token: pageToken,
      }, "POST", true);
      if (!container.id) throw new Error("Resumable container response missing ID");
      containerId = container.id;
      await onEvent({ phase: "uploading", containerId });
      if (!container.uri) throw new Error("Resumable container response missing upload URI");
      try {
        const res = await fetchImpl(container.uri, {
          method: "POST", signal: AbortSignal.timeout(180_000),
          headers: { Authorization: `OAuth ${pageToken}`, offset: "0", file_size: String(statSync(source.value).size) },
          body: readFileSync(source.value),
        });
        const data = await res.json();
        if (!res.ok || data.error || data.success !== true) {
          const type = data.error?.type || data.debug_info?.type || "";
          const message = data.error?.message || data.debug_info?.message || "upload not acknowledged";
          throw new Error(`Binary upload failed (${res.status}): ${type} ${message}`);
        }
        break;
      } catch (error) {
        if (!error.message.includes("ProcessingFailedError") || attempt === 3) throw error;
        await sleep(attempt * 30_000);
      }
    }
  } else if (source.type === "url") {
    const container = await graph(`/${INSTAGRAM_USER_ID}/media`, {
      media_type: "REELS", video_url: source.value, caption, share_to_feed: true,
      thumb_offset: thumbOffset, access_token: pageToken,
    }, "POST");
    if (!container.id) throw new Error("URL container response missing ID");
    containerId = container.id;
    await onEvent({ phase: "processing", containerId });
  } else throw new Error("Unsupported video source");

  let ready = false;
  for (let attempt = 0; attempt < pollAttempts; attempt++) {
    const status = await graph(`/${containerId}`, { fields: "status_code,status", access_token: pageToken });
    if (status.status_code === "FINISHED") { ready = true; break; }
    if (["ERROR", "EXPIRED"].includes(status.status_code)) throw new Error(`Media processing failed: ${status.status_code}`);
    await sleep(5000);
  }
  if (!ready) throw new Error("Media processing timed out");

  // Synchronous journal + remote checkpoint completes before the POST below.
  // Any timeout/error after this point has an uncertain publication outcome.
  await onEvent({ phase: "publishing", containerId, safeToRetry: false });
  const published = await graph(`/${INSTAGRAM_USER_ID}/media_publish`, {
    creation_id: containerId, access_token: pageToken,
  }, "POST");
  if (!published.id) throw new Error("Publish response missing media ID");
  await onEvent({ status: "succeeded", phase: "published", mediaId: published.id, safeToRetry: false });
  return { mediaId: published.id };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error("Use post-sns.mjs or retry-instagram.mjs with a date-scoped journal; direct untracked upload is disabled.");
  process.exitCode = 1;
}
