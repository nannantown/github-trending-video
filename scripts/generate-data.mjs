/**
 * Transform raw trending data into full Project[] with Japanese text.
 * Input:  output/raw-trending.json
 * Output: output/trending-data.json
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "..", "output");

function formatStarsJa(n) {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, "") + "万";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "千";
  return n.toString();
}

// Language → Japanese category templates
const langCategories = {
  TypeScript: "TypeScript製",
  JavaScript: "JavaScript製",
  Python: "Python製",
  Go: "Go言語製",
  Rust: "Rust製",
  Java: "Java製",
  "C++": "C++製",
  C: "C言語製",
  Ruby: "Ruby製",
  Swift: "Swift製",
  Kotlin: "Kotlin製",
  Dart: "Dart製",
  Markdown: "ドキュメント",
  Shell: "シェルスクリプト",
};

// Keyword → Japanese description mapping
const keywordMap = [
  [/\bAI\b.*\b(chat|assistant)/i, "AIチャット・アシスタント"],
  [/\bAI\b.*\bagent/i, "AIエージェント"],
  [/\bAI\b.*\b(code|coding)/i, "AIコーディングツール"],
  [/\bAI\b/i, "AI関連ツール"],
  [/\bLLM\b/i, "大規模言語モデル関連"],
  [/\bMCP\b/i, "MCP対応ツール"],
  [/\bCLI\b/i, "コマンドラインツール"],
  [/\bscreen\s*record/i, "画面録画ツール"],
  [/\bvideo\b.*\bedit/i, "動画編集ツール"],
  [/\bredactor?\b/i, "テキストエディタ"],
  [/\bneovim\b|\bvim\b|\bnvim\b/i, "Neovimプラグイン"],
  [/\bfile\s*(search|find|manager)/i, "ファイル検索ツール"],
  [/\bsearch\b/i, "検索ツール"],
  [/\bmonitor/i, "監視ツール"],
  [/\bdashboard/i, "ダッシュボード"],
  [/\bframework/i, "フレームワーク"],
  [/\blibrary/i, "ライブラリ"],
  [/\bplatform/i, "プラットフォーム"],
  [/\btoolkit\b|\btool\b/i, "開発ツール"],
  [/\bsystem\s*prompt/i, "システムプロンプト集"],
  [/\bOSINT\b|\busername\b.*\bsearch/i, "OSINT調査ツール"],
  [/\bsecurity/i, "セキュリティツール"],
  [/\btime\s*series/i, "時系列分析ツール"],
  [/\bfoundation\s*model/i, "基盤モデル"],
  [/\bopen\s*source/i, "オープンソースツール"],
  [/\balternative/i, "代替ツール"],
  [/\bself[- ]?host/i, "セルフホスト型ツール"],
];

function describeInJapanese(repo) {
  const desc = repo.description || "";
  const lang = langCategories[repo.language] || "";

  // Try keyword matching for a concise Japanese description
  for (const [regex, ja] of keywordMap) {
    if (regex.test(desc) || regex.test(repo.name)) {
      return lang ? `${lang}の${ja}` : ja;
    }
  }

  // Fallback: generic description based on language
  if (lang) return `${lang}のオープンソースプロジェクト`;
  return "注目のオープンソースプロジェクト";
}

function generateDetail(repo) {
  const starsJa = formatStarsJa(repo.stars);
  const todayJa = repo.todayStars.toLocaleString();
  const desc = describeInJapanese(repo);

  // Build a detail paragraph in Japanese
  const parts = [];
  parts.push(`${desc}。`);

  if (repo.todayStars >= 2000) {
    parts.push(`本日だけで+${todayJa}スターの爆発的な伸びを記録。`);
  } else if (repo.todayStars >= 1000) {
    parts.push(`本日+${todayJa}スターと急上昇中。`);
  } else {
    parts.push(`本日+${todayJa}スター獲得。`);
  }

  parts.push(`累計${starsJa}スター。`);
  return parts.join("");
}

function generateNarration(repo) {
  const desc = describeInJapanese(repo);
  const starsJa = formatStarsJa(repo.stars);
  const todayJa = repo.todayStars.toLocaleString();

  return `第${repo.rank}位、${repo.name}。${desc}です。累計${starsJa}スター、今日${todayJa}スター獲得。`;
}

function main() {
  const rawPath = join(outputDir, "raw-trending.json");
  const raw = JSON.parse(readFileSync(rawPath, "utf-8"));

  const projects = raw.map((repo) => ({
    rank: repo.rank,
    name: repo.name,
    fullName: repo.fullName,
    description: describeInJapanese(repo),
    detail: generateDetail(repo),
    narration: generateNarration(repo),
    stars: repo.stars,
    todayStars: repo.todayStars,
    language: repo.language,
    url: repo.url,
  }));

  const data = {
    openingNarration:
      "今日のGitHub Trending。注目リポジトリトップ5を紹介します。",
    endingNarration:
      "以上、今日のGitHub Trendingでした。フォローといいねで、毎朝のトレンドをチェックしましょう。",
    projects,
  };

  const outputPath = join(outputDir, "trending-data.json");
  writeFileSync(outputPath, JSON.stringify(data, null, 2));

  console.log(`Generated ${projects.length} projects → ${outputPath}`);
  projects.forEach((p) =>
    console.log(`  #${p.rank} ${p.fullName}\n    desc: ${p.description}\n    detail: ${p.detail}`)
  );
}

main();
