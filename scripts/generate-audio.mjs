/**
 * Generate TTS narration using Edge TTS (Microsoft Neural voices)
 * Voice: ja-JP-NanamiNeural (female) or ja-JP-KeitaNeural (male)
 * Output: public/audio/*.mp3 + output/audio-durations.json
 *
 * Usage:
 *   node scripts/generate-audio.mjs                         # use hardcoded defaults
 *   node scripts/generate-audio.mjs --data=output/trending-data.json  # from data file
 *   node scripts/generate-audio.mjs --voice=keita           # male voice
 */

import { Communicate } from "edge-tts-universal";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const audioDir = join(rootDir, "public", "audio");
const outputDir = join(rootDir, "output");

const voiceArg = process.argv.find((a) => a.startsWith("--voice="));
const voiceName =
  voiceArg?.split("=")[1] === "keita"
    ? "ja-JP-KeitaNeural"
    : "ja-JP-NanamiNeural";

// Default narrations (fallback when no --data is provided)
const defaultNarrations = [
  {
    filename: "opening",
    text: "今日のGitHub Trending。注目リポジトリトップ5を紹介します。",
  },
  {
    filename: "project-1",
    text: "第1位、オープンスクリーン。スクリーンスタジオの無料オープンソース代替です。プロ品質の録画と編集がすべて無料で使えます。今日だけで2496スター獲得。",
  },
  {
    filename: "project-2",
    text: "第2位、オーマイコーデックス。OpenAIコーデックスCLIの拡張レイヤーです。カスタムプロンプトやプラグインでCLI開発体験を大幅に向上。今日2852スター獲得で急上昇中。",
  },
  {
    filename: "project-3",
    text: "第3位、システムプロンプトリークス。主要AIモデルのシステムプロンプト集です。ChatGPTやClaudeの裏側が丸見えになる、3万6千スター超えの人気リポジトリ。",
  },
  {
    filename: "project-4",
    text: "第4位、シャーロック。SNSアカウント探索ツールです。ユーザー名ひとつで400以上のサービスを一括検索。7万7千スター突破の定番OSINTツール。",
  },
  {
    filename: "project-5",
    text: "第5位、クロードコード。Anthropic製のAIコーディングエージェントです。ターミナルから自律的にコード生成、編集、Git操作までこなす次世代ツール。今日920スター獲得。",
  },
  {
    filename: "ending",
    text: "以上、今日のGitHub Trendingでした。フォローといいねで、毎朝のトレンドをチェックしましょう。",
  },
];

function loadNarrations() {
  const dataArg = process.argv.find((a) => a.startsWith("--data="));
  if (!dataArg) return defaultNarrations;

  const dataPath = dataArg.split("=")[1];
  const data = JSON.parse(readFileSync(dataPath, "utf-8"));

  const narrations = [
    { filename: "opening", text: data.openingNarration },
  ];
  data.projects.forEach((p, i) => {
    narrations.push({ filename: `project-${i + 1}`, text: p.narration });
  });
  narrations.push({ filename: "ending", text: data.endingNarration });

  return narrations;
}

function getAudioDuration(filePath) {
  // MP3 at 48kbps mono = ~6000 bytes/sec (Edge TTS default codec)
  const size = statSync(filePath).size;
  return Math.round((size / 6000) * 100) / 100;
}

async function synthesize(text, outputPath) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const comm = new Communicate(text, {
        voice: voiceName,
        rate: "+30%",
        pitch: "+0Hz",
      });

      const audioChunks = [];
      const wordBoundaries = [];
      for await (const chunk of comm.stream()) {
        if (chunk.type === "audio" && chunk.data) {
          audioChunks.push(chunk.data);
        } else if (chunk.type === "WordBoundary" && chunk.text) {
          wordBoundaries.push({
            // offset/duration are in 100-nanosecond units → convert to seconds
            offset: (chunk.offset || 0) / 10_000_000,
            duration: (chunk.duration || 0) / 10_000_000,
            text: chunk.text,
          });
        }
      }

      const buffer = Buffer.concat(audioChunks);
      writeFileSync(outputPath, buffer);
      return { bytes: buffer.length, wordBoundaries };
    } catch (err) {
      console.error(`\n  Attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
      else throw err;
    }
  }
}

async function main() {
  mkdirSync(audioDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });

  const narrations = loadNarrations();

  console.log(`Voice: ${voiceName}`);
  console.log(`Output: ${audioDir}\n`);

  const durations = {};
  const subtitles = {};

  for (let i = 0; i < narrations.length; i++) {
    const { filename, text } = narrations[i];
    const outputPath = join(audioDir, `${filename}.mp3`);

    process.stdout.write(`[${i + 1}/${narrations.length}] ${filename}... `);
    const result = await synthesize(text, outputPath);
    const duration = getAudioDuration(outputPath);
    durations[filename] = duration;
    subtitles[filename] = {
      text,
      words: result.wordBoundaries,
    };
    console.log(`${(result.bytes / 1024).toFixed(0)} KB (${duration}s, ${result.wordBoundaries.length} words)`);
  }

  // Write durations for Remotion composition
  const durationsPath = join(outputDir, "audio-durations.json");
  writeFileSync(durationsPath, JSON.stringify(durations, null, 2));
  console.log(`\nDurations → ${durationsPath}`);

  // Write subtitle timing data
  const subtitlesPath = join(outputDir, "subtitles.json");
  writeFileSync(subtitlesPath, JSON.stringify(subtitles, null, 2));
  console.log(`Subtitles → ${subtitlesPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
