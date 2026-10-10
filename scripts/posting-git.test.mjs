import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, saveBundle, gitCheckpoint, attemptInstagram } from "./posting-state.mjs";

// Real Git persistence against a temporary local bare remote. No GitHub/SNS I/O.
test("durable journal reaches the remote before publishing and retains partial success", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "posting-git-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const remote = join(base, "remote.git");
  const rootDir = join(base, "work");
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
  git(base, "init", "--bare", remote);
  git(base, "clone", remote, rootDir);
  git(rootDir, "switch", "-c", "main");
  git(rootDir, "config", "user.name", "test");
  git(rootDir, "config", "user.email", "test@example.invalid");
  mkdirSync(join(rootDir, "data"));
  mkdirSync(join(rootDir, "output"));
  writeFileSync(join(rootDir, ".gitignore"), "output/\n");
  writeFileSync(join(rootDir, "data/performance-history.json"), JSON.stringify({ schemaVersion: 1, videos: [], optimizationLog: [] }));
  git(rootDir, "add", ".");
  git(rootDir, "commit", "-m", "fixture");
  git(rootDir, "push", "-u", "origin", "main");
  const date = "2030-01-02";
  const video = join(rootDir, "output/trending-20300102.mp4");
  writeFileSync(video, "fake-video");
  const { metadata, metadataSha256 } = saveBundle({ rootDir, date, video,
    captions: { date: { compact: "20300102" }, instagram: "exact saved caption" },
    trendingData: { projects: [{ fullName: "example/repo" }] } });
  const state = { schemaVersion: 1, date, videoSha256: metadata.videoSha256, metadataSha256,
    platforms: { youtube: { status: "succeeded", videoId: "yt-known" }, instagram: { status: "not_started" } } };
  const checkpoint = () => gitCheckpoint(rootDir, date, { POSTING_CHECKPOINT: "git" });
  const store = createStore({ rootDir, date, metadata, state, checkpoint });
  const remoteState = () => JSON.parse(git(remote, "show", `main:data/posting/${date}.json`));
  await assert.rejects(attemptInstagram({ store, video, caption: metadata.captions.instagram, env: {}, upload: async ({ onEvent }) => {
    assert.equal(remoteState().platforms.instagram.status, "in_progress");
    await onEvent({ phase: "uploading", containerId: "container-known" });
    await onEvent({ phase: "publishing", containerId: "container-known" });
    assert.equal(remoteState().platforms.instagram.phase, "publishing");
    throw new Error("mock publish response timeout");
  } }), /timeout/);
  assert.equal(remoteState().platforms.instagram.status, "unknown");
  assert.equal(remoteState().platforms.youtube.videoId, "yt-known");
  const history = JSON.parse(git(remote, "show", "main:data/performance-history.json"));
  assert.equal(history.videos[0].videoId, "yt-known");
  assert.equal(history.videos[0].posting.instagram.containerId, "container-known");
  assert.equal(git(rootDir, "status", "--porcelain"), "");
  assert.equal(JSON.parse(readFileSync(join(rootDir, `data/posting/${date}.json`), "utf8")).platforms.instagram.status, "unknown");
});

test("real YouTube child journals the API ID before thumbnail work, using only a mocked client", async (t) => {
  const { cpSync, symlinkSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname } = await import("node:path");
  const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const base = mkdtempSync(join(tmpdir(), "posting-youtube-child-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const remote = join(base, "remote.git");
  const rootDir = join(base, "work");
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
  git(base, "init", "--bare", remote);
  git(base, "clone", remote, rootDir);
  git(rootDir, "switch", "-c", "main");
  git(rootDir, "config", "user.name", "test");
  git(rootDir, "config", "user.email", "test@example.invalid");
  for (const dir of ["data", "output", "scripts"]) mkdirSync(join(rootDir, dir));
  symlinkSync(join(sourceRoot, "node_modules"), join(rootDir, "node_modules"));
  for (const name of ["upload-youtube.mjs", "youtube-upload.mjs", "youtube-variant.mjs", "yt-experiment-switches.mjs", "posting-state.mjs", "record-upload.mjs"]) {
    cpSync(join(sourceRoot, "scripts", name), join(rootDir, "scripts", name));
  }
  writeFileSync(join(rootDir, ".gitignore"), "output/\nnode_modules\n");
  writeFileSync(join(rootDir, "data/performance-history.json"), JSON.stringify({ schemaVersion: 1, videos: [], optimizationLog: [] }));
  git(rootDir, "add", ".");
  git(rootDir, "commit", "-m", "fixture");
  git(rootDir, "push", "-u", "origin", "main");
  const date = "2030-01-02";
  const video = join(rootDir, "output/trending-20300102.mp4");
  writeFileSync(video, "fake-video");
  writeFileSync(join(rootDir, "output/thumb.jpg"), "fake-thumb");
  const { metadata, metadataSha256 } = saveBundle({ rootDir, date, video,
    captions: { date: { compact: "20300102" }, instagram: "saved caption", youtube: { title: "mock title", tags: [], categoryId: "28" } },
    trendingData: { projects: [{ fullName: "example/repo" }] } });
  const state = { schemaVersion: 1, date, videoSha256: metadata.videoSha256, metadataSha256,
    platforms: { youtube: { status: "in_progress", safeToRetry: false }, instagram: { status: "not_started" } } };
  const store = createStore({ rootDir, date, metadata, state, checkpoint: () => gitCheckpoint(rootDir, date, { POSTING_CHECKPOINT: "git" }) });
  store.persist();
  const preloader = join(rootDir, "output/mock-youtube.mjs");
  writeFileSync(preloader, `
    import { google } from 'googleapis';
    import { readFileSync, writeFileSync } from 'node:fs';
    import { execFileSync } from 'node:child_process';
    import assert from 'node:assert/strict';
    globalThis.fetch = () => { throw new Error('Real network is forbidden in this test'); };
    google.auth.OAuth2 = class { setCredentials() {} };
    const remoteState = () => JSON.parse(execFileSync('git', ['--git-dir', process.env.TEST_REMOTE, 'show', 'main:data/posting/2030-01-02.json'], { encoding: 'utf8' }));
    google.youtube = () => ({
      videos: { insert: async () => {
        assert.equal(remoteState().platforms.youtube.status, 'in_progress');
        return { data: { id: 'real-child-mock-id' } };
      } },
      thumbnails: { set: async () => {
        const state = remoteState();
        assert.equal(state.platforms.youtube.videoId, 'real-child-mock-id');
        const history = JSON.parse(readFileSync('data/performance-history.json', 'utf8'));
        assert.equal(history.videos[0].videoId, 'real-child-mock-id');
        writeFileSync('output/thumbnail-observed.json', JSON.stringify({ videoId: state.platforms.youtube.videoId }));
        throw new Error('Mock thumbnail failure after insert');
      } },
    });
  `);
  execFileSync(process.execPath, ["--import", preloader, "scripts/upload-youtube.mjs", `--date=${date}`,
    `--video=${video}`, "--opening-variant=brand", "--thumbnail=output/thumb.jpg"], {
    cwd: rootDir, stdio: "pipe", env: { ...process.env, GITHUB_ACTIONS: "false", POSTING_CHECKPOINT: "git",
      POSTING_YOUTUBE_ATTEMPT: date, TEST_REMOTE: remote, YOUTUBE_CLIENT_ID: "mock", YOUTUBE_CLIENT_SECRET: "mock",
      YOUTUBE_REFRESH_TOKEN: "mock", YT_SET_THUMBNAIL: "true" },
  });
  const saved = JSON.parse(git(remote, "show", `main:data/posting/${date}.json`));
  assert.equal(saved.platforms.youtube.status, "succeeded");
  assert.equal(saved.platforms.youtube.videoId, "real-child-mock-id");
  assert.match(saved.platforms.youtube.thumbnail.error, /Mock thumbnail/);
  assert.equal(JSON.parse(readFileSync(join(rootDir, "output/thumbnail-observed.json"), "utf8")).videoId, "real-child-mock-id");
});
