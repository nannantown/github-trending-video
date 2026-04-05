# SNS 自動投稿 セットアップガイド

GitHub Actions で動画生成後に YouTube Shorts / Instagram Reels へ自動投稿するための完全ガイド。

> 所要時間: YouTube 約20分、Instagram 約30分

---

## 目次

- [Part 1: 全体像](#part-1-全体像)
- [Part 2: YouTube Shorts セットアップ](#part-2-youtube-shorts-セットアップ)
- [Part 3: Instagram Reels セットアップ](#part-3-instagram-reels-セットアップ)
- [Part 4: GitHub Secrets の登録](#part-4-github-secrets-の登録)
- [Part 5: 動作確認](#part-5-動作確認)
- [Part 6: Instagram トークン自動更新](#part-6-instagram-トークン自動更新)
- [Part 7: トラブルシューティング](#part-7-トラブルシューティング)

---

## Part 1: 全体像

### 仕組み

```
毎朝 8:00 JST（GitHub Actions cron）
  │
  ├── Step 1-5: 動画生成（既存パイプライン）
  │     scrape → translate → TTS → BGM → render
  │
  └── Step 6: SNS投稿（SNS_POST_ENABLED=true のとき）
        │
        ├── キャプション自動生成
        │     YouTube用: タイトル + 説明 + タグ + カテゴリ
        │     Instagram用: キャプション + ハッシュタグ
        │
        ├── GitHub Release 作成
        │     → 動画ファイルの公開URLを取得（Instagram用）
        │
        ├── YouTube Shorts アップロード
        │     → YouTube Data API v3（ファイル直接アップロード）
        │
        └── Instagram Reels アップロード
              → Facebook Graph API（公開URL経由）
```

### 必要なアカウント

| プラットフォーム | 必要なもの |
|----------------|-----------|
| YouTube | Google アカウント + YouTube チャンネル |
| Instagram | Instagram ビジネス/クリエイターアカウント + Facebook ページ |
| GitHub | リポジトリの Settings > Secrets（既にある） |

### 片方だけでもOK

YouTube だけ、Instagram だけでも動作します。
認証情報が未設定のプラットフォームは自動でスキップされます。

---

## Part 2: YouTube Shorts セットアップ

### Step 2-1: Google Cloud プロジェクト作成

1. ブラウザで開く: **https://console.cloud.google.com/**

2. Google アカウントでログイン（YouTube チャンネルを持っているアカウント）

3. 画面上部のプロジェクト選択ドロップダウンをクリック

4. 右上の「新しいプロジェクト」をクリック

5. 以下を入力:
   - **プロジェクト名**: `github-trending-video`
   - **場所**: 「組織なし」のままでOK

6. 「作成」をクリック → 数秒で作成完了

7. 通知ベルに「プロジェクト "github-trending-video" を作成しました」が出たら、「プロジェクトを選択」をクリック

### Step 2-2: YouTube Data API v3 を有効化

1. 左のハンバーガーメニュー（☰）→「API とサービス」→「ライブラリ」

2. 検索ボックスに `YouTube Data API v3` と入力

3. 「YouTube Data API v3」をクリック

4. 青い「有効にする」ボタンをクリック

5. 有効化されるまで数秒待つ → 「API が有効です」と表示されればOK

### Step 2-3: OAuth 同意画面の設定

1. 左メニュー「API とサービス」→「OAuth 同意画面」

2. 「アプリ情報」ページ:
   - **アプリ名**: `GitHub Trending Video`
   - **ユーザーサポートメール**: 自分のメールアドレスを選択
   - **アプリのロゴ**: 空白でOK（省略可）

3. 下にスクロールして「デベロッパーの連絡先情報」:
   - **メールアドレス**: 自分のメールアドレスを入力

4. 「保存して次へ」をクリック

5. 「スコープ」ページ:
   - 「スコープを追加または削除」をクリック
   - フィルタに `youtube.upload` と入力
   - `https://www.googleapis.com/auth/youtube.upload` にチェック
   - 「更新」をクリック
   - 「保存して次へ」をクリック

6. 「テストユーザー」ページ:
   - 「+ ADD USERS」をクリック
   - 自分の Google メールアドレスを入力
   - 「追加」→「保存して次へ」

7. 「概要」ページで内容を確認 →「ダッシュボードに戻る」

### Step 2-4: OAuth クライアント ID を作成

1. 左メニュー「API とサービス」→「認証情報」

2. 上部の「+ 認証情報を作成」→「OAuth クライアント ID」

3. 以下を入力:
   - **アプリケーションの種類**: `デスクトップ アプリ` を選択
   - **名前**: `GitHub Trending Video CLI`

4. 「作成」をクリック

5. ダイアログに表示される値を**コピーして安全な場所に保存**:
   - **クライアント ID**: `xxxxxx.apps.googleusercontent.com` の形式
   - **クライアント シークレット**: `GOCSPX-xxxxxx` の形式

6. 「OK」で閉じる

> ここで保存しなくても、後から「認証情報」ページで確認できます

### Step 2-5: リフレッシュトークンを取得

ローカルのターミナルでプロジェクトフォルダに移動して実行:

```bash
cd /Users/kokinaniwa/projects/github-trending-video

# Step 2-4 でメモした値を設定
export YOUTUBE_CLIENT_ID="ここにクライアントIDを貼り付け"
export YOUTUBE_CLIENT_SECRET="ここにクライアントシークレットを貼り付け"

# 認証ヘルパーを実行
node scripts/auth-youtube.mjs
```

以下のような出力が表示されます:

```
=== YouTube OAuth 2.0 Authorization ===

1. Open this URL in your browser:

   https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&scope=...

2. Sign in with your Google account and authorize the app.
3. Copy the authorization code and paste it below.

Authorization code:
```

操作手順:
1. 表示されたURLをブラウザで開く
2. Google アカウントでログイン
3. 「このアプリは確認されていません」と表示されたら:
   - 「詳細」をクリック
   - 「GitHub Trending Video（安全ではないページ）に移動」をクリック
4. 「GitHub Trending Video が Google アカウントへのアクセスをリクエストしています」
   - 「許可」をクリック
5. 画面に **認証コード** が表示される（`4/0Axxxxxx...` のような文字列）
6. コードをコピー → ターミナルに貼り付けて Enter

成功すると:

```
=== Success! ===

Refresh Token: 1//0eXxXxXxXx...

Saved to: /Users/kokinaniwa/projects/github-trending-video/output/youtube-refresh-token.txt
```

**この Refresh Token を安全な場所にコピー**しておきます。

### YouTube セットアップ完了

取得した3つの値:
- `YOUTUBE_CLIENT_ID` = `xxxxxx.apps.googleusercontent.com`
- `YOUTUBE_CLIENT_SECRET` = `GOCSPX-xxxxxx`
- `YOUTUBE_REFRESH_TOKEN` = `1//0eXxXxXx...`

→ [Part 4](#part-4-github-secrets-の登録) で GitHub Secrets に登録します。

---

## Part 3: Instagram Reels セットアップ

### 前提条件チェック

Instagram Reels の API 投稿には以下の3つが必要です。
まだの場合は先に済ませてください。

#### (A) Instagram アカウントをビジネス/クリエイターに切り替え

1. Instagram アプリを開く
2. プロフィール → 右上の ☰ → 「設定とプライバシー」
3. 「アカウントの種類とツール」→「プロアカウントに切り替える」
4. カテゴリを選択（「テクノロジー」「ブロガー」等）
5. 「クリエイター」または「ビジネス」を選択 → 完了

#### (B) Facebook ページを作成して Instagram と連携

1. ブラウザで **https://www.facebook.com/pages/create** を開く
2. ページ名: `GitHub Trending Daily` (任意)
3. カテゴリ: `テクノロジー・IT` → 「作成」
4. Instagram との連携:
   - Facebook ページの「設定」→「リンク済みアカウント」
   - 「Instagram」→「アカウントをリンク」
   - Instagram にログイン → 連携完了

### Step 3-1: Facebook 開発者アカウント登録

1. ブラウザで開く: **https://developers.facebook.com/**

2. 右上の「ログイン」→ Facebook アカウントでログイン

3. 初回は「開始」ボタンが表示される → クリック

4. メールアドレス確認・携帯電話確認を求められたら完了させる

### Step 3-2: Facebook アプリ作成

1. **https://developers.facebook.com/apps/** にアクセス

2. 「アプリを作成」をクリック

3. ユースケースを選択:
   - 「その他」を選択 → 「次へ」

4. アプリタイプ:
   - 「ビジネス」を選択 → 「次へ」

5. アプリの詳細:
   - **アプリ表示名**: `GitHub Trending Video`
   - **アプリの連絡先メールアドレス**: 自分のメール
   - **ビジネスアカウント**: なしでOK（省略可）

6. 「アプリを作成」をクリック

7. パスワードを求められたら入力 → アプリダッシュボードが開く

8. **App ID** と **App Secret** をメモ:
   - ダッシュボードの「基本設定」（左メニュー「設定」→「基本」）
   - **アプリID**: 数字の羅列（例: `1234567890123456`）
   - **app secret**: 「表示」をクリックしてコピー

### Step 3-3: Instagram Graph API を追加

1. アプリダッシュボードの左メニュー「アプリにプロダクトを追加」

2. 「Instagram Graph API」を探して「設定」をクリック
   - 見つからない場合: ページ上部の検索で「Instagram」と入力

3. 追加されると左メニューに「Instagram」が表示される

### Step 3-4: Instagram ビジネスアカウント ID を取得

1. ブラウザで開く: **https://developers.facebook.com/tools/explorer/**

2. 右上のドロップダウンで:
   - **アプリ**: `GitHub Trending Video`（Step 3-2 で作成したアプリ）

3. 「ユーザーまたはページのアクセストークン」横の「Generate Access Token」をクリック

4. 「権限を追加」で以下にチェック:
   - `pages_show_list`
   - `pages_read_engagement`
   - `instagram_basic`
   - `instagram_content_publish`

5. 「Generate Access Token」をクリック → Facebook ログイン → 全て許可

6. **まず Facebook ページ ID を取得**:
   - 上部のテキストボックスに以下を入力:
   ```
   /me/accounts
   ```
   - 「送信」をクリック
   - レスポンスの `data` 配列から、連携した Facebook ページを探す
   - その `id` をメモ（例: `"id": "123456789012345"`）

7. **次に Instagram ビジネスアカウント ID を取得**:
   - テキストボックスを書き換え:
   ```
   /123456789012345?fields=instagram_business_account
   ```
   （`123456789012345` は手順6でメモしたページID）
   - 「送信」をクリック
   - レスポンス例:
   ```json
   {
     "instagram_business_account": {
       "id": "17841400000000000"
     },
     "id": "123456789012345"
   }
   ```
   - `instagram_business_account.id` をメモ → これが **INSTAGRAM_USER_ID**

### Step 3-5: 長期アクセストークンを取得

Graph API Explorer で取得したトークンは短期（有効期限1時間）です。
これを長期トークン（約60日）に交換します。

#### ターミナルで実行:

```bash
# 以下の3つの値を書き換えて実行
APP_ID="Step 3-2 でメモした App ID"
APP_SECRET="Step 3-2 でメモした App Secret"
SHORT_TOKEN="Graph API Explorer に表示されているアクセストークン"

curl -s "https://graph.facebook.com/v22.0/oauth/access_token?\
grant_type=fb_exchange_token&\
client_id=${APP_ID}&\
client_secret=${APP_SECRET}&\
fb_exchange_token=${SHORT_TOKEN}"
```

#### レスポンス例:

```json
{
  "access_token": "EAAxxxxxx...（長い文字列）",
  "token_type": "bearer",
  "expires_in": 5184000
}
```

- `access_token` の値をコピー → これが **INSTAGRAM_ACCESS_TOKEN**
- `expires_in: 5184000` = 60日（期限切れ前に更新が必要）

> jq がインストール済みなら `| jq .` を末尾に追加すると見やすくなります

### Step 3-6: トークンの動作確認（任意）

取得したトークンが正しいか確認:

```bash
curl -s "https://graph.facebook.com/v22.0/me?access_token=ここに長期トークンを貼り付け"
```

自分の Facebook の `name` と `id` が返ってくればOK。

### Instagram セットアップ完了

取得した値:
- `INSTAGRAM_USER_ID` = `17841400000000000`（Step 3-4 で取得）
- `INSTAGRAM_ACCESS_TOKEN` = `EAAxxxxxx...`（Step 3-5 で取得）
- `FACEBOOK_APP_ID` = `1234567890123456`（Step 3-2、トークン自動更新に使用）
- `FACEBOOK_APP_SECRET` = `xxxxxx`（Step 3-2、トークン自動更新に使用）

---

## Part 4: GitHub Secrets の登録

ターミナルでリポジトリフォルダに移動して以下を実行。
`gh secret set` を実行すると値の入力プロンプトが表示されるので、貼り付けて Enter → Ctrl+D で確定。

```bash
cd /Users/kokinaniwa/projects/github-trending-video
```

### 4-1: SNS投稿を有効化

```bash
echo "true" | gh secret set SNS_POST_ENABLED
```

### 4-2: YouTube の認証情報（3つ）

```bash
# 1つずつ実行。値を貼り付けて Enter → Ctrl+D
gh secret set YOUTUBE_CLIENT_ID
gh secret set YOUTUBE_CLIENT_SECRET
gh secret set YOUTUBE_REFRESH_TOKEN
```

### 4-3: Instagram の認証情報（2つ）

```bash
gh secret set INSTAGRAM_USER_ID
gh secret set INSTAGRAM_ACCESS_TOKEN
```

### 4-4: Instagram トークン自動更新用（任意、推奨）

```bash
gh secret set FACEBOOK_APP_ID
gh secret set FACEBOOK_APP_SECRET
```

### 4-5: 登録確認

```bash
gh secret list
```

以下が表示されればOK:

```
FACEBOOK_APP_ID          Updated 2026-04-05
FACEBOOK_APP_SECRET      Updated 2026-04-05
INSTAGRAM_ACCESS_TOKEN   Updated 2026-04-05
INSTAGRAM_USER_ID        Updated 2026-04-05
SNS_POST_ENABLED         Updated 2026-04-05
YOUTUBE_CLIENT_ID        Updated 2026-04-05
YOUTUBE_CLIENT_SECRET    Updated 2026-04-05
YOUTUBE_REFRESH_TOKEN    Updated 2026-04-05
```

---

## Part 5: 動作確認

### 5-1: キャプション生成テスト（ローカル）

```bash
cd /Users/kokinaniwa/projects/github-trending-video
node scripts/generate-caption.mjs
```

`output/captions.json` が生成される。中身を確認:

```bash
cat output/captions.json | jq .youtube.title
# → "【GitHub Trending】今日の注目リポジトリ TOP5｜2026/04/05 #Shorts"
```

### 5-2: YouTube アップロードテスト（ローカル）

```bash
export YOUTUBE_CLIENT_ID="..."
export YOUTUBE_CLIENT_SECRET="..."
export YOUTUBE_REFRESH_TOKEN="..."

node scripts/upload-youtube.mjs --video=output/trending-20260405.mp4
```

成功すると:

```
YouTube: uploading output/trending-20260405.mp4
  Title: 【GitHub Trending】今日の注目リポジトリ TOP5｜2026/04/05 #Shorts
  Uploading...
  Uploaded! https://youtube.com/shorts/xxxxxxxxxxx
```

> アップロード後、YouTube Studio で確認。処理に数分かかる場合があります。

### 5-3: GitHub Actions 全体テスト

```bash
# 手動実行
gh workflow run "Daily Trending Video"

# 実行状況をリアルタイムで確認
gh run list --workflow=daily-video.yml --limit=1
gh run watch
```

### 5-4: Instagram テスト

Instagram は公開URLが必要なため、ローカルテストは少し手間です。
GitHub Actions で GitHub Release → Instagram の流れで自動テストするのが簡単:

```bash
# SNS_POST_ENABLED=true になっていれば、
# workflow_dispatch で全体パイプラインが走る
gh workflow run "Daily Trending Video"
```

---

## Part 6: Instagram トークン自動更新

Instagram の長期トークンは **約60日で期限切れ** になります。
月2回自動更新するワークフローを追加します。

### ファイルを作成:

`.github/workflows/refresh-instagram-token.yml` は既にリポジトリに含まれていません。
必要な場合は以下の内容で作成してください:

```yaml
name: Refresh Instagram Token

on:
  schedule:
    # 毎月1日と15日の UTC 0:00 に実行
    - cron: "0 0 1,15 * *"
  workflow_dispatch:

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Refresh token
        run: |
          RESPONSE=$(curl -s "https://graph.facebook.com/v22.0/oauth/access_token?\
          grant_type=fb_exchange_token&\
          client_id=${FACEBOOK_APP_ID}&\
          client_secret=${FACEBOOK_APP_SECRET}&\
          fb_exchange_token=${INSTAGRAM_ACCESS_TOKEN}")

          NEW_TOKEN=$(echo "$RESPONSE" | jq -r '.access_token')

          if [ "$NEW_TOKEN" != "null" ] && [ -n "$NEW_TOKEN" ]; then
            echo "Token refreshed successfully"
            echo "Expires in: $(echo "$RESPONSE" | jq -r '.expires_in') seconds"
            gh secret set INSTAGRAM_ACCESS_TOKEN --body "$NEW_TOKEN"
          else
            echo "Token refresh failed:"
            echo "$RESPONSE" | jq .
            exit 1
          fi
        env:
          FACEBOOK_APP_ID: ${{ secrets.FACEBOOK_APP_ID }}
          FACEBOOK_APP_SECRET: ${{ secrets.FACEBOOK_APP_SECRET }}
          INSTAGRAM_ACCESS_TOKEN: ${{ secrets.INSTAGRAM_ACCESS_TOKEN }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 動作確認:

```bash
gh workflow run "Refresh Instagram Token"
gh run list --workflow=refresh-instagram-token.yml --limit=1
```

---

## Part 7: トラブルシューティング

### YouTube

| 症状 | 原因 | 対処法 |
|------|------|--------|
| `invalid_grant` | リフレッシュトークンが失効 | `node scripts/auth-youtube.mjs` を再実行してトークン再取得 |
| `quotaExceeded` | 1日のAPI quota上限に到達 | 翌日 PST 0:00 にリセット。頻繁なら [quota増加申請](https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas) |
| `forbidden` | OAuth 同意画面のテストユーザーに未追加 | Google Cloud Console → OAuth 同意画面 → テストユーザーに追加 |
| `The request cannot be completed because you have exceeded your quota` | デフォルトquotaは10,000 units/日。upload=1600 units | 1日6回程度が上限。quota増加を申請 |
| 動画がShortsにならない | 60秒超、または非9:16 | 動画の長さを60秒以下にする |

### Instagram

| 症状 | 原因 | 対処法 |
|------|------|--------|
| `OAuthException (code 190)` | アクセストークン期限切れ | Step 3-5 の手順でトークン再取得、または自動更新ワークフロー設定 |
| `Invalid video url` | 動画URLにInstagramサーバーからアクセスできない | GitHub Release URLが正しいか確認。プライベートリポジトリの場合は不可 |
| `Media processing timed out` | 動画の処理に5分以上 | ファイルサイズを確認（1GB以下推奨）。リトライ |
| `Application does not have permission for this action` | `instagram_content_publish` 権限なし | Graph API Explorer で権限を再付与 |
| `(#100) You must be an admin or editor of this page` | Facebook ページの権限不足 | Facebook ページの設定で自分を管理者にする |
| コンテナ作成後 `ERROR` | 動画フォーマット非対応 | H.264/AAC/MP4 であることを確認 |

### GitHub Actions

| 症状 | 原因 | 対処法 |
|------|------|--------|
| SNS投稿がスキップされる | `SNS_POST_ENABLED` 未設定 | `echo "true" \| gh secret set SNS_POST_ENABLED` |
| `gh release create` 失敗 | `GITHUB_TOKEN` の権限不足 | リポジトリ Settings → Actions → General → Workflow permissions → Read and write |
| Secrets が読み込めない | Secret名のタイポ | `gh secret list` で確認 |

### よくある質問

**Q: プライベートリポジトリでもInstagramは動く？**
A: いいえ。Instagram は公開URLが必要で、プライベートリポジトリの Release からはアクセスできません。リポジトリはパブリックにしておく必要があります。

**Q: YouTube の quota を増やすには？**
A: Google Cloud Console → YouTube Data API v3 → Quotas → 「Edit Quotas」から申請。審査に数日かかります。

**Q: Instagram のアカウントをビジネスからクリエイターに変えるとどうなる？**
A: クリエイターアカウントでも Content Publishing API は使えます。問題ありません。

**Q: 片方のプラットフォームだけ使える？**
A: はい。認証情報が設定されているプラットフォームのみ実行されます。未設定のプラットフォームは自動スキップです。

---

## シークレット一覧

| シークレット名 | 必須 | 用途 | 取得場所 |
|---------------|------|------|----------|
| `SNS_POST_ENABLED` | 必須 | SNS投稿の有効/無効フラグ | `true` を設定 |
| `YOUTUBE_CLIENT_ID` | YouTube使用時 | OAuth Client ID | Google Cloud Console > 認証情報 |
| `YOUTUBE_CLIENT_SECRET` | YouTube使用時 | OAuth Client Secret | Google Cloud Console > 認証情報 |
| `YOUTUBE_REFRESH_TOKEN` | YouTube使用時 | OAuth Refresh Token | `node scripts/auth-youtube.mjs` |
| `INSTAGRAM_USER_ID` | Instagram使用時 | IG ビジネスアカウントID | Graph API Explorer |
| `INSTAGRAM_ACCESS_TOKEN` | Instagram使用時 | 長期アクセストークン | Graph API Explorer → curl で交換 |
| `FACEBOOK_APP_ID` | 自動更新時 | Facebook App ID | developers.facebook.com > 基本設定 |
| `FACEBOOK_APP_SECRET` | 自動更新時 | Facebook App Secret | developers.facebook.com > 基本設定 |
