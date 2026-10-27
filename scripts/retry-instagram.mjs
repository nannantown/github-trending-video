/** Only a proven pre-publication failure is eligible for this manual retry. */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateDate, loadState, assertRetryable, validateBundle, createStore, attemptInstagram, withDateLock } from "./posting-state.mjs";
import { uploadInstagram } from "./upload-instagram.mjs";

export function preflight({ rootDir, date, platform }) {
  validateDate(date);
  if (platform !== "instagram") throw new Error("Retry platform must explicitly be instagram");
  const state = loadState(rootDir, date); // No journal = no safe retry, including pre-feature dates.
  const historyPath = join(rootDir, "data/performance-history.json");
  const history = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, "utf8")) : { videos: [] };
  assertRetryable(state, platform, history);
  return { state, ...validateBundle({ rootDir, date, state }) };
}

export async function retryInstagram({ rootDir, date, platform, env = process.env, upload = uploadInstagram, checkpoint }) {
  return withDateLock({ rootDir, date }, async () => {
    const { state, metadata, video } = preflight({ rootDir, date, platform });
    // No caption generation, stats fetch, release creation, YouTube import, or rendering.
    const store = createStore({ rootDir, date, metadata, state, checkpoint });
    return attemptInstagram({ store, video, caption: metadata.captions.instagram, env, upload });
  });
}

/**
 * The account already shows the day's caption (scripts/ig-auto-retry.mjs check):
 * a publish whose reply was lost. Record that post instead of publishing again.
 */
export async function recordFoundInstagram({ rootDir, date, platform, mediaId, checkpoint }) {
  if (!/^\d+$/.test(mediaId || "")) throw new Error("Found Instagram media ID must be numeric");
  return withDateLock({ rootDir, date }, async () => {
    const { state, metadata } = preflight({ rootDir, date, platform });
    const store = createStore({ rootDir, date, metadata, state, checkpoint });
    store.update("instagram", { status: "succeeded", phase: "published", mediaId, safeToRetry: false, reason: "found_on_instagram" });
    return { mediaId };
  });
}

export function parseRetryArgs(args) {
  const allowed = new Set(["--check"]);
  for (const arg of args) {
    if (!allowed.has(arg) && !arg.startsWith("--date=") && !arg.startsWith("--platform=") && !arg.startsWith("--record-media-id=")) {
      throw new Error(`Unsupported argument: ${arg}`);
    }
  }
  const value = (name) => {
    const values = args.filter((arg) => arg.startsWith(`--${name}=`));
    if (values.length !== 1) throw new Error(`Exactly one explicit --${name}= required`);
    return values[0].slice(name.length + 3);
  };
  const found = args.filter((arg) => arg.startsWith("--record-media-id="));
  if (found.length > 1 || (found.length && args.includes("--check"))) throw new Error("One --record-media-id=, without --check");
  return { date: validateDate(value("date")), platform: value("platform"), check: args.includes("--check"),
    recordMediaId: found.length ? found[0].slice("--record-media-id=".length) : null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const { date, platform, check, recordMediaId } = parseRetryArgs(process.argv.slice(2));
    if (recordMediaId) { await recordFoundInstagram({ rootDir, date, platform, mediaId: recordMediaId }); console.log(`Recorded Instagram ${recordMediaId} for ${date}`); }
    else if (check) { preflight({ rootDir, date, platform }); console.log(`Retry preflight OK: ${date} instagram`); }
    else await retryInstagram({ rootDir, date, platform });
  } catch (error) {
    console.error(`Instagram retry stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
