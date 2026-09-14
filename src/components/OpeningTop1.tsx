import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Project } from "../data";

/**
 * YouTube-only opening (2026-09-14 distribution experiment B).
 *
 * The shared <Opening /> is identical every day except for the date, so every
 * YouTube upload's first second and auto-thumbnail looked like a re-upload of
 * the previous day. This variant puts the day's TOP1 repository (name + one
 * line of what it does) on screen from frame 0, above a compact brand block.
 *
 * It is rendered only into the YouTube file (openingVariant="top1", see
 * scripts/youtube-variant.mjs). The Instagram Reel keeps the shared <Opening />
 * untouched — IG reach is healthy and is the control for this experiment.
 *
 * Typography follows the 1080x1920 rules used across the SNS videos: main
 * title <= 82px, emphasis 46px, heading 36px, label in a solid pill with white
 * text (the accent colour lives in the pill border).
 */
export const OpeningTop1: React.FC<{ topProject: Project }> = ({
  topProject,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // TOP1 hook — fully opaque on frame 0 (it is the first frame and the
  // thumbnail source), only a short upward settle.
  const hookY = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 120 },
    from: 16,
    to: 0,
  });

  // Date (frame 0-15)
  const dateOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  const dateY = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 100 },
    from: 40,
    to: 0,
  });

  // GitHub icon + title (frame 10-30)
  const titleOpacity = interpolate(frame, [10, 30], [0, 1], {
    extrapolateRight: "clamp",
  });

  const titleY = spring({
    frame: Math.max(0, frame - 10),
    fps,
    config: { damping: 12, stiffness: 100 },
    from: 60,
    to: 0,
  });

  // Divider (frame 20+)
  const lineScale = spring({
    frame: Math.max(0, frame - 20),
    fps,
    config: { damping: 15, stiffness: 120 },
    from: 0,
    to: 1,
  });

  // Subtitle (frame 30-50)
  const subtitleOpacity = interpolate(frame, [30, 50], [0, 1], {
    extrapolateRight: "clamp",
  });

  const subtitleY = spring({
    frame: Math.max(0, frame - 30),
    fps,
    config: { damping: 12, stiffness: 80 },
    from: 40,
    to: 0,
  });

  const glowOpacity = interpolate(frame, [0, 30, 60], [0, 0.6, 0.3]);

  const today = new Date();
  const dateStr = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, "0")}.${String(today.getDate()).padStart(2, "0")}`;

  // Repo names are ASCII slugs of very different lengths; step the size down
  // so long names stay within one or two lines of the 900px column.
  const nameLength = topProject.name.length;
  const nameFontSize =
    nameLength > 24 ? 48 : nameLength > 18 ? 58 : nameLength > 12 ? 72 : 82;

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #0d0d0d 0%, #111111 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Noto Sans JP', 'Noto Sans CJK JP', 'Hiragino Sans', sans-serif",
        overflow: "hidden",
      }}
    >
      {/* Background glow */}
      <div
        style={{
          position: "absolute",
          top: "40%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 700,
          height: 700,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(88, 166, 255, 0.15) 0%, transparent 70%)",
          opacity: glowOpacity,
        }}
      />

      {/* TOP1 hook — the day-specific part, on screen from frame 0 */}
      <div
        style={{
          transform: `translateY(${hookY}px)`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: 900,
          marginBottom: 72,
          textAlign: "center",
        }}
      >
        <div
          style={{
            background: "#0d1b2e",
            border: "3px solid #58a6ff",
            color: "#ffffff",
            fontSize: 36,
            fontWeight: 800,
            letterSpacing: "2px",
            padding: "8px 32px",
            borderRadius: 100,
            marginBottom: 28,
          }}
        >
          今日の1位
        </div>
        <div
          style={{
            fontSize: nameFontSize,
            fontWeight: 900,
            color: "#ffffff",
            letterSpacing: "-1px",
            lineHeight: 1.1,
            wordBreak: "break-word",
            marginBottom: 20,
          }}
        >
          {topProject.name}
        </div>
        <div
          style={{
            fontSize: 46,
            fontWeight: 700,
            color: "rgba(255,255,255,0.9)",
            lineHeight: 1.4,
            wordBreak: "break-word",
          }}
        >
          {topProject.description}
        </div>
      </div>

      {/* Date */}
      <div
        style={{
          opacity: dateOpacity,
          transform: `translateY(${dateY}px)`,
          marginBottom: 32,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 44,
            fontWeight: 900,
            color: "#ffffff",
            letterSpacing: "5px",
          }}
        >
          {dateStr}
        </div>
      </div>

      {/* GitHub icon */}
      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          marginBottom: 28,
        }}
      >
        <svg width="96" height="96" viewBox="0 0 24 24" fill="#ffffff">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
        </svg>
      </div>

      {/* Main title */}
      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 60,
            fontWeight: 900,
            color: "#ffffff",
            letterSpacing: "-1px",
            lineHeight: 1.1,
          }}
        >
          GitHub
        </div>
        <div
          style={{
            fontSize: 60,
            fontWeight: 900,
            background: "linear-gradient(90deg, #58a6ff, #79c0ff)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            letterSpacing: "-1px",
            lineHeight: 1.1,
          }}
        >
          Trending
        </div>
      </div>

      {/* Divider line */}
      <div
        style={{
          width: 200 * lineScale,
          height: 3,
          background: "linear-gradient(90deg, #58a6ff, #79c0ff)",
          borderRadius: 2,
          margin: "28px 0",
        }}
      />

      {/* Subtitle */}
      <div
        style={{
          opacity: subtitleOpacity,
          transform: `translateY(${subtitleY}px)`,
          fontSize: 36,
          fontWeight: 700,
          color: "rgba(255,255,255,0.9)",
          letterSpacing: "2px",
        }}
      >
        今日の注目リポジトリ TOP5
      </div>
    </AbsoluteFill>
  );
};
