import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toJstDate,
  missingScopes,
  parseInsights,
  matchReelsToVideos,
  needsRefresh,
  updateInstagramStats,
  GraphError,
  resolveBudgetMs,
  orderForRefresh,
} from "./instagram-insights.mjs";

test("toJstDate converts IG +0000 timestamps to the JST calendar date", () => {
  assert.equal(toJstDate("2026-06-12T23:30:00+0000"), "2026-06-13");
  assert.equal(toJstDate("2026-06-13T14:59:59+0000"), "2026-06-13");
  assert.equal(toJstDate("2026-06-13T15:00:00+0000"), "2026-06-14");
});

test("missingScopes lists required scopes that are not granted", () => {
  const payload = {
    data: [
      { permission: "instagram_basic", status: "granted" },
      { permission: "instagram_manage_insights", status: "declined" },
      { permission: "pages_read_engagement", status: "granted" },
    ],
  };
  assert.deepEqual(missingScopes(payload), ["instagram_manage_insights"]);
});

test("parseInsights flattens lifetime values and skips empty metrics", () => {
  const payload = {
    data: [
      { name: "views", period: "lifetime", values: [{ value: 120 }] },
      { name: "reach", values: [{ value: 80 }] },
      { name: "shares", total_value: { value: 3 } },
      { name: "saved", values: [] },
    ],
  };
  assert.deepEqual(parseInsights(payload), { views: 120, reach: 80, shares: 3 });
});

test("matchReelsToVideos prefers stored mediaId, then matches by JST date", () => {
  const videos = [
    { date: "2026-06-13", instagram: { mediaId: "stored" } },
    { date: "2026-06-14" },
    { date: "2026-06-15" },
    { date: "2026-06-16" },
  ];
  const reels = [
    { id: "stored", timestamp: "2026-06-12T23:31:00+0000" },
    { id: "a", timestamp: "2026-06-13T23:31:00+0000" },
    { id: "b1", timestamp: "2026-06-15T23:31:00+0000" },
    { id: "b2", timestamp: "2026-06-16T03:00:00+0000" },
  ];
  const { assignments, unmatched } = matchReelsToVideos(videos, reels);
  assert.equal(assignments.get(videos[0]).id, "stored");
  assert.equal(assignments.get(videos[1]).id, "a");
  assert.equal(assignments.has(videos[2]), false);
  assert.equal(assignments.has(videos[3]), false);
  assert.equal(unmatched.length, 2);
  assert.match(unmatched.find((u) => u.date === "2026-06-15").reason, /no REELS/);
  assert.match(unmatched.find((u) => u.date === "2026-06-16").reason, /ambiguous: 2/);
});

test("needsRefresh: recent entries and never-fetched entries only", () => {
  assert.equal(needsRefresh({ date: "2026-09-01", instagram: { updatedAt: "x" } }, "2026-08-28"), true);
  assert.equal(needsRefresh({ date: "2026-07-01", instagram: { updatedAt: "x" } }, "2026-08-28"), false);
  assert.equal(needsRefresh({ date: "2026-07-01", instagram: { updatedAt: null } }, "2026-08-28"), true);
});

test("GraphError classifies permission errors", () => {
  assert.equal(new GraphError({ message: "x", code: 10 }).isPermissionError, true);
  assert.equal(new GraphError({ message: "x", code: 200 }).isPermissionError, true);
  assert.equal(new GraphError({ message: "x", code: 100 }).isPermissionError, false);
});

const ENV = {
  INSTAGRAM_ACCESS_TOKEN: "user-token",
  INSTAGRAM_USER_ID: "ig1",
  FACEBOOK_PAGE_ID: "page1",
};

function fakeFetch(routes, calls = []) {
  return async (url) => {
    calls.push(url);
    const key = url.pathname.replace("/v22.0", "");
    const handler = routes[key];
    const body = typeof handler === "function" ? handler(url) : handler;
    return { json: async () => body ?? { error: { message: `no route ${key}`, code: 100 } } };
  };
}

const PERMS_OK = {
  data: ["instagram_basic", "instagram_manage_insights", "pages_read_engagement"].map(
    (permission) => ({ permission, status: "granted" })
  ),
};

test("updateInstagramStats fills instagram metrics and nulls unmatched entries", async () => {
  const history = {
    videos: [
      { date: "2026-09-09", stats: { views: 5 } },
      { date: "2026-09-10", stats: { views: 7 } },
    ],
  };
  const calls = [];
  const fetchImpl = fakeFetch(
    {
      "/me/permissions": PERMS_OK,
      "/page1": { access_token: "page-token" },
      "/ig1/media": {
        data: [
          { id: "m10", media_product_type: "REELS", timestamp: "2026-09-09T23:30:00+0000", permalink: "p10" },
          { id: "f1", media_product_type: "FEED", timestamp: "2026-09-08T23:30:00+0000" },
        ],
      },
      "/m10/insights": {
        data: ["views", "reach", "likes", "comments", "shares", "saved"].map((name, i) => ({
          name,
          values: [{ value: (i + 1) * 10 }],
        })),
      },
    },
    calls
  );
  const logs = [];
  const now = new Date("2026-09-11T00:00:00Z");
  const result = await updateInstagramStats(history, ENV, { fetchImpl, now, log: (m) => logs.push(m) });

  assert.equal(history.videos[0].instagram, null);
  assert.deepEqual(history.videos[1].instagram, {
    mediaId: "m10",
    permalink: "p10",
    views: 10,
    reach: 20,
    likes: 30,
    comments: 40,
    shares: 50,
    saved: 60,
    updatedAt: now.toISOString(),
  });
  assert.deepEqual(history.videos[1].stats, { views: 7 }, "YouTube stats untouched");
  assert.equal(result.updated, 1);
  assert.equal(result.permissionDenied, false);
  assert.ok(logs.some((l) => l.includes("2026-09-09 unmatched")));
  const insightsCall = calls.find((u) => u.pathname.endsWith("/m10/insights"));
  assert.equal(insightsCall.searchParams.get("metric"), "views,reach,likes,comments,shares,saved");
  assert.ok(!insightsCall.searchParams.get("metric").includes("plays"));
  assert.ok(!logs.join("\n").includes("user-token") && !logs.join("\n").includes("page-token"));
});

test("updateInstagramStats reports permissionDenied when every insights call is refused", async () => {
  const history = { videos: [{ date: "2026-09-10" }] };
  const fetchImpl = fakeFetch({
    "/me/permissions": { data: [{ permission: "instagram_basic", status: "granted" }] },
    "/page1": { access_token: "page-token" },
    "/ig1/media": {
      data: [{ id: "m10", media_product_type: "REELS", timestamp: "2026-09-09T23:30:00+0000" }],
    },
    "/m10/insights": { error: { message: "(#10) Application does not have permission", code: 10 } },
  });
  const result = await updateInstagramStats(history, ENV, {
    fetchImpl,
    now: new Date("2026-09-11T00:00:00Z"),
    log: () => {},
  });
  assert.equal(result.permissionDenied, true);
  assert.deepEqual(result.missingScopes, ["instagram_manage_insights", "pages_read_engagement"]);
  assert.equal(history.videos[0].instagram.mediaId, "m10");
  assert.equal(history.videos[0].instagram.views, null);
});

test("updateInstagramStats falls back to the user token when the page token is refused", async () => {
  const history = { videos: [{ date: "2026-09-10" }] };
  const fetchImpl = fakeFetch({
    "/me/permissions": PERMS_OK,
    "/page1": { access_token: "page-token" },
    "/ig1/media": {
      data: [{ id: "m10", media_product_type: "REELS", timestamp: "2026-09-09T23:30:00+0000" }],
    },
    "/m10/insights": (url) =>
      url.searchParams.get("access_token") === "page-token"
        ? { error: { message: "denied", code: 10 } }
        : { data: [{ name: "views", values: [{ value: 42 }] }] },
  });
  await updateInstagramStats(history, ENV, {
    fetchImpl,
    now: new Date("2026-09-11T00:00:00Z"),
    log: () => {},
  });
  assert.equal(history.videos[0].instagram.views, 42);
  assert.equal(history.videos[0].instagram.reach, null);
});

test("listReels follows paging until the window is covered", async () => {
  const history = { videos: [{ date: "2026-09-01" }, { date: "2026-09-10" }] };
  const calls = [];
  const fetchImpl = fakeFetch(
    {
      "/me/permissions": PERMS_OK,
      "/page1": { access_token: "page-token" },
      "/ig1/media": (url) =>
        url.searchParams.get("after") === "c1"
          ? {
              data: [{ id: "old", media_product_type: "REELS", timestamp: "2026-08-31T23:30:00+0000" }],
            }
          : {
              data: [{ id: "new", media_product_type: "REELS", timestamp: "2026-09-09T23:30:00+0000" }],
              paging: { next: "https://graph.facebook.com/v22.0/ig1/media?after=c1" },
            },
      "/new/insights": { data: [{ name: "views", values: [{ value: 1 }] }] },
      "/old/insights": { data: [{ name: "views", values: [{ value: 2 }] }] },
    },
    calls
  );
  await updateInstagramStats(history, ENV, {
    fetchImpl,
    now: new Date("2026-09-11T00:00:00Z"),
    log: () => {},
  });
  assert.equal(history.videos[0].instagram.mediaId, "old");
  assert.equal(history.videos[1].instagram.mediaId, "new");
});

test("matchReelsToVideos re-matches by date when the stored mediaId was deleted", () => {
  const videos = [
    { date: "2026-09-10", instagram: { mediaId: "deleted" } },
    { date: "2026-09-09", instagram: { mediaId: "gone" } },
  ];
  const reels = [{ id: "retry", timestamp: "2026-09-10T02:00:00+0000" }];
  const { assignments, unmatched } = matchReelsToVideos(videos, reels);
  assert.equal(assignments.get(videos[0]).id, "retry");
  assert.equal(assignments.has(videos[1]), false);
  assert.match(unmatched[0].reason, /stored mediaId gone no longer listed/);
});

test("updateInstagramStats stops calling insights after repeated permission refusals", async () => {
  const dates = ["2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09"];
  const history = { videos: dates.map((date) => ({ date })) };
  const routes = {
    "/me/permissions": PERMS_OK,
    "/page1": { access_token: "page-token" },
    "/ig1/media": {
      data: dates.map((d, i) => ({
        id: `m${i}`,
        media_product_type: "REELS",
        timestamp: `${d}T01:00:00+0000`,
      })),
    },
  };
  let insightsCalls = 0;
  for (let i = 0; i < dates.length; i++) {
    routes[`/m${i}/insights`] = () => {
      insightsCalls++;
      return { error: { message: "(#10) denied", code: 10 } };
    };
  }
  const result = await updateInstagramStats(history, ENV, {
    fetchImpl: fakeFetch(routes),
    now: new Date("2026-09-11T00:00:00Z"),
    log: () => {},
  });
  assert.equal(insightsCalls, 3 * 2, "3 videos x (page token + user token)");
  assert.equal(result.skipped, 2);
  assert.equal(result.permissionDenied, true);
  assert.ok(history.videos.every((v) => v.instagram?.mediaId), "mediaIds still restored");
});

function slowRoutes(count, insightsHandler) {
  const dates = Array.from({ length: count }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
  const routes = {
    "/me/permissions": PERMS_OK,
    "/page1": { access_token: "page-token" },
    "/ig1/media": {
      data: dates.map((d, i) => ({
        id: `m${i}`,
        media_product_type: "REELS",
        timestamp: `${d}T01:00:00+0000`,
      })),
    },
  };
  for (let i = 0; i < count; i++) routes[`/m${i}/insights`] = insightsHandler;
  return { history: { videos: dates.map((date) => ({ date })) }, routes };
}

test("updateInstagramStats stops at the overall time budget and keeps previous values", async () => {
  const clock = { t: 0 };
  const { history, routes } = slowRoutes(8, () => ({ data: [{ name: "views", values: [{ value: 5 }] }] }));
  // Newest-first: the oldest entry (09-01) is among the skipped ones.
  history.videos[0].instagram = { mediaId: "m0", views: 99, updatedAt: null };
  const base = fakeFetch(routes);
  const fetchImpl = async (url, init) => {
    clock.t += 30_000; // every Graph call takes 30s
    return base(url, init);
  };
  const logs = [];
  const result = await updateInstagramStats(history, ENV, {
    fetchImpl,
    clock: () => clock.t,
    budgetMs: 180_000,
    now: new Date("2026-09-11T00:00:00Z"),
    log: (m) => logs.push(m),
  });
  // 3 setup calls (90s) + 3 insights calls (90s) = budget
  assert.equal(result.updated, 3);
  assert.equal(result.stopReason, "budget");
  assert.equal(result.skipped, 5);
  assert.ok(clock.t <= 180_000, "never starts a request past the deadline");
  assert.equal(history.videos[0].instagram.views, 99, "skipped entry keeps previous value");
  assert.equal(history.videos[7].instagram.views, 5, "newest entry fetched first");
  assert.ok(logs.some((l) => l.includes("stopped early (time budget")));
});

test("resolveBudgetMs honours IG_INSIGHTS_BUDGET_MS and defaults to 90s", () => {
  assert.equal(resolveBudgetMs({}), 90_000);
  assert.equal(resolveBudgetMs({ IG_INSIGHTS_BUDGET_MS: "30000" }), 30_000);
  assert.equal(resolveBudgetMs({ IG_INSIGHTS_BUDGET_MS: "abc" }), 90_000);
});

test("updateInstagramStats stops after 3 consecutive timeouts/network errors", async () => {
  let calls = 0;
  const { history, routes } = slowRoutes(6, () => {
    calls++;
    throw new TypeError("fetch failed");
  });
  const result = await updateInstagramStats(history, ENV, {
    fetchImpl: fakeFetch(routes),
    now: new Date("2026-09-11T00:00:00Z"),
    log: () => {},
  });
  assert.equal(calls, 3, "network errors are not retried with the user token");
  assert.equal(result.stopReason, "transient");
  assert.equal(result.skipped, 3);
  assert.equal(result.permissionDenied, false);
});

test("a success resets the consecutive-failure streak", async () => {
  let n = 0;
  const { history, routes } = slowRoutes(6, () => {
    n++;
    if (n % 3 === 0) return { data: [{ name: "views", values: [{ value: 1 }] }] };
    throw new TypeError("fetch failed");
  });
  const result = await updateInstagramStats(history, ENV, {
    fetchImpl: fakeFetch(routes),
    now: new Date("2026-09-11T00:00:00Z"),
    log: () => {},
  });
  assert.equal(result.stopReason, null);
  assert.equal(result.updated, 2);
});

test("code 10 / subcode 2108006 (media predates business account) is not a permission error", () => {
  assert.equal(
    new GraphError({ message: "x", code: 10, error_subcode: 2108006 }).isPermissionError,
    false
  );
});

test("orderForRefresh: recent window first (newest first), then backfill", () => {
  const items = ["2026-06-13", "2026-09-10", "2026-07-01", "2026-09-01", "2026-08-30"].map((date) => ({
    video: { date },
  }));
  const order = orderForRefresh(items, "2026-08-28").map((i) => i.video.date);
  assert.deepEqual(order, ["2026-09-10", "2026-09-01", "2026-08-30", "2026-07-01", "2026-06-13"]);
});

test("when the budget runs out, recent entries are fetched before the backfill", async () => {
  const clock = { t: 0 };
  // History order is oldest first, like performance-history.json.
  const dates = ["2026-06-13", "2026-06-14", "2026-06-15", "2026-09-09", "2026-09-10"];
  const routes = {
    "/me/permissions": PERMS_OK,
    "/page1": { access_token: "page-token" },
    "/ig1/media": {
      data: dates
        .map((d, i) => ({ id: `m${i}`, media_product_type: "REELS", timestamp: `${d}T01:00:00+0000` }))
        .reverse(),
    },
  };
  const fetched = [];
  dates.forEach((d, i) => {
    routes[`/m${i}/insights`] = () => {
      fetched.push(d);
      return { data: [{ name: "views", values: [{ value: 7 }] }] };
    };
  });
  const base = fakeFetch(routes);
  const history = { videos: dates.map((date) => ({ date })) };
  const result = await updateInstagramStats(history, ENV, {
    fetchImpl: async (url, init) => {
      clock.t += 10_000;
      return base(url, init);
    },
    clock: () => clock.t,
    budgetMs: 50_000, // 3 setup calls + 2 insights calls
    now: new Date("2026-09-11T00:00:00Z"),
    log: () => {},
  });
  assert.deepEqual(fetched, ["2026-09-10", "2026-09-09"]);
  assert.equal(result.stopReason, "budget");
  assert.equal(history.videos[4].instagram.views, 7);
  assert.equal(history.videos[0].instagram.views, null);
  assert.equal(history.videos[0].instagram.mediaId, "m0", "backfill entries still get their mediaId");
});
