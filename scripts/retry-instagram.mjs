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

export function parseRetryArgs(args) {
  const allowed = new Set(["--check"]);
  for (const arg of args) {
    if (!allowed.has(arg) && !arg.startsWith("--date=") && !arg.startsWith("--platform=")) throw new Error(`Unsupported argument: ${arg}`);
  }
  const value = (name) => {
    const values = args.filter((arg) => arg.startsWith(`--${name}=`));
    if (values.length !== 1) throw new Error(`Exactly one explicit --${name}= required`);
    return values[0].slice(name.length + 3);
  };
  return { date: validateDate(value("date")), platform: value("platform"), check: args.includes("--check") };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const { date, platform, check } = parseRetryArgs(process.argv.slice(2));
    if (check) { preflight({ rootDir, date, platform }); console.log(`Retry preflight OK: ${date} instagram`); }
    else await retryInstagram({ rootDir, date, platform });
  } catch (error) {
    console.error(`Instagram retry stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
