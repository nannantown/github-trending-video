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
} from "./yt-experiment-report.mjs";

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
