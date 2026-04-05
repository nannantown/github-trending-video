/**
 * Fetch YouTube video stats and generate optimization hints.
 *
 * Step 0 of the pipeline (runs before scraping).
 * - Reads data/performance-history.json
 * - Fetches stats for recent videos via YouTube Data API
 * - Updates stats in history
 * - Runs optimization rules
 * - Writes output/optimization-hints.json
 *
 * Non-blocking: failures here don't affect the pipeline.
 *
 * Required env vars (same as upload):
 *   YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN
 */

import { google } from "googleapis";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const outputDir = join(rootDir, "output");
const historyPath = join(rootDir, "data", "performance-history.json");

const MIN_VIDEOS_FOR_HASHTAG_OPT = 7;
const MIN_VIDEOS_FOR_TITLE_OPT = 10;
const HASHTAG_BOOST_THRESHOLD = 1.3;
const HASHTAG_DROP_THRESHOLD = 0.8;

// --- Stats Fetching ---

async function fetchVideoStats(youtube, videoIds) {
  if (videoIds.length === 0) return {};

  // YouTube API accepts up to 50 IDs per request
  const res = await youtube.videos.list({
    part: ["statistics"],
    id: videoIds.join(","),
  });

  const statsMap = {};
  for (const item of res.data.items || []) {
    statsMap[item.id] = {
      views: parseInt(item.statistics.viewCount || "0", 10),
      likes: parseInt(item.statistics.likeCount || "0", 10),
      comments: parseInt(item.statistics.commentCount || "0", 10),
      updatedAt: new Date().toISOString(),
    };
  }
  return statsMap;
}

// --- Optimization Rules ---

function analyzeHashtags(videos) {
  if (videos.length < MIN_VIDEOS_FOR_HASHTAG_OPT) return null;

  const avgViews =
    videos.reduce((sum, v) => sum + (v.stats?.views || 0), 0) / videos.length;

  if (avgViews === 0) return null;

  // Count hashtag occurrences and their total views
  const hashtagStats = {};
  for (const video of videos) {
    const views = video.stats?.views || 0;
    for (const tag of video.hashtags || []) {
      if (!hashtagStats[tag]) {
        hashtagStats[tag] = { count: 0, totalViews: 0 };
      }
      hashtagStats[tag].count++;
      hashtagStats[tag].totalViews += views;
    }
  }

  const boosted = [];
  const dropped = [];
  const reasoning = [];

  for (const [tag, stat] of Object.entries(hashtagStats)) {
    if (stat.count < 3) continue; // Need at least 3 appearances
    const tagAvg = stat.totalViews / stat.count;
    const ratio = tagAvg / avgViews;

    if (ratio >= HASHTAG_BOOST_THRESHOLD) {
      boosted.push(tag);
      reasoning.push(`${tag}: ${ratio.toFixed(1)}x avg views → boost`);
    } else if (ratio <= HASHTAG_DROP_THRESHOLD) {
      dropped.push(tag);
      reasoning.push(`${tag}: ${ratio.toFixed(1)}x avg views → drop`);
    }
  }

  return { boosted, dropped, reasoning };
}

function analyzeTitleTemplates(videos) {
  if (videos.length < MIN_VIDEOS_FOR_TITLE_OPT) return null;

  const templateStats = {};
  for (const video of videos) {
    const template = video.titleTemplate || "standard";
    if (!templateStats[template]) {
      templateStats[template] = { count: 0, totalViews: 0 };
    }
    templateStats[template].count++;
    templateStats[template].totalViews += video.stats?.views || 0;
  }

  let best = "standard";
  let bestAvg = 0;
  const reasoning = [];

  for (const [template, stat] of Object.entries(templateStats)) {
    const avg = stat.totalViews / stat.count;
    reasoning.push(
      `${template}: ${avg.toFixed(0)} avg views (${stat.count} videos)`
    );
    if (avg > bestAvg) {
      bestAvg = avg;
      best = template;
    }
  }

  return { recommended: best, reasoning };
}

function analyzeLanguages(videos) {
  if (videos.length < MIN_VIDEOS_FOR_HASHTAG_OPT) return null;

  const avgViews =
    videos.reduce((sum, v) => sum + (v.stats?.views || 0), 0) / videos.length;

  if (avgViews === 0) return null;

  const langStats = {};
  for (const video of videos) {
    const views = video.stats?.views || 0;
    for (const lang of video.languages || []) {
      if (!langStats[lang]) {
        langStats[lang] = { count: 0, totalViews: 0 };
      }
      langStats[lang].count++;
      langStats[lang].totalViews += views;
    }
  }

  const trending = [];
  for (const [lang, stat] of Object.entries(langStats)) {
    if (stat.count < 2) continue;
    const ratio = stat.totalViews / stat.count / avgViews;
    if (ratio >= HASHTAG_BOOST_THRESHOLD) {
      trending.push({ language: lang, ratio });
    }
  }

  return trending;
}

function generateDayOfWeekInsights(videos) {
  const dayStats = {};
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  for (const video of videos) {
    const day = dayNames[new Date(video.date).getDay()];
    if (!dayStats[day]) {
      dayStats[day] = { count: 0, totalViews: 0 };
    }
    dayStats[day].count++;
    dayStats[day].totalViews += video.stats?.views || 0;
  }

  return Object.entries(dayStats)
    .map(([day, stat]) => ({
      day,
      avgViews: Math.round(stat.totalViews / stat.count),
      count: stat.count,
    }))
    .sort((a, b) => b.avgViews - a.avgViews);
}

// --- Main ---

async function main() {
  console.log("fetch-stats: starting...");

  // Load history
  if (!existsSync(historyPath)) {
    console.log("fetch-stats: no history file, skipping.");
    return;
  }

  const history = JSON.parse(readFileSync(historyPath, "utf-8"));
  if (!history.videos || history.videos.length === 0) {
    console.log("fetch-stats: no videos in history, skipping.");
    return;
  }

  // Fetch stats from YouTube API
  const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN } =
    process.env;

  if (YOUTUBE_CLIENT_ID && YOUTUBE_CLIENT_SECRET && YOUTUBE_REFRESH_TOKEN) {
    console.log("fetch-stats: fetching YouTube stats...");

    const oauth2 = new google.auth.OAuth2(
      YOUTUBE_CLIENT_ID,
      YOUTUBE_CLIENT_SECRET,
      "urn:ietf:wg:oauth:2.0:oob"
    );
    oauth2.setCredentials({ refresh_token: YOUTUBE_REFRESH_TOKEN });

    const youtube = google.youtube({ version: "v3", auth: oauth2 });

    // Get stats for last 14 days of videos
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const recentVideos = history.videos.filter((v) => v.date >= cutoffStr);
    const videoIds = recentVideos.map((v) => v.videoId).filter(Boolean);

    if (videoIds.length > 0) {
      try {
        const statsMap = await fetchVideoStats(youtube, videoIds);

        // Update stats in history
        let updated = 0;
        for (const video of history.videos) {
          if (statsMap[video.videoId]) {
            video.stats = statsMap[video.videoId];
            updated++;
          }
        }
        console.log(`  Updated stats for ${updated} videos`);
      } catch (err) {
        console.error(`  Failed to fetch stats: ${err.message}`);
        // Continue with existing stats
      }
    }
  } else {
    console.log("fetch-stats: YouTube credentials not set, using existing stats.");
  }

  // Save updated history
  writeFileSync(historyPath, JSON.stringify(history, null, 2));

  // Run optimization analysis
  console.log("fetch-stats: analyzing performance...");

  const hints = {
    generatedAt: new Date().toISOString(),
    videoCount: history.videos.length,
    recommendedHashtags: null,
    droppedHashtags: [],
    recommendedTitleTemplate: "standard",
    reasoning: [],
  };

  // Hashtag analysis
  const hashtagResult = analyzeHashtags(history.videos);
  if (hashtagResult) {
    hints.droppedHashtags = hashtagResult.dropped;
    hints.reasoning.push(...hashtagResult.reasoning);

    // Build recommended hashtags: base set + boosted - dropped
    const baseHashtags = [
      "GitHubTrending", "GitHub", "プログラミング", "エンジニア",
      "Tech", "開発", "OSS", "オープンソース", "Shorts",
    ];
    const recommended = baseHashtags.filter(
      (h) => !hashtagResult.dropped.includes(h)
    );
    for (const h of hashtagResult.boosted) {
      if (!recommended.includes(h)) recommended.push(h);
    }
    hints.recommendedHashtags = recommended;
  }

  // Title template analysis
  const titleResult = analyzeTitleTemplates(history.videos);
  if (titleResult) {
    hints.recommendedTitleTemplate = titleResult.recommended;
    hints.reasoning.push(...titleResult.reasoning);
  }

  // Language analysis
  const langResult = analyzeLanguages(history.videos);
  if (langResult && langResult.length > 0) {
    hints.reasoning.push(
      `Trending languages: ${langResult.map((l) => `${l.language} (${l.ratio.toFixed(1)}x)`).join(", ")}`
    );
  }

  // Day of week insights
  const dayInsights = generateDayOfWeekInsights(history.videos);
  if (dayInsights.length > 0) {
    hints.reasoning.push(
      `Day performance: ${dayInsights.map((d) => `${d.day}=${d.avgViews}`).join(", ")}`
    );
  }

  // Write hints
  writeFileSync(join(outputDir, "optimization-hints.json"), JSON.stringify(hints, null, 2));
  console.log(`fetch-stats: hints generated (${hints.reasoning.length} insights)`);

  for (const r of hints.reasoning) {
    console.log(`  - ${r}`);
  }

  // Log optimization if any changes applied
  if (hints.reasoning.length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    history.optimizationLog.push({
      date: today,
      changes: hints.reasoning,
      recommendedTemplate: hints.recommendedTitleTemplate,
    });

    // Keep last 30 log entries
    if (history.optimizationLog.length > 30) {
      history.optimizationLog = history.optimizationLog.slice(-30);
    }

    writeFileSync(historyPath, JSON.stringify(history, null, 2));
  }
}

main().catch((err) => {
  console.error(`fetch-stats error: ${err.message}`);
  // Non-blocking: don't exit with error code
});
