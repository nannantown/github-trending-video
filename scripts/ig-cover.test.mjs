import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractCoverFrame, igCoverPathFor, instagramCoverForYouTube, instagramThumbOffset } from "./ig-cover.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const noFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 ? false : "ffmpeg is not installed";

/** Red for 7 s, then blue for 2 s — the frame at 7000 ms (Instagram's default) is blue. */
function twoColourVideo(path) {
  execFileSync("ffmpeg", ["-y", "-v", "error",
    "-f", "lavfi", "-i", "color=c=red:s=108x192:r=30:d=7",
    "-f", "lavfi", "-i", "color=c=blue:s=108x192:r=30:d=2",
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0", "-c:v", "libx264", "-pix_fmt", "yuv420p", path]);
}

function colourOf(image) {
  const [r, g, b] = execFileSync("ffmpeg", ["-v", "error", "-i", image, "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  if (r > 200 && g < 60 && b < 60) return "red";
  if (b > 200 && r < 60 && g < 60) return "blue";
  return `rgb(${r},${g},${b})`;
}

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "ig-cover-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("Instagram's thumb_offset is unchanged (7000 ms unless INSTAGRAM_THUMB_OFFSET_MS)", () => {
  assert.equal(instagramThumbOffset({}), "7000");
  assert.equal(instagramThumbOffset({ INSTAGRAM_THUMB_OFFSET_MS: "2500" }), "2500");
  const ig = readFileSync(join(here, "upload-instagram.mjs"), "utf8");
  assert.match(ig, /const thumbOffset = instagramThumbOffset\(env\);/, "one rule for both platforms");
});

test("the YouTube thumbnail is the frame Instagram takes from the shared video", { skip: noFfmpeg }, (t) => {
  const dir = tempDir(t);
  const video = join(dir, "trending-20300102.mp4");
  twoColourVideo(video);
  const path = instagramCoverForYouTube({ video, env: {} });
  assert.equal(path, igCoverPathFor(video));
  assert.equal(path, join(dir, "trending-20300102-ig-cover.jpg"));
  assert.equal(colourOf(path), "blue");
  // an override moves both: the cover Instagram gets and the YouTube thumbnail
  instagramCoverForYouTube({ video, env: { INSTAGRAM_THUMB_OFFSET_MS: "3000" } });
  assert.equal(colourOf(path), "red");
});

test("no frame → null (YouTube keeps its own frame), stale frame removed, never throws", { skip: noFfmpeg }, (t) => {
  const dir = tempDir(t);
  const video = join(dir, "trending-20300102.mp4");
  twoColourVideo(video);
  writeFileSync(igCoverPathFor(video), "yesterday's frame");
  const errors = [];
  assert.equal(instagramCoverForYouTube({ video, env: { INSTAGRAM_THUMB_OFFSET_MS: "60000" }, logError: (m) => errors.push(m) }), null);
  assert.equal(existsSync(igCoverPathFor(video)), false);
  assert.match(errors[0], /YouTube keeps its own frame/);
  assert.equal(instagramCoverForYouTube({ video: join(dir, "missing.mp4"), env: {}, logError: () => {} }), null);
  assert.throws(() => extractCoverFrame({ video, offsetMs: -1, out: join(dir, "x.jpg") }), /invalid cover offset/);
});
