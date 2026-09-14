import { test } from "node:test";
import assert from "node:assert/strict";
import { switchOn } from "./yt-experiment-switches.mjs";

function collect() {
  const warnings = [];
  return { warnings, warn: (m) => warnings.push(m) };
}

test("unset / explicit on values keep the experiment on", () => {
  const { warnings, warn } = collect();
  for (const v of [undefined, null, "", " ", "true", "TRUE", "on", "1", "yes", "top1"]) {
    assert.equal(switchOn(v, "X", warn), true, String(v));
  }
  assert.equal(warnings.length, 0);
});

test("off values turn the feature off silently", () => {
  const { warnings, warn } = collect();
  for (const v of ["false", " False ", "off", "0", "no", "standard", "STANDARD"]) {
    assert.equal(switchOn(v, "X", warn), false, v);
  }
  assert.equal(warnings.length, 0);
});

test("typos fall back to the pre-experiment behaviour with a warning", () => {
  const { warnings, warn } = collect();
  assert.equal(switchOn("flase", "YT_OPENING_HOOK", warn), false);
  assert.equal(switchOn("emoji", "YT_TITLE_TEMPLATE", warn), false);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /Unrecognized YT_OPENING_HOOK="flase"/);
});
