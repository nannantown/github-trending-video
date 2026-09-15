import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync, createReadStream } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { google } from "googleapis";
import { GaxiosError } from "gaxios";
import {
  errorReasons,
  isMetadataRejection,
  insertVideo,
  insertWithLegacyFallback,
  METADATA_REJECTION_REASONS,
} from "./youtube-upload.mjs";

// A local stand-in for the YouTube API. The real googleapis client (the same
// one upload-youtube.mjs uses) talks to it, so every error below is the
// GaxiosError that gaxios itself builds from a real HTTP response.
//
// No request may leave the machine: a client-level rootUrl is not applied to
// media uploads, so every call passes `requestOptions` (per-call rootUrl) and a
// fetch that refuses anything but the local server.
let server;
let base;
let requestOptions;
let tmp;
let videoPath;
const youtube = google.youtube({ version: "v3" });
const requests = [];
const replies = [];

function apiError(status, reason, message = reason) {
  return {
    status,
    body: { error: { code: status, message, errors: [{ message, domain: "youtube.video", reason }] } },
  };
}

function localOnlyFetch(input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(base)) {
    return Promise.reject(new Error(`test attempted a non-local request: ${url}`));
  }
  return fetch(input, init);
}

before(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString("utf8") });
      const reply = replies.shift() ?? { status: 500, body: { error: { code: 500, message: "no reply queued" } } };
      res.writeHead(reply.status, { "content-type": "application/json; charset=UTF-8" });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
  requestOptions = { rootUrl: base, fetchImplementation: localOnlyFetch };
  tmp = mkdtempSync(join(tmpdir(), "yt-upload-test-"));
  videoPath = join(tmp, "video.mp4");
  writeFileSync(videoPath, "fake-mp4-bytes");
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  requests.length = 0;
  replies.length = 0;
});

const experiment = {
  title: "colibri — 余ったSSDでフロンティアMoEを回す｜GitHub Trending TOP5 9/14",
  description: "今日のTOP1は colibri（JustVugg/colibri）— …",
  tags: ["GitHubTrending"],
  categoryId: "28",
  titleTemplate: "top1",
};
const fallback = {
  title: "【GitHub Trending】今日の注目リポジトリ TOP5｜2026/09/14 #Shorts",
  description: "2026/09/14 の GitHub Trending 上位5リポジトリを紹介します。",
  titleTemplate: "standard",
};
const quiet = { log: () => {}, logError: () => {} };

test("(a) reasons come from a real gaxios GaxiosError for a 400 invalidTitle upload response", async () => {
  replies.push(apiError(400, "invalidTitle", "The request metadata specifies an invalid or empty video title."));
  await assert.rejects(insertVideo(youtube, videoPath, experiment, requestOptions), (err) => {
    assert.ok(err instanceof GaxiosError, `expected GaxiosError, got ${err?.constructor?.name}: ${err?.message}`);
    assert.equal(err.status, 400);
    assert.deepEqual(errorReasons(err), ["invalidTitle"]);
    assert.equal(isMetadataRejection(err), true);
    return true;
  });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /^\/upload\/youtube\/v3\/videos\?/);
});

test("(a) the thumbnail 403 forbidden reason is read the same way", async () => {
  replies.push(apiError(403, "forbidden", "The authenticated user doesn't have permissions to upload and set custom video thumbnails."));
  await assert.rejects(
    youtube.thumbnails.set(
      { videoId: "vid", media: { mimeType: "image/jpeg", body: createReadStream(videoPath) } },
      requestOptions
    ),
    (err) => {
      assert.ok(err instanceof GaxiosError, `expected GaxiosError, got ${err?.constructor?.name}: ${err?.message}`);
      assert.deepEqual(errorReasons(err), ["forbidden"]);
      assert.equal(isMetadataRejection(err), false);
      return true;
    }
  );
  assert.equal(requests.length, 1);
});

test("(b) invalidTitle on the first insert → second insert with the legacy metadata succeeds", async () => {
  replies.push(apiError(400, "invalidTitle"));
  replies.push({ status: 200, body: { kind: "youtube#video", id: "vid-legacy" } });

  const { res, metadata } = await insertWithLegacyFallback({
    youtube,
    videoPath,
    metadata: experiment,
    fallback,
    requestOptions,
    ...quiet,
  });

  assert.equal(res.data.id, "vid-legacy");
  assert.equal(metadata.titleTemplate, "standard");
  assert.equal(metadata.title, fallback.title);
  assert.deepEqual(metadata.tags, experiment.tags, "tags / category stay the same");
  assert.equal(requests.length, 2);
  assert.ok(requests[0].body.includes(experiment.title), "first request carries the experiment title");
  assert.ok(requests[1].body.includes(fallback.title), "second request carries the legacy title");
  assert.ok(requests[1].body.includes(fallback.description));
  assert.ok(!requests[1].body.includes(experiment.title));
});

test("(b) a successful first insert is not retried", async () => {
  replies.push({ status: 200, body: { kind: "youtube#video", id: "vid-top1" } });
  const { res, metadata } = await insertWithLegacyFallback({
    youtube,
    videoPath,
    metadata: experiment,
    fallback,
    requestOptions,
    ...quiet,
  });
  assert.equal(res.data.id, "vid-top1");
  assert.equal(metadata.titleTemplate, "top1");
  assert.equal(requests.length, 1);
});

test("(c) quotaExceeded is rethrown without a retry", async () => {
  replies.push(apiError(403, "quotaExceeded"));
  await assert.rejects(
    insertWithLegacyFallback({ youtube, videoPath, metadata: experiment, fallback, requestOptions, ...quiet }),
    (err) => err instanceof GaxiosError && errorReasons(err)[0] === "quotaExceeded"
  );
  assert.equal(requests.length, 1);
});

test("(c) a 500 backend error is rethrown without a retry", async () => {
  replies.push(apiError(500, "backendError"));
  await assert.rejects(
    insertWithLegacyFallback({ youtube, videoPath, metadata: experiment, fallback, requestOptions, ...quiet }),
    (err) => err instanceof GaxiosError && err.status === 500
  );
  assert.equal(requests.length, 1);
});

test("(c) without fallback metadata (standard arm) a metadata rejection is rethrown", async () => {
  replies.push(apiError(400, "invalidDescription"));
  await assert.rejects(
    insertWithLegacyFallback({ youtube, videoPath, metadata: experiment, fallback: undefined, requestOptions, ...quiet }),
    (err) => err instanceof GaxiosError && errorReasons(err)[0] === "invalidDescription"
  );
  assert.equal(requests.length, 1);
});

test("errorReasons fallbacks: string body, cause.errors, legacy err.errors, and nothing", () => {
  const body = JSON.stringify({ error: { errors: [{ reason: "invalidDescription" }] } });
  assert.deepEqual(errorReasons({ response: { data: body } }), ["invalidDescription"]);
  assert.deepEqual(errorReasons({ cause: { errors: [{ reason: "invalidVideoMetadata" }] } }), ["invalidVideoMetadata"]);
  assert.deepEqual(errorReasons({ errors: [{ reason: "invalidTitle" }] }), ["invalidTitle"]);
  assert.deepEqual(errorReasons({ response: { data: "<html>502</html>" } }), []);
  assert.deepEqual(errorReasons(new Error("socket hang up")), []);
  assert.deepEqual(errorReasons(undefined), []);
  assert.deepEqual(METADATA_REJECTION_REASONS, ["invalidTitle", "invalidDescription", "invalidVideoMetadata"]);
});
