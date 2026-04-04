import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const Ending: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleScale = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 100 },
    from: 0.6,
    to: 1,
  });

  const titleOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  const subOpacity = interpolate(frame, [25, 45], [0, 1], {
    extrapolateRight: "clamp",
  });

  const subY = spring({
    frame: Math.max(0, frame - 25),
    fps,
    config: { damping: 12, stiffness: 80 },
    from: 30,
    to: 0,
  });

  const ctaOpacity = interpolate(frame, [45, 65], [0, 1], {
    extrapolateRight: "clamp",
  });

  const ctaScale = spring({
    frame: Math.max(0, frame - 45),
    fps,
    config: { damping: 10, stiffness: 180 },
    from: 0.8,
    to: 1,
  });

  const glowPulse = interpolate(
    frame % 90,
    [0, 45, 90],
    [0.4, 0.8, 0.4]
  );

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #0d0d0d 0%, #0a0a14 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Noto Sans JP', 'Hiragino Sans', sans-serif",
      }}
    >
      {/* Glow */}
      <div
        style={{
          position: "absolute",
          top: "45%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 700,
          height: 700,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(88, 166, 255, 0.2) 0%, transparent 65%)",
          opacity: glowPulse,
        }}
      />

      {/* Main text */}
      <div
        style={{
          opacity: titleOpacity,
          transform: `scale(${titleScale})`,
          textAlign: "center",
          marginBottom: 28,
        }}
      >
        <div
          style={{
            fontSize: 88,
            fontWeight: 900,
            letterSpacing: "-2px",
            lineHeight: 1.1,
          }}
        >
          <span style={{ color: "#fff" }}>明日も</span>
          <br />
          <span
            style={{
              background: "linear-gradient(90deg, #58a6ff, #79c0ff)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            チェックしよう
          </span>
        </div>
      </div>

      {/* Sub message */}
      <div
        style={{
          opacity: subOpacity,
          transform: `translateY(${subY}px)`,
          fontSize: 32,
          color: "rgba(255,255,255,0.5)",
          fontWeight: 400,
          marginBottom: 64,
          textAlign: "center",
          lineHeight: 1.6,
        }}
      >
        毎朝 GitHub Trending を
        <br />
        チェックしてトレンドをキャッチ
      </div>

      {/* CTA */}
      <div
        style={{
          opacity: ctaOpacity,
          transform: `scale(${ctaScale})`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            background: "linear-gradient(90deg, #58a6ff, #79c0ff)",
            borderRadius: 100,
            padding: "24px 72px",
            fontSize: 36,
            fontWeight: 800,
            color: "#000",
            letterSpacing: "1px",
          }}
        >
          フォロー & いいね
        </div>
        <div
          style={{
            fontSize: 24,
            color: "rgba(255,255,255,0.35)",
            fontWeight: 400,
          }}
        >
          毎朝のトレンド動画をお届けします
        </div>
      </div>

      {/* GitHub watermark */}
      <div
        style={{
          position: "absolute",
          bottom: 80,
          opacity: 0.3,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <svg width="30" height="30" viewBox="0 0 24 24" fill="#ffffff">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
        </svg>
        <span
          style={{
            fontSize: 24,
            color: "#ffffff",
            fontFamily: "monospace",
            fontWeight: 600,
          }}
        >
          github.com/trending
        </span>
      </div>
    </AbsoluteFill>
  );
};
