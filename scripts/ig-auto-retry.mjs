/**
 * Automatic Instagram-only retry (owner order 2026-10-27): when the daily post
 * reached YouTube but Instagram failed, post the SAME archived video again a few
 * hours later — Instagram only, never twice, never re-rendered.
 *
 * The same file lives in github-trending-video, coffee-daily-video,
 * figma-navi-video and kawagutsu-zukan-video — change all four together.
 *
 *   node scripts/ig-auto-retry.mjs gate --records=data/performance-history.json --post-time=08:00 --last-slot="7 5 * * *" [--date=YYYYMMDD]
 *     → $GITHUB_OUTPUT go=true|false, final=true|false, stamp=YYYYMMDD, date=YYYY-MM-DD
 *       go=true only when the day's live record (origin/main) has YouTube and no
 *       Instagram, daily-video.yml (main) is not running, and it finished at least
 *       MIN_GAP_MINUTES ago (an earlier slot right after it leaves the try to the
 *       next slot; the last slot always tries). final=false only on the earlier
 *       scheduled slots. --force=true (hand-runs only) skips the record, not the
 *       account check. EVENT_SCHEDULE = ${{ github.event.schedule }}.
 *       Scheduled runs only: IG_AUTO_RETRY=off (repo Variable) → nothing;
 *       IG_AUTO_RETRY_SKIP=20261026,20261023 → those days are left alone; a day
 *       that used up its tries (STATE_PATH) → stop=… + exit 1.
 *   node scripts/ig-auto-retry.mjs check --file=<mp4> --captions=<json> --stamp=YYYYMMDD --post-time=08:00 [--max-seconds=59.5 | --max-seconds-from=scripts/reels-fit.mjs]
 *     → $GITHUB_OUTPUT posted=true|false
 *       stop=… + exit 1 (nothing uploaded) when the video is longer than Instagram
 *       takes (it fails every time — a person decides), or when the account has a
 *       different post since the day's post time (cannot tell which is the day's).
 *       posted=true + output/instagram-result.json when the day's caption is
 *       already on Instagram (a publish whose reply was lost) — record it, don't post.
 *   node scripts/ig-auto-retry.mjs mark --stamp=YYYYMMDD [--log=output/ig-upload.log]
 *     Scheduled runs: counts an automatic attempt in STATE_PATH on main, right
 *     before the upload (a crash still counts). With --log (after a failed upload)
 *     it keeps the failure's kind; a day out of tries → stop=… + exit 1.
 *
 * "stop" = no later slot can fix it: the workflow turns red at once, even on an
 * earlier slot. Anything else that fails on an earlier slot is a note — the job
 * has continue-on-error and the next slot tries again; the last slot goes red.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const GRAPH_API_BASE = "https://graph.facebook.com/v22.0";
const JST_MS = 9 * 3600_000;

/** Instagram refuses Reels over 60 s in practice (coffee 2026-09-16, kawagutsu 2026-10-21). */
export const REELS_MAX_SECONDS = 59.5;

/** Leave Instagram this long after the daily run's own 3 tries before trying again. */
export const MIN_GAP_MINUTES = 45;

/**
 * Automatic uploads one day's video may get, all slots and days together. Each
 * upload already tries 3 times inside (30/60/120 s apart), and the daily run did
 * 3 more: 3 automatic attempts = at most 12 uploads of one video, 1 post.
 */
export const MAX_AUTO_ATTEMPTS = 3;

/** This many automatic attempts in a row failing with ProcessingFailedError: the video or the account, not a glitch. */
export const SAME_FAILURE_STOP = 2;

/** Where the automatic attempts are counted (committed to main, per day). */
export const STATE_PATH = "data/ig-auto-retry.json";

/**
 * The day whose post a run retries: the latest daily post time (JST) at or before
 * `now` — a 02:00 JST run still belongs to yesterday's 20:30 post.
 */
export function episodeStamp(now, postTime) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(postTime ?? "");
  if (!m) throw new Error(`--post-time must be HH:MM (JST), got ${JSON.stringify(postTime)}`);
  const shifted = now.getTime() + JST_MS - (Number(m[1]) * 60 + Number(m[2])) * 60_000;
  return new Date(shifted).toISOString().slice(0, 10).replaceAll("-", "");
}

/** Does a failure turn this run red? Every run but the earlier scheduled slots. */
export function isFinalAttempt(eventName, schedule, lastSlot) {
  if (eventName !== "schedule") return true;
  if (!lastSlot) throw new Error("--last-slot=<cron> required (the workflow's last schedule line)");
  return schedule === lastSlot;
}

export const isoDate = (stamp) => `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;

/**
 * Unix seconds of the day's daily post time (JST). The daily run never starts
 * before it (GitHub only starts crons late), so a post before it is another
 * day's — kawagutsu's 20:30 post of day D−1 usually goes out after 00:00 of D.
 */
export function postStartUnix(stamp, postTime) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(postTime ?? "");
  if (!m) throw new Error(`--post-time must be HH:MM (JST), got ${JSON.stringify(postTime)}`);
  return Math.floor((Date.parse(`${isoDate(stamp)}T00:00:00Z`) - JST_MS) / 1000) + Number(m[1]) * 3600 + Number(m[2]) * 60;
}

/** IG timestamps look like "2026-06-13T23:30:00+0000". */
export const igUnix = (timestamp) => Date.parse(String(timestamp).replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) / 1000;

/**
 * `{ go, reason }` from the day's record. Two shapes are read:
 * performance-history.json videos[] ({ videoId, instagram: { mediaId } }) and
 * kawagutsu's aired.json aired[] ({ youtube, instagram: "<id>" }).
 * `auto` (a scheduled run) also needs YouTube on record — the order is an
 * Instagram-ONLY failure; a hand-run is left to the repo's own manual guards.
 */
export function recordDecision(entries, stamp, { dailyRunning = false, auto = true, final = true, minutesSinceDaily = Infinity, force = false } = {}) {
  const date = isoDate(stamp);
  if (dailyRunning) return { go: false, reason: "daily-video.yml is still running — it may be posting right now. The next retry slot looks again." };
  // A hand-run's force=true skips the record; `check` still refuses a caption already on Instagram.
  if (force && !auto) return { go: true, reason: `${date}: force — the record is not consulted, the account check still runs.` };
  const entry = (entries || []).find((e) => e && e.date === date && !e.skip);
  if (!entry && !auto) return { go: true, reason: `${date} has no post on record — hand-run, posting.` };
  if (!entry) return { go: false, reason: `${date} has no post on record (daily run not done, a rest day, or YouTube failed too) — nothing for an Instagram-only retry.` };
  const youtube = entry.videoId ?? entry.youtube;
  const instagram = typeof entry.instagram === "string" ? entry.instagram : entry.instagram?.mediaId;
  if (instagram) return { go: false, reason: `${date} is already on Instagram (${instagram}) — not posting twice.` };
  if (!youtube && auto) return { go: false, reason: `${date} has no YouTube post on record — not an Instagram-only failure, left to a person.` };
  if (auto && !final && minutesSinceDaily < MIN_GAP_MINUTES) {
    return { go: false, reason: `${date}: daily-video.yml finished ${Math.round(minutesSinceDaily)} min ago — giving Instagram time; the next slot tries.` };
  }
  return { go: true, reason: `${date}: YouTube ${youtube ?? "(none)"} on record, Instagram not — retrying Instagram only.` };
}

/**
 * The owner's switch (repo Variables), for scheduled runs only — a hand-run is a
 * person's call. Returns why to leave the day alone, or null.
 */
export function switchDecision({ auto, mode, skip, stamp }) {
  if (!auto) return null;
  if (String(mode ?? "").trim().toLowerCase() === "off") return "IG_AUTO_RETRY=off — automatic Instagram retries are switched off.";
  const days = String(skip ?? "").split(/[\s,]+/).filter(Boolean);
  if (days.includes(stamp)) return `${stamp} is in IG_AUTO_RETRY_SKIP — left alone (no automatic retry).`;
  return null;
}

/** The kind of a failed upload, from its log. */
export const failureKind = (log) => (/ProcessingFailedError/.test(String(log ?? "")) ? "ProcessingFailedError" : "other");

/** Why the day gets no more automatic attempts, or null. `entry` = STATE_PATH[stamp]. */
export function budgetStop(entry = {}) {
  const attempts = entry.attempts ?? 0;
  if (attempts >= MAX_AUTO_ATTEMPTS) return `${attempts} automatic attempts already (limit ${MAX_AUTO_ATTEMPTS}) — not uploading this video again automatically.`;
  const last = (entry.failures ?? []).slice(-SAME_FAILURE_STOP);
  if (last.length === SAME_FAILURE_STOP && last.every((f) => f === "ProcessingFailedError")) {
    return `ProcessingFailedError on the last ${SAME_FAILURE_STOP} automatic attempts — the video or the account, not a passing glitch. Not retried automatically.`;
  }
  return null;
}

/** STATE_PATH after one more attempt (`failure` absent) or one more failure kind. Keeps 60 days. */
export function markState(state, stamp, { failure, now = new Date() } = {}) {
  const next = { ...(state || {}) };
  const entry = { attempts: 0, failures: [], ...(next[stamp] || {}) };
  if (failure) entry.failures = [...entry.failures, failure];
  else { entry.attempts += 1; entry.lastAttemptAt = now.toISOString(); }
  next[stamp] = entry;
  const cutoff = new Date(now.getTime() - 60 * 86400_000).toISOString().slice(0, 10).replaceAll("-", "");
  for (const day of Object.keys(next)) if (day < cutoff) delete next[day];
  return next;
}

/** Duration (s) from the mp4 movie header (moov/mvhd) — no ffprobe needed. */
export function mp4DurationSeconds(buf) {
  const find = (start, end, type) => {
    for (let p = start; p + 8 <= end; ) {
      let size = buf.readUInt32BE(p);
      let header = 8;
      if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); header = 16; }
      else if (size === 0) size = end - p;
      if (size < header) break;
      if (buf.toString("latin1", p + 4, p + 8) === type) return { start: p + header, end: Math.min(p + size, end) };
      p += size;
    }
    return null;
  };
  const moov = find(0, buf.length, "moov");
  const mvhd = moov && find(moov.start, moov.end, "mvhd");
  if (!mvhd) throw new Error("not an mp4 (no moov/mvhd box)");
  const v1 = buf[mvhd.start] === 1;
  const timescale = buf.readUInt32BE(mvhd.start + (v1 ? 20 : 12));
  const duration = v1 ? Number(buf.readBigUInt64BE(mvhd.start + 24)) : buf.readUInt32BE(mvhd.start + 16);
  if (!timescale) throw new Error("mp4 header has timescale 0");
  return duration / timescale;
}

/** Same Reel? Instagram keeps the caption as sent; whitespace is compared loosely. */
export const sameCaption = (a, b) => {
  const n = (s) => String(s ?? "").replace(/\s+/gu, " ").trim();
  return n(a) !== "" && n(a) === n(b);
};

/**
 * What to do with the day's video, given the account's recent media:
 * `too-long` (Instagram refuses it every time), `posted` (the day's caption is
 * already there — record it), `unknown` (another post since the day's post
 * time: posting could double the day, a person looks), or `post`.
 */
export function checkDecision({ seconds, maxSeconds = REELS_MAX_SECONDS, media = [], caption, since }) {
  if (seconds > maxSeconds) return { action: "too-long" };
  const same = media.find((m) => sameCaption(m.caption, caption));
  if (same) return { action: "posted", media: same };
  const other = media.find((m) => igUnix(m.timestamp) >= since);
  if (other) return { action: "unknown", media: other };
  return { action: "post" };
}

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const output = (pairs) => {
  const text = Object.entries(pairs).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, text);
  process.stdout.write(text);
};
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "inherit"] });

/** A condition no later slot can fix: stop=… makes the workflow red at once. */
function stop(reason) {
  console.log(`::error title=Instagram retry stopped::${reason}`);
  output({ stop: reason.replace(/\s+/g, " ") });
  process.exit(1);
}

const readState = (ref) => {
  try { return JSON.parse(sh("git", ["show", `${ref}:${STATE_PATH}`])); } catch { return {}; }
};

async function graphGet(path, params) {
  const url = new URL(`${GRAPH_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const data = await (await fetch(url)).json();
  if (data.error) throw new Error(`Graph API error: ${data.error.message} (code: ${data.error.code})`);
  return data;
}

function gate() {
  const records = arg("records");
  if (!records) throw new Error("--records=<path> required");
  const stamp = arg("date") || episodeStamp(new Date(), arg("post-time"));
  if (!/^\d{8}$/.test(stamp)) throw new Error(`--date must be YYYYMMDD, got "${stamp}"`);
  const auto = process.env.GITHUB_EVENT_NAME === "schedule";
  const off = switchDecision({ auto, mode: process.env.IG_AUTO_RETRY, skip: process.env.IG_AUTO_RETRY_SKIP, stamp });
  if (off) {
    console.log(`::notice title=Instagram retry::${off}`);
    output({ go: false, final: true, stamp, date: isoDate(stamp) });
    return;
  }
  // The live main, not this checkout: the daily run may have pushed its record after we started.
  sh("git", ["fetch", "--quiet", "origin", "main"]);
  const data = JSON.parse(sh("git", ["show", `origin/main:${records}`]));
  const runs = JSON.parse(sh("gh", ["run", "list", "--workflow", "daily-video.yml", "--branch", "main", "--limit", "10", "--json", "status,updatedAt"]));
  const dailyRunning = runs.some((r) => r.status !== "completed");
  const lastDone = runs.find((r) => r.status === "completed");
  const minutesSinceDaily = lastDone ? (Date.now() - Date.parse(lastDone.updatedAt)) / 60_000 : Infinity;
  const final = isFinalAttempt(process.env.GITHUB_EVENT_NAME, process.env.EVENT_SCHEDULE, arg("last-slot"));
  const { go, reason } = recordDecision(data.videos ?? data.aired, stamp, { dailyRunning, auto, final, minutesSinceDaily, force: arg("force") === "true" });
  console.log(reason);
  if (go && auto) {
    const spent = budgetStop(readState("origin/main")[stamp]);
    if (spent) stop(`${isoDate(stamp)}: ${spent}`);
  }
  if (go) console.log(final ? "Last attempt: a failure turns this run red." : "Earlier slot: a failure is a warning, the next slot tries again.");
  output({ go, final, stamp, date: isoDate(stamp) });
}

async function check() {
  const file = arg("file");
  const stamp = arg("stamp");
  // --max-seconds-from: a repo that speeds a long video up for Instagram exports the longest it can take.
  const from = arg("max-seconds-from");
  const max = from ? (await import(pathToFileURL(resolve(from)).href)).MAX_SOURCE_SECONDS : Number(arg("max-seconds") ?? REELS_MAX_SECONDS);
  if (!(max > 0)) throw new Error(`no usable length limit (${from ?? "--max-seconds"})`);
  if (!file || !/^\d{8}$/.test(stamp ?? "")) throw new Error("--file=<mp4> and --stamp=YYYYMMDD required");
  const since = postStartUnix(stamp, arg("post-time"));
  const seconds = mp4DurationSeconds(readFileSync(file));
  if (checkDecision({ seconds, maxSeconds: max }).action === "too-long") {
    stop(`${file} is ${seconds.toFixed(1)} s, over the ${max.toFixed(1)} s Instagram takes — a retry fails every time, so it is not retried. Shorten the video (YouTube is unaffected).`);
  }
  console.log(`Length OK: ${seconds.toFixed(1)} s (limit ${max} s)`);

  const json = JSON.parse(readFileSync(arg("captions"), "utf-8"));
  const caption = json.instagram ?? json.captions?.instagram;
  if (typeof caption !== "string" || !caption.trim()) throw new Error(`${arg("captions")} has no Instagram caption`);
  const { INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID, FACEBOOK_PAGE_ID } = process.env;
  if (!INSTAGRAM_ACCESS_TOKEN || !INSTAGRAM_USER_ID || !FACEBOOK_PAGE_ID) throw new Error("Instagram credentials missing — cannot check the account, not posting");
  const { access_token: pageToken } = await graphGet(`/${FACEBOOK_PAGE_ID}`, { fields: "access_token", access_token: INSTAGRAM_ACCESS_TOKEN });
  if (!pageToken) throw new Error(`Could not derive the Page token for ${FACEBOOK_PAGE_ID}`);
  // 36 h back for the same caption (a hand-run that went out early); "another
  // post" only counts from the day's post time.
  const recent = await graphGet(`/${INSTAGRAM_USER_ID}/media`, {
    fields: "id,caption,timestamp", since: since - 36 * 3600, limit: 50, access_token: pageToken,
  });
  const decision = checkDecision({ seconds, maxSeconds: max, media: recent.data || [], caption, since });
  const posted = decision.action === "posted" && decision.media;
  const unknown = decision.action === "unknown" && decision.media;
  if (posted) {
    console.log(`::notice title=Already on Instagram::${isoDate(stamp)} is on Instagram (${posted.id}, ${posted.timestamp}) with this caption — recording it, not posting twice.`);
    mkdirSync("output", { recursive: true });
    writeFileSync("output/instagram-result.json", JSON.stringify({ mediaId: posted.id, publishedAt: posted.timestamp }, null, 2));
    output({ posted: true, mediaId: posted.id });
    return;
  }
  if (unknown) {
    stop(`the account already has a post since ${arg("post-time")} JST on ${isoDate(stamp)} (${unknown.id}, ${unknown.timestamp}) with a different caption — posting could put the day out twice. A person checks the account.`);
  }
  console.log(`Nothing on Instagram since ${arg("post-time")} JST on ${isoDate(stamp)} — posting.`);
  output({ posted: false });
}

/** Commit STATE_PATH on top of the live main (3 tries; a lost race drops only our commit). */
function commitState(update, message) {
  sh("git", ["config", "user.name", "github-actions[bot]"]);
  sh("git", ["config", "user.email", "github-actions[bot]@users.noreply.github.com"]);
  for (let i = 1; i <= 3; i++) {
    sh("git", ["pull", "--rebase", "--quiet", "origin", "main"]);
    const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf-8")) : {};
    const next = update(state);
    mkdirSync(dirname(STATE_PATH), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(next, null, 2) + "\n");
    sh("git", ["add", STATE_PATH]);
    sh("git", ["commit", "--quiet", "-m", `${message} [skip ci]`]);
    try {
      sh("git", ["push", "--quiet", "origin", "HEAD:main"]);
      return next;
    } catch {
      sh("git", ["reset", "--hard", "--quiet", "HEAD~1"]);
      execFileSync("sleep", [String(i * 5)]);
    }
  }
  throw new Error(`could not push ${STATE_PATH}`);
}

function mark() {
  const stamp = arg("stamp");
  if (!/^\d{8}$/.test(stamp ?? "")) throw new Error("--stamp=YYYYMMDD required");
  const log = arg("log");
  if (!log) {
    const next = commitState((s) => markState(s, stamp), `Instagram auto-retry ${stamp}: attempt`);
    console.log(`Automatic attempt ${next[stamp].attempts} of ${MAX_AUTO_ATTEMPTS} for ${isoDate(stamp)}.`);
    return;
  }
  const kind = failureKind(existsSync(log) ? readFileSync(log, "utf-8") : "");
  const next = commitState((s) => markState(s, stamp, { failure: kind }), `Instagram auto-retry ${stamp}: ${kind}`);
  console.log(`Recorded the failure (${kind}) for ${isoDate(stamp)}: ${JSON.stringify(next[stamp])}`);
  const spent = budgetStop(next[stamp]);
  if (spent) stop(`${isoDate(stamp)}: ${spent}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cmd = process.argv[2];
  try {
    if (cmd === "gate") gate();
    else if (cmd === "check") await check();
    else if (cmd === "mark") mark();
    else throw new Error("usage: ig-auto-retry.mjs gate|check|mark …");
  } catch (err) {
    console.error(`::error title=Instagram retry stopped::${err.message}`);
    process.exit(1);
  }
}
