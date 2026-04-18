/**
 * SNS posting orchestrator.
 * 1. Generate captions
 * 2. Create a GitHub Release with the video (for Instagram's public URL requirement)
 * 3. Upload to YouTube Shorts
 * 4. Upload to Instagram Reels
 *
 * Usage: node scripts/post-sns.mjs [--video=path/to/video.mp4]
 *
 * Environment variables (all optional - missing credentials = skip that platform):
 *   YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN
 *   INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID
 *   GITHUB_TOKEN (automatically available in GitHub Actions)
 *   GITHUB_REPOSITORY (automatically available in GitHub Actions)
 */

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const outputDir = join(rootDir, "output");

function run(cmd, opts = {}) {
  console.log(`>>> ${cmd}`);
  return execSync(cmd, { cwd: rootDir, encoding: "utf-8", ...opts });
}

function getVideoPath() {
  const arg = process.argv.find((a) => a.startsWith("--video="));
  if (arg) {
    const p = join(rootDir, arg.split("=")[1]);
    if (existsSync(p)) return p;
  }

  // Auto-detect: find latest trending-YYYYMMDD.mp4
  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const p = join(outputDir, `trending-${dateStr}.mp4`);
  if (existsSync(p)) return p;

  // Fallback: find any trending-*.mp4
  const files = execSync(`ls -t ${outputDir}/trending-*.mp4 2>/dev/null || true`, {
    encoding: "utf-8",
  }).trim();
  if (files) return files.split("\n")[0];

  return null;
}

async function createGitHubRelease(videoPath, coverPath) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;

  if (!token || !repo) {
    console.log("GitHub Release: GITHUB_TOKEN or GITHUB_REPOSITORY not set, skipping.");
    return null;
  }

  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const tag = `v${dateStr}`;
  const title = `GitHub Trending ${dateStr}`;
  const videoFileName = basename(videoPath);
  const coverFileName = coverPath ? basename(coverPath) : null;
  const coverArg = coverPath && existsSync(coverPath) ? ` "${coverPath}"` : "";

  console.log(`\nCreating GitHub Release: ${tag}`);

  const videoUrl = `https://github.com/${repo}/releases/download/${tag}/${videoFileName}`;
  const coverUrl = coverFileName
    ? `https://github.com/${repo}/releases/download/${tag}/${coverFileName}`
    : null;

  try {
    // Create release and upload both video + cover image
    run(
      `gh release create "${tag}" "${videoPath}"${coverArg} --title "${title}" --notes "Auto-generated trending video for ${dateStr}" --latest`,
      { env: { ...process.env, GH_TOKEN: token } }
    );
    console.log(`  Video URL:  ${videoUrl}`);
    if (coverUrl) console.log(`  Cover URL:  ${coverUrl}`);
    return { videoUrl, coverUrl };
  } catch (err) {
    console.error(`GitHub Release failed: ${err.message}`);
    // Tag already exists — upload assets onto existing release (clobber).
    try {
      run(
        `gh release upload "${tag}" "${videoPath}"${coverArg} --clobber`,
        { env: { ...process.env, GH_TOKEN: token } }
      );
      console.log(`  Video URL:  ${videoUrl}`);
      if (coverUrl) console.log(`  Cover URL:  ${coverUrl}`);
      return { videoUrl, coverUrl };
    } catch (uploadErr) {
      console.error(`Upload to existing release failed: ${uploadErr.message}`);
      return null;
    }
  }
}

async function uploadYouTube(videoPath) {
  const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN } =
    process.env;

  if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET || !YOUTUBE_REFRESH_TOKEN) {
    console.log("\nYouTube: credentials not configured, skipping.");
    return null;
  }

  console.log("\n=== YouTube Shorts Upload ===");
  try {
    run(`node scripts/upload-youtube.mjs --video="${videoPath}"`, {
      stdio: "inherit",
    });
    return true;
  } catch (err) {
    console.error(`YouTube upload failed: ${err.message}`);
    return null;
  }
}

async function uploadInstagram(videoPath, coverUrl) {
  const { INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID, FACEBOOK_PAGE_ID } =
    process.env;

  if (!INSTAGRAM_ACCESS_TOKEN || !INSTAGRAM_USER_ID || !FACEBOOK_PAGE_ID) {
    console.log("\nInstagram: credentials not configured, skipping.");
    console.log("  (Requires INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID, FACEBOOK_PAGE_ID)");
    return null;
  }

  if (!videoPath) {
    console.log("\nInstagram: no video file provided, skipping.");
    return null;
  }

  console.log("\n=== Instagram Reels Upload ===");
  try {
    // Resumable upload (binary POST) — avoids the unreliable URL fetcher
    // that returns (#2207076) on GitHub Release assets.
    const coverArg = coverUrl ? ` --cover="${coverUrl}"` : "";
    run(`node scripts/upload-instagram.mjs --file="${videoPath}"${coverArg}`, {
      stdio: "inherit",
    });
    return true;
  } catch (err) {
    console.error(`Instagram upload failed: ${err.message}`);
    return null;
  }
}

async function main() {
  const videoPath = getVideoPath();
  if (!videoPath) {
    console.error("No video file found. Run pipeline.mjs first.");
    process.exit(1);
  }
  console.log(`Video: ${videoPath}`);

  // Step 1: Generate captions
  console.log("\n=== Generating Captions ===");
  run("node scripts/generate-caption.mjs", { stdio: "inherit" });

  // Step 2: Create GitHub Release (provides public URL for Instagram)
  //         Also uploads the cover image so IG can fetch it as cover_url.
  const coverPath = videoPath.replace(/\.mp4$/, "-cover.jpg");
  const hasCover = existsSync(coverPath);
  const urls = await createGitHubRelease(videoPath, hasCover ? coverPath : null);
  if (urls?.videoUrl) {
    process.env.VIDEO_PUBLIC_URL = urls.videoUrl;
  }

  // Step 3: Upload to platforms. Instagram takes the local file and uses
  // resumable upload directly; the GitHub Release above is kept as an
  // archival copy and a fallback source for manual re-posting.
  const results = {
    youtube: await uploadYouTube(videoPath),
    instagram: await uploadInstagram(videoPath, urls?.coverUrl),
  };

  // Summary
  console.log("\n=== SNS Posting Summary ===");
  console.log(`  YouTube:   ${results.youtube ? "OK" : "skipped"}`);
  console.log(`  Instagram: ${results.instagram ? "OK" : "skipped"}`);

  const anySuccess = Object.values(results).some(Boolean);
  if (!anySuccess) {
    console.log("\n  No platforms were configured. See docs/sns-setup.md for setup instructions.");
  }
}

main().catch((err) => {
  console.error("SNS posting failed:", err);
  process.exit(1);
});
