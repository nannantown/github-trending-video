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
 * Primary metric since 2026-09-16: YouTube Studio's Shorts engagement
 * "viewed vs. swiped away" (視聴を継続 % / スワイプして消去 %), compared before
 * and after the experiment. The Data API does not expose it, so it is typed
 * in by hand into data/studio-retention.json (schema: loadStudioRetention).
 * The report never fails when that file is missing or half-filled — the cells
 * read "—（Studio から手動入力）". The view medians stay in the report as
 * reference values (this channel's counts are too small to separate signal
 * from noise).
 *
 * Usage:
 *   node scripts/yt-experiment-report.mjs [--start=YYYY-MM-DD] [--days=14] [--history=path] [--today=YYYY-MM-DD] [--retention=path]
 *   --start defaults to the first video recorded with an experiment arm
 *   (titleTemplate "top1" or ytOpening "top1").
 *   --retention defaults to data/studio-retention.json.
 */

import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultHistoryPath = join(__dirname, "..", "data", "performance-history.json");
const defaultRetentionPath = join(__dirname, "..", "data", "studio-retention.json");

export const EXPERIMENT_ARM = "top1";
export const DEFAULT_WINDOW_DAYS = 14;
/** Treatment YT median at/above this = distribution is back (clearly out of the 0–1 band). */
export const RESTORED_MIN_MEDIAN = 10;
/** Treatment YT median at/above this (but below RESTORED) = a signal worth extending the window. */
export const SIGNAL_MIN_MEDIAN = 2;
/**
 * Change of 視聴を継続 % (percentage points, after − before) that counts as a
 * real move. Proposal from 2026-09-16 — the owner confirms the value.
 */
export const RETENTION_DELTA_PT = 5;
/** Cell text when a Studio value has not been typed in yet. */
export const RETENTION_MISSING = "—（Studio から手動入力）";

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

/*
 * ── Primary metric: YouTube Studio 視聴を継続 % (typed in by hand) ──────────
 *
 * data/studio-retention.json
 * {
 *   "control":   { "label": "実験前 — Studio の「過去 28 日」（2026-09-16 閲覧）",
 *                  "from": "YYYY-MM-DD", "to": "YYYY-MM-DD",      // optional; label wins when both exist
 *                  "viewedPct": 28.6, "swipedPct": 71.4,           // 視聴を継続 % / スワイプして消去 % (0–100)
 *                  "views": 11, "capturedAt": "2026-09-16", "note": "..." },
 *   "treatment": null                                             // same shape once read from Studio
 * }
 * If only swipedPct is given, viewedPct = 100 − swipedPct. Anything malformed
 * counts as "not entered" — a typo must not break the report.
 */

/** Parsed JSON of the Studio input file, or null when it is missing / unreadable / not an object. */
export function loadStudioRetention(path = defaultRetentionPath) {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function pct(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/** One period entry normalized; null when 視聴を継続 % has not been entered (or is not a 0–100 number). */
export function normalizeRetention(entry) {
  if (!entry || typeof entry !== "object") return null;
  let viewedPct = pct(entry.viewedPct);
  const swipedPct = pct(entry.swipedPct);
  if (viewedPct === null && swipedPct !== null) viewedPct = round1(100 - swipedPct);
  if (viewedPct === null) return null;
  const str = (k) => (typeof entry[k] === "string" && entry[k] ? entry[k] : null);
  return {
    viewedPct,
    swipedPct: swipedPct ?? round1(100 - viewedPct),
    label: str("label"),
    from: str("from"),
    to: str("to"),
    views: typeof entry.views === "number" && Number.isFinite(entry.views) ? entry.views : null,
    capturedAt: str("capturedAt"),
    note: str("note"),
  };
}

/** after − before in percentage points (0.1 precision); null unless both periods are entered. */
export function retentionDelta(control, treatment) {
  if (!control || !treatment) return null;
  return round1(treatment.viewedPct - control.viewedPct);
}

export function retentionVerdict(control, treatment, deltaPt = RETENTION_DELTA_PT) {
  const delta = retentionDelta(control, treatment);
  if (delta === null) return "missing";
  if (delta >= deltaPt) return "improved";
  if (delta <= -deltaPt) return "worse";
  return "flat";
}

const RETENTION_VERDICT_LABEL = {
  improved: `効果あり（実験前から +${RETENTION_DELTA_PT} pt 以上）`,
  flat: `変化なし（±${RETENTION_DELTA_PT} pt 未満）`,
  worse: `悪化（−${RETENTION_DELTA_PT} pt 以下）`,
};

function signedPt(delta) {
  return delta < 0 ? `−${Math.abs(delta)}` : `+${delta}`;
}

/** The one-line primary verdict. Exported so the morning routine / memo can quote it verbatim. */
export function retentionHeadline(control, treatment) {
  const head = "**主指標 — 視聴を継続 %（YouTube Studio 手動入力）: ";
  const v = retentionVerdict(control, treatment);
  if (v === "missing") {
    const which = !control && !treatment ? "実験前・実験後とも" : !control ? "実験前が" : "実験後が";
    return `${head}未入力（${which}未入力。${RETENTION_MISSING}）**`;
  }
  const delta = retentionDelta(control, treatment);
  return `${head}${RETENTION_VERDICT_LABEL[v]} — 実験前 ${control.viewedPct} → 実験後 ${treatment.viewedPct}（${signedPt(delta)} pt）**`;
}

function retentionPeriod(r) {
  if (!r) return RETENTION_MISSING;
  if (r.label) return r.label;
  if (r.from && r.to) return `${r.from} 〜 ${r.to}`;
  return "-";
}

function retentionSection(control, treatment) {
  const row = (name, r) =>
    `| ${name} | ${retentionPeriod(r)} | ${r ? r.viewedPct : RETENTION_MISSING} | ${r ? r.swipedPct : "-"} | ${fmt(r?.views)} | ${fmt(r?.capturedAt)} |`;
  const delta = retentionDelta(control, treatment);
  const notes = [control?.note, treatment?.note].filter(Boolean);
  return [
    "### 主指標: 視聴を継続 %（YouTube Studio、手動入力）",
    "",
    "| 期間 | Studio の期間 | 視聴を継続 % | スワイプして消去 % | 視聴回数 | 取得日 |",
    "|---|---|---:|---:|---:|---|",
    row("実験前（control）", control),
    row("実験後（treatment）", treatment),
    "",
    `- 差分: ${delta === null ? "—（実験前・実験後の両方が入るまで出ない）" : `${signedPt(delta)} pt`}（閾値 ±${RETENTION_DELTA_PT} pt は提案値。確定はオーナー）`,
    `- 閾値案: 実験前から +${RETENTION_DELTA_PT} pt 以上 = 効果あり / ±${RETENTION_DELTA_PT} pt 未満 = 変化なし / −${RETENTION_DELTA_PT} pt 以下 = 悪化`,
    "- 入力: `data/studio-retention.json`（`--retention=path` で差し替え）。YouTube Studio → アナリティクス → コンテンツ → ショート → 視聴者のエンゲージメント「視聴を継続 / スワイプして消去」を期間指定で読む（Data API では取れない。supply が実測して入力）",
    ...notes.map((n) => `- メモ: ${n}`),
  ];
}

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

/**
 * @param history   parsed data/performance-history.json
 * @param retention parsed data/studio-retention.json (loadStudioRetention) — optional; missing = cells read RETENTION_MISSING
 */
export function buildReport(history, { start, days = DEFAULT_WINDOW_DAYS, today = todayJst(), retention = null } = {}) {
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
  const rControl = normalizeRetention(retention?.control);
  const rTreatment = normalizeRetention(retention?.treatment);
  const lines = [
    `## YouTube 配信実験 — ${days} 日比較（開始 ${startDate}）`,
    "",
    `- control: ${w.controlFrom} 〜 ${addDays(startDate, -1)}（旧タイトル・旧説明文・共用動画）`,
    `- treatment: ${startDate} 〜 ${addDays(w.treatmentTo, -1)}（YouTube のみ: TOP1 個別化タイトル/説明文 + TOP1 冒頭の専用レンダ）`,
    `- Instagram は両期間とも無変更（対照）`,
    `- YouTube views は fetch 済みの値のみ（fetch-stats.mjs は投稿後 14 日まで更新。未取得は "-"）`,
    `- 集計日 ${today} / 14 日判定は ${day14From} 以降 / 確定は ${finalFrom} 以降`,
    "- 主指標は YouTube Studio の「視聴を継続 %」の実験前後比較（2026-09-16 変更。API では取れないので手動入力 = `data/studio-retention.json`）。views 中央値と IG views は参考値（母数が小さくノイズ）",
    ...(fallbackDays > 0
      ? [`- treatment のうち ${fallbackDays} 日は YouTube 専用レンダなし（YT opening = brand）`]
      : []),
    "",
    "| window | n | YT median (n) | YT mean | YT max | IG median (n) | 視聴を継続 % (Studio) |",
    "|---|---:|---:|---:|---:|---:|---:|",
    `| control | ${c.n} | ${fmt(c.ytMedian)} (${c.ytN}) | ${fmt(c.ytMean)} | ${fmt(c.ytMax)} | ${fmt(c.igMedian)} (${c.igN}) | ${rControl ? rControl.viewedPct : RETENTION_MISSING} |`,
    `| treatment | ${t.n} | ${fmt(t.ytMedian)} (${t.ytN}) | ${fmt(t.ytMean)} | ${fmt(t.ytMax)} | ${fmt(t.igMedian)} (${t.igN}) | ${rTreatment ? rTreatment.viewedPct : RETENTION_MISSING} |`,
    "",
    retentionHeadline(rControl, rTreatment),
    "",
    `**判定（${phaseLabel(phase, finalFrom)}）: ${VERDICT_LABEL[v]}**（参考 — views 中央値）`,
    "",
    ...retentionSection(rControl, rTreatment),
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
  const retentionPath = argValue("retention") || defaultRetentionPath;
  const retention = loadStudioRetention(retentionPath);
  if (retention === null && existsSync(retentionPath)) {
    console.error(`warning: ${retentionPath} is not a JSON object — treating 視聴を継続 % as not entered`);
  }
  console.log(buildReport(history, { start: argValue("start"), days, today: argValue("today") || todayJst(), retention }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
