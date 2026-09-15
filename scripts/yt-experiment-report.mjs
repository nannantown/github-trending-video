/**
 * YouTube distribution experiment report (started 2026-09-14: per-day title /
 * description + a YouTube-only render with the TOP1 opening).
 *
 * Prints a markdown comparison of YouTube vs Instagram views for the N days
 * before the experiment (control) and the N days from its start (treatment),
 * so the verdict is mechanical. Reads data/performance-history.json (YouTube
 * stats are refreshed by fetch-stats.mjs for videos up to 14 days old,
 * Instagram insights by instagram-insights.mjs).
 *
 * Usage:
 *   node scripts/yt-experiment-report.mjs [--start=YYYY-MM-DD] [--days=14] [--history=path] [--today=YYYY-MM-DD]
 *   --start defaults to the first video recorded with an experiment arm
 *   (titleTemplate "top1" or ytOpening "top1").
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultHistoryPath = join(__dirname, "..", "data", "performance-history.json");

export const EXPERIMENT_ARM = "top1";
export const DEFAULT_WINDOW_DAYS = 14;
/** Treatment YT median at/above this = distribution is back (clearly out of the 0–1 band). */
export const RESTORED_MIN_MEDIAN = 10;
/** Treatment YT median at/above this (but below RESTORED) = a signal worth extending the window. */
export const SIGNAL_MIN_MEDIAN = 2;

export function median(nums) {
  const xs = nums.filter((n) => typeof n === "number" && Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isExperimentVideo(v) {
  return v.titleTemplate === EXPERIMENT_ARM || v.ytOpening === EXPERIMENT_ARM;
}

export function findExperimentStart(history) {
  const first = (history.videos || [])
    .filter(isExperimentVideo)
    .map((v) => v.date)
    .sort()[0];
  return first || null;
}

/**
 * YouTube views that were actually fetched. record-upload.mjs writes a
 * placeholder `views: 0` with `updatedAt: null`; counting it would turn a
 * failed stats fetch into a fake "unchanged" verdict.
 */
export function ytViews(video) {
  const s = video.stats;
  return s?.updatedAt && typeof s.views === "number" ? s.views : null;
}

/** control = [start-days, start), treatment = [start, start+days) */
export function splitWindows(videos, start, days = DEFAULT_WINDOW_DAYS) {
  const controlFrom = addDays(start, -days);
  const treatmentTo = addDays(start, days);
  const byDate = (a, b) => a.date.localeCompare(b.date);
  return {
    control: videos.filter((v) => v.date >= controlFrom && v.date < start).sort(byDate),
    treatment: videos.filter((v) => v.date >= start && v.date < treatmentTo).sort(byDate),
    controlFrom,
    treatmentTo,
  };
}

export function summarize(videos) {
  const yt = videos.map(ytViews).filter((n) => typeof n === "number");
  const ig = videos.map((v) => v.instagram?.views).filter((n) => typeof n === "number");
  return {
    n: videos.length,
    ytN: yt.length,
    ytMedian: median(yt),
    ytMean: yt.length ? Math.round((yt.reduce((a, b) => a + b, 0) / yt.length) * 10) / 10 : null,
    ytMax: yt.length ? Math.max(...yt) : null,
    igN: ig.length,
    igMedian: median(ig),
  };
}

export function verdict(treatmentYtMedian) {
  if (treatmentYtMedian === null) return "insufficient";
  if (treatmentYtMedian >= RESTORED_MIN_MEDIAN) return "restored";
  if (treatmentYtMedian >= SIGNAL_MIN_MEDIAN) return "signal";
  return "unchanged";
}

const VERDICT_LABEL = {
  restored: "配信が戻った（YT 14日中央値 ≥ 10）",
  signal: "兆候あり（YT 14日中央値 2〜9）— 窓を延長して再判定",
  unchanged: "戻らない（YT 14日中央値 ≤ 1、実験前と同じ帯）",
  insufficient: "判定不能（treatment 窓に取得済みの YouTube stats がない）",
};

/**
 * Report phases.
 *  - running: before start + days + 1 — the treatment window is not complete.
 *  - day14:   the 14-day verdict. Later treatment videos have had fewer days to
 *             collect views than the control videos (whose stats froze at ~14
 *             days old), so YT reads low — a "restored" verdict is conservative.
 *  - final:   from start + 2 × days — every treatment video's stats have also
 *             frozen at ~14 days old, so both windows are age-matched.
 */
export function judgeDates(start, days = DEFAULT_WINDOW_DAYS) {
  return { day14From: addDays(start, days + 1), finalFrom: addDays(start, 2 * days) };
}

export function reportPhase(start, days, today) {
  const { day14From, finalFrom } = judgeDates(start, days);
  if (today >= finalFrom) return "final";
  if (today >= day14From) return "day14";
  return "running";
}

function phaseLabel(phase, finalFrom) {
  if (phase === "final") return "確定 — 全動画が約 14 日分の視聴期間";
  if (phase === "day14") return `14 日判定 — 後半の動画は視聴期間が短く YT は低めに出る。年齢を揃えた確定値は ${finalFrom} 以降`;
  return "暫定 — treatment 窓が未完了";
}

function fmt(n) {
  return n === null || n === undefined ? "-" : String(n);
}

function rows(videos) {
  const out = [
    "| date | title | YT opening | YT thumb | YT views | IG views | IG reach |",
    "|---|---|---|---|---:|---:|---:|",
  ];
  for (const v of videos) {
    out.push(
      `| ${v.date} | ${v.titleTemplate || "standard"} | ${v.ytOpening || "brand"} | ${v.ytThumbnail || "-"} | ${fmt(ytViews(v))} | ${fmt(v.instagram?.views)} | ${fmt(v.instagram?.reach)} |`
    );
  }
  if (videos.length === 0) out.push("| (no videos) | | | | | | |");
  return out;
}

/** Today's date in JST (the pipeline and performance-history use JST dates). */
export function todayJst(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function buildReport(history, { start, days = DEFAULT_WINDOW_DAYS, today = todayJst() } = {}) {
  const videos = history.videos || [];
  const startDate = start || findExperimentStart(history);
  if (!startDate) {
    return `No video recorded with an experiment arm ("${EXPERIMENT_ARM}") yet — pass --start=YYYY-MM-DD or wait for the first experiment upload.`;
  }
  const w = splitWindows(videos, startDate, days);
  const c = summarize(w.control);
  const t = summarize(w.treatment);
  const v = verdict(t.ytMedian);
  const { day14From, finalFrom } = judgeDates(startDate, days);
  const phase = reportPhase(startDate, days, today);
  const fallbackDays = w.treatment.filter((x) => x.ytOpening !== EXPERIMENT_ARM).length;
  const lines = [
    `## YouTube 配信実験 — ${days} 日比較（開始 ${startDate}）`,
    "",
    `- control: ${w.controlFrom} 〜 ${addDays(startDate, -1)}（旧タイトル・旧説明文・共用動画）`,
    `- treatment: ${startDate} 〜 ${addDays(w.treatmentTo, -1)}（YouTube のみ: TOP1 個別化タイトル/説明文 + TOP1 冒頭の専用レンダ）`,
    `- Instagram は両期間とも無変更（対照）`,
    `- YouTube views は fetch 済みの値のみ（fetch-stats.mjs は投稿後 14 日まで更新。未取得は "-"）`,
    `- 集計日 ${today} / 14 日判定は ${day14From} 以降 / 確定は ${finalFrom} 以降`,
    ...(fallbackDays > 0
      ? [`- treatment のうち ${fallbackDays} 日は YouTube 専用レンダなし（YT opening = brand）`]
      : []),
    "",
    "| window | n | YT median (n) | YT mean | YT max | IG median (n) |",
    "|---|---:|---:|---:|---:|---:|",
    `| control | ${c.n} | ${fmt(c.ytMedian)} (${c.ytN}) | ${fmt(c.ytMean)} | ${fmt(c.ytMax)} | ${fmt(c.igMedian)} (${c.igN}) |`,
    `| treatment | ${t.n} | ${fmt(t.ytMedian)} (${t.ytN}) | ${fmt(t.ytMean)} | ${fmt(t.ytMax)} | ${fmt(t.igMedian)} (${t.igN}) |`,
    "",
    `**判定（${phaseLabel(phase, finalFrom)}）: ${VERDICT_LABEL[v]}**`,
    "",
    "### control",
    "",
    ...rows(w.control),
    "",
    "### treatment",
    "",
    ...rows(w.treatment),
    "",
  ];
  return lines.join("\n");
}

function argValue(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : undefined;
}

function main() {
  const historyPath = argValue("history") || defaultHistoryPath;
  const history = JSON.parse(readFileSync(historyPath, "utf-8"));
  const days = Number(argValue("days") || DEFAULT_WINDOW_DAYS);
  console.log(buildReport(history, { start: argValue("start"), days, today: argValue("today") || todayJst() }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
