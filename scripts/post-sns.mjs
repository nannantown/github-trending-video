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

async function createGitHubRelease(videoPath) {
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
  const fileName = basename(videoPath);

  console.log(`\nCreating GitHub Release: ${tag}`);

  try {
    // Create release and upload asset
    run(
      `gh release create "${tag}" "${videoPath}" --title "${title}" --notes "Auto-generated trending video for ${dateStr}" --latest`,
      { env: { ...process.env, GH_TOKEN: token } }
    );

    // Get the download URL for the asset
    const releaseJson = run(
      `gh release view "${tag}" --json assets --jq '.assets[] | select(.name=="${fileName}") | .url'`,
      { env: { ...process.env, GH_TOKEN: token } }
    );

    const assetUrl = releaseJson.trim();
    if (assetUrl) {
      console.log(`  Release asset URL: ${assetUrl}`);
      return assetUrl;
    }

    // Fallback: construct URL manually
    const fallbackUrl = `https://github.com/${repo}/releases/download/${tag}/${fileName}`;
    console.log(`  Release URL (constructed): ${fallbackUrl}`);
    return fallbackUrl;
  } catch (err) {
    console.error(`GitHub Release failed: ${err.message}`);
    // If tag already exists, try to get existing release URL
    try {
      const existingUrl = run(
        `gh release view "${tag}" --json assets --jq '.assets[0].url'`,
        { env: { ...process.env, GH_TOKEN: token } }
      ).trim();
      if (existingUrl) return existingUrl;
    } catch {
      // ignore
    }
    return null;
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

async function uploadInstagram(videoUrl) {
  const { INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID } = process.env;

  if (!INSTAGRAM_ACCESS_TOKEN || !INSTAGRAM_USER_ID) {
    console.log("\nInstagram: credentials not configured, skipping.");
    return null;
  }

  if (!videoUrl) {
    console.log("\nInstagram: no public video URL available, skipping.");
    console.log("  (Instagram requires a public URL - set up GitHub Release or provide VIDEO_PUBLIC_URL)");
    return null;
  }

  console.log("\n=== Instagram Reels Upload ===");
  try {
    run(`node scripts/upload-instagram.mjs --url="${videoUrl}"`, {
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
  const videoPublicUrl = await createGitHubRelease(videoPath);
  if (videoPublicUrl) {
    process.env.VIDEO_PUBLIC_URL = videoPublicUrl;
  }

  // Step 3: Upload to platforms (YouTube can run independently)
  const results = {
    youtube: await uploadYouTube(videoPath),
    instagram: await uploadInstagram(videoPublicUrl),
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
