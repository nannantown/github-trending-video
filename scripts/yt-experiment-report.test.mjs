import { test } from "node:test";
import assert from "node:assert/strict";
import {
  median,
  addDays,
  findExperimentStart,
  splitWindows,
  summarize,
  verdict,
  ytViews,
  buildReport,
  judgeDates,
  reportPhase,
  todayJst,
  RESTORED_MIN_MEDIAN,
  SIGNAL_MIN_MEDIAN,
  RETENTION_DELTA_PT,
  RETENTION_MISSING,
  loadStudioRetention,
  normalizeRetention,
  retentionDelta,
  retentionVerdict,
  retentionHeadline,
} from "./yt-experiment-report.mjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function video(date, ytViewCount, igViews, titleTemplate = "standard", extra = {}) {
  const experiment = titleTemplate === "top1";
  return {
    videoId: `id-${date}`,
    date,
    titleTemplate,
    ...(experiment ? { ytOpening: "top1", ytThumbnail: "error:forbidden" } : {}),
    stats: { views: ytViewCount, updatedAt: "2026-09-30T00:00:00Z" },
    instagram: igViews === null ? null : { views: igViews, reach: igViews - 100 },
    ...extra,
  };
}

test("median handles odd/even/empty and ignores non-numbers", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([null, 5, undefined]), 5);
});

test("addDays does calendar arithmetic across month boundaries", () => {
  assert.equal(addDays("2026-09-15", -14), "2026-09-01");
  assert.equal(addDays("2026-09-25", 14), "2026-10-09");
});

test("findExperimentStart picks the earliest upload with any experiment arm", () => {
  const history = { videos: [video("2026-09-16", 0, 1, "top1"), video("2026-09-15", 0, 1, "top1"), video("2026-09-14", 0, 1)] };
  assert.equal(findExperimentStart(history), "2026-09-15");
  assert.equal(findExperimentStart({ videos: [video("2026-09-14", 0, 1)] }), null);
  // title switch off, opening still on → still the experiment
  const openingOnly = { videos: [video("2026-09-17", 0, 1, "standard", { ytOpening: "top1" })] };
  assert.equal(findExperimentStart(openingOnly), "2026-09-17");
});

test("splitWindows uses [start-days, start) and [start, start+days)", () => {
  const videos = [
    video("2026-08-31", 1, 900),
    video("2026-09-01", 0, 1000),
    video("2026-09-14", 1, 1100),
    video("2026-09-15", 3, 1200, "top1"),
    video("2026-09-28", 4, 1300, "top1"),
    video("2026-09-29", 9, 1400, "top1"),
  ];
  const w = splitWindows(videos, "2026-09-15", 14);
  assert.deepEqual(w.control.map((v) => v.date), ["2026-09-01", "2026-09-14"]);
  assert.deepEqual(w.treatment.map((v) => v.date), ["2026-09-15", "2026-09-28"]);
  assert.equal(w.controlFrom, "2026-09-01");
  assert.equal(w.treatmentTo, "2026-09-29");
});

test("placeholder stats (views 0, updatedAt null) are not counted as real YouTube views", () => {
  const placeholder = video("2026-09-15", 0, 1000, "top1", { stats: { views: 0, updatedAt: null } });
  assert.equal(ytViews(placeholder), null);
  assert.equal(ytViews(video("2026-09-16", 7, 1000, "top1")), 7);
  const s = summarize([placeholder]);
  assert.equal(s.ytN, 0);
  assert.equal(s.ytMedian, null);
  assert.equal(verdict(s.ytMedian), "insufficient");
});

test("summarize reports YT median/mean/max and IG median over available insights", () => {
  const s = summarize([video("2026-09-15", 0, 1000), video("2026-09-16", 2, null), video("2026-09-17", 10, 3000)]);
  assert.equal(s.n, 3);
  assert.equal(s.ytN, 3);
  assert.equal(s.ytMedian, 2);
  assert.equal(s.ytMean, 4);
  assert.equal(s.ytMax, 10);
  assert.equal(s.igN, 2);
  assert.equal(s.igMedian, 2000);
  assert.deepEqual(summarize([]), { n: 0, ytN: 0, ytMedian: null, ytMean: null, ytMax: null, igN: 0, igMedian: null });
});

test("verdict thresholds: unchanged / signal / restored / insufficient", () => {
  assert.equal(verdict(null), "insufficient");
  assert.equal(verdict(0), "unchanged");
  assert.equal(verdict(1), "unchanged");
  assert.equal(verdict(SIGNAL_MIN_MEDIAN), "signal");
  assert.equal(verdict(RESTORED_MIN_MEDIAN - 1), "signal");
  assert.equal(verdict(RESTORED_MIN_MEDIAN), "restored");
});

test("phases: running → 14-day verdict → age-matched final", () => {
  assert.deepEqual(judgeDates("2026-09-15", 14), { day14From: "2026-09-30", finalFrom: "2026-10-13" });
  assert.equal(reportPhase("2026-09-15", 14, "2026-09-29"), "running");
  assert.equal(reportPhase("2026-09-15", 14, "2026-09-30"), "day14");
  assert.equal(reportPhase("2026-09-15", 14, "2026-10-12"), "day14");
  assert.equal(reportPhase("2026-09-15", 14, "2026-10-13"), "final");
});

test("buildReport renders both windows, the summary table, the phase and the verdict", () => {
  const history = {
    videos: [
      video("2026-09-10", 0, 800),
      video("2026-09-14", 1, 1200),
      video("2026-09-15", 12, 1000, "top1"),
      video("2026-09-16", 15, null, "top1"),
      video("2026-09-17", 0, 900, "top1", { ytOpening: "brand", ytThumbnail: null, stats: { views: 0, updatedAt: null } }),
    ],
  };
  const md = buildReport(history, { days: 14, today: "2026-09-30" });
  assert.match(md, /開始 2026-09-15/);
  assert.match(md, /\| control \| 2 \| 0\.5 \(2\) \| 0\.5 \| 1 \| 1000 \(2\) \|/);
  assert.match(md, /\| treatment \| 3 \| 13\.5 \(2\) \| 13\.5 \| 15 \| 950 \(2\) \|/);
  assert.match(md, /\*\*判定（14 日判定 — .*2026-10-13 以降）: 配信が戻った/);
  assert.match(md, /treatment のうち 1 日は YouTube 専用レンダなし/);
  assert.match(md, /\| 2026-09-16 \| top1 \| top1 \| error:forbidden \| 15 \| - \| - \|/);
  assert.match(md, /\| 2026-09-17 \| top1 \| brand \| - \| - \| 900 \| 800 \|/);
  assert.match(md, /\| 2026-09-14 \| standard \| brand \| - \| 1 \| 1200 \| 1100 \|/);
});

test("buildReport labels the verdict as provisional / final by date", () => {
  const history = { videos: [video("2026-09-15", 0, 1000, "top1")] };
  assert.match(buildReport(history, { today: "2026-09-29" }), /判定（暫定 — treatment 窓が未完了）: 戻らない/);
  assert.match(buildReport(history, { today: "2026-10-13" }), /判定（確定 — 全動画が約 14 日分の視聴期間）: 戻らない/);
});

test("buildReport explains when no experiment upload exists yet", () => {
  assert.match(buildReport({ videos: [video("2026-09-14", 0, 1)] }), /No video recorded with an experiment arm/);
});

test("todayJst uses the Tokyo calendar date", () => {
  // 2026-09-14 23:30 UTC is already 2026-09-15 in JST (the 08:00 JST cron runs at 23:00 UTC).
  assert.equal(todayJst(new Date("2026-09-14T23:30:00Z")), "2026-09-15");
});

// ── Primary metric since 2026-09-16: YouTube Studio 視聴を継続 % (typed in by hand) ──

test("normalizeRetention accepts 視聴を継続 % directly or as 100 − swiped, and rejects malformed entries", () => {
  assert.equal(normalizeRetention(null), null);
  assert.equal(normalizeRetention("28.6"), null);
  assert.equal(normalizeRetention({}), null);
  assert.equal(normalizeRetention({ viewedPct: "28.6" }), null);
  assert.equal(normalizeRetention({ viewedPct: 128 }), null);
  assert.equal(normalizeRetention({ viewedPct: -1 }), null);
  const full = normalizeRetention({ label: "過去 28 日", viewedPct: 28.6, swipedPct: 71.4, views: 11, capturedAt: "2026-09-16" });
  assert.deepEqual(full, { viewedPct: 28.6, swipedPct: 71.4, label: "過去 28 日", from: null, to: null, views: 11, capturedAt: "2026-09-16", note: null });
  assert.equal(normalizeRetention({ swipedPct: 71.4 }).viewedPct, 28.6);
  assert.equal(normalizeRetention({ viewedPct: 40 }).swipedPct, 60);
});

test("retentionVerdict: ±5 pt thresholds (proposal) and missing input", () => {
  assert.equal(RETENTION_DELTA_PT, 5);
  const before = normalizeRetention({ viewedPct: 28.6 });
  assert.equal(retentionVerdict(before, null), "missing");
  assert.equal(retentionVerdict(null, before), "missing");
  assert.equal(retentionVerdict(null, null), "missing");
  assert.equal(retentionVerdict(before, normalizeRetention({ viewedPct: 33.6 })), "improved"); // +5.0
  assert.equal(retentionVerdict(before, normalizeRetention({ viewedPct: 33.5 })), "flat"); // +4.9
  assert.equal(retentionVerdict(before, normalizeRetention({ viewedPct: 23.7 })), "flat"); // −4.9
  assert.equal(retentionVerdict(before, normalizeRetention({ viewedPct: 23.6 })), "worse"); // −5.0
  assert.equal(retentionDelta(before, normalizeRetention({ viewedPct: 40 })), 11.4);
  assert.equal(retentionDelta(before, null), null);
});

test("retentionHeadline says which side is missing, or the before → after comparison", () => {
  const before = normalizeRetention({ viewedPct: 28.6 });
  assert.equal(retentionHeadline(null, null), `**主指標 — 視聴を継続 %（YouTube Studio 手動入力）: 未入力（実験前・実験後とも未入力。${RETENTION_MISSING}）**`);
  assert.match(retentionHeadline(before, null), /未入力（実験後が未入力/);
  assert.match(retentionHeadline(null, before), /未入力（実験前が未入力/);
  assert.equal(
    retentionHeadline(before, normalizeRetention({ viewedPct: 40 })),
    "**主指標 — 視聴を継続 %（YouTube Studio 手動入力）: 効果あり（実験前から +5 pt 以上） — 実験前 28.6 → 実験後 40（+11.4 pt）**"
  );
  assert.match(retentionHeadline(before, normalizeRetention({ viewedPct: 20 })), /悪化（−5 pt 以下） — 実験前 28\.6 → 実験後 20（−8\.6 pt）/);
  assert.match(retentionHeadline(before, normalizeRetention({ viewedPct: 30 })), /変化なし（±5 pt 未満） — 実験前 28\.6 → 実験後 30（\+1\.4 pt）/);
});

test("buildReport without Studio input still renders and marks 視聴を継続 % as not entered", () => {
  const history = { videos: [video("2026-09-15", 0, 1000, "top1")] };
  const md = buildReport(history, { today: "2026-09-29" });
  assert.match(md, /\| window \| n \| YT median \(n\) \| YT mean \| YT max \| IG median \(n\) \| 視聴を継続 % \(Studio\) \|/);
  assert.match(md, /\| control \| 0 \| - \(0\) \| - \| - \| - \(0\) \| —（Studio から手動入力） \|/);
  assert.match(md, /\| treatment \| 1 \| 0 \(1\) \| 0 \| 0 \| 1000 \(1\) \| —（Studio から手動入力） \|/);
  assert.match(md, /\*\*主指標 — 視聴を継続 %（YouTube Studio 手動入力）: 未入力（実験前・実験後とも未入力/);
  assert.match(md, /\| 実験前（control） \| —（Studio から手動入力） \| —（Studio から手動入力） \| - \| - \| - \|/);
  assert.match(md, /\| 実験後（treatment） \| —（Studio から手動入力） \| —（Studio から手動入力） \| - \| - \| - \|/);
  assert.match(md, /- 差分: —（実験前・実験後の両方が入るまで出ない）/);
  // the view-median verdict is still printed, now labelled as a reference value
  assert.match(md, /\*\*判定（暫定 — treatment 窓が未完了）: 戻らない（YT 14日中央値 ≤ 1、実験前と同じ帯）\*\*（参考 — views 中央値）/);
  assert.match(md, /主指標は YouTube Studio の「視聴を継続 %」/);
});

test("buildReport with control-only Studio input shows the baseline and asks for the treatment value", () => {
  const history = { videos: [video("2026-09-15", 0, 1000, "top1")] };
  const retention = {
    control: { label: "過去 28 日（2026-09-16 閲覧）", viewedPct: 28.6, swipedPct: 71.4, views: 11, capturedAt: "2026-09-16", note: "supply が実測" },
    treatment: null,
  };
  const md = buildReport(history, { today: "2026-09-29", retention });
  assert.match(md, /\| control \| 0 \| - \(0\) \| - \| - \| - \(0\) \| 28\.6 \|/);
  assert.match(md, /\| treatment \| 1 \| 0 \(1\) \| 0 \| 0 \| 1000 \(1\) \| —（Studio から手動入力） \|/);
  assert.match(md, /\| 実験前（control） \| 過去 28 日（2026-09-16 閲覧） \| 28\.6 \| 71\.4 \| 11 \| 2026-09-16 \|/);
  assert.match(md, /未入力（実験後が未入力/);
  assert.match(md, /- 差分: —/);
  assert.match(md, /- メモ: supply が実測/);
});

test("buildReport compares 視聴を継続 % before / after when both are entered", () => {
  const history = { videos: [video("2026-09-15", 0, 1000, "top1")] };
  const retention = {
    control: { viewedPct: 28.6, capturedAt: "2026-09-16" },
    treatment: { from: "2026-09-16", to: "2026-09-29", viewedPct: 40, capturedAt: "2026-09-30" },
  };
  const md = buildReport(history, { today: "2026-09-30", retention });
  assert.match(md, /\| control \| 0 \| - \(0\) \| - \| - \| - \(0\) \| 28\.6 \|/);
  assert.match(md, /\| treatment \| 1 \| 0 \(1\) \| 0 \| 0 \| 1000 \(1\) \| 40 \|/);
  assert.match(md, /\*\*主指標 — 視聴を継続 %（YouTube Studio 手動入力）: 効果あり（実験前から \+5 pt 以上） — 実験前 28\.6 → 実験後 40（\+11\.4 pt）\*\*/);
  assert.match(md, /\| 実験後（treatment） \| 2026-09-16 〜 2026-09-29 \| 40 \| 60 \| - \| 2026-09-30 \|/);
  assert.match(md, /- 差分: \+11\.4 pt（閾値 ±5 pt は提案値。確定はオーナー）/);
  // the view-median verdict is unchanged by the Studio numbers
  assert.match(md, /\*\*判定（14 日判定 — .*）: 戻らない.*\*\*（参考 — views 中央値）/);
  const worse = buildReport(history, { today: "2026-09-30", retention: { ...retention, treatment: { viewedPct: 20 } } });
  assert.match(worse, /悪化（−5 pt 以下） — 実験前 28\.6 → 実験後 20（−8\.6 pt）/);
});

test("loadStudioRetention returns null for a missing or malformed file instead of throwing", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-retention-"));
  assert.equal(loadStudioRetention(join(dir, "missing.json")), null);
  const broken = join(dir, "broken.json");
  writeFileSync(broken, "{ not json");
  assert.equal(loadStudioRetention(broken), null);
  const list = join(dir, "list.json");
  writeFileSync(list, "[1, 2]");
  assert.equal(loadStudioRetention(list), null);
  const ok = join(dir, "ok.json");
  writeFileSync(ok, JSON.stringify({ control: { viewedPct: 28.6 }, treatment: null }));
  assert.deepEqual(loadStudioRetention(ok), { control: { viewedPct: 28.6 }, treatment: null });
});

test("the committed data/studio-retention.json parses and holds the 2026-09-16 baseline", () => {
  const r = loadStudioRetention();
  assert.ok(r, "data/studio-retention.json should exist and be a JSON object");
  assert.equal(normalizeRetention(r.control).viewedPct, 28.6);
  assert.equal(normalizeRetention(r.control).swipedPct, 71.4);
  const t = normalizeRetention(r.treatment);
  assert.ok(t === null || typeof t.viewedPct === "number", "treatment is either not entered yet or a valid 視聴を継続 %");
});
