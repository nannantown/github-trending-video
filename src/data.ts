export interface Project {
  rank: number;
  name: string;
  fullName: string;
  description: string;
  detail: string;
  narration: string;
  stars: number;
  todayStars: number;
  language?: string;
  url: string;
}

export const defaultProjects: Project[] = [
  {
    rank: 1,
    name: "openscreen",
    fullName: "siddharthvaddem/openscreen",
    description: "Screen Studioの無料OSS代替",
    detail:
      "macOSの有料スクリーン録画アプリScreen Studioと同等の機能を無料で提供するオープンソースツール。ズームイン、カーソルハイライト、背景ぼかしなどプロ品質の録画編集がすべて無料。",
    narration:
      "第1位、オープンスクリーン。スクリーンスタジオの無料オープンソース代替です。プロ品質の録画と編集がすべて無料で使えます。今日だけで2496スター獲得。",
    stars: 15700,
    todayStars: 2496,
    language: "TypeScript",
    url: "https://github.com/siddharthvaddem/openscreen",
  },
  {
    rank: 2,
    name: "oh-my-codex",
    fullName: "Yeachan-Heo/oh-my-codex",
    description: "OpenAI Codex CLIの拡張レイヤー",
    detail:
      "OpenAIのCodex CLIをさらに強化する拡張レイヤー。カスタムプロンプト、セッション管理、プラグインシステムを追加し、コマンドライン開発体験を大幅に改善。",
    narration:
      "第2位、オーマイコーデックス。OpenAIコーデックスCLIの拡張レイヤーです。カスタムプロンプトやプラグインでCLI開発体験を大幅に向上。今日2852スター獲得で急上昇中。",
    stars: 11500,
    todayStars: 2852,
    language: "Python",
    url: "https://github.com/Yeachan-Heo/oh-my-codex",
  },
  {
    rank: 3,
    name: "system_prompts_leaks",
    fullName: "asgeirtj/system_prompts_leaks",
    description: "主要AIモデルのシステムプロンプト集",
    detail:
      "ChatGPT、Claude、Geminiなど主要AIモデルの内部システムプロンプトを収集・公開。AIの裏側の仕組みが丸見えになるコレクション。累計3万6千スター超え。",
    narration:
      "第3位、システムプロンプトリークス。主要AIモデルのシステムプロンプト集です。ChatGPTやClaudeの裏側が丸見えになる、3万6千スター超えの人気リポジトリ。",
    stars: 36267,
    todayStars: 1200,
    language: "Markdown",
    url: "https://github.com/asgeirtj/system_prompts_leaks",
  },
  {
    rank: 4,
    name: "sherlock",
    fullName: "sherlock-project/sherlock",
    description: "SNSアカウント探索OSINTツール",
    detail:
      "ユーザー名を入力するだけで400以上のSNSやWebサービスでアカウントの存在を一括検索。セキュリティ調査やOSINTに広く利用される定番ツール。7万7千スター突破。",
    narration:
      "第4位、シャーロック。SNSアカウント探索ツールです。ユーザー名ひとつで400以上のサービスを一括検索。7万7千スター突破の定番OSINTツール。",
    stars: 77200,
    todayStars: 580,
    language: "Python",
    url: "https://github.com/sherlock-project/sherlock",
  },
  {
    rank: 5,
    name: "claude-code",
    fullName: "anthropics/claude-code",
    description: "AIエージェントコーディングツール",
    detail:
      "Anthropicが開発したターミナルベースのAIコーディングエージェント。コードの読み書き、コマンド実行、Git操作まで自律的にこなす次世代の開発ツール。",
    narration:
      "第5位、クロードコード。Anthropic製のAIコーディングエージェントです。ターミナルから自律的にコード生成、編集、Git操作までこなす次世代ツール。今日920スター獲得。",
    stars: 18400,
    todayStars: 920,
    language: "TypeScript",
    url: "https://github.com/anthropics/claude-code",
  },
];

// Narrations for opening and ending
export const openingNarration =
  "今日のGitHub Trending。注目リポジトリトップ5を紹介します。";
export const endingNarration =
  "以上、今日のGitHub Trendingでした。フォローといいねで、毎朝のトレンドをチェックしましょう。";

// Subtitle data (word boundaries from Edge TTS)
export interface WordBoundary {
  offset: number;
  duration: number;
  text: string;
}

export interface SubtitleEntry {
  text: string;
  words: WordBoundary[];
}

export interface SubtitleMap {
  [key: string]: SubtitleEntry;
}

// Audio durations (seconds per audio file)
export interface AudioDurations {
  opening: number;
  "project-1": number;
  "project-2": number;
  "project-3": number;
  "project-4": number;
  "project-5": number;
  ending: number;
}

// Default durations matching the hardcoded Edge TTS output (for local dev / Remotion Studio)
export const defaultDurations: AudioDurations = {
  opening: 5.0,
  "project-1": 12.5,
  "project-2": 14.6,
  "project-3": 12.0,
  "project-4": 12.2,
  "project-5": 13.3,
  ending: 6.5,
};

const FPS = 30;
const PADDING = 15; // 0.5s padding after audio
const ENDING_EXTRA = 30; // 1s extra for ending

export function calculateFrameDurations(d: AudioDurations) {
  const opening = Math.ceil(d.opening * FPS) + PADDING;
  const projects = [
    Math.ceil(d["project-1"] * FPS) + PADDING,
    Math.ceil(d["project-2"] * FPS) + PADDING,
    Math.ceil(d["project-3"] * FPS) + PADDING,
    Math.ceil(d["project-4"] * FPS) + PADDING,
    Math.ceil(d["project-5"] * FPS) + PADDING,
  ];
  const ending = Math.ceil(d.ending * FPS) + ENDING_EXTRA;
  const total = opening + projects.reduce((a, b) => a + b, 0) + ending;
  return { opening, projects, ending, total };
}
