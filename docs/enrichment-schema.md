# Enrichment Schema

`data/enriched-trending.json` is the **single source of truth** for the daily
video. Claude's scheduled task writes this file ~30 minutes before the GitHub
Actions workflow runs. The Actions pipeline no longer scrapes GitHub Trending
on its own — everything it needs must be in this file.

## Why no scraping in CI

Previously the pipeline scraped `github.com/trending` at workflow time and
joined those repos with Claude's enrichment by `fullName`. Trending rotates
fast, so the scrape sometimes returned a different set of repos than Claude
had enriched, silently falling back to a minimal Japanese template.

Making the enrichment authoritative removes that drift entirely.

## Required shape

```json
{
  "date": "YYYY-MM-DD",
  "projects": [
    {
      "rank": 1,
      "fullName": "owner/repo",
      "name": "repo",
      "url": "https://github.com/owner/repo",
      "language": "TypeScript",
      "stars": 12345,
      "todayStars": 678,
      "description": "カード上に出る一行コピー（15〜25文字）",
      "detail": "カード下に出る詳細解説（90〜140文字・2〜3文）",
      "narration": "TTSが読み上げる原稿（フック1文＋要点1文、合計50〜80文字）"
    }
  ]
}
```

### Field notes

| Field | Notes |
|---|---|
| `date` | JST 基準。`generate-data.mjs` は ±1日の窓で受け入れる |
| `rank` | 1〜5 |
| `language` | null 可（言語タグが無い repo 向け） |
| `stars`, `todayStars` | `github.com/trending` の現在値。ProjectCard で表示される |
| `description` | カード上部の太字（34px）。15〜25文字程度で短く |
| `detail` | カード本文（27px）。90〜140文字・2〜3文で「何ができるか／誰に向くか」まで含める |
| `narration` | **B案**: フック1文＋要点1文。読み上げ速度 +30% で10〜15秒に収まる50〜80文字 |

## Narration guidelines (B案)

ナレーションは「見出し」ではなく「短い説明」にする。視聴者がプロジェクト名
を聞き取れて、**何が価値か**を理解できる粒度を目指す。

### 構造

1. **フック文** — 一言でどんなリポジトリかを述べる（「〜するツールです」「〜のライブラリです」）
2. **要点文** — そのリポジトリの独自性・利用者メリットを具体的に1つ挙げる

### 例

| ❌ 旧（見出し調・1文） | ✅ 新（B案・2文） |
|---|---|
| Claude Codeを賢く、カーパシー流の一枚設定ファイル | Claude Codeを賢くする一枚の設定ファイルです。CLAUDE.mdに置くだけで、AIの過剰実装や勘違いを防ぐルールが効いて、提案品質が目に見えて上がります。 |
| 自分でスキルを増やすAIエージェント、トークンも6分の1 | 自分で新しいスキルを覚えていくAIエージェントです。わずか3,300行のPythonコードから、同じ作業のトークン消費を従来の6分の1に抑えます。 |

### ルール

- ランク（「第1位」）やスター数はナレーションに含めない（画面カードに表示される）
- 語尾は「です・ます」調で統一
- 英単語・固有名詞は原文表記のまま（TTSが自然に読む）
- 数字は漢字ではなくアラビア数字（例: 「6分の1」ではなく「6分の1」OK、「六分の一」NG）
- 堅い文語体は避ける

## Validation

`scripts/generate-data.mjs` は以下を満たさないと fail する:

- ファイルが存在
- `date` が今日 ±1日
- `projects` が空でない
- 各 project に `rank` / `fullName` / `name` / `url` / `stars` / `todayStars` / `description` / `detail` / `narration` が揃っている

`language` のみ optional（null または undefined 可）。
