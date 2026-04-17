# Shared Patterns — SNS 自動投稿の共通ハマりポイント

両プロジェクト（github-trending-video, coffee-daily-video）で同じ構成を取っているため、片方で遭遇した問題はもう片方でも発生しうる。今日までに解決したパターンを集約する。

---

## Instagram 関連

### `(#10) Application does not have permission for this action`

**症状**: `POST /{IG_USER_ID}/media` または `/media_publish` が `(#10)` で弾かれる。

**原因**: IG Business Account が Business Portfolio 所有の Facebook Page に紐付いている場合、プレーンな User Access Token では公開操作が拒否される。

**対処**: User token から **Page Access Token を派生**させて `/media` と `/media_publish` を叩く。

```javascript
const { access_token: pageToken } = await graphGet(`/${FACEBOOK_PAGE_ID}`, {
  fields: "access_token",
  access_token: userToken,
});
// 以降すべて pageToken を使用
```

発見の副次指標: `/me/accounts` が空配列で返ると本パターンの可能性大（Business Portfolio 所有 Page はここに現れないため）。

### `(#2207076) Media upload has failed` / 動画処理 ERROR

**症状**: `/media?video_url=...` で container 作成は成功するが、processing 段階で `2207076` エラー。動画フォーマットを何度変えても直らない。

**原因**: Meta の URL fetcher が公開 URL からのダウンロードに頻繁に失敗する。GitHub Release の 302 リダイレクトは特に落ちる。Google CDN の mp4 ですらエラーになる事例あり。

**対処**: URL 指定を捨てて **resumable upload** に切り替える。

```
1. POST /{IG_USER_ID}/media?media_type=REELS&upload_type=resumable → { id, uri }
2. POST {uri} (binary body, headers: Authorization: OAuth ..., offset: 0, file_size: N)
3. GET /{container_id}?fields=status_code で FINISHED を待つ
4. POST /{IG_USER_ID}/media_publish { creation_id }
```

実装は両プロジェクトの `scripts/upload-instagram.mjs` に共通して配備済み。`--file=<path>` を渡せば resumable、`--url=<url>` だと URL 経路（下位互換）。

### IG Token 60 日失効

**症状**: `Session has expired` または認証系エラー。

**原因**: Long-lived User Token は 60 日で失効する。

**対処**: `refresh-instagram-token.yml` が週次で `fb_exchange_token` により延長。手動起動もできる:

```bash
gh workflow run refresh-instagram-token.yml
```

失効後に完全再発行する必要が出たら、Graph API Explorer で Social Media Manager アプリから `instagram_basic` を含む 5 スコープでトークン生成 → secret にセット → refresh workflow で長期化。

### IG Token 再発行時、`instagram_basic` 欠落

**症状**: `(#10)` エラー（上記と違って Page token 使っても出る）。

**原因**: Graph API Explorer のスコープ追加画面で `instagram_basic` を入れ忘れると、`/{page_id}/instagram_business_account` が空返り → 全投稿系 API が不能。

**対処**: 必須スコープは以下 5 つすべて:
- `instagram_basic`
- `instagram_content_publish`
- `instagram_manage_comments`
- `pages_show_list`
- `pages_read_engagement`

### リポジトリが private だと URL 経路は絶対失敗

**症状**: `(#2207076)` で落ちるが、resumable に切り替えても匿名 URL fetch 依存処理は動かない。

**原因**: GitHub Release asset の匿名アクセスは public リポだけで可能。

**対処**: 両プロジェクトとも **public リポ運用**。sns-setup.md にも記載。なお resumable upload なら private リポでも動作（GitHub Actions から local file を直接送るため）。

---

## YouTube 関連

### `unauthorized_client` (Refresh Token 失効)

**原因**: OAuth 同意画面が Testing のままだと Refresh Token が 7 日で失効。

**対処**: Google Cloud Console の OAuth 同意画面を **Production に公開**（アプリ確認未でも個人利用なら OK）。

**再発行手順**:

```bash
export YOUTUBE_CLIENT_ID=...
export YOUTUBE_CLIENT_SECRET=...
node scripts/auth-youtube.mjs    # loopback redirect フロー（OOB は非推奨）
cat output/youtube-refresh-token.txt | gh secret set YOUTUBE_REFRESH_TOKEN
```

### OAuth Client ID/Secret と Refresh Token の不一致

**症状**: Client を新しく作り直したあと、古い Refresh Token を使い続けて `unauthorized_client`。

**対処**: **Client を変えたら Refresh Token も同じ Client で取り直す**。Google Cloud Console の認証情報ページに複数 Client が並んでいると混乱しがち。

---

## GitHub Actions 関連

### `gh secret set` が 403 (`Resource not accessible by integration`)

**原因**: デフォルトの `GITHUB_TOKEN` には Secrets: Read/Write 権限が無い。

**対処**: Fine-grained PAT を作成して `GH_PAT` secret に保存、workflow 内で `GH_TOKEN: ${{ secrets.GH_PAT }}` として使う。

PAT 設定:
- Repository access: 該当リポジトリのみ
- Permissions → Secrets: Read and write
- Expiration: 1 年（毎年再発行）

### 両プロジェクトの workflow_dispatch はデフォルトブランチ必須

GitHub UI 上で workflow を選んで実行できるのは main に file が入っている場合のみ。開発中のブランチで実行したい場合は:

```bash
gh workflow run <file.yml> --ref <branch>
```

ただし、初回登録のために一度は main へマージが必要。

---

## 動画エンコーディング

### Remotion デフォルトの `yuvj420p` を Instagram は拒否

**対処**: `remotion.config.ts` に以下を記述:

```typescript
Config.setPixelFormat("yuv420p");
```

これで追加の ffmpeg 再エンコードなしで Reels 互換の動画が出る。

### Reels 要件サマリ（合格ライン）

- コンテナ: MP4
- 映像: H.264（Baseline〜High どれでも実運用で通った）、yuv420p、1080x1920、30fps
- 音声: AAC LC、44.1kHz or 48kHz、stereo、128kbps 以上
- 尺: 3秒〜15分
- moov atom: 先頭（`-movflags +faststart` 相当）

重要な落とし穴: `yuvj420p`（JPEG フルレンジ）は NG。`yuv420p`（TV レンジ）必須。

---

## 運用チェックリスト

新しい日に「自動投稿が失敗した」と気づいたとき:

1. `gh run list --workflow=daily-video.yml --limit=5 -R <repo>` でどこで落ちたか
2. 失敗ステップをクリック → 最初のエラーメッセージをこのドキュメントの症状表と照合
3. 該当パターンの対処を実行
4. 再度 `gh workflow run daily-video.yml -R <repo>` で再実行
5. **パターンに載っていない新種エラー**なら、解決後に本ドキュメントへ追記

---

## Open Questions（今後の改善候補）

- `post-sns.mjs` は認証失敗時も summary に "skipped" と表示し workflow 自体は成功扱いになる → 本当に失敗したときの検知性が弱い。失敗数に応じた exit code にすべき
- 共通コードの二重管理（`upload-instagram.mjs` 等）を解消するなら private npm package 化（「Option C」）を検討
- IG Graph API の `expires_in: null` レスポンス挙動は未解明。現状は値の有無にかかわらず新 token を secret に書いており動作している
