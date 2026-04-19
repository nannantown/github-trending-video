import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

interface WordBoundary {
  offset: number;
  duration: number;
  text: string;
}

export interface SubtitleData {
  text: string;
  words: WordBoundary[];
}

interface Props {
  data?: SubtitleData;
}

/**
 * Animated subtitle overlay synced with TTS word boundaries.
 * Displays text at the bottom with word-by-word highlight animation.
 */
export const Subtitle: React.FC<Props> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!data || !data.words || data.words.length === 0) return null;

  const currentTime = frame / fps;

  // Group words into lines (~15 chars per line for mobile readability)
  const lines = groupIntoLines(data.words, 18);

  // Find which line group is currently active
  const activeLineIdx = lines.findIndex((line) => {
    const firstWord = line[0];
    const lastWord = line[line.length - 1];
    const lineEnd = lastWord.offset + lastWord.duration + 0.3;
    return currentTime >= firstWord.offset - 0.1 && currentTime < lineEnd;
  });

  if (activeLineIdx === -1) return null;

  const activeLine = lines[activeLineIdx];
  const lineStart = activeLine[0].offset;

  // Fade in for the line
  const lineOpacity = interpolate(
    currentTime,
    [lineStart - 0.1, lineStart + 0.15],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        position: "absolute",
        bottom: 340,
        // Symmetric horizontal safe area matching ProjectCard padding,
        // clearing YT Shorts action buttons (~140px on the right).
        left: 120,
        right: 140,
        display: "flex",
        justifyContent: "center",
        opacity: lineOpacity,
      }}
    >
      <div
        style={{
          background: "rgba(0, 0, 0, 0.75)",
          borderRadius: 16,
          padding: "16px 28px",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "2px",
          maxWidth: "90%",
        }}
      >
        {activeLine.map((word, i) => {
          const isSpoken = currentTime >= word.offset;
          const speakProgress = interpolate(
            currentTime,
            [word.offset, word.offset + Math.max(word.duration, 0.1)],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );

          return (
            <span
              key={`${activeLineIdx}-${i}`}
              style={{
                fontSize: 36,
                fontWeight: 700,
                fontFamily: "'Noto Sans JP', 'Noto Sans CJK JP', 'Hiragino Sans', sans-serif",
                color: isSpoken ? "#ffffff" : "rgba(255, 255, 255, 0.4)",
                textShadow: isSpoken
                  ? "0 0 20px rgba(88, 166, 255, 0.5)"
                  : "none",
                transition: "color 0.1s",
              }}
            >
              {word.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};

function groupIntoLines(
  words: WordBoundary[],
  maxChars: number
): WordBoundary[][] {
  const lines: WordBoundary[][] = [];
  let current: WordBoundary[] = [];
  let charCount = 0;

  for (const word of words) {
    if (charCount + word.text.length > maxChars && current.length > 0) {
      lines.push(current);
      current = [];
      charCount = 0;
    }
    current.push(word);
    charCount += word.text.length;
  }
  if (current.length > 0) lines.push(current);
  return lines;
}
