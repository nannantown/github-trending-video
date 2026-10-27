/**
 * Reading fixes for the narration voice (shared by the 4 sns-hub video repos — keep the copies identical).
 *
 * Edge TTS guesses the reading of kanji and sometimes guesses wrong (甲革 -> 「かんかく」).
 * The Edge read-aloud endpoint refuses SSML <sub>/<phoneme> (closes with 1007, checked 2026-10-27),
 * so the only fix is to send it a different text: forSpeech() swaps the words listed in
 * data/tts-readings.json for their kana reading. The on-screen text must not change, so
 * restoreWords() maps Edge's word timings (which now carry kana) back onto the original spelling.
 *
 *   const speech = forSpeech(text);
 *   const { audio, words } = await synthesizeOnce(speech.spoken, opts);
 *   const subtitleWords = speech.restoreWords(words); // texts are slices of `text` again
 *
 * CLI (the routines run this before making audio):
 *   node scripts/tts-reading.mjs "<narration>" ...                -> what the voice will be given
 *   node scripts/tts-reading.mjs --data=<file.json> [--date=YYYY-MM-DD]
 *     -> the same for every Japanese string in the file (with --date: skip objects whose "date" differs),
 *        then the words still left to the voice's own guess (English, kanji compounds) to check one by one
 */

import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const DICT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "tts-readings.json");

// A reading is kana only (a reading, never new words or kanji), starts and ends with kana (a leading
// space would drop the word from the subtitles), replaces something that is not already kana, and is
// not much longer than what it replaces. ponytail: it cannot check the reading MEANS the surface —
// 保存 → 「ゆうほ」 passes; the length cap only stops whole sentences from riding in.
const KANA = /^[ぁ-ゖァ-ヺー](?:[ぁ-ゖァ-ヺー・、。 　]*[ぁ-ゖァ-ヺー])?$/u;
const ONLY_KANA = /^[ぁ-ゖァ-ヺー・、。\s]+$/u;
export function readingProblem(surface, reading) {
  if (typeof surface !== "string" || !surface.trim()) return "empty surface";
  if (ONLY_KANA.test(surface)) return `「${surface}」 is already kana — nothing to read differently`;
  if (typeof reading !== "string" || !KANA.test(reading)) return `reading of 「${surface}」 must be kana only (kana at both ends): ${JSON.stringify(reading)}`;
  if (reading.length > Math.max(surface.length * 3, surface.length + 6)) return `reading of 「${surface}」 is too long for a reading: ${reading}`;
  return null;
}

/** { surface: reading }. Keys starting with "_" are notes. A bad entry or a broken file is skipped (with a warning), never fatal. */
export function loadReadings(path = DICT_PATH) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    console.warn(`tts-readings: ${existsSync(path) ? `cannot read ${path} (${err.message})` : `${path} not found`} — the voice reads every word its own way`);
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    console.warn(`tts-readings: ${path} is not a JSON object — the voice reads every word its own way`);
    return {};
  }
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("_")) continue;
    const problem = readingProblem(k, v);
    if (problem) console.warn(`tts-readings: skipped — ${problem}`);
    else out[k] = v;
  }
  return out;
}

let cached;
const defaultReadings = () => (cached ??= loadReadings());

/**
 * Returns { spoken, spans, restoreWords }. spans: [{ from, to, origFrom, origTo }] (spoken / original
 * index ranges of each replacement). Longest surface wins where two entries overlap.
 */
export function forSpeech(text, readings = defaultReadings()) {
  const keys = Object.keys(readings).filter((k) => k && readings[k] !== k).sort((a, b) => b.length - a.length);
  const spans = [];
  let spoken = "";
  let i = 0;
  // An English entry only matches a whole word ("agent" must not hit "Reagent" or "agents"), and a
  // number only a whole number ("1足" must not hit the 1足 inside "11足").
  const edge = (c, next) => (/[A-Za-z]/.test(c) && /[A-Za-z]/.test(next)) || (/[0-9０-９]/.test(c) && /[0-9０-９.,]/.test(next));
  const wholeWord = (k, at) => !edge(k[0], text[at - 1] ?? "") && !edge(k.at(-1), text[at + k.length] ?? "");
  while (i < text.length) {
    const key = keys.find((k) => text.startsWith(k, i) && wholeWord(k, i));
    if (key) {
      spans.push({ from: spoken.length, to: spoken.length + readings[key].length, origFrom: i, origTo: i + key.length });
      spoken += readings[key];
      i += key.length;
    } else {
      spoken += text[i++];
    }
  }
  return { spoken, spans, restoreWords: (words) => restoreWords(words, text, spoken, spans) };
}

// spoken index -> original index. Inside a replaced span everything maps to the span's end, so the
// word that holds the start of a span gets the whole original surface and later pieces get nothing.
function toOrig(pos, spans) {
  let delta = 0;
  for (const s of spans) {
    if (pos <= s.from) break;
    if (pos < s.to) return s.origTo;
    delta = s.origTo - s.to;
  }
  return pos + delta;
}

/**
 * Edge word boundaries for `spoken` -> the same timings with texts sliced from `text`.
 * A piece that falls entirely inside a replaced span is merged into the previous word (its
 * duration is extended) so no empty word reaches the subtitles.
 */
export function restoreWords(words, text, spoken, spans) {
  if (!spans.length) return words;
  const out = [];
  let cursor = 0;
  let unmatched = 0; // characters of tokens Edge rewrote since the last match
  for (const w of words) {
    // Edge drops punctuation and spaces between tokens, and sometimes rewrites a token (１ → 1, 3cm →
    // 3センチ). The next match may skip what was rewritten (about as long as the rewritten tokens) plus
    // punctuation; a match further away is a false hit — keep what Edge said, don't jump.
    const at = spoken.indexOf(w.text, cursor);
    const gap = at < 0 ? "" : spoken.slice(cursor, at);
    if (at < 0 || (gap.length > 2 + unmatched && !/^[\s\p{P}\p{S}]*$/u.test(gap))) {
      out.push(w);
      unmatched += w.text.length;
      continue;
    }
    unmatched = 0;
    cursor = at + w.text.length;
    const surface = text.slice(toOrig(at, spans), toOrig(cursor, spans));
    if (surface) {
      out.push({ ...w, text: surface });
    } else if (out.length) {
      const prev = out[out.length - 1];
      out[out.length - 1] = { ...prev, duration: w.offset + w.duration - prev.offset };
    }
  }
  return out;
}

// ---- CLI ----
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const [dataPath, date] = [arg("data"), arg("date")];
  const texts = [];
  if (dataPath) {
    const walk = (v) => {
      if (typeof v === "string") {
        if (/[぀-ヿ一-鿿]/.test(v) && !texts.includes(v)) texts.push(v);
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object" && !(date && typeof v.date === "string" && v.date !== date)) Object.values(v).forEach(walk);
    };
    walk(JSON.parse(readFileSync(dataPath, "utf-8")));
  } else texts.push(...process.argv.slice(2).filter((a) => !a.startsWith("--")));
  const left = { 英字: new Set(), 漢字: new Set() };
  for (const t of texts) {
    const { spoken } = forSpeech(t);
    console.log(spoken === t ? `  ${t}` : `* ${t}\n  -> ${spoken}`);
    for (const m of spoken.match(/[A-Za-z][A-Za-z0-9.&'+-]*/g) ?? []) left.英字.add(m);
    for (const m of spoken.match(/[一-鿿々]{2,}/g) ?? []) left.漢字.add(m);
  }
  console.log("\n声が自分で読みを決める語（固有名詞・専門用語・読みが 2 通りある語・数と助数詞は、読みを決めて data/tts-readings.json に足す）:");
  for (const [kind, set] of Object.entries(left)) console.log(`  ${kind}: ${[...set].join("、") || "なし"}`);
}
