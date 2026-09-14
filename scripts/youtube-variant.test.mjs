import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coverPathFor,
  youtubeVideoPathFor,
  isYouTubeVariantFile,
  isSharedVideoFile,
  openingVariantForFile,
  argPath,
  resolveYouTubeUpload,
  renderYouTubeVariant,
  summarizeThumbnail,
  MIN_VARIANT_BUDGET_MS,
} from "./youtube-variant.mjs";

const shared = "output/trending-20260914.mp4";
const youtube = "output/trending-20260914-youtube.mp4";

function existsOnly(...paths) {
  const set = new Set(paths);
  return (p) => set.has(p);
}

test("file naming keeps the Instagram files as they were and suffixes the YouTube render", () => {
  assert.equal(youtubeVideoPathFor(shared), youtube);
  assert.equal(coverPathFor(shared), "output/trending-20260914-cover.jpg");
  assert.equal(coverPathFor(youtube), "output/trending-20260914-youtube-cover.jpg");
  assert.equal(isYouTubeVariantFile(youtube), true);
  assert.equal(isYouTubeVariantFile(shared), false);
});

test("shared-file detection ignores the YouTube render and raw intermediates", () => {
  assert.equal(isSharedVideoFile("/x/output/trending-20260914.mp4"), true);
  assert.equal(isSharedVideoFile("/x/output/trending-20260914-youtube.mp4"), false);
  assert.equal(isSharedVideoFile("/x/output/trending-20260914.raw.mp4"), false);
  assert.equal(isSharedVideoFile("/x/output/trending-20260914-youtube.raw.mp4"), false);
  assert.equal(openingVariantForFile(youtube), "top1");
  assert.equal(openingVariantForFile(shared), "brand");
});

test("argPath resolves relative paths against the base dir and keeps absolute ones", () => {
  const argv = ["node", "post-sns.mjs", `--video=${shared}`, `--youtube-video=/abs/${youtube}`];
  assert.equal(argPath(argv, "video", "/repo"), `/repo/${shared}`);
  assert.equal(argPath(argv, "youtube-video", "/repo"), `/abs/${youtube}`);
  assert.equal(argPath(argv, "thumbnail", "/repo"), null);
  assert.equal(argPath(["--video="], "video", "/repo"), null);
});

test("YouTube uploads its own render with the matching cover as thumbnail", () => {
  const r = resolveYouTubeUpload({
    sharedVideo: shared,
    youtubeVideo: youtube,
    exists: existsOnly(youtube, "output/trending-20260914-youtube-cover.jpg"),
  });
  assert.deepEqual(r, {
    video: youtube,
    openingVariant: "top1",
    thumbnail: "output/trending-20260914-youtube-cover.jpg",
    fellBack: false,
  });
});

test("YouTube render without a cover still uploads, just without a custom thumbnail", () => {
  const r = resolveYouTubeUpload({ sharedVideo: shared, youtubeVideo: youtube, exists: existsOnly(youtube) });
  assert.equal(r.video, youtube);
  assert.equal(r.thumbnail, null);
});

test("missing YouTube render falls back to the shared video and never uses the brand cover", () => {
  const r = resolveYouTubeUpload({
    sharedVideo: shared,
    youtubeVideo: youtube,
    exists: existsOnly(shared, "output/trending-20260914-cover.jpg"),
  });
  assert.deepEqual(r, { video: shared, openingVariant: "brand", thumbnail: null, fellBack: true });

  const notRequested = resolveYouTubeUpload({ sharedVideo: shared, exists: existsOnly(shared) });
  assert.equal(notRequested.video, shared);
  assert.equal(notRequested.fellBack, false);
});

// --- renderYouTubeVariant (pipeline Step 4d) ---------------------------------

function harness({ failOn = null, clock = [0], stepMs = 0, deadline = 10 * 60 * 1000 } = {}) {
  const calls = [];
  const writes = [];
  const errors = [];
  const logs = [];
  // Async like runInProcessGroup (process-group.mjs), which the pipeline passes in.
  const run = async (cmd, opts = {}) => {
    calls.push({ cmd, timeout: opts.timeout });
    clock[0] += stepMs;
    if (failOn && cmd.includes(failOn)) throw new Error(`${failOn} timed out after 300s (process group killed)`);
  };
  const args = {
    inputProps: { projects: [{ name: "colibri" }] },
    sharedVideo: shared,
    outputDir: "/repo/output",
    deadline,
    run,
    writeFile: (path, data) => writes.push({ path, data }),
    now: () => clock[0],
    log: (m) => logs.push(m),
    logError: (m) => errors.push(m),
  };
  return { args, calls, writes, errors, logs };
}

const cmds = (calls) => calls.map((c) => c.cmd.split(" ").slice(0, 3).join(" "));

test("Step 4d success: YouTube props, render, normalize, cover — returns the YouTube file", async () => {
  const h = harness();
  assert.equal(await renderYouTubeVariant(h.args), youtube);
  assert.deepEqual(JSON.parse(h.writes[0].data), { projects: [{ name: "colibri" }], openingVariant: "top1" });
  assert.equal(h.writes[0].path, "/repo/output/input-props-youtube.json");
  assert.deepEqual(cmds(h.calls), [
    "npx remotion render",
    "ffmpeg -y -i",
    "npx remotion still",
    'rm -f "output/trending-20260914-youtube.raw.mp4"',
  ]);
  assert.ok(h.calls[0].cmd.includes('"output/trending-20260914-youtube.raw.mp4"'));
  assert.ok(h.calls[1].cmd.includes("-pix_fmt yuv420p"));
  assert.ok(h.calls[2].cmd.includes('"output/trending-20260914-youtube-cover.jpg" --frame=60'));
  assert.ok(h.calls.slice(0, 3).every((c) => c.timeout > 0), "every heavy step has a timeout");
  assert.equal(h.errors.length, 0);
});

test("Step 4d render failure / timeout: falls back (null) and removes partial YouTube files", async () => {
  const h = harness({ failOn: "remotion render" });
  assert.equal(await renderYouTubeVariant(h.args), null);
  const removed = h.calls.filter((c) => c.cmd.startsWith("rm -f")).map((c) => c.cmd);
  assert.deepEqual(removed, [
    'rm -f "output/trending-20260914-youtube.mp4"',
    'rm -f "output/trending-20260914-youtube.raw.mp4"',
  ]);
  assert.ok(!h.calls.some((c) => c.cmd.includes("remotion still")));
  assert.match(h.errors[0], /falls back to the shared video/);
  assert.match(h.errors[0], /process group killed/);
});

test("Step 4d cover failure keeps the video (no custom thumbnail that day)", async () => {
  const h = harness({ failOn: "remotion still" });
  assert.equal(await renderYouTubeVariant(h.args), youtube);
  assert.ok(h.calls.some((c) => c.cmd === 'rm -f "output/trending-20260914-youtube-cover.jpg"'));
  assert.ok(!h.calls.some((c) => c.cmd === 'rm -f "output/trending-20260914-youtube.mp4"'));
});

test("Step 4d uses the injected remove for cleanup (pipeline deletes files in-process)", async () => {
  const h = harness({ failOn: "ffmpeg" });
  const removed = [];
  h.args.remove = (path) => removed.push(path);
  assert.equal(await renderYouTubeVariant(h.args), null);
  assert.deepEqual(removed, ["output/trending-20260914-youtube.mp4", "output/trending-20260914-youtube.raw.mp4"]);
  assert.ok(!h.calls.some((c) => c.cmd.startsWith("rm -f")));
});

test("Step 4d is skipped entirely when the time budget is already too small", async () => {
  const h = harness({ deadline: MIN_VARIANT_BUDGET_MS - 1 });
  assert.equal(await renderYouTubeVariant(h.args), null);
  assert.equal(h.calls.length, 0);
  assert.equal(h.writes.length, 0);
  assert.match(h.logs[0], /YouTube variant skipped/);
});

test("Step 4d stops before encoding when the render used up the budget", async () => {
  const clock = [0];
  const h = harness({ clock, stepMs: 10 * 60 * 1000 });
  assert.equal(await renderYouTubeVariant(h.args), null);
  assert.ok(!h.calls.some((c) => c.cmd.startsWith("ffmpeg")), "encode never started");
  assert.match(h.errors[0], /time budget exhausted before encode/);
});

test("Step 4d never rejects, even if writing the props file fails", async () => {
  const h = harness();
  h.args.writeFile = () => {
    throw new Error("ENOSPC");
  };
  assert.equal(await renderYouTubeVariant(h.args), null);
  assert.match(h.errors[0], /ENOSPC/);
});

test("summarizeThumbnail flattens the upload result for performance-history", () => {
  assert.equal(summarizeThumbnail(undefined), null);
  assert.equal(summarizeThumbnail({ set: true }), "set");
  assert.equal(summarizeThumbnail({ skipped: "disabled" }), "skipped:disabled");
  assert.equal(summarizeThumbnail({ error: "Forbidden", reasons: "forbidden" }), "error:forbidden");
  assert.equal(summarizeThumbnail({ error: "boom", reasons: "" }), "error");
});
