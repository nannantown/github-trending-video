import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

interface Props {
  /** "left" or "right" side placement */
  side?: "left" | "right";
  /** delay before entrance in frames */
  delay?: number;
}

/**
 * Anime-style female navigator character (SVG illustration)
 * Stylized minimal design with dark theme accent colors
 */
export const Character: React.FC<Props> = ({
  side = "right",
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = Math.max(0, frame - delay);

  const slideIn = spring({
    frame: f,
    fps,
    config: { damping: 14, stiffness: 80 },
    from: side === "right" ? 120 : -120,
    to: 0,
  });

  const opacity = interpolate(f, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Subtle breathing/idle animation
  const breathe = Math.sin((frame / fps) * 2) * 3;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        [side]: 0,
        opacity,
        transform: `translateX(${slideIn}px)`,
        width: 420,
        height: 700,
        overflow: "hidden",
      }}
    >
      <svg
        viewBox="0 0 420 700"
        width="420"
        height="700"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ transform: `translateY(${breathe}px)` }}
      >
        {/* Hair - long flowing style */}
        <path
          d="M140 80 C140 40, 280 40, 280 80 L290 200 C295 280, 310 350, 320 420 L340 520 C330 530, 310 520, 300 500 L280 400 C270 350, 265 300, 260 250 L255 200 Z"
          fill="#1a1a2e"
          stroke="#2a2a4e"
          strokeWidth="1"
        />
        <path
          d="M160 80 C160 40, 140 40, 140 80 L130 200 C125 280, 110 350, 100 420 L80 520 C90 530, 110 520, 120 500 L140 400 C150 350, 155 300, 160 250 L165 200 Z"
          fill="#1a1a2e"
          stroke="#2a2a4e"
          strokeWidth="1"
        />

        {/* Face */}
        <ellipse cx="210" cy="140" rx="75" ry="85" fill="#fce4d6" />

        {/* Hair bangs (front) */}
        <path
          d="M135 120 C140 60, 200 35, 210 35 C220 35, 280 60, 285 120 L280 105 C275 75, 240 55, 210 55 C180 55, 145 75, 140 105 Z"
          fill="#1a1a2e"
        />
        {/* Side bangs */}
        <path
          d="M135 120 C130 100, 132 80, 148 65 L140 130 Z"
          fill="#1a1a2e"
        />
        <path
          d="M285 120 C290 100, 288 80, 272 65 L280 130 Z"
          fill="#1a1a2e"
        />

        {/* Eyes */}
        <ellipse cx="185" cy="140" rx="18" ry="20" fill="#fff" />
        <ellipse cx="235" cy="140" rx="18" ry="20" fill="#fff" />
        <ellipse cx="188" cy="142" rx="11" ry="13" fill="#4a7dff" />
        <ellipse cx="238" cy="142" rx="11" ry="13" fill="#4a7dff" />
        <ellipse cx="190" cy="138" rx="5" ry="5" fill="#fff" />
        <ellipse cx="240" cy="138" rx="5" ry="5" fill="#fff" />
        <ellipse cx="185" cy="145" rx="3" ry="3" fill="#fff" opacity="0.6" />
        <ellipse cx="235" cy="145" rx="3" ry="3" fill="#fff" opacity="0.6" />
        {/* Pupils */}
        <ellipse cx="188" cy="144" rx="6" ry="7" fill="#1a1a3e" />
        <ellipse cx="238" cy="144" rx="6" ry="7" fill="#1a1a3e" />

        {/* Eyebrows */}
        <path
          d="M168 118 Q185 112, 200 118"
          stroke="#1a1a2e"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M220 118 Q235 112, 252 118"
          stroke="#1a1a2e"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />

        {/* Nose */}
        <path
          d="M208 158 L210 165 L214 162"
          stroke="#e8c4b0"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />

        {/* Mouth - slight smile */}
        <path
          d="M195 178 Q210 190, 225 178"
          stroke="#d4726a"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />

        {/* Blush */}
        <ellipse cx="170" cy="168" rx="14" ry="8" fill="#ffb3b3" opacity="0.35" />
        <ellipse cx="250" cy="168" rx="14" ry="8" fill="#ffb3b3" opacity="0.35" />

        {/* Neck */}
        <path d="M195 220 L195 250 L225 250 L225 220" fill="#fce4d6" />

        {/* Body - fitted top */}
        <path
          d="M160 250 C160 240, 195 235, 210 235 C225 235, 260 240, 260 250 L275 300 L280 380 C280 395, 270 400, 260 400 L160 400 C150 400, 140 395, 140 380 L145 300 Z"
          fill="#2a2a4e"
        />

        {/* Neckline / collar */}
        <path
          d="M185 248 L210 275 L235 248"
          stroke="#fce4d6"
          strokeWidth="2"
          fill="#fce4d6"
          opacity="0.9"
        />

        {/* Chest area detail line */}
        <path
          d="M170 280 Q210 310, 250 280"
          stroke="#3a3a5e"
          strokeWidth="1"
          fill="none"
        />

        {/* Arms */}
        <path
          d="M160 260 L120 340 L115 380 C112 390, 118 395, 125 390 L135 360 L155 300"
          fill="#fce4d6"
          stroke="#e8c4b0"
          strokeWidth="0.5"
        />
        <path
          d="M260 260 L300 340 L305 380 C308 390, 302 395, 295 390 L285 360 L265 300"
          fill="#fce4d6"
          stroke="#e8c4b0"
          strokeWidth="0.5"
        />

        {/* Sleeve details */}
        <path d="M155 255 L130 290" stroke="#3a3a5e" strokeWidth="1" fill="none" />
        <path d="M265 255 L290 290" stroke="#3a3a5e" strokeWidth="1" fill="none" />

        {/* Skirt */}
        <path
          d="M140 395 L120 580 C120 590, 135 590, 140 585 L180 450 L210 400 L240 450 L280 585 C285 590, 300 590, 300 580 L280 395 Z"
          fill="#1e1e3a"
        />

        {/* Skirt fold lines */}
        <path d="M180 410 L155 530" stroke="#2a2a4e" strokeWidth="1" fill="none" />
        <path d="M240 410 L265 530" stroke="#2a2a4e" strokeWidth="1" fill="none" />
        <path d="M210 400 L210 500" stroke="#2a2a4e" strokeWidth="0.8" fill="none" />

        {/* Legs */}
        <path d="M165 570 L160 680 L180 680 L185 575" fill="#fce4d6" />
        <path d="M235 575 L240 680 L260 680 L255 570" fill="#fce4d6" />

        {/* Shoes */}
        <path
          d="M155 675 L150 695 L185 695 L185 680"
          fill="#2a2a4e"
          rx="3"
        />
        <path
          d="M235 680 L235 695 L270 695 L265 675"
          fill="#2a2a4e"
          rx="3"
        />

        {/* Accessory - hair clip with glow */}
        <circle cx="270" cy="95" r="8" fill="#58a6ff" />
        <circle cx="270" cy="95" r="4" fill="#fff" opacity="0.8" />
        <circle cx="270" cy="95" r="14" fill="#58a6ff" opacity="0.2" />

        {/* Belt/waist accent */}
        <rect x="145" y="393" width="130" height="6" rx="3" fill="#58a6ff" opacity="0.6" />
      </svg>
    </div>
  );
};
