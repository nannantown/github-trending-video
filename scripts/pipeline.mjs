/**
 * Full pipeline: scrape → generate data → generate audio → render video
 * Usage: node scripts/pipeline.mjs
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const outputDir = join(rootDir, "output");

function run(cmd) {
  console.log(`\n>>> ${cmd}\n`);
  execSync(cmd, { cwd: rootDir, stdio: "inherit" });
}

function main() {
  mkdirSync(outputDir, { recursive: true });

  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

  // Step 1: Scrape GitHub Trending
  console.log("=== Step 1: Scrape GitHub Trending ===");
  run("node scripts/scrape-trending.mjs");

  // Step 2: Generate Japanese data
  console.log("\n=== Step 2: Generate Data ===");
  run("node scripts/generate-data.mjs");

  // Step 3: Generate TTS audio
  console.log("\n=== Step 3: Generate Audio ===");
  run("node scripts/generate-audio.mjs --data=output/trending-data.json");

  // Step 4: Build input props for Remotion
  console.log("\n=== Step 4: Build Input Props ===");
  const trendingData = JSON.parse(
    readFileSync(join(outputDir, "trending-data.json"), "utf-8")
  );
  const audioDurations = JSON.parse(
    readFileSync(join(outputDir, "audio-durations.json"), "utf-8")
  );

  const inputProps = {
    projects: trendingData.projects,
    audioDurations,
  };

  const propsPath = join(outputDir, "input-props.json");
  writeFileSync(propsPath, JSON.stringify(inputProps));
  console.log(`Input props → ${propsPath}`);

  // Step 5: Render video
  const outputFile = `output/trending-${dateStr}.mp4`;
  console.log(`\n=== Step 5: Render Video → ${outputFile} ===`);
  run(`npx remotion render TrendingVideo "${outputFile}" --props="${propsPath}"`);

  console.log(`\n=== Done! ${outputFile} ===`);
}

main();
