/**
 * YouTube upload helpers shared by upload-youtube.mjs and its tests
 * (no side effects on import).
 *
 * 2026-09-14 distribution experiment: if YouTube rejects the individualized
 * title/description, the day's upload is retried once with the legacy
 * metadata — the experiment must never cost the upload.
 */

import { createReadStream } from "fs";

/**
 * videos.insert 400 reasons caused by the request metadata
 * (https://developers.google.com/youtube/v3/docs/videos/insert, 2026-09-04).
 * Only these trigger the legacy-metadata retry; quota, auth or server errors
 * would fail the same way again.
 */
export const METADATA_REJECTION_REASONS = ["invalidTitle", "invalidDescription", "invalidVideoMetadata"];

function listFromBody(data) {
  let body = data;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return undefined;
    }
  }
  return body?.error?.errors;
}

/**
 * API error reasons (e.g. ["invalidTitle"]) from a googleapis / gaxios error.
 *
 * gaxios 7 (googleapis 171, google-auth-library 10) does not copy the API's
 * `errors` array onto the GaxiosError — the reasons only exist in the response
 * body, `err.response.data.error.errors[].reason`. `err.cause.errors` and
 * `err.errors` are kept as fallbacks for other client stacks.
 */
export function errorReasons(err) {
  const list = listFromBody(err?.response?.data) ?? err?.cause?.errors ?? err?.errors;
  return Array.isArray(list) ? list.map((e) => e?.reason).filter(Boolean) : [];
}

export function isMetadataRejection(err) {
  return errorReasons(err).some((reason) => METADATA_REJECTION_REASONS.includes(reason));
}

/**
 * @param {object} [requestOptions] per-call googleapis/gaxios options. Note that
 *   a client-level `rootUrl` is NOT applied to media uploads (googleapis-common
 *   8 only rewrites `url`, not `mediaUrl`), so tests pass `rootUrl` here.
 */
export function insertVideo(youtube, videoPath, metadata, requestOptions = {}) {
  return youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
        categoryId: metadata.categoryId,
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
  }, requestOptions);
}

/**
 * Insert the video; on a metadata rejection retry exactly once with `fallback`
 * (the legacy title/description). Any other error is rethrown untouched.
 *
 * @returns {Promise<{ res: object, metadata: object }>} the API response and the metadata actually uploaded
 */
export async function insertWithLegacyFallback({
  youtube,
  videoPath,
  metadata,
  fallback,
  requestOptions = {},
  insert = insertVideo,
  log = console.log,
  logError = console.error,
}) {
  try {
    return { res: await insert(youtube, videoPath, metadata, requestOptions), metadata };
  } catch (err) {
    if (!fallback || !isMetadataRejection(err)) throw err;
    logError(
      `  Upload rejected the experiment metadata [${errorReasons(err).join(", ")}] — retrying once with the legacy title/description`
    );
    const legacy = {
      ...metadata,
      title: fallback.title,
      description: fallback.description,
      titleTemplate: fallback.titleTemplate || "standard",
    };
    log(`  Title: ${legacy.title}`);
    return { res: await insert(youtube, videoPath, legacy, requestOptions), metadata: legacy };
  }
}
