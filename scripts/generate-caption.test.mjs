import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { generateInstagramCaption, generateYouTubeCaption } from "./generate-caption.mjs";

// Inputs and expected output captured on 2026-09-14 by running origin/main's
// (a6e9ffe) scripts/generate-caption.mjs on the day's real data.
const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/captions-2026-09-14/${name}`, import.meta.url), "utf-8"));
const data = fixture("trending-data.json");
const hints = fixture("optimization-hints.json");
const expected = fixture("expected-origin-main.json");
const dateStr = { full: "2026/09/14", compact: "20260914" };

test("Instagram caption is identical to origin/main for the same input (IG must not change)", () => {
  assert.equal(generateInstagramCaption(data, dateStr, hints), expected.instagram);
});

test("YouTube control arm (standard) reproduces origin/main's title, description and tags exactly", () => {
  const yt = generateYouTubeCaption(data, dateStr, hints, "standard");
  assert.equal(yt.title, expected.youtube.title);
  assert.equal(yt.description, expected.youtube.description);
  assert.deepEqual(yt.tags, expected.youtube.tags);
  assert.equal(yt.categoryId, expected.youtube.categoryId);
  assert.equal(yt.titleTemplate, "standard");
  assert.equal(yt.fallback, undefined);
});

test("YouTube experiment arm (top1) is individualized and carries the legacy metadata as fallback", () => {
  const yt = generateYouTubeCaption(data, dateStr, hints, "top1");
  assert.equal(yt.titleTemplate, "top1");
  assert.equal(yt.title, "colibri — 余ったSSDでフロンティアMoEを回す｜GitHub Trending TOP5 9/14");
  assert.notEqual(yt.description, expected.youtube.description);
  assert.deepEqual(yt.tags, expected.youtube.tags, "tags are shared by both arms");
  assert.deepEqual(yt.fallback, {
    title: expected.youtube.title,
    description: expected.youtube.description,
    titleTemplate: "standard",
  });
});
