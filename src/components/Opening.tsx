import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";


export const Opening: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  const titleY = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 100 },
    from: 60,
    to: 0,
  });

  const subtitleOpacity = interpolate(frame, [25, 45], [0, 1], {
    extrapolateRight: "clamp",
  });

  const subtitleY = spring({
    frame: Math.max(0, frame - 25),
    fps,
    config: { damping: 12, stiffness: 80 },
    from: 40,
    to: 0,
  });

  const dateOpacity = interpolate(frame, [40, 60], [0, 1], {
    extrapolateRight: "clamp",
  });

  const lineScale = spring({
    frame: Math.max(0, frame - 15),
    fps,
    config: { damping: 15, stiffness: 120 },
    from: 0,
    to: 1,
  });

  const glowOpacity = interpolate(frame, [0, 30, 60], [0, 0.6, 0.3]);

  const today = new Date();
  const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #0d0d0d 0%, #111111 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Noto Sans JP', 'Hiragino Sans', sans-serif",
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

      {/* GitHub icon */}
      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          marginBottom: 40,
        }}
      >
        <svg width="130" height="130" viewBox="0 0 24 24" fill="#ffffff">
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
            fontSize: 72,
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
            fontSize: 72,
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
          margin: "32px 0",
        }}
      />

      {/* Subtitle */}
      <div
        style={{
          opacity: subtitleOpacity,
          transform: `translateY(${subtitleY}px)`,
          fontSize: 42,
          fontWeight: 700,
          color: "rgba(255,255,255,0.9)",
          letterSpacing: "2px",
        }}
      >
        今日の注目リポジトリ
      </div>

      {/* Date */}
      <div
        style={{
          opacity: dateOpacity,
          marginTop: 20,
          fontSize: 30,
          color: "rgba(255,255,255,0.5)",
          fontWeight: 400,
        }}
      >
        {dateStr}
      </div>

    </AbsoluteFill>
  );
};
