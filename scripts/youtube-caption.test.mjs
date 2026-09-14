import { test } from "node:test";
import assert from "node:assert/strict";
import {
  YT_TITLE_MAX,
  YT_TITLE_SAFE_MAX,
  YT_DESCRIPTION_MAX_BYTES,
  resolveTitleTemplate,
  unitLength,
  sanitizeText,
  truncateUnits,
  shortDate,
  buildYouTubeTitle,
  buildYouTubeDescription,
  buildLegacyTitle,
  buildYouTubeMetadata,
} from "./youtube-caption.mjs";

const dateStr = { full: "2026/09/14", compact: "20260914" };
const legacyTitle = "【GitHub Trending】今日の注目リポジトリ TOP5｜2026/09/14 #Shorts";

function project(rank, name, description, extra = {}) {
  return {
    rank,
    name,
    fullName: `owner${rank}/${name}`,
    url: `https://github.com/owner${rank}/${name}`,
    stars: 1000 * rank,
    todayStars: 10 * rank,
    language: "TypeScript",
    description,
    detail: `${name} の詳細説明。二文目もあります`,
    narration: "ナレーション",
    ...extra,
  };
}

const projects = [
  project(1, "colibri", "余ったSSDでフロンティアMoEを回す", { language: "C" }),
  project(2, "ever-gauzy", "小規模チーム向け統合業務OSS"),
  project(3, "gods-eye-view", "OSINT向けブラウザ3D地球儀", { language: "JavaScript" }),
  project(4, "agent-skills", "AI IDE 共通のスキルレジストリ"),
  project(5, "DeskcommCRM", "WhatsApp 商流の自己ホスト CRM"),
];
const hashtags = ["#GitHubTrending", "#Shorts"];

test("YT_TITLE_TEMPLATE: unset/top1 = experiment, standard/false/typo = control (never throws)", () => {
  const warnings = [];
  const warn = (m) => warnings.push(m);
  assert.equal(resolveTitleTemplate(undefined, warn), "top1");
  assert.equal(resolveTitleTemplate("", warn), "top1");
  assert.equal(resolveTitleTemplate("top1", warn), "top1");
  assert.equal(resolveTitleTemplate(" Standard ", warn), "standard");
  assert.equal(resolveTitleTemplate("false", warn), "standard");
  assert.equal(warnings.length, 0);
  assert.equal(resolveTitleTemplate("emoji", warn), "standard");
  assert.equal(warnings.length, 1);
});

test("shortDate derives M/D from the full date", () => {
  assert.equal(shortDate({ full: "2026/09/14" }), "9/14");
  assert.equal(shortDate({ full: "2026/10/01" }), "10/1");
});

test("top1 title leads with the TOP1 repo name and what it does, plus the date", () => {
  const title = buildYouTubeTitle(projects, dateStr, "top1");
  assert.equal(title, "colibri — 余ったSSDでフロンティアMoEを回す｜GitHub Trending TOP5 9/14");
  assert.ok(unitLength(title) <= YT_TITLE_SAFE_MAX);
  assert.ok(YT_TITLE_SAFE_MAX < YT_TITLE_MAX);
});

test("top1 title differs day to day when the TOP1 repo changes", () => {
  const a = buildYouTubeTitle(projects, dateStr, "top1");
  const b = buildYouTubeTitle([projects[1], ...projects], { full: "2026/09/15" }, "top1");
  assert.notEqual(a, b);
  assert.equal(b, "ever-gauzy — 小規模チーム向け統合業務OSS｜GitHub Trending TOP5 9/15");
});

test("standard template reproduces the legacy (control) title exactly", () => {
  assert.equal(buildYouTubeTitle(projects, dateStr, "standard"), legacyTitle);
  assert.equal(buildLegacyTitle(dateStr), legacyTitle);
});

test("top1 title stays within the safe limit and keeps the suffix when the hook is long", () => {
  const longHook = "あ".repeat(120);
  const title = buildYouTubeTitle([project(1, "some-long-repository-name", longHook)], dateStr, "top1");
  assert.ok(unitLength(title) <= YT_TITLE_SAFE_MAX, `length ${unitLength(title)}`);
  assert.ok(title.endsWith("｜GitHub Trending TOP5 9/14"), title);
  assert.ok(title.startsWith("some-long-repository-name — あ"), title);
  assert.ok(title.includes("…"));
});

test("emoji-heavy hooks are measured in UTF-16 units and never split a surrogate pair", () => {
  const title = buildYouTubeTitle([project(1, "emoji-repo", "🚀".repeat(80))], dateStr, "top1");
  assert.ok(unitLength(title) <= YT_TITLE_SAFE_MAX, `length ${unitLength(title)}`);
  assert.ok(title.endsWith("｜GitHub Trending TOP5 9/14"), title);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(title), "no lone high surrogate");
  assert.equal(unitLength("😀😀"), 4);
  assert.equal(truncateUnits("😀😀😀", 5), "😀😀…");
});

test("title strips characters YouTube rejects (< >) and collapses whitespace", () => {
  const title = buildYouTubeTitle([project(1, "x<y>z", "  a  <b>  c ")], dateStr, "top1");
  assert.ok(!/[<>]/.test(title));
  assert.match(title, /^xyz — a b c｜/);
  assert.equal(sanitizeText("  a \n b  "), "a b");
});

test("truncateUnits trims dangling punctuation before the ellipsis", () => {
  assert.equal(truncateUnits("abc", 5), "abc");
  assert.equal(truncateUnits("あいうえお、かき", 6), "あいうえお…");
});

test("builders never throw on sparse data (captions run before the Instagram upload)", () => {
  assert.equal(buildYouTubeTitle([], dateStr, "top1"), legacyTitle);
  assert.equal(buildYouTubeTitle([{ rank: 1 }], dateStr, "top1"), legacyTitle);
  assert.match(buildYouTubeDescription([], dateStr, hashtags), /^2026\/09\/14 の GitHub Trending TOP5/);
  assert.doesNotThrow(() => buildYouTubeDescription([{ rank: 1, name: "x" }], dateStr, hashtags));
  const meta = buildYouTubeMetadata([{ rank: 1, name: "x" }], dateStr, hashtags, "top1");
  assert.equal(meta.titleTemplate, "top1");
});

test("description leads with TOP1, lists every repo with detail + url, and drops the fixed template opener", () => {
  const desc = buildYouTubeDescription(projects, dateStr, hashtags);
  const lines = desc.split("\n");
  assert.equal(lines[0], "今日のTOP1は colibri（owner1/colibri）— 余ったSSDでフロンティアMoEを回す。");
  assert.equal(lines[1], "colibri の詳細説明。二文目もあります。");
  for (const p of projects) {
    assert.ok(desc.includes(`${p.rank}. ${p.fullName} — ${p.description}`), p.fullName);
    assert.ok(desc.includes(p.url), p.url);
    assert.ok(desc.includes(p.detail), p.detail);
  }
  assert.ok(desc.includes("1,000 stars (+10 today) / C"));
  assert.ok(desc.includes("今日の顔ぶれ: colibri / ever-gauzy / gods-eye-view / agent-skills / DeskcommCRM"));
  assert.ok(desc.endsWith("#GitHubTrending #Shorts"));
  assert.ok(!desc.includes("上位5リポジトリを紹介します"));
  assert.ok(!desc.includes("チャンネル登録"));
  assert.ok(!/[<>]/.test(desc));
});

test("description falls back to the short form, then truncates, to stay under 5000 bytes", () => {
  const bloated = projects.map((p) => ({ ...p, detail: "長".repeat(600) }));
  const desc = buildYouTubeDescription(bloated, dateStr, hashtags);
  assert.ok(Buffer.byteLength(desc, "utf8") <= YT_DESCRIPTION_MAX_BYTES);
  assert.ok(!desc.includes("長".repeat(600)), "detail lines dropped in short form");
  assert.ok(desc.includes("owner5/DeskcommCRM"), "short form keeps the ranking");

  const huge = projects.map((p) => ({ ...p, description: "説".repeat(700) }));
  const desc2 = buildYouTubeDescription(huge, dateStr, hashtags);
  assert.ok(Buffer.byteLength(desc2, "utf8") <= YT_DESCRIPTION_MAX_BYTES);
  assert.ok(desc2.endsWith("…"));
});

test("metadata: standard = legacy title + description, top1 = individualized + legacy fallback", () => {
  const standard = buildYouTubeMetadata(projects, dateStr, hashtags, "standard");
  assert.equal(standard.title, legacyTitle);
  assert.match(standard.description, /^2026\/09\/14 の GitHub Trending 上位5リポジトリを紹介します。/);
  assert.ok(standard.description.includes("チャンネル登録 & いいね お願いします。"));
  assert.equal(standard.fallback, undefined);

  const top1 = buildYouTubeMetadata(projects, dateStr, hashtags, "top1");
  assert.match(top1.title, /^colibri — /);
  assert.equal(top1.fallback.title, legacyTitle);
  assert.equal(top1.fallback.description, standard.description);
  assert.equal(top1.fallback.titleTemplate, "standard");
});
