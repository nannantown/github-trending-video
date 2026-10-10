/** Date-scoped, fail-closed posting journal. No network calls on import. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, statSync, rmdirSync } from "node:fs";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { recordUpload } from "./record-upload.mjs";

export function validateDate(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date) {
    throw new Error("Explicit calendar date YYYY-MM-DD required");
  }
  return date;
}
export const compactDate = (date) => validateDate(date).replaceAll("-", "");
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const metadataName = (date) => `trending-${compactDate(date)}-metadata.json`;
export const statePath = (root, date) => join(root, `data/posting/${validateDate(date)}.json`);

export function loadState(root, date) {
  const state = JSON.parse(readFileSync(statePath(root, date), "utf8"));
  if (state.schemaVersion !== 1 || state.date !== date || !state.platforms) throw new Error("Invalid posting journal");
  return state;
}

export function assertRetryable(state, platform, history = { videos: [] }) {
  if (platform !== "instagram") throw new Error("Retry platform must explicitly be instagram");
  const result = state.platforms.instagram;
  const known = history.videos?.find((v) => v.date === state.date)?.instagram?.mediaId;
  if (known || result?.mediaId || result?.status === "succeeded") throw new Error("Instagram already posted; refusing duplicate");
  if (result?.status !== "failed" || result.safeToRetry !== true || !["preparing", "uploading", "processing"].includes(result.phase)) {
    throw new Error("Instagram result unknown, in progress, or never attempted; reconcile before retrying");
  }
}

export function validateBundle({ rootDir, date, state }) {
  const compact = compactDate(date);
  const video = join(rootDir, `output/trending-${compact}.mp4`);
  const path = join(rootDir, "output", metadataName(date));
  if (!existsSync(video) || !statSync(video).isFile() || statSync(video).size === 0) throw new Error("Saved video missing or empty");
  if (!existsSync(path)) throw new Error("Saved metadata missing; regeneration is forbidden in retry");
  const bytes = readFileSync(path);
  const metadata = JSON.parse(bytes);
  if (metadata.schemaVersion !== 1 || metadata.date !== date || metadata.videoFile !== basename(video) ||
      metadata.captions?.date?.compact !== compact || typeof metadata.captions?.instagram !== "string" ||
      !metadata.captions.instagram.trim() || !metadata.trendingData?.projects?.length ||
      metadata.videoSha256 !== state.videoSha256 || sha256(bytes) !== state.metadataSha256 ||
      sha256(readFileSync(video)) !== state.videoSha256) {
    throw new Error("Saved video/metadata does not match this date's posting journal");
  }
  return { video, metadata };
}

export function saveBundle({ rootDir, date, video, captions, trendingData, audioDurations, discovery }) {
  const metadata = { schemaVersion: 1, date: validateDate(date), videoFile: basename(video),
    videoSha256: sha256(readFileSync(video)), captions, trendingData, audioDurations, discovery };
  const path = join(rootDir, "output", metadataName(date));
  const bytes = JSON.stringify(metadata, null, 2);
  writeFileSync(path, bytes);
  return { metadata, metadataSha256: sha256(bytes) };
}

// Persist remotely before every SNS side effect on Actions. A failed push must
// stop publication. Crashes leave in_progress on main, which blocks a retry.
export function gitCheckpoint(rootDir, date, env = process.env, git = execFileSync) {
  if (env.GITHUB_ACTIONS !== "true" && env.POSTING_CHECKPOINT !== "git") {
    throw new Error("Live posting requires a durable Git checkpoint; use the main workflow");
  }
  if (env.GITHUB_ACTIONS === "true" && env.GITHUB_REF !== "refs/heads/main") throw new Error("Live posting requires main");
  const run = (...args) => git("git", args, { cwd: rootDir, stdio: "pipe" });
  if (env.GITHUB_ACTIONS !== "true" && run("branch", "--show-current").toString().trim() !== "main") {
    throw new Error("Live posting requires main");
  }
  const paths = [`data/posting/${validateDate(date)}.json`, "data/performance-history.json"];
  run("config", "user.name", "github-actions[bot]");
  run("config", "user.email", "github-actions[bot]@users.noreply.github.com");
  run("add", "--", ...paths);
  const changed = run("diff", "--cached", "--name-only", "--", ...paths).toString().trim();
  if (changed) run("commit", "--only", "-m", `Record posting ${date} [skip ci]`, "--", ...paths);
  // Rebase unrelated enrichment/stats commits; conflicts fail closed. Never force.
  run("pull", "--rebase", "origin", "main");
  run("push", "origin", "HEAD:main");
}

export function createStore({ rootDir, date, metadata, state, checkpoint = () => gitCheckpoint(rootDir, date) }) {
  const path = statePath(rootDir, date);
  mkdirSync(join(rootDir, "data/posting"), { recursive: true });
  const persist = () => {
    state.updatedAt = new Date().toISOString();
    writeFileSync(`${path}.tmp`, JSON.stringify(state, null, 2));
    renameSync(`${path}.tmp`, path);
    recordUpload({ rootDir, metadata, state });
    checkpoint();
  };
  return {
    state, persist,
    update(platform, patch) {
      const previous = state.platforms[platform] || {};
      if (previous.status === "succeeded" && patch.status && patch.status !== "succeeded") throw new Error("Cannot downgrade a successful post");
      for (const id of ["mediaId", "videoId"]) {
        if (previous[id] && patch[id] && previous[id] !== patch[id]) throw new Error("Cannot replace a known post ID");
      }
      state.platforms[platform] = { ...previous, ...patch, updatedAt: new Date().toISOString() };
      if (patch.containerId) {
        state.platforms[platform].containerIds = [...new Set([...(previous.containerIds || []), patch.containerId])];
      }
      persist();
    },
  };
}

export async function attemptInstagram({ store, video, caption, env, upload }) {
  const prior = store.state.platforms.instagram;
  // This checkpoint is outside the catch: a failure cannot authorize a POST.
  store.update("instagram", { status: "in_progress", phase: "preparing", safeToRetry: false,
    reason: null, attemptId: randomUUID(), attempts: (prior?.attempts || 0) + 1 });
  let publishing = false;
  let knownMediaId = null;
  try {
    const result = await upload({ source: { type: "file", value: video }, caption, env,
      onEvent(event) {
        if (event.phase === "publishing") publishing = true;
        if (event.mediaId) knownMediaId = event.mediaId;
        store.update("instagram", event);
      },
    });
    if (!result?.mediaId) throw new Error("Instagram publish response missing media ID");
    knownMediaId = result.mediaId;
    if (store.state.platforms.instagram.status !== "succeeded" || store.state.platforms.instagram.mediaId !== result.mediaId) {
      store.update("instagram", { status: "succeeded", phase: "published", mediaId: result.mediaId, safeToRetry: false });
    }
    return result;
  } catch (error) {
    // Includes response timeouts and failure to checkpoint after a known publish.
    store.update("instagram", knownMediaId
      ? { status: "succeeded", phase: "published", mediaId: knownMediaId, safeToRetry: false }
      : { status: publishing ? "unknown" : "failed", safeToRetry: !publishing,
          reason: publishing ? "publish_result_unknown" : "failed_before_publish" });
    throw error;
  }
}

// Also protect local invocations. A stale lock is never removed automatically.
export async function withDateLock({ rootDir, date }, operation) {
  const output = join(rootDir, "output");
  mkdirSync(output, { recursive: true });
  const path = join(output, `.posting-${validateDate(date)}.lock`);
  try { mkdirSync(path); }
  catch { throw new Error("Posting lock exists; inspect the journal before another attempt"); }
  try { return await operation(); }
  finally { rmdirSync(path); }
}
