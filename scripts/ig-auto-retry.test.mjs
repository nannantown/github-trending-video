// Same file in all four repos (see scripts/ig-auto-retry.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import {
  episodeStamp, postStartUnix, recordDecision, isFinalAttempt, mp4DurationSeconds, postingRuns,
  checkDecision, sameCaption, igUnix, REELS_MAX_SECONDS,
  switchDecision, failureKind, budgetStop, markState, MAX_AUTO_ATTEMPTS, STATE_PATH,
} from "./ig-auto-retry.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("episodeStamp: the latest daily post time at or before now (JST)", () => {
  // 08:00 JST post, retries at 09:07 / 14:07 JST → same day
  assert.equal(episodeStamp(new Date("2026-10-27T00:07:00Z"), "08:00"), "20261027");
  assert.equal(episodeStamp(new Date("2026-10-27T05:07:00Z"), "08:00"), "20261027");
  // 20:30 JST post: 23:47 JST and a late 02:00 JST run both belong to that day
  assert.equal(episodeStamp(new Date("2026-10-27T14:47:00Z"), "20:30"), "20261027");
  assert.equal(episodeStamp(new Date("2026-10-27T17:00:00Z"), "20:30"), "20261027");
  assert.throws(() => episodeStamp(new Date(), "8am"));
});

test("postStartUnix is the day's post time in JST", () => {
  assert.equal(new Date(postStartUnix("20261027", "08:00") * 1000).toISOString(), "2026-10-26T23:00:00.000Z");
  assert.equal(new Date(postStartUnix("20261022", "20:30") * 1000).toISOString(), "2026-10-22T11:30:00.000Z");
  assert.equal(igUnix("2026-10-21T16:00:00+0000"), Date.parse("2026-10-21T16:00:00Z") / 1000);
});

test("recordDecision: only YouTube-on-record + Instagram-missing goes", () => {
  const history = [
    { date: "2026-10-25", videoId: "y1", instagram: { mediaId: "i1" } },
    { date: "2026-10-26", videoId: "y2", instagram: null },
    { date: "2026-10-24", skip: true },
  ];
  assert.equal(recordDecision(history, "20261026").go, true);
  assert.equal(recordDecision(history, "20261025").go, false, "already on Instagram → never twice");
  assert.equal(recordDecision(history, "20261027").go, false, "no record → nothing to retry");
  assert.equal(recordDecision(history, "20261024").go, false, "rest day");
  assert.equal(recordDecision(history, "20261026", { dailyRunning: true }).go, false, "daily-video still running");
  assert.equal(recordDecision([{ date: "2026-10-26", instagram: null }], "20261026").go, false, "YouTube failed too");
  // a hand-run: only "already on Instagram" stops it (the repo's manual guards do the rest)
  assert.equal(recordDecision(history, "20261027", { auto: false }).go, true);
  assert.equal(recordDecision([{ date: "2026-10-26", instagram: null }], "20261026", { auto: false }).go, true);
  assert.equal(recordDecision(history, "20261025", { auto: false }).go, false);
  assert.equal(recordDecision(history, "20261025", { auto: false, force: true }).go, true, "force: a hand-run past a wrong record");
  assert.equal(recordDecision(history, "20261025", { force: true }).go, false, "force never applies to a scheduled run");
  // right after the daily run: an earlier slot waits, the last slot tries anyway
  assert.equal(recordDecision(history, "20261026", { final: false, minutesSinceDaily: 20 }).go, false);
  assert.equal(recordDecision(history, "20261026", { final: false, minutesSinceDaily: 50 }).go, true);
  assert.equal(recordDecision(history, "20261026", { final: true, minutesSinceDaily: 20 }).go, true);
  // kawagutsu aired.json shape
  const aired = [{ date: "2026-10-22", youtube: "yt" }, { date: "2026-10-21", youtube: "yt", instagram: "ig" }];
  assert.equal(recordDecision(aired, "20261022").go, true);
  assert.equal(recordDecision(aired, "20261021").go, false);
});

test("isFinalAttempt: only the last scheduled slot (and hand-runs) turn red", () => {
  assert.equal(isFinalAttempt("schedule", "7 0 * * *", "7 5 * * *"), false);
  assert.equal(isFinalAttempt("schedule", "7 5 * * *", "7 5 * * *"), true);
  assert.equal(isFinalAttempt("workflow_dispatch", "", undefined), true);
  assert.throws(() => isFinalAttempt("schedule", "7 0 * * *", undefined));
});

/** ftyp + moov{mvhd} with the given version / timescale / duration. */
function mp4(version, timescale, duration) {
  const box = (type, body) => {
    const b = Buffer.alloc(8 + body.length);
    b.writeUInt32BE(b.length, 0);
    b.write(type, 4, "latin1");
    body.copy(b, 8);
    return b;
  };
  const mvhd = Buffer.alloc(version === 1 ? 112 : 100);
  mvhd[0] = version;
  if (version === 1) { mvhd.writeUInt32BE(timescale, 20); mvhd.writeBigUInt64BE(BigInt(duration), 24); }
  else { mvhd.writeUInt32BE(timescale, 12); mvhd.writeUInt32BE(duration, 16); }
  return Buffer.concat([box("ftyp", Buffer.from("isom0000")), box("free", Buffer.alloc(4)), box("moov", box("mvhd", mvhd))]);
}

test("mp4DurationSeconds reads moov/mvhd (v0 and v1)", () => {
  assert.equal(mp4DurationSeconds(mp4(0, 1000, 56100)), 56.1);
  assert.equal(mp4DurationSeconds(mp4(1, 90000, 62 * 90000)), 62);
  assert.throws(() => mp4DurationSeconds(Buffer.from("not a video at all")));
});

test("checkDecision: too long → never retried, whatever the account shows (kawagutsu 2026-10-21: 62.0 s)", () => {
  const seconds = mp4DurationSeconds(mp4(0, 1000, 62000));
  assert.equal(checkDecision({ seconds, caption: "c", since: 0 }).action, "too-long");
  assert.equal(checkDecision({ seconds: 59, caption: "c", since: 0 }).action, "post");
  assert.equal(checkDecision({ seconds: 62, maxSeconds: 76.7, caption: "c", since: 0 }).action, "post", "kawagutsu speeds ≤ 76.7 s up for Instagram");
  assert.equal(checkDecision({ seconds: 80, maxSeconds: 76.7, caption: "c", since: 0 }).action, "too-long");
});

test("checkDecision: same caption = already posted; another post after the post time = stop; else post", () => {
  const caption = "今日の1本\n\n#tag";
  const since = postStartUnix("20261022", "20:30"); // kawagutsu, 10/22 20:30 JST
  const yesterday = { id: "y", caption: "前の晩の1足", timestamp: "2026-10-21T16:00:00+0000" }; // 10/22 01:00 JST — 10/21's late Reel
  assert.equal(checkDecision({ seconds: 50, media: [yesterday], caption, since }).action, "post", "the previous day's late post is not today's");
  assert.equal(checkDecision({ seconds: 50, media: [{ id: "1", caption: "今日の1本 #tag", timestamp: "2026-10-22T15:00:00+0000" }, yesterday], caption, since }).media.id, "1");
  assert.equal(checkDecision({ seconds: 50, media: [{ id: "e", caption: "今日の1本 #tag", timestamp: "2026-10-22T09:00:00+0000" }], caption, since }).action, "posted", "the same caption counts even before the post time");
  const other = checkDecision({ seconds: 50, media: [{ id: "2", caption: "別の投稿", timestamp: "2026-10-22T14:00:00+0000" }], caption, since });
  assert.deepEqual([other.action, other.media.id], ["unknown", "2"]);
  assert.equal(sameCaption("", ""), false);
});

test("(c) the owner's switch: off stops every scheduled run, SKIP leaves listed days alone, hand-runs are not affected", () => {
  assert.match(switchDecision({ auto: true, mode: "off", stamp: "20261027" }), /switched off/);
  assert.match(switchDecision({ auto: true, mode: " OFF ", stamp: "20261027" }), /switched off/);
  assert.match(switchDecision({ auto: true, skip: "20261026, 20261023", stamp: "20261026" }), /SKIP/);
  assert.match(switchDecision({ auto: true, skip: "20261026,20261023", stamp: "20261023" }), /SKIP/);
  assert.match(switchDecision({ auto: true, skip: "2026-10-26", stamp: "20261026" }), /SKIP/, "the dashed form works too");
  assert.equal(switchDecision({ auto: true, skip: "20261026,20261023", stamp: "20261027" }), null);
  assert.equal(switchDecision({ auto: true, mode: "", skip: "", stamp: "20261027" }), null, "unset = today's behaviour");
  assert.equal(switchDecision({ auto: false, mode: "off", skip: "20261026", stamp: "20261026" }), null);
});

test("(a)(b) the day's budget: at most MAX_AUTO_ATTEMPTS, and two ProcessingFailedErrors in a row stop it", () => {
  assert.equal(MAX_AUTO_ATTEMPTS, 3);
  assert.equal(budgetStop(undefined), null);
  assert.equal(budgetStop({ attempts: 2, failures: ["other", "ProcessingFailedError"] }), null);
  assert.match(budgetStop({ attempts: 3, failures: ["other", "other", "other"] }), /3 automatic attempts/);
  assert.match(budgetStop({ attempts: 2, failures: ["ProcessingFailedError", "ProcessingFailedError"] }), /ProcessingFailedError/);
  assert.equal(budgetStop({ attempts: 2, failures: ["ProcessingFailedError", "other"] }), null, "a different failure breaks the run");
  assert.equal(failureKind("Binary upload failed (400): {\"error\":{\"type\":\"ProcessingFailedError\",\"debug_info\":{\"retriable\":false}}}"), "ProcessingFailedError");
  assert.equal(failureKind("Graph API error: timeout"), "other");
  assert.equal(failureKind(undefined), "other");
  // the last error line decides, not the uploader's own retry lines
  const retried = "  Upload failed (ProcessingFailedError), retrying in 30s…\n  Upload failed (ProcessingFailedError), retrying in 60s…\n";
  assert.equal(failureKind(retried + "Instagram upload failed: Graph API error: Invalid OAuth access token (code: 190)"), "other");
  assert.equal(failureKind(retried + "Instagram upload failed: Binary upload failed (400) ProcessingFailedError"), "ProcessingFailedError");
});

test("markState: counts attempts across days for one episode, keeps 60 days", () => {
  const t0 = new Date("2026-10-27T16:37:00Z");
  let s = markState({ 20260801: { attempts: 1, failures: [] } }, "20261027", { now: t0 });
  s = markState(s, "20261027", { failure: "ProcessingFailedError", now: t0 });
  s = markState(s, "20261027", { now: new Date("2026-10-28T00:37:00Z") }); // the next calendar day, same episode
  assert.deepEqual([s["20261027"].attempts, s["20261027"].failures], [2, ["ProcessingFailedError"]]);
  s = markState(s, "20261027", { stopped: "spent", now: t0 });
  assert.deepEqual([s["20261027"].attempts, s["20261027"].stopped], [2, "spent"], "marking stopped is not an attempt");
  assert.equal(s["20260801"], undefined);
});

const script = join(root, "scripts/ig-auto-retry.mjs");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
const run = (cwd, args, env = {}) => {
  const out = join(cwd, "..", `out-${Math.random()}`);
  writeFileSync(out, "");
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf-8", env: { ...process.env, GITHUB_OUTPUT: out, ...env } });
  return { status: r.status, output: readFileSync(out, "utf-8"), log: r.stdout + r.stderr };
};

test("(a)(b) mark: counts on main before each upload and stops the day (stop=…, exit 1) when it is spent", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ig-mark-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, "init", "--quiet", "--bare", "-b", "main", "remote.git");
  git(dir, "clone", "--quiet", "remote.git", "work");
  const work = join(dir, "work");
  git(work, "config", "user.email", "t@example.com");
  git(work, "config", "user.name", "t");
  git(work, "commit", "--quiet", "--allow-empty", "-m", "init");
  git(work, "push", "--quiet", "origin", "HEAD:main");
  git(work, "branch", "--set-upstream-to=origin/main");
  writeFileSync(join(dir, "pfe.log"), "Upload failed: ProcessingFailedError (retriable:false)");

  const start = run(work, ["mark", "--stamp=20261026"]);
  assert.equal(start.status, 0, start.log);
  const first = run(work, ["mark", "--stamp=20261026", `--log=${join(dir, "pfe.log")}`]);
  assert.equal(first.status, 0, first.log);
  assert.equal(run(work, ["mark", "--stamp=20261026"]).status, 0);
  const second = run(work, ["mark", "--stamp=20261026", `--log=${join(dir, "pfe.log")}`]);
  assert.equal(second.status, 1, "two ProcessingFailedErrors in a row → red");
  assert.match(second.output, /^stop=.*ProcessingFailedError/m);
  const onMain = JSON.parse(git(work, "show", `origin/main:${STATE_PATH}`));
  assert.deepEqual(onMain["20261026"].failures, ["ProcessingFailedError", "ProcessingFailedError"]);
  assert.equal(onMain["20261026"].attempts, 2);
  assert.match(onMain["20261026"].stopped, /ProcessingFailedError/);
  assert.match(git(work, "log", "-1", "--format=%s", "origin/main").trim(), /\[skip ci\]$/);
  // the next slot: no upload, and only a note — one red per day, not one per slot
  const later = run(work, ["mark", "--stamp=20261026"]);
  assert.equal(later.status, 0, later.log);
  assert.match(later.output, /^go=false$/m);
  assert.doesNotMatch(later.output, /^stop=/m);
  assert.equal(JSON.parse(git(work, "show", `origin/main:${STATE_PATH}`))["20261026"].attempts, 2, "not counted");

  // (a) the cap: the 3rd failed attempt (other failures) is red at once; the next slot only notes it
  const other = join(dir, "other.log");
  writeFileSync(other, "Instagram upload failed: Graph API error: timeout");
  const fails = [];
  for (let i = 0; i < 3; i++) {
    assert.match(run(work, ["mark", "--stamp=20261027"]).output, /^go=true$/m);
    fails.push(run(work, ["mark", "--stamp=20261027", `--log=${other}`]));
  }
  assert.deepEqual(fails.map((f) => f.status), [0, 0, 1]);
  assert.match(fails[2].output, /^stop=.*3 automatic attempts/m);
  const next = run(work, ["mark", "--stamp=20261027"]);
  assert.deepEqual([next.status, /^go=false$/m.test(next.output)], [0, true], "no 4th upload, no 2nd red");
});

test("(c) gate: IG_AUTO_RETRY=off / IG_AUTO_RETRY_SKIP end a scheduled run green with go=false, before any network or git", () => {
  const dir = mkdtempSync(join(tmpdir(), "ig-gate-"));
  try {
    const base = ["gate", "--records=data/x.json", "--post-time=20:30", "--last-slot=37 0 * * *", "--date=20261026"];
    const off = run(dir, base, { GITHUB_EVENT_NAME: "schedule", EVENT_SCHEDULE: "37 16 * * *", IG_AUTO_RETRY: "off" });
    assert.equal(off.status, 0, off.log);
    assert.match(off.output, /^go=false$/m);
    const skip = run(dir, base, { GITHUB_EVENT_NAME: "schedule", EVENT_SCHEDULE: "37 16 * * *", IG_AUTO_RETRY_SKIP: "20261026,20261023" });
    assert.equal(skip.status, 0, skip.log);
    assert.match(skip.output, /^go=false$/m);
    // A posting-clock run (workflow_dispatch + slot) is that scheduled slot: the switches apply.
    const clock = run(dir, base, { GITHUB_EVENT_NAME: "workflow_dispatch", EVENT_SCHEDULE: "37 16 * * *", IG_AUTO_RETRY: "off" });
    assert.equal(clock.status, 0, clock.log);
    assert.match(clock.output, /^go=false$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The workflow wiring the functions above rely on.
const workflows = readdirSync(join(root, ".github/workflows")).filter((f) => f.endsWith(".yml"));
const wf = (f) => readFileSync(join(root, ".github/workflows", f), "utf-8");
const name = workflows.find((f) => wf(f).includes("ig-auto-retry.mjs gate"));

test("the retry workflow: scheduled slots, Instagram only, notes on earlier slots, red on the last", () => {
  assert.ok(name, "a workflow runs ig-auto-retry.mjs gate");
  const yml = wf(name);
  const crons = [...yml.matchAll(/- cron: "([^"]+)"/g)].map((m) => m[1]);
  const last = crons.at(-1);
  assert.ok(crons.length >= 3, "at least three retry slots");
  assert.equal(yml.match(/--last-slot="([^"]+)"/)[1], last, "--last-slot is the last cron line");
  const lastRefs = [...yml.matchAll(/(?:\(inputs\.slot \|\| github\.event\.schedule\)|env\.EVENT_SCHEDULE) != '([^']+)'/g)].map((m) => m[1]);
  assert.ok(lastRefs.length >= 2, "job continue-on-error + the note step name the last slot");
  for (const ref of lastRefs) assert.equal(ref, last);
  assert.match(yml, /^    continue-on-error: \$\{\{ \(github\.event_name == 'schedule' \|\| inputs\.slot != ''\) && \(inputs\.slot \|\| github\.event\.schedule\) != '[^']+' \}\}$/m, "job-level: earlier slots are notes (clock runs too)");
  // A posting-clock run (workflow_dispatch + slot = a cron line above) is that scheduled slot.
  assert.match(yml, /\n      slot:\n        description: [^\n]+\n        type: string\n        default: ""\n/, "the clock's slot input");
  assert.match(yml, /^      AUTO: \$\{\{ github\.event_name == 'schedule' \|\| inputs\.slot != '' \}\}$/m);
  assert.match(yml, /^      EVENT_SCHEDULE: \$\{\{ inputs\.slot \|\| github\.event\.schedule \}\}$/m);
  assert.doesNotMatch(yml, /^ {10}EVENT_SCHEDULE:/m, "no step overrides the job's EVENT_SCHEDULE");
  const eventRefs = yml.split("\n").filter((l) => /github\.event_name/.test(l)
    && !/^      AUTO: |^    continue-on-error: |^    if: github\.event_name == 'schedule'$|^ +EVENT: \$\{\{ env\.AUTO == 'true' && 'schedule' \|\| github\.event_name \}\}$/.test(l));
  assert.deepEqual(eventRefs, [], "every schedule-only branch goes through env.AUTO (clock runs too)");
  assert.match(yml, /\n  backup-gate:\n    if: github\.event_name == 'schedule'\n[\s\S]*?select\(\.display_title == \$ENV\.TITLE\)/, "the backup does nothing after the slot's on-time run");
  assert.match(yml, /needs: backup-gate\n    if: \$\{\{ !cancelled\(\) && \(needs\.backup-gate\.result == 'skipped' \|\| needs\.backup-gate\.outputs\.skip == 'false'\) \}\}/);
  assert.match(yml, /IG_AUTO_RETRY: \$\{\{ vars\.IG_AUTO_RETRY \}\}/, "(c) the off switch reaches the gate");
  assert.match(yml, /IG_AUTO_RETRY_SKIP: \$\{\{ vars\.IG_AUTO_RETRY_SKIP \}\}/, "(c) the skip list reaches the gate");
  assert.doesNotMatch(yml, /upload-youtube|YOUTUBE_/, "YouTube is never touched");

  const steps = yml.split(/\n\s+- (?=name:|if:|uses:|run:|env:)/);
  const at = (re) => steps.findIndex((s) => re.test(s));
  const check = at(/ig-auto-retry\.mjs check/);
  const count = at(/ig-auto-retry\.mjs mark --stamp="[^"]+"$/m);
  const upload = at(/\bid: upload\b/);
  const markFail = at(/ig-auto-retry\.mjs mark [^\n]*--log=output\/ig-upload\.log/);
  const posts = /upload-instagram\.mjs --file|retry-instagram\.mjs --date="\$RETRY_DATE" --platform=instagram(?! --(check|record-media-id))/;
  assert.match(steps[upload], posts);
  assert.equal(steps.filter((s) => posts.test(s)).length, 1, "one step posts to Instagram");
  assert.ok(check > 0 && count > check && upload > count && markFail > upload, "check → count (a) → upload → remember the failure (b)");
  assert.match(steps[check], /--post-time=\d{2}:\d{2}/, "the account check knows the day's post time");
  assert.match(steps[count], /if: env\.AUTO == 'true' && steps\.check\.outputs\.posted == 'false'/, "(a) every automatic upload is counted first");
  assert.match(steps[upload], /steps\.check\.outputs\.posted == 'false'/, "uploads only when the day is not on Instagram");
  assert.match(steps[upload], /set -(eu)?o pipefail[\s\S]*\| tee output\/ig-upload\.log/, "(b) the failure's kind is kept");
  assert.match(steps[markFail], /if: failure\(\) && steps\.upload\.outcome == 'failure' && env\.AUTO == 'true'/);
  assert.doesNotMatch(yml, /^\s{8}continue-on-error/m, "no step-level continue-on-error (it would let the next step run)");

  const stops = yml.match(/^      stop: (.+)$/m)?.[1] ?? "";
  assert.match(steps[count], /\bid: count\b/);
  assert.match(steps[upload], /\(env\.AUTO != 'true' \|\| steps\.count\.outputs\.go == 'true'\)/, "(a)(b) a spent day never uploads");
  for (const id of ["gate", "check", "count", "mark"]) assert.ok(stops.includes(`steps.${id}.outputs.stop`), `stop from ${id}`);
  assert.match(yml, /\n  needs-a-person:\n    needs: (\w+)\n    if: always\(\) && needs\.\1\.outputs\.stop != ''[\s\S]*exit 1/, "a stop is red at once, on any slot");
});

test("the retry shares daily-video.yml's lock, and no waiting run (the 08:15/20:30 post included) is ever cancelled", () => {
  const block = (yml) => yml.match(/^concurrency:\n  group: (.+)\n  queue: (\w+)[^\n]*\n  cancel-in-progress: (\w+)$/m);
  const retry = block(wf(name));
  const daily = block(wf("daily-video.yml"));
  assert.ok(retry && daily, "both have group + queue + cancel-in-progress");
  // GitHub's default (queue: single) cancels a waiting run when a third joins — the
  // daily post would vanish without anything turning red.
  assert.deepEqual([retry[2], retry[3], daily[2], daily[3]], ["max", "false", "max", "false"]);
  // The same group for the production run: either the same text, or the daily's
  // production branch of a "verification runs get their own group" expression.
  const g = retry[1];
  if (daily[1] !== g) {
    assert.ok(daily[1].includes(`&& '${g}' || format(`), `daily-video.yml's production group is ${g}`);
    assert.match(daily[1], /github\.ref == 'refs\/heads\/main'/);
    assert.match(daily[1], /github\.run_id\) \}\}$/, "verification runs: a group of their own (unique per run)");
  }
});

test("postingRuns: the late backup that stops itself after an on-time run is not a post", () => {
  const onTime = { event: "workflow_dispatch", displayTitle: "Daily (on time)", createdAt: "2026-11-02T11:30:02Z" };
  const skippedBackup = { event: "schedule", displayTitle: "Daily", createdAt: "2026-11-02T16:10:00Z" };
  const realBackup = { event: "schedule", displayTitle: "Daily", createdAt: "2026-11-01T16:10:00Z" }; // no on-time run before it
  const hand = { event: "workflow_dispatch", displayTitle: "Daily", createdAt: "2026-11-02T17:00:00Z" };
  assert.deepEqual(postingRuns([hand, skippedBackup, onTime, realBackup]), [hand, onTime, realBackup]);
  const nextDay = { event: "schedule", displayTitle: "Daily", createdAt: "2026-11-03T12:01:00Z" }; // 24 h later: a real post
  assert.deepEqual(postingRuns([nextDay, onTime]), [nextDay, onTime]);
});
