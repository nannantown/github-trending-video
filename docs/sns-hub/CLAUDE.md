# sns-hub — SNS 動画自動投稿プロジェクト群

このフォルダは、日次の縦型ショート動画を自動生成して YouTube Shorts / Instagram Reels に投稿するプロジェクトを束ねる親ディレクトリです。個々のプロジェクトは独立した GitHub リポジトリとして運用されており、本フォルダは**共通知見の集約**と**複数プロジェクトを 1 セッションで横断操作する作業台**の役割を持ちます。

## 収容プロジェクト

| ディレクトリ | GitHub | IG アカウント | YouTube チャンネル | テーマ |
|---|---|---|---|---|
| [github-trending-video/](github-trending-video/) | `nannantown/github-trending-video` | [@ai_trend_daily_](https://www.instagram.com/ai_trend_daily_/) | — | 毎朝の GitHub Trending TOP5 解説 |
| [coffee-daily-video/](coffee-daily-video/) | `nannantown/coffee-daily-video` | [@open_ground_coffee_roasters](https://www.instagram.com/open_ground_coffee_roasters/) | `@MindBrewLab` | コーヒー豆知識ショート |

両プロジェクトは **Meta App "Social Media Manager" を共有**し、同一ユーザー (opengroundcoffee@gmail.com) の Facebook アカウントで管理されている。IG Business Account / FB Page は別物。

## アーキテクチャ共通原則

```
Claude Routine (~30min前)        GitHub Actions (cron)
─────────────────────          ─────────────────────
トピック調査 & 原稿生成   →    動画生成 → YouTube + Instagram 投稿
(data/*.json commit)           (pipeline.mjs)
```

毎朝の流れ（JST）:

1. **~07:30** Claude Routine が起動し、当日のネタをリサーチ。日本語原稿 (description / detail / narration) を JSON ファイルとしてコミット
2. **08:00〜08:30** GitHub Actions が cron で起動、コミット済み JSON を読んで動画を合成 → SNS 投稿

ルーチンと Actions の分業は「**言葉のクリエイティブは Claude、映像化と配信は Actions**」。

## 重要な ID・Secrets（値は GitHub Secrets に格納、ここは名前の辞書）

### github-trending-video

| Secret 名 | 意味 |
|---|---|
| `SNS_POST_ENABLED` | `true` で SNS 投稿有効化 |
| `YOUTUBE_CLIENT_ID` / `_SECRET` / `_REFRESH_TOKEN` | YouTube Data API v3 OAuth |
| `INSTAGRAM_ACCESS_TOKEN` | FB User Long-lived Token（60日、週次自動延長） |
| `INSTAGRAM_USER_ID` | `17841443808798329` (ai_trend_daily_) |
| `FACEBOOK_PAGE_ID` | `987049344502207` (AI Trend Daily) |
| `FACEBOOK_APP_ID` / `_SECRET` | Meta App "Social Media Manager" |
| `GH_PAT` | Fine-grained PAT, Secrets: RW（週次の token 延長用） |

### coffee-daily-video

| Secret 名 | 値/意味 |
|---|---|
| `INSTAGRAM_USER_ID` | `17841464767833513` (open_ground_coffee_roasters) |
| `FACEBOOK_PAGE_ID` | `1149844638201593` (Open Ground Coffee) |
| `FACEBOOK_APP_ID` | `1567718357640275` (Social Media Manager 共通) |
| その他 | 構成は trending 側と同形式 |

## 今後の運用カレンダー

| 頻度 | 何が走る | 対応 |
|---|---|---|
| 毎朝 07:30 JST | 両プロジェクトの Claude Routine | （自動） |
| 毎朝 08:00〜08:30 JST | daily-video.yml 両方 | （自動） |
| 毎週日曜 09:00 JST | refresh-instagram-token.yml 両方 | （自動） |
| 60日ごと | ↑の累積で IG token 延長 | （自動） |
| 1年後 (2027-04-17 頃) | `GH_PAT` 期限切れ | **手動再発行** |
| Google 同意画面の状態確認 | Testing→Production 本番公開維持 | （必要なら手動） |

## 困ったときの最初の一歩

**「今日の動画が投稿されていない」** と感じたら:

```bash
# どこで止まったか確認
gh run list --workflow=daily-video.yml --limit=5 --repo nannantown/github-trending-video
gh run list --workflow=daily-video.yml --limit=5 --repo nannantown/coffee-daily-video
```

よくある失敗と原処方:

| 症状 | 原因 | 対処 |
|---|---|---|
| YouTube `unauthorized_client` | Refresh Token 失効 | `node scripts/auth-youtube.mjs` で再認証 |
| IG `(#10) Application does not have permission` | Page Access Token 派生失敗 | `FACEBOOK_PAGE_ID` secret 確認 |
| IG `(#2207076) Media upload has failed` | resumable 経路から URL 経路に退行 | `--file=` 渡しになっているか確認 |
| IG `Session has expired` | 60日トークン失効 | `gh workflow run refresh-instagram-token.yml` 手動起動 |
| `refresh-instagram-token.yml` が 403 | `GH_PAT` が期限切れ | PAT を再発行して `gh secret set GH_PAT` |

詳細パターン集は [shared-patterns.md](shared-patterns.md) 参照。

## このフォルダでの作業原則

- **機密値を直接貼らない** — GitHub Secrets 経由が原則
- **片方で直した共通問題は反対側にもポートする** — 両プロジェクトで `upload-instagram.mjs` 等が二重管理されている（Option A 構成のトレードオフ）
- **変更は必ず main に PR 経由** — `daily-video.yml` がスケジュール実行される都合、main の状態が本番
- **作業前に必ず `git pull origin main`** — 両リポに GitHub Actions が [skip ci] コミットを daily で push する

## 3 つ目のプロジェクトを足したくなったら

最初の段階では既存のどちらかをテンプレに `cp -r` で複製し、scripts と data を差し替えるのが最速。
もし 3 つ以上に増えて共通コードの二重管理が辛くなってきたら、`upload-instagram.mjs` 等を別 npm private package に切り出す（Option C への昇格）のを検討。
