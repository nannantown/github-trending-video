import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useVideoConfig,
} from "remotion";
import { Project } from "../data";

interface Props {
  project: Project;
  localFrame: number;
}

const languageColors: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Go: "#00ADD8",
  Rust: "#dea584",
  Java: "#b07219",
  "C++": "#f34b7d",
  C: "#555555",
  Ruby: "#701516",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Dart: "#00B4AB",
  Markdown: "#083fa1",
  default: "#8b949e",
};

function formatStars(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return n.toString();
}

export const ProjectCard: React.FC<Props> = ({ project, localFrame }) => {
  const { fps } = useVideoConfig();

  // --- Animations ---

  // Rank badge pop in
  const rankScale = spring({
    frame: localFrame,
    fps,
    config: { damping: 10, stiffness: 200 },
    from: 0,
    to: 1,
  });

  // Card slide up
  const cardY = spring({
    frame: Math.max(0, localFrame - 8),
    fps,
    config: { damping: 14, stiffness: 90 },
    from: 100,
    to: 0,
  });
  const cardOpacity = interpolate(localFrame, [8, 25], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Repo name reveal
  const nameOpacity = interpolate(localFrame, [15, 30], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Short description
  const descOpacity = interpolate(localFrame, [30, 50], [0, 1], {
    extrapolateRight: "clamp",
  });
  const descY = spring({
    frame: Math.max(0, localFrame - 30),
    fps,
    config: { damping: 12, stiffness: 80 },
    from: 20,
    to: 0,
  });

  // Detail text (longer description) - reveals after short desc
  const detailOpacity = interpolate(localFrame, [60, 90], [0, 1], {
    extrapolateRight: "clamp",
  });
  const detailY = spring({
    frame: Math.max(0, localFrame - 60),
    fps,
    config: { damping: 14, stiffness: 70 },
    from: 25,
    to: 0,
  });

  // Stars count up
  const starsProgress = interpolate(localFrame, [25, 100], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const displayStars = Math.floor(starsProgress * project.stars);

  // Today stars pop
  const todayOpacity = interpolate(localFrame, [100, 120], [0, 1], {
    extrapolateRight: "clamp",
  });
  const todayScale = spring({
    frame: Math.max(0, localFrame - 100),
    fps,
    config: { damping: 8, stiffness: 200 },
    from: 0.5,
    to: 1,
  });

  // Language tag
  const langOpacity = interpolate(localFrame, [40, 55], [0, 1], {
    extrapolateRight: "clamp",
  });

  const langColor =
    languageColors[project.language || "default"] || languageColors.default;

  // Background glow pulse
  const glowOpacity = interpolate(
    localFrame % 120,
    [0, 60, 120],
    [0.15, 0.3, 0.15]
  );

  return (
    <AbsoluteFill
      style={{
        background: "#0d0d0d",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Noto Sans JP', 'Hiragino Sans', sans-serif",
        padding: "0 56px",
      }}
    >
      {/* Background accent glow */}
      <div
        style={{
          position: "absolute",
          top: "35%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 700,
          height: 700,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${langColor}22 0%, transparent 60%)`,
          opacity: glowOpacity,
        }}
      />

      {/* Rank badge */}
      <div
        style={{
          transform: `scale(${rankScale})`,
          marginBottom: 32,
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${langColor}dd, ${langColor}77)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 36,
            fontWeight: 900,
            color: "#fff",
            boxShadow: `0 0 30px ${langColor}44`,
          }}
        >
          #{project.rank}
        </div>
      </div>

      {/* Main card */}
      <div
        style={{
          opacity: cardOpacity,
          transform: `translateY(${cardY}px)`,
          width: "100%",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 28,
          padding: "40px 44px",
        }}
      >
        {/* Owner / Repo name */}
        <div style={{ opacity: nameOpacity, marginBottom: 16 }}>
          <div
            style={{
              fontSize: 24,
              color: "rgba(255,255,255,0.4)",
              fontWeight: 400,
              marginBottom: 8,
              letterSpacing: "0.5px",
            }}
          >
            {project.fullName.split("/")[0]} /
          </div>
          <div
            style={{
              fontSize: 54,
              fontWeight: 800,
              color: "#ffffff",
              letterSpacing: "-1px",
              lineHeight: 1.15,
            }}
          >
            {project.name}
          </div>
        </div>

        {/* Language tag */}
        <div
          style={{
            opacity: langOpacity,
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 24,
          }}
        >
          {project.language && (
            <>
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: langColor,
                }}
              />
              <span
                style={{
                  fontSize: 24,
                  color: "rgba(255,255,255,0.55)",
                  fontWeight: 500,
                }}
              >
                {project.language}
              </span>
            </>
          )}
        </div>

        {/* Short description */}
        <div
          style={{
            opacity: descOpacity,
            transform: `translateY(${descY}px)`,
            fontSize: 34,
            fontWeight: 600,
            color: "rgba(255,255,255,0.85)",
            lineHeight: 1.4,
            marginBottom: 20,
          }}
        >
          {project.description}
        </div>

        {/* Detailed description */}
        <div
          style={{
            opacity: detailOpacity,
            transform: `translateY(${detailY}px)`,
            fontSize: 27,
            fontWeight: 400,
            color: "rgba(255,255,255,0.55)",
            lineHeight: 1.6,
            marginBottom: 36,
          }}
        >
          {project.detail}
        </div>

        {/* Divider */}
        <div
          style={{
            width: "100%",
            height: 1,
            background: "rgba(255,255,255,0.06)",
            marginBottom: 28,
          }}
        />

        {/* Stats row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
          }}
        >
          {/* Stars */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <svg width="34" height="34" viewBox="0 0 16 16" fill="#e3b341">
              <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
            </svg>
            <span
              style={{
                fontSize: 44,
                fontWeight: 800,
                color: "#e3b341",
                fontVariantNumeric: "tabular-nums",
                minWidth: 130,
              }}
            >
              {formatStars(displayStars)}
            </span>
          </div>

          {/* Today stars */}
          <div
            style={{
              opacity: todayOpacity,
              transform: `scale(${todayScale})`,
              background: "rgba(88, 166, 255, 0.12)",
              border: "1px solid rgba(88, 166, 255, 0.25)",
              borderRadius: 100,
              padding: "10px 24px",
              fontSize: 26,
              fontWeight: 700,
              color: "#58a6ff",
              whiteSpace: "nowrap",
            }}
          >
            +{project.todayStars.toLocaleString()} today
          </div>
        </div>
      </div>

      {/* Progress indicator (bottom) */}
      <div
        style={{
          position: "absolute",
          bottom: 100,
          display: "flex",
          gap: 10,
        }}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <div
            key={n}
            style={{
              width: n === project.rank ? 40 : 14,
              height: 14,
              borderRadius: 7,
              background:
                n === project.rank
                  ? "#58a6ff"
                  : n < project.rank
                    ? "rgba(88, 166, 255, 0.3)"
                    : "rgba(255,255,255,0.15)",
              transition: "all 0.3s ease",
            }}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};
