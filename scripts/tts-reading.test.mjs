import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { forSpeech, loadReadings, readingProblem } from "./tts-reading.mjs";

const w = (text, offset, duration = 0.2) => ({ text, offset, duration });

test("the voice gets the kana, the subtitles keep the kanji", () => {
  const text = "甲革と羽根を縫い合わせます。";
  const s = forSpeech(text, { 甲革: "こうかく", 縫い合わせ: "ぬいあわせ" });
  assert.equal(s.spoken, "こうかくと羽根をぬいあわせます。");
  // word split Edge actually returned for the kana text on 2026-10-27
  const words = [w("こうかく", 0), w("と", 0.3), w("羽根", 0.4), w("を", 0.6), w("ぬいあわ", 0.7), w("せ", 0.9), w("ます", 1.1)];
  const back = s.restoreWords(words);
  assert.deepEqual(back.map((x) => x.text), ["甲革", "と", "羽根", "を", "縫い合わせ", "ます"]);
  assert.equal(back[4].offset, 0.7);
  assert.ok(Math.abs(back[4].duration - 0.4) < 1e-9); // the merged「せ」extends it
  assert.equal(back.map((x) => x.text).join(""), "甲革と羽根を縫い合わせます");
});

test("a token that runs past a replaced word keeps the rest of the original", () => {
  const s = forSpeech("革靴の甲革です", { 甲革: "こうかく" });
  const back = s.restoreWords([w("革靴", 0), w("の", 0.3), w("こうかくです", 0.4)]);
  assert.deepEqual(back.map((x) => x.text), ["革靴", "の", "甲革です"]);
});

test("longest entry wins and English is swapped too", () => {
  const s = forSpeech("Crockett & Jonesの本革", { "Crockett & Jones": "クロケットアンドジョーンズ", 本: "ほん", 本革: "ほんがわ" });
  assert.equal(s.spoken, "クロケットアンドジョーンズのほんがわ");
  const back = s.restoreWords([w("クロケット", 0), w("アンド", 0.4), w("ジョーンズ", 0.6), w("の", 1), w("ほんがわ", 1.1)]);
  assert.deepEqual(back.map((x) => x.text), ["Crockett & Jones", "の", "本革"]);
});

test("an English entry matches whole words only (digits and kanji around it are fine)", () => {
  const r = { agent: "エージェント", Claude: "クロード", DB: "ディービー" };
  assert.equal(forSpeech("Reagent と agents と 17agent", r).spoken, "Reagent と agents と 17エージェント");
  assert.equal(forSpeech("Claude公式、ClaudeCode、80DBを", r).spoken, "クロード公式、ClaudeCode、80ディービーを");
});

test("no entry hit -> text and words untouched", () => {
  const words = [w("今日", 0), w("は", 0.2)];
  const s = forSpeech("今日は", { 甲革: "こうかく" });
  assert.equal(s.spoken, "今日は");
  assert.equal(s.restoreWords(words), words);
});

test("a token Edge rewrote is kept as Edge said it", () => {
  const s = forSpeech("甲革は3cm", { 甲革: "こうかく" });
  const back = s.restoreWords([w("こうかく", 0), w("は", 0.3), w("3センチ", 0.4)]);
  assert.deepEqual(back.map((x) => x.text), ["甲革", "は", "3センチ"]);
});

test("every entry of data/tts-readings.json is a usable reading", () => {
  const raw = JSON.parse(readFileSync(new URL("../data/tts-readings.json", import.meta.url), "utf-8"));
  const problems = Object.entries(raw).filter(([k]) => !k.startsWith("_")).map(([k, v]) => readingProblem(k, v)).filter(Boolean);
  assert.deepEqual(problems, []);
  assert.ok(!Object.keys(loadReadings()).some((k) => k.startsWith("_")));
});

test("a reading must be kana and reading-sized; bad entries are skipped, not fatal", () => {
  assert.equal(readingProblem("甲革", "こうかく"), null);
  assert.equal(readingProblem("Crockett & Jones", "クロケット・アンド・ジョーンズ"), null);
  assert.match(readingProblem("甲革", "甲かく"), /kana only/);
  assert.match(readingProblem("AI", "AI"), /kana only/);
  assert.match(readingProblem("AI", "ゆうりょうプランがおすすめのえーあい"), /too long/);
  assert.match(readingProblem("保存", "ゆうりょうぷらんへ"), /too long/);
  assert.match(readingProblem("X", " えっくす"), /kana at both ends/); // a leading space would drop X from the subtitles
  assert.match(readingProblem("て", "ゆう"), /already kana/);
  const dir = mkdtempSync(join(tmpdir(), "readings-"));
  writeFileSync(join(dir, "r.json"), JSON.stringify({ _about: "x", 甲革: "こうかく", 木型: "木がた" }));
  assert.deepEqual(loadReadings(join(dir, "r.json")), { 甲革: "こうかく" });
  writeFileSync(join(dir, "broken.json"), '{ "甲革": "こうかく", }'); // a trailing comma must not stop the video
  assert.deepEqual(loadReadings(join(dir, "broken.json")), {});
  assert.deepEqual(loadReadings(join(dir, "missing.json")), {});
});

test("a number entry matches whole numbers only", () => {
  const r = { "1足": "いっそく", "3足": "さんぞく" };
  assert.equal(forSpeech("1足、11足、3足", r).spoken, "いっそく、11足、さんぞく");
});

test("a token Edge rewrote far ahead does not make the rest jump (no kana leaks)", () => {
  const text = "１つ目はClaude、2つ目は1つ";
  const s = forSpeech(text, { Claude: "クロード" });
  const words = ["1", "つ", "目", "は", "クロード", "2", "つ", "目", "は", "1", "つ"].map((t, i) => w(t, i * 0.2));
  assert.deepEqual(s.restoreWords(words).map((x) => x.text), ["1", "つ", "目", "は", "Claude", "2", "つ", "目", "は", "1", "つ"]);
});
