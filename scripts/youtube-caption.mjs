/**
 * YouTube title / description builders — per-day individualization.
 *
 * Why (experiment started 2026-09-14): every upload since April used the
 * identical title "【GitHub Trending】今日の注目リポジトリ TOP5｜YYYY/MM/DD #Shorts"
 * plus a templated description. YouTube distribution collapsed on 2026-04-21
 * (213 → 9 views overnight, 14-day median 0–1 ever since) while the very same
 * video reaches ~1,300 views on Instagram — so the content is not the problem.
 * Identical metadata posted daily through the API is a classic re-upload /
 * spam signal, so the YouTube metadata is made unique per day here:
 *   - title       = TOP1 repo name + what it does + short date
 *   - description = leads with TOP1, per-repo detail copy, no fixed opener
 * Instagram captions are deliberately untouched (IG reach is healthy).
 *
 * Arms (YT_TITLE_TEMPLATE, see yt-experiment-switches.mjs):
 *   "top1"     experiment — the builders below
 *   "standard" control    — the exact pre-experiment title AND description
 *
 * Limits (YouTube Data API v3 `videos` resource): snippet.title ≤ 100
 * characters, snippet.description ≤ 5000 bytes, neither may contain `<` or `>`.
 * The docs do not say how characters are counted, so titles are measured in
 * UTF-16 code units (never less than code points — the conservative choice).
 */

import { switchOn } from "./yt-experiment-switches.mjs";

export const YT_TITLE_MAX = 100;
/** Safety margin under the API limit (coffee-daily-video lost a whole upload at 127 chars on 2026-09-03). */
export const YT_TITLE_SAFE_MAX = 95;
export const YT_DESCRIPTION_MAX_BYTES = 5000;

/**
 * Experiment arm. Pinned via the Variable on purpose: `optimization-hints.json`
 * used to be allowed to pick the template, but its "best average" rule would
 * flip back to "standard" (82 videos at ~1 view) after a couple of quiet days
 * and contaminate the 14-day window.
 */
export function resolveTitleTemplate(envValue, warn = console.warn) {
  return switchOn(envValue, "YT_TITLE_TEMPLATE", warn) ? "top1" : "standard";
}

/** Length as YouTube is most likely to count it (UTF-16 code units). */
export function unitLength(text) {
  return String(text ?? "").length;
}

/** Strip characters YouTube rejects and collapse whitespace. */
export function sanitizeText(text) {
  return String(text ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Truncate to at most `max` UTF-16 units, ending with "…" (trailing
 * punctuation trimmed). Cuts only between code points, never inside a
 * surrogate pair.
 */
export function truncateUnits(text, max) {
  const str = String(text ?? "");
  if (str.length <= max) return str;
  let head = "";
  for (const ch of str) {
    if (head.length + ch.length > max - 1) break;
    head += ch;
  }
  return `${head.replace(/[\s、。，,｜|—\-]+$/u, "")}…`;
}

/** "2026/09/14" → "9/14" */
export function shortDate(dateStr) {
  const [, month, day] = String(dateStr?.full ?? "").split("/");
  return month && day ? `${Number(month)}/${Number(day)}` : String(dateStr?.full ?? "");
}

function sentence(text) {
  const t = sanitizeText(text);
  if (!t) return "";
  return /[。！？!?]$/.test(t) ? t : `${t}。`;
}

/** Control arm — the exact title used for every upload before 2026-09-14. */
export function buildLegacyTitle(dateStr) {
  return `【GitHub Trending】今日の注目リポジトリ TOP5｜${dateStr.full} #Shorts`;
}

/** Control arm — the exact description used for every upload before 2026-09-14. */
export function buildLegacyDescription(projects, dateStr, hashtags) {
  const lines = [
    `${dateStr.full} の GitHub Trending 上位5リポジトリを紹介します。`,
    "",
    "--- 本日のランキング ---",
    "",
  ];

  for (const p of projects) {
    lines.push(`${p.rank}. ${p.fullName}`);
    lines.push(`   ${p.description}`);
    lines.push(`   ${p.stars.toLocaleString()} stars (+${p.todayStars.toLocaleString()} today)`);
    lines.push(`   ${p.url}`);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("毎朝 GitHub Trending をチェックして、最新のトレンドをキャッチしよう。");
  lines.push("チャンネル登録 & いいね お願いします。");
  lines.push("");
  lines.push(hashtags.join(" "));

  return lines.join("\n");
}

export function buildTop1Title(projects, dateStr) {
  const top = projects?.[0] ?? {};
  const name = sanitizeText(top.name);
  if (!name) return buildLegacyTitle(dateStr);
  const what = sanitizeText(top.description);
  const head = `${name} — `;
  const suffix = `｜GitHub Trending TOP5 ${shortDate(dateStr)}`;
  const room = YT_TITLE_SAFE_MAX - unitLength(head) - unitLength(suffix);
  const body = room >= 8 ? truncateUnits(what, room) : "";
  const title = body ? `${head}${body}${suffix}` : `${name}${suffix}`;
  return truncateUnits(title, YT_TITLE_SAFE_MAX);
}

export function buildYouTubeTitle(projects, dateStr, template = "top1") {
  return template === "top1" ? buildTop1Title(projects, dateStr) : buildLegacyTitle(dateStr);
}

function descriptionLines(projects, dateStr, hashtags, { withDetail }) {
  const list = projects ?? [];
  const top = list[0] ?? {};
  const lines = [];
  if (sanitizeText(top.name)) {
    lines.push(
      `今日のTOP1は ${sanitizeText(top.name)}（${sanitizeText(top.fullName)}）— ${sentence(top.description)}`
    );
    if (withDetail) lines.push(sentence(top.detail));
    lines.push("");
  }
  lines.push(`${dateStr.full} の GitHub Trending TOP5`, "");

  for (const p of list) {
    lines.push(`${p.rank}. ${sanitizeText(p.fullName)} — ${sanitizeText(p.description)}`);
    if (withDetail) lines.push(`   ${sentence(p.detail)}`);
    const lang = p.language ? ` / ${sanitizeText(p.language)}` : "";
    lines.push(
      `   ${Number(p.stars).toLocaleString()} stars (+${Number(p.todayStars).toLocaleString()} today)${lang}`
    );
    lines.push(`   ${sanitizeText(p.url)}`);
    lines.push("");
  }

  lines.push(`今日の顔ぶれ: ${list.map((p) => sanitizeText(p.name)).join(" / ")}`);
  lines.push("");
  lines.push(hashtags.join(" "));
  return lines;
}

/**
 * Description that changes every day: TOP1 lead + per-repo detail copy.
 * Falls back to the short form (no detail lines) if the 5000-byte limit
 * would be exceeded, then hard-truncates as a last resort.
 */
export function buildYouTubeDescription(projects, dateStr, hashtags) {
  const full = descriptionLines(projects, dateStr, hashtags, { withDetail: true }).join("\n");
  if (Buffer.byteLength(full, "utf8") <= YT_DESCRIPTION_MAX_BYTES) return full;

  const short = descriptionLines(projects, dateStr, hashtags, { withDetail: false }).join("\n");
  if (Buffer.byteLength(short, "utf8") <= YT_DESCRIPTION_MAX_BYTES) return short;

  let out = short;
  while (Buffer.byteLength(out, "utf8") > YT_DESCRIPTION_MAX_BYTES) {
    out = truncateUnits(out, unitLength(out) - 50);
  }
  return out;
}

/**
 * Title + description for the chosen arm.
 *
 * "standard" reproduces the pre-experiment metadata exactly (same code, same
 * failure modes). "top1" also carries the legacy metadata as `fallback`, which
 * upload-youtube.mjs uses for a single retry if YouTube rejects the
 * experiment's title/description — the experiment must never cost the day's
 * upload.
 */
export function buildYouTubeMetadata(projects, dateStr, hashtags, template) {
  if (template !== "top1") {
    return {
      title: buildLegacyTitle(dateStr),
      description: buildLegacyDescription(projects, dateStr, hashtags),
      titleTemplate: "standard",
    };
  }

  const metadata = {
    title: buildTop1Title(projects, dateStr),
    description: buildYouTubeDescription(projects, dateStr, hashtags),
    titleTemplate: "top1",
  };
  try {
    metadata.fallback = {
      title: buildLegacyTitle(dateStr),
      description: buildLegacyDescription(projects, dateStr, hashtags),
      titleTemplate: "standard",
    };
  } catch (err) {
    console.warn(`  (legacy fallback metadata unavailable: ${err.message})`);
  }
  return metadata;
}
