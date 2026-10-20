#!/usr/bin/env node
/**
 * account-stats.mjs — read-only numbers for the sns-hub SNS tab.
 *
 * Prints one JSON object to stdout (the workflow saves it as the artifact
 * `account-stats`): follower counts and the views of the latest posts, for the
 * YouTube channel and the Instagram account this repo posts to. It never posts
 * and never writes to the repo, so it cannot disturb daily-video.yml.
 *
 * Same file in all four repos (github-trending / coffee / figma / kawagutsu);
 * the collector lives in sns-hub `dashboard/collect.mjs` and dispatches the
 * workflow. No npm dependencies (Node 20+ fetch) so the job skips `npm ci`.
 *
 * 【一次資料】YouTube Data API channels.list / playlistItems.list / videos.list
 *   (developers.google.com/youtube/v3/docs, channels.list updated 2026-10-15):
 *   statistics.subscriberCount, contentDetails.relatedPlaylists.uploads.
 *   Instagram Graph API: IG User `followers_count` (as figma
 *   scripts/instagram-insights.mjs), IG Media insights metric `views` (REELS,
 *   reference shows v26.0; this repo family pins v22.0).
 *
 * Env (same secrets as daily-video.yml): YOUTUBE_CLIENT_ID / _SECRET /
 * _REFRESH_TOKEN, INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID, FACEBOOK_PAGE_ID.
 * A platform whose call fails is reported as { error } — the other still lands.
 */

const GRAPH = "https://graph.facebook.com/v22.0";
const YT = "https://www.googleapis.com/youtube/v3";
const LIMIT = 40; // newest posts per platform — the tab shows about a month
const TIMEOUT_MS = 20_000;

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data.error?.message || data.error_description || data.error || res.statusText;
    throw new Error(`${res.status} ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
  }
  return data;
}

const qs = (params) => new URLSearchParams(params).toString();

export async function youtubeStats(env) {
  const token = await getJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: qs({
      client_id: env.YOUTUBE_CLIENT_ID,
      client_secret: env.YOUTUBE_CLIENT_SECRET,
      refresh_token: env.YOUTUBE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const auth = { headers: { Authorization: `Bearer ${token.access_token}` } };
  const ch = await getJson(`${YT}/channels?${qs({ part: "statistics,contentDetails,snippet", mine: "true" })}`, auth);
  const c = ch.items?.[0];
  if (!c) throw new Error("no channel for this token");
  const uploads = c.contentDetails?.relatedPlaylists?.uploads;
  const list = uploads
    ? await getJson(`${YT}/playlistItems?${qs({ part: "contentDetails", playlistId: uploads, maxResults: String(LIMIT) })}`, auth)
    : { items: [] };
  const ids = list.items.map((i) => i.contentDetails.videoId).filter(Boolean);
  const vids = ids.length ? await getJson(`${YT}/videos?${qs({ part: "statistics,snippet", id: ids.join(",") })}`, auth) : { items: [] };
  return {
    channel: c.snippet?.customUrl || c.id,
    subscribers: c.statistics?.hiddenSubscriberCount ? null : Number(c.statistics?.subscriberCount ?? NaN),
    videos: vids.items.map((v) => ({
      id: v.id,
      title: v.snippet?.title ?? "",
      publishedAt: v.snippet?.publishedAt ?? null,
      views: Number(v.statistics?.viewCount ?? 0),
    })),
  };
}

export async function instagramStats(env) {
  const user = env.INSTAGRAM_ACCESS_TOKEN;
  // The Page token is what publishing uses; insights accept either (figma instagram-insights.mjs).
  const page = await getJson(`${GRAPH}/${env.FACEBOOK_PAGE_ID}?${qs({ fields: "access_token", access_token: user })}`);
  const token = page.access_token || user;
  const me = await getJson(`${GRAPH}/${env.INSTAGRAM_USER_ID}?${qs({ fields: "username,followers_count", access_token: token })}`);
  const media = await getJson(
    `${GRAPH}/${env.INSTAGRAM_USER_ID}/media?${qs({ fields: "id,timestamp,permalink,media_product_type", limit: String(LIMIT), access_token: token })}`,
  );
  const out = [];
  for (const m of media.data ?? []) {
    let views = null;
    try {
      const ins = await getJson(`${GRAPH}/${m.id}/insights?${qs({ metric: "views", access_token: token })}`);
      const v = ins.data?.find((d) => d.name === "views")?.values?.[0]?.value;
      if (Number.isFinite(v)) views = v;
    } catch {
      // one post without insights (too new, a non-Reel) must not drop the rest
    }
    out.push({ id: m.id, timestamp: m.timestamp, permalink: m.permalink, views });
  }
  return { username: me.username ?? null, followers: Number.isInteger(me.followers_count) ? me.followers_count : null, media: out };
}

async function settle(fn, env) {
  try {
    return await fn(env);
  } catch (err) {
    return { error: String(err.message || err).slice(0, 300) };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env;
  const result = {
    collectedAt: new Date().toISOString(),
    youtube: await settle(youtubeStats, env),
    instagram: await settle(instagramStats, env),
  };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.youtube.error && result.instagram.error) process.exit(1);
}
