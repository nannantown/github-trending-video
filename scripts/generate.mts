/**
 * generate.mts
 * Usage: node --loader ts-node/esm scripts/generate.mts [data.json]
 *
 * data.json format:
 * [
 *   {
 *     "rank": 1,
 *     "name": "openscreen",
 *     "fullName": "siddharthvaddem/openscreen",
 *     "description": "Screen Studioの無料OSS代替",
 *     "stars": 15700,
 *     "todayStars": 2496,
 *     "language": "TypeScript",
 *     "url": "https://github.com/siddharthvaddem/openscreen"
 *   },
 *   ...
 * ]
 *
 * If no data.json is provided, uses the default projects from src/data.ts
 */

import path from "path";
import { fileURLToPath } from "url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { defaultProjects, type Project } from "../src/data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

async function main() {
  // Load data - from CLI arg or defaults
  let projects: Project[] = defaultProjects;

  const dataArg = process.argv[2];
  if (dataArg) {
    const { readFileSync } = await import("fs");
    const raw = readFileSync(path.resolve(dataArg), "utf-8");
    projects = JSON.parse(raw);
    console.log(`Loaded ${projects.length} projects from ${dataArg}`);
  } else {
    console.log("Using default project data...");
  }

  // Output path with date stamp
  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const outputPath = path.join(rootDir, "output", `trending-${dateStr}.mp4`);

  console.log("Bundling...");
  const bundleLocation = await bundle({
    entryPoint: path.join(rootDir, "src", "index.ts"),
    webpackOverride: (config) => config,
  });

  console.log("Selecting composition...");
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "TrendingVideo",
    inputProps: { projects },
  });

  console.log(`Rendering ${composition.durationInFrames} frames...`);
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outputPath,
    inputProps: { projects },
    onProgress: ({ progress }) => {
      process.stdout.write(`\rRendering: ${Math.round(progress * 100)}%`);
    },
  });

  console.log(`\nDone! Output: ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
