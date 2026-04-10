/**
 * Scrape GitHub Trending page for top 5 repositories.
 * Output: output/raw-trending.json
 */

import { load } from "cheerio";
import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "..", "output");

async function fetchTrending() {
  const url = "https://github.com/trending";
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html",
    "Accept-Language": "en-US,en;q=0.9",
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      console.error(`Attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt === 0) await new Promise((r) => setTimeout(r, 5000));
      else throw err;
    }
  }
}

function parseTrending(html) {
  const $ = load(html);
  const repos = [];

  $("article.Box-row")
    .slice(0, 5)
    .each((i, el) => {
      const $el = $(el);

      // Repo name: "owner / repo"
      const nameLink = $el.find("h2 a");
      const fullName = nameLink
        .text()
        .replace(/\s+/g, "")
        .replace(/\n/g, "");
      const [owner, name] = fullName.split("/");

      // Description
      const description = $el.find("p").first().text().trim() || "";

      // Language
      const language =
        $el.find('[itemprop="programmingLanguage"]').text().trim() || undefined;

      // Total stars
      const starsText = $el
        .find('a[href$="/stargazers"]')
        .first()
        .text()
        .trim();
      const stars = parseInt(starsText.replace(/,/g, ""), 10) || 0;

      // Today's stars
      const todayText = $el
        .find("span.d-inline-block.float-sm-right")
        .text()
        .trim();
      const todayMatch = todayText.match(/([\d,]+)\s*stars?\s*today/i);
      const todayStars = todayMatch
        ? parseInt(todayMatch[1].replace(/,/g, ""), 10)
        : 0;

      repos.push({
        rank: i + 1,
        name,
        fullName: `${owner}/${name}`,
        description,
        stars,
        todayStars,
        language,
        url: `https://github.com/${owner}/${name}`,
      });
    });

  return repos;
}

async function fetchReadmeExcerpt(fullName) {
  try {
    // Try to fetch README via GitHub API (no auth needed for public repos)
    const res = await fetch(
      `https://api.github.com/repos/${fullName}/readme`,
      {
        headers: {
          Accept: "application/vnd.github.v3.raw",
          "User-Agent": "github-trending-video-bot",
        },
      }
    );
    if (!res.ok) return "";

    const text = await res.text();

    // Extract first meaningful content (skip badges, images, title)
    const lines = text.split("\n");
    const contentLines = [];
    let foundContent = false;

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip empty lines, badges, images, HTML tags, headers with just the repo name
      if (!trimmed) {
        if (foundContent) contentLines.push("");
        continue;
      }
      if (trimmed.startsWith("![") || trimmed.startsWith("[![")) continue;
      if (trimmed.startsWith("<") && !trimmed.startsWith("<br")) continue;
      if (trimmed.startsWith("---") || trimmed.startsWith("===")) continue;
      if (trimmed.match(/^\[!\[/)) continue; // badge links

      // Strip markdown formatting
      const clean = trimmed
        .replace(/^#+\s*/, "")
        .replace(/\*\*/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .trim();

      if (clean.length < 10) continue; // too short

      foundContent = true;
      contentLines.push(clean);

      // Get first 500 chars of meaningful content
      if (contentLines.join(" ").length > 500) break;
    }

    return contentLines.join(" ").slice(0, 500).trim();
  } catch {
    return "";
  }
}

async function main() {
  mkdirSync(outputDir, { recursive: true });

  console.log("Fetching github.com/trending...");
  const html = await fetchTrending();

  const repos = parseTrending(html);

  if (repos.length < 5) {
    console.error(`Only found ${repos.length} repos (expected 5)`);
    if (repos.length === 0) process.exit(1);
  }

  // Fetch README excerpts for richer descriptions
  console.log("\nFetching README excerpts...");
  for (const repo of repos) {
    process.stdout.write(`  #${repo.rank} ${repo.fullName}: `);
    const readme = await fetchReadmeExcerpt(repo.fullName);
    repo.readmeExcerpt = readme;
    console.log(readme ? `${readme.length} chars` : "no README");
    await new Promise((r) => setTimeout(r, 200)); // Rate limit
  }

  const outputPath = join(outputDir, "raw-trending.json");
  writeFileSync(outputPath, JSON.stringify(repos, null, 2));

  console.log(`\nSaved ${repos.length} repos to ${outputPath}`);
  repos.forEach((r) =>
    console.log(`  #${r.rank} ${r.fullName} - ${r.stars} stars (+${r.todayStars} today)`)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
