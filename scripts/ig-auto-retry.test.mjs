// Same file in all four repos (see scripts/ig-auto-retry.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  episodeStamp, postStartUnix, recordDecision, isFinalAttempt, mp4DurationSeconds,
  checkDecision, sameCaption, igUnix, REELS_MAX_SECONDS,
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

// The workflow wiring the functions above rely on.
const workflows = readdirSync(join(root, ".github/workflows")).filter((f) => f.endsWith(".yml"));
const name = workflows.find((f) => readFileSync(join(root, ".github/workflows", f), "utf-8").includes("ig-auto-retry.mjs gate"));

test("the retry workflow: scheduled slots, Instagram only, red only on the last slot", () => {
  assert.ok(name, "a workflow runs ig-auto-retry.mjs gate");
  const yml = readFileSync(join(root, ".github/workflows", name), "utf-8");
  const crons = [...yml.matchAll(/- cron: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(crons.length >= 3, "at least three retry slots");
  assert.equal(yml.match(/--last-slot="([^"]+)"/)[1], crons.at(-1), "--last-slot is the last cron line");
  assert.match(yml, /EVENT_SCHEDULE: \$\{\{ github\.event\.schedule \}\}/);
  assert.doesNotMatch(yml, /upload-youtube|YOUTUBE_/, "YouTube is never touched");

  const steps = yml.split(/\n\s+- (?=name:|if:|uses:|run:)/);
  const at = (re) => steps.findIndex((s) => re.test(s));
  const check = at(/ig-auto-retry\.mjs check/);
  const upload = at(/\bid: upload\b/);
  const posts = /upload-instagram\.mjs --file|retry-instagram\.mjs --date="\$RETRY_DATE" --platform=instagram(?! --(check|record-media-id))/;
  assert.match(steps[upload], posts);
  assert.equal(steps.filter((s) => posts.test(s)).length, 1, "one step posts to Instagram");
  assert.ok(check > 0 && upload > check, "the account and the length are checked before the upload");
  assert.match(steps[upload], /continue-on-error: \$\{\{ steps\.gate\.outputs\.final != 'true' \}\}/);
  assert.match(steps[upload], /steps\.check\.outputs\.posted == 'false'/, "uploads only when the day is not on Instagram");
  assert.match(steps[check], /--post-time=\d{2}:\d{2}/, "the account check knows the day's post time");
  assert.match(steps[check], /continue-on-error: \$\{\{ steps\.gate\.outputs\.final != 'true' \}\}/, "a check failure on an earlier slot is a warning");
});
