import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { postDaily, dateFromVideo } from "./post-sns.mjs";
import { retryInstagram, preflight, parseRetryArgs } from "./retry-instagram.mjs";
import { uploadInstagram } from "./upload-instagram.mjs";
import { loadState, statePath, createStore, saveBundle, metadataName, validateDate, gitCheckpoint } from "./posting-state.mjs";
import { recordUpload } from "./record-upload.mjs";

const date = "2030-01-02";
const env = { INSTAGRAM_ACCESS_TOKEN: "fake-user-token", INSTAGRAM_USER_ID: "fake-ig", FACEBOOK_PAGE_ID: "fake-page",
  YOUTUBE_CLIENT_ID: "fake-yt", YOUTUBE_CLIENT_SECRET: "fake-secret", YOUTUBE_REFRESH_TOKEN: "fake-refresh" };
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const write = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2));

function fixture(t, checkpoint = () => {}) {
  const rootDir = mkdtempSync(join(tmpdir(), "posting-test-"));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  mkdirSync(join(rootDir, "output"));
  mkdirSync(join(rootDir, "data"));
  const video = join(rootDir, "output/trending-20300102.mp4");
  writeFileSync(video, "fake-mp4-bytes");
  const captions = { date: { compact: "20300102", full: "2030/01/02" }, instagram: "saved exact caption", youtube: { title: "saved YT title", tags: ["OSS"] } };
  const trendingData = { projects: [{ fullName: "test/repo", language: "JS" }] };
  const args = { rootDir, date, video, captions, trendingData, audioDurations: { opening: 10 },
    youtubeUpload: { video, openingVariant: "brand", thumbnail: null }, env,
    archive: () => {}, checkpoint,
    uploadYouTube: async ({ onEvent }) => {
      const result = { videoId: "youtube-1", videoUrl: "https://youtube.com/shorts/youtube-1", title: "actual YT title" };
      onEvent({ ...result, status: "succeeded" });
      return result;
    },
  };
  return { rootDir, video, args, retry: { rootDir, date, platform: "instagram", env, checkpoint } };
}

function graphMock({ binaryFailure = false, processing = "FINISHED", publishError, missingId = false } = {}) {
  const calls = [];
  let containers = 0;
  const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, options });
    if (path.endsWith("/fake-page")) return response({ access_token: "fake-page-token" });
    if (path.endsWith("/media")) {
      containers++;
      assert.equal(options.body.get("caption"), "saved exact caption");
      return response({ id: `container-${containers}`, uri: "https://upload.invalid/binary" });
    }
    if (path === "/binary") return binaryFailure ? response({ error: { message: "ProcessingFailedError" } }, 400) : response({ success: true });
    if (path.endsWith("/media_publish")) {
      if (publishError) throw publishError;
      return response(missingId ? {} : { id: "instagram-1" });
    }
    if (path.includes("/container-")) return response({ status_code: processing });
    throw new Error(`Unexpected mocked API path: ${path}`);
  };
  const upload = (options) => uploadInstagram({ ...options, fetchImpl, sleep: async () => {}, pollAttempts: 2 });
  return { calls, upload };
}
async function failIG(f, options = { binaryFailure: true }) {
  const mock = graphMock(options);
  await assert.rejects(postDaily({ ...f.args, uploadIG: mock.upload }), /SNS upload failed: instagram/);
  return mock;
}

test("Instagram HTTP 400 preserves YouTube success and all known container IDs; exact bundle can retry", async (t) => {
  const f = fixture(t);
  const failed = await failIG(f);
  assert.equal(failed.calls.filter((c) => c.path === "/binary").length, 3);
  assert.equal(failed.calls.filter((c) => c.path.endsWith("/media_publish")).length, 0);
  let state = loadState(f.rootDir, date);
  assert.equal(state.platforms.youtube.videoId, "youtube-1");
  assert.equal(state.platforms.instagram.status, "failed");
  assert.equal(state.platforms.instagram.safeToRetry, true);
  assert.deepEqual(state.platforms.instagram.containerIds, ["container-1", "container-2", "container-3"]);
  const historyPath = join(f.rootDir, "data/performance-history.json");
  const history = read(historyPath);
  history.videos[0].stats.views = 17;
  write(historyPath, history);
  const success = graphMock();
  await retryInstagram({ ...f.retry, upload: success.upload });
  state = loadState(f.rootDir, date);
  assert.equal(state.platforms.instagram.mediaId, "instagram-1");
  assert.equal(state.platforms.instagram.attempts, 2);
  const entry = read(historyPath).videos[0];
  assert.equal(entry.videoId, "youtube-1");
  assert.equal(entry.title, "actual YT title");
  assert.equal(entry.stats.views, 17);
  assert.equal(entry.instagram.mediaId, "instagram-1");
  assert.equal(success.calls.filter((c) => c.path.endsWith("/media_publish")).length, 1);
  let called = false;
  await assert.rejects(retryInstagram({ ...f.retry, upload: async () => { called = true; } }), /already posted/);
  assert.equal(called, false);
});

for (const mode of ["timeout", "missing ID"]) {
  test(`publish ${mode} becomes unknown and blocks another API attempt`, async (t) => {
    const f = fixture(t);
    const options = mode === "timeout" ? { publishError: new Error("response timeout") } : { missingId: true };
    await failIG(f, options);
    const state = loadState(f.rootDir, date);
    assert.equal(state.platforms.instagram.status, "unknown");
    assert.equal(state.platforms.instagram.safeToRetry, false);
    assert.equal(state.platforms.instagram.containerId, "container-1");
    await assert.rejects(retryInstagram({ ...f.retry, upload: () => assert.fail("No API call allowed") }), /unknown/);
  });
}

test("YouTube API failure still permits Instagram success and IG-only analytics entry", async (t) => {
  const f = fixture(t);
  await assert.rejects(postDaily({ ...f.args, uploadYouTube: async () => { throw new Error("YT timeout"); }, uploadIG: graphMock().upload }), /failed: youtube/);
  const state = loadState(f.rootDir, date);
  assert.equal(state.platforms.youtube.status, "unknown");
  assert.equal(state.platforms.instagram.status, "succeeded");
  const entry = read(join(f.rootDir, "data/performance-history.json")).videos[0];
  assert.equal(entry.videoId, null);
  assert.equal(entry.instagram.mediaId, "instagram-1");
});

test("known YouTube ID survives a child failure after insert", async (t) => {
  const f = fixture(t);
  await assert.rejects(postDaily({ ...f.args, uploadYouTube: async ({ onEvent }) => {
    onEvent({ status: "succeeded", videoId: "known-before-crash" });
    throw new Error("child died after insert");
  }, uploadIG: graphMock().upload }), /failed: youtube/);
  assert.equal(loadState(f.rootDir, date).platforms.youtube.videoId, "known-before-crash");
  assert.equal(read(join(f.rootDir, "data/performance-history.json")).videos[0].videoId, "known-before-crash");
});

test("missing credentials are explicit skips; missing archive prevents all SNS calls", async (t) => {
  const f = fixture(t);
  await postDaily({ ...f.args, env: {}, uploadIG: () => assert.fail(), uploadYouTube: () => assert.fail() });
  assert.equal(loadState(f.rootDir, date).platforms.instagram.status, "skipped");
  const second = fixture(t);
  await assert.rejects(postDaily({ ...second.args, archive: () => { throw new Error("Archive unavailable"); }, uploadIG: () => assert.fail(), uploadYouTube: () => assert.fail() }), /Archive unavailable/);
});

for (const status of ["ERROR", "IN_PROGRESS"]) {
  test(`processing ${status} fails before publish and remains safely retryable`, async (t) => {
    const f = fixture(t);
    await failIG(f, { processing: status });
    assert.equal(loadState(f.rootDir, date).platforms.instagram.safeToRetry, true);
    preflight(f.retry);
  });
}

for (const status of ["succeeded", "unknown", "in_progress", "not_started", "skipped"]) {
  test(`stored ${status} rejects retry before network access`, async (t) => {
    const f = fixture(t);
    await failIG(f);
    const state = loadState(f.rootDir, date);
    state.platforms.instagram.status = status;
    write(statePath(f.rootDir, date), state);
    await assert.rejects(retryInstagram({ ...f.retry, upload: () => assert.fail("No network") }));
  });
}

test("known IDs block even when the failure flag is inconsistent", async (t) => {
  const f = fixture(t);
  await failIG(f);
  const state = loadState(f.rootDir, date);
  state.platforms.instagram.mediaId = "known-id";
  write(statePath(f.rootDir, date), state);
  assert.throws(() => preflight(f.retry), /already posted/);
  delete state.platforms.instagram.mediaId;
  write(statePath(f.rootDir, date), state);
  const historyPath = join(f.rootDir, "data/performance-history.json");
  const history = read(historyPath);
  history.videos[0].instagram = { mediaId: "known-in-history" };
  write(historyPath, history);
  assert.throws(() => preflight(f.retry), /already posted/);
  history.videos[0].instagram = null;
  write(historyPath, history);
  state.platforms.instagram.phase = "published";
  write(statePath(f.rootDir, date), state);
  assert.throws(() => preflight(f.retry), /unknown/);
});

for (const problem of ["video missing", "video empty", "metadata missing", "modified video", "wrong date", "corrupt metadata", "missing captions"]) {
  test(`${problem} fails closed without API use`, async (t) => {
    const f = fixture(t);
    await failIG(f);
    const metadataPath = join(f.rootDir, "output", metadataName(date));
    if (problem === "video missing") rmSync(f.video);
    if (problem === "video empty") writeFileSync(f.video, "");
    if (problem === "metadata missing") rmSync(metadataPath);
    if (problem === "modified video") writeFileSync(f.video, "changed bytes");
    if (problem === "corrupt metadata") writeFileSync(metadataPath, "{");
    if (["wrong date", "missing captions"].includes(problem)) {
      const metadata = read(metadataPath);
      if (problem === "wrong date") metadata.date = "2030-01-03";
      else delete metadata.captions;
      write(metadataPath, metadata);
    }
    await assert.rejects(retryInstagram({ ...f.retry, upload: () => assert.fail("No API") }));
  });
}

test("missing journal/pre-feature dates never use a regenerated caption or video", async (t) => {
  const f = fixture(t);
  await assert.rejects(retryInstagram({ ...f.retry, upload: () => assert.fail("No API") }), /ENOENT/);
});

test("retry requires explicit valid date and instagram, with no permissive flags", async (t) => {
  for (const args of [[], ["--date=2030-01-02"], ["--date=2030-02-30", "--platform=instagram"],
    ["--date=2030-01-02", "--platform=instagram", "--force"], ["--date=2030-01-02", "--date=2030-01-03", "--platform=instagram"]]) {
    assert.throws(() => parseRetryArgs(args));
  }
  for (const invalid of ["2030-99-01", "20300102", "", "$(touch nope)"]) assert.throws(() => validateDate(invalid));
  assert.equal(dateFromVideo("/tmp/trending-20300102.mp4"), date);
  assert.throws(() => dateFromVideo("trending-20300102-youtube.mp4"));
  const f = fixture(t);
  await failIG(f);
  await assert.rejects(retryInstagram({ ...f.retry, platform: "youtube", upload: () => assert.fail() }), /explicitly be instagram/);
});

test("checkpoint failure before attempt allows no API call and leaves blocking marker", async (t) => {
  const f = fixture(t);
  await failIG(f);
  await assert.rejects(retryInstagram({ ...f.retry, checkpoint: () => { throw new Error("push failed"); }, upload: () => assert.fail() }), /push failed/);
  assert.equal(loadState(f.rootDir, date).platforms.instagram.status, "in_progress");
});

test("checkpoint failure before publish sends no publish request and blocks another retry", async (t) => {
  const f = fixture(t);
  await failIG(f);
  const mock = graphMock();
  const checkpoint = () => { if (loadState(f.rootDir, date).platforms.instagram.phase === "publishing") throw new Error("push failed"); };
  await assert.rejects(retryInstagram({ ...f.retry, checkpoint, upload: mock.upload }), /push failed/);
  assert.equal(mock.calls.filter((c) => c.path.endsWith("/media_publish")).length, 0);
  assert.equal(loadState(f.rootDir, date).platforms.instagram.status, "unknown");
});

test("checkpoint failure after successful publish retains the ID locally and rejects retry", async (t) => {
  const f = fixture(t);
  await failIG(f);
  const mock = graphMock();
  const checkpoint = () => { if (loadState(f.rootDir, date).platforms.instagram.mediaId) throw new Error("push failed"); };
  await assert.rejects(retryInstagram({ ...f.retry, checkpoint, upload: mock.upload }), /push failed/);
  assert.equal(loadState(f.rootDir, date).platforms.instagram.mediaId, "instagram-1");
  assert.equal(mock.calls.filter((c) => c.path.endsWith("/media_publish")).length, 1);
  assert.throws(() => preflight(f.retry), /already posted/);
});

test("concurrent local retries make at most one upload", async (t) => {
  const f = fixture(t);
  await failIG(f);
  let finish;
  const first = retryInstagram({ ...f.retry, upload: () => new Promise((resolve) => { finish = resolve; }) });
  await assert.rejects(retryInstagram({ ...f.retry, upload: () => assert.fail() }), /lock exists/);
  finish({ mediaId: "single-post" });
  await first;
});

test("record merging preserves unrelated dates, analytics, and the other platform's ID", (t) => {
  const f = fixture(t);
  const { metadata, metadataSha256 } = saveBundle(f.args);
  const old = { date: "2020-01-01", videoId: "untouched-old", stats: { views: 99 } };
  const existing = { date, videoId: "yt-existing", title: "existing title", stats: { views: 42 }, instagram: { mediaId: "ig-existing", views: 9 } };
  const path = join(f.rootDir, "data/performance-history.json");
  write(path, { schemaVersion: 1, videos: [old, existing], optimizationLog: ["unchanged"] });
  const state = { schemaVersion: 1, date, metadataSha256, videoSha256: metadata.videoSha256,
    platforms: { instagram: { status: "succeeded", mediaId: "ig-existing" } } };
  recordUpload({ rootDir: f.rootDir, metadata, state });
  const history = read(path);
  assert.deepEqual(history.videos[0], old);
  assert.equal(history.videos[1].videoId, "yt-existing");
  assert.equal(history.videos[1].stats.views, 42);
  assert.equal(history.videos[1].instagram.views, 9);
  assert.deepEqual(history.optimizationLog, ["unchanged"]);
  state.platforms.instagram.mediaId = "different-id";
  assert.throws(() => recordUpload({ rootDir: f.rootDir, metadata, state }), /Conflicting/);
});

test("journal cannot downgrade a success or replace known IDs", (t) => {
  const f = fixture(t);
  const { metadata } = saveBundle(f.args);
  const state = { date, platforms: { instagram: { status: "succeeded", mediaId: "known" } } };
  const store = createStore({ rootDir: f.rootDir, date, metadata, state, checkpoint: () => {} });
  assert.throws(() => store.update("instagram", { status: "failed" }), /downgrade/);
  assert.throws(() => store.update("instagram", { mediaId: "different" }), /replace/);
});

test("Actions checkpoint rejects branch publication and never ignores a failed push", () => {
  const calls = [];
  const git = (_exe, args) => { calls.push(args); if (args[0] === "push") throw new Error("push rejected"); return Buffer.from(args[0] === "diff" ? "changed" : ""); };
  assert.throws(() => gitCheckpoint("/fake", date, { GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/feature" }, git), /requires main/);
  assert.equal(calls.length, 0);
  assert.throws(() => gitCheckpoint("/fake", date, { GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/main" }, git), /push rejected/);
  assert.deepEqual(calls.at(-1), ["push", "origin", "HEAD:main"]);
  assert.ok(calls.some((args) => args[0] === "pull" && args[1] === "--rebase"));
});

test("daily rerun cannot replace the archived bundle or duplicate a known posting", async (t) => {
  const f = fixture(t);
  await failIG(f);
  const originalMetadata = readFileSync(join(f.rootDir, "output", metadataName(date)), "utf8");
  await assert.rejects(postDaily({ ...f.args, archive: () => assert.fail("No archive overwrite"),
    uploadIG: () => assert.fail("No second posting") }), /journal already exists/);
  assert.equal(readFileSync(join(f.rootDir, "output", metadataName(date)), "utf8"), originalMetadata);
  const second = fixture(t);
  write(join(second.rootDir, "data/performance-history.json"), { videos: [{ date, videoId: "legacy-known" }] });
  await assert.rejects(postDaily({ ...second.args, uploadIG: () => assert.fail(), archive: () => assert.fail() }), /known post/);
});

test("local live posting cannot silently skip a durable checkpoint", () => {
  assert.throws(() => gitCheckpoint("/fake", date, {}, () => assert.fail("No git without configuration")), /durable Git checkpoint/);
});
