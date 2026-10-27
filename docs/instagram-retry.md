# Instagram 単独再試行

この機能を main に適用した後に作成された日付だけを対象とします。過去の台帳修復・再投稿は行いません。

## 自動再試行（2026-10-27〜）

同じ **Retry Instagram for Date** が 1 日 4 回（12:07 / 14:07 / 17:07 / 20:07 JST）自動で走ります。日次の 08:00 JST の回（GitHub の遅れで実際は 09:35〜10:40 頃）について:

1. main の `data/performance-history.json` に YouTube があり Instagram が無いときだけ進みます（`scripts/ig-auto-retry.mjs gate`）。日次の実行中・終了から 45 分以内は見送ります（最後の回は待たない）。
2. 動画が 59.5 秒を超えていたら投稿しません。Instagram 本体の直近の投稿に同じキャプションがあれば投稿せず、`--record-media-id` で台帳を `succeeded` にします（公開の返事が途切れて台帳が `unknown` の日もここで直ります）。その日 08:00 JST 以降に違うキャプションの投稿があれば投稿しません（`scripts/ig-auto-retry.mjs check`）。
3. そのあと下の手動と同じ台帳の確認（`failed` かつ `safeToRetry: true` だけ）と bundle の検証を通ってから投稿します。Instagram に無いのに `unknown` / `in_progress` の日は赤で止まり、投稿しません。
4. 自動で上げるのは 1 つの回に合計 3 回まで（日をまたいでも合算、`data/ig-auto-retry.json`）。自動の試行で `ProcessingFailedError` が 2 回続いたら、その回はもう自動では上げません。
5. 次の回でも直らないもの（上限・同じ失敗の連続・長さ・別の投稿・上の 3 の台帳の状態）はどの回でもその場で赤。それ以外の失敗は、最初の 3 回なら注記だけで緑（次の回がもう一度）、4 回目なら赤です。
6. 止めるスイッチ（リポの Variables、自動の回だけ）: `IG_AUTO_RETRY=off` で全部、`IG_AUTO_RETRY_SKIP=YYYYMMDD,…` でその回だけ。日次の `daily-video.yml` と同じ `sns-posting` で順番待ちするので、同時には投稿しません。

## 手動再試行

1. 失敗日の `data/posting/YYYY-MM-DD.json` を確認します。Instagram が `status: failed` かつ `safeToRetry: true`、既知の `mediaId` がない場合だけ再試行できます。
2. GitHub Actions の **Retry Instagram for Date** (`post-today-instagram.yml`) を開き、branch は **main**、`date` は **YYYY-MM-DD**、`platform` は **instagram** を指定します。
3. 同日の Release `vYYYYMMDD` から保存済み動画とメタデータをダウンロードし、日付・ファイル名・SHA-256 を検証した後、Instagram だけを投稿します。当日のキャプションをそのまま使い、YouTube 投稿、動画生成、原稿生成、統計取得は実行しません。

適用後の運用で使うコマンド例（実行すると投稿されます）:

```sh
gh workflow run post-today-instagram.yml \
  --repo nannantown/github-trending-video --ref main \
  -f date=YYYY-MM-DD -f platform=instagram
```

`.retry-ig-trigger` の push 起動と日付の自動補完は廃止しました（定時の自動再試行は上の節）。元の失敗した日次ワークフロー全体を再実行する代わりに、このワークフローを使います。直接の `upload-instagram.mjs` 実行は台帳を回避するため停止します。

## 保存先と結果の見方

| 保存先 | 内容 |
|---|---|
| main の `data/posting/YYYY-MM-DD.json` | 投稿先ごとの状態、試行回数・識別子、YouTube `videoId`、Instagram `mediaId` / `containerId` と過去の container IDs、動画とメタデータのハッシュ |
| main の `data/performance-history.json` | 投稿先別の状態と既知 ID をマージ。片側が失敗しても他方の ID と取得済み指標を保持。Instagram 単独成功なら `videoId: null` の行も保存 |
| Release `vYYYYMMDD` | `trending-YYYYMMDD.mp4` と `trending-YYYYMMDD-metadata.json`（キャプション、元データ、音声長、discovery）。初回のみ作成し、上書きしない |
| Actions artifact（30 日） | 日次は動画・メタデータ・台帳・history、再試行はメタデータ・台帳・history。失敗時も保存を試みる |

投稿前に `in_progress` を main へ commit/push します。Instagram の公開 POST 前には `phase: publishing` と container ID も保存します。公開応答から得た ID はその場で保存し、YouTube もサムネイル処理より前に成功 ID を保存します。記録の push が失敗した場合は後続の公開操作を止めます。

| 状態 | 再試行 |
|---|---|
| `failed`, `safeToRetry: true` | 公開 POST より前の失敗。保存済み bundle が一致するときだけ可能 |
| `succeeded` または既知 `mediaId` あり | 停止。二重投稿を防ぐ |
| `unknown` / `in_progress` | 停止。応答不明、強制終了、保存失敗などを含む。main の台帳、artifact、Instagram 実投稿を照合する |
| `not_started` / `skipped` / 台帳不在 | 停止。通常の再試行の対象外。原因を個別に確認する |

結果不明を強制投稿するオプションはありません。公開後の保存失敗では、main に `in_progress` / `publishing` が残り、手元・artifact に既知 ID が残る場合があります。既存投稿を調べ、確認済み ID を台帳に反映する修復は別途レビューして行ってください。推測で `failed` に変更しないでください。

動画や当日メタデータがない、内容がハッシュと一致しない場合も停止します。現在の `enriched-trending.json` や現在日のキャプションから補完しません。初回の Release 保存が失敗した場合は SNS 投稿前に停止します。

日次と再試行は共有の `sns-posting` キューで直列実行し、実行中の投稿を取消しません。待機中の実行も保持するため `queue: max` を使います（[GitHub Actions concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)）。ローカルでも日付別ロックを使い、残ったロックは自動削除しません。別 checkout の同時操作も Git の競合で停止するよう、試行識別子を保存します。

## 投稿せずに確認する

対象日の保存済み動画とメタデータを `output/` に置き、最新 main の台帳と合わせて:

```sh
node scripts/retry-instagram.mjs --date=YYYY-MM-DD --platform=instagram --check
```

これは API・生成処理・台帳書換えを行いません。通常のローカル起動で投稿はできません。ライブ処理には main 上の永続 Git checkpoint が必須です。

API モックと一時ローカル Git リモートによる検証:

```sh
# Node 22 / npm ci 済みの環境
npm test
```

## 適用時の確認

- コードレビュー後に main へ取り込む（この作業では push / PR / merge は未実行）。既存の `contents: write` 権限で、Actions bot に Release 作成と main の台帳 commit/push が許可されていることを確認する。ブランチ保護などで書込み不可なら、公開前の checkpoint で停止する。
- 次回以降の日次実行で、Release のメタデータと日付別台帳が作られることを確認する。
- 将来の Instagram 公開前失敗に限って上記手順を使う。現行の日次動画生成や実際の SNS API の動作確認はこの実装作業では行っていない。
