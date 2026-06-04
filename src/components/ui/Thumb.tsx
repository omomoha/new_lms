"use client";

/**
 * Thumb — Thumbnail components for courses and cohorts.
 *
 * Exports:
 *   GeneratedThumb  — deterministic SVG art from a string seed (no storage)
 *   EntityThumb     — resolves a Firebase Storage thumbPath to a URL; falls
 *                     back to GeneratedThumb on error or when no path given
 */

import { useEffect, useState } from "react";
import { getResourceUrl } from "@/lib/files";

// ── Brand-adjacent palette used for generated backgrounds ────────────────────
const PALETTE = [
  "#13403A", // ink
  "#2C7A6B", // teal
  "#8FB85C", // moss
  "#456B5E", // mid-ink
  "#7FB069", // light-moss
  "#1C5048", // deep-teal
];

// ── Deterministic hash of a string → unsigned integer ────────────────────────
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0; // keep unsigned 32-bit
  }
  return h;
}

// Pick a value from an array deterministically using a hash + offset
function pick<T>(arr: T[], hash: number, offset: number): T {
  return arr[(hash + offset) % arr.length];
}

// Map a hash byte to a range [min, max]
function mapRange(hash: number, shift: number, min: number, max: number): number {
  return min + ((hash >>> shift) % (max - min + 1));
}

// Extract up to 2 initials from a title string
function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// ── Diamond definition ────────────────────────────────────────────────────────
interface Diamond {
  cx: number;
  cy: number;
  size: number;
  rotation: number;
  opacity: number;
  color: string;
}

function generateDiamonds(hash: number, color2: string): Diamond[] {
  const count = 2 + (hash % 2); // 2 or 3 diamonds
  const diamonds: Diamond[] = [];
  for (let i = 0; i < count; i++) {
    const seed = (hash >>> (i * 7)) ^ (hash << (i * 3));
    diamonds.push({
      cx: mapRange(seed, 0, 10, 90),
      cy: mapRange(seed, 5, 5, 95),
      size: mapRange(seed, 10, 22, 52),
      rotation: mapRange(seed, 15, 20, 70),
      opacity: 0.15 + ((seed % 15) / 100), // 0.15–0.30
      color: i % 2 === 0 ? "#FFFFFF" : color2,
    });
  }
  return diamonds;
}

// ── GeneratedThumb ────────────────────────────────────────────────────────────

export interface GeneratedThumbProps {
  /** Seed string — typically entity ID */
  seed: string;
  /** Title to derive initials from */
  title: string;
  className?: string;
}

export function GeneratedThumb({ seed, title, className = "" }: GeneratedThumbProps) {
  const h = hashStr(seed || title || "default");
  const color1 = pick(PALETTE, h, 0);
  const color2 = pick(PALETTE, h, 2 + (h % 3));
  const diamonds = generateDiamonds(h, color2);
  const letters = initials(title);

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Gradient background */}
      <defs>
        <linearGradient id={`tg-${h}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={color1} />
          <stop offset="100%" stopColor={color2} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#tg-${h})`} />

      {/* Rotated-square diamonds */}
      {diamonds.map((d, i) => (
        <rect
          key={i}
          x={d.cx - d.size / 2}
          y={d.cy - d.size / 2}
          width={d.size}
          height={d.size}
          fill={d.color}
          opacity={d.opacity}
          transform={`rotate(${d.rotation} ${d.cx} ${d.cy})`}
        />
      ))}

      {/* Initials */}
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="28"
        fontWeight="600"
        fill="white"
        opacity="0.72"
      >
        {letters}
      </text>
    </svg>
  );
}

// ── EntityThumb ───────────────────────────────────────────────────────────────

export interface EntityThumbProps {
  /** Firebase Storage path to the uploaded thumbnail, if any */
  thumbPath?: string;
  /** Fallback seed for GeneratedThumb (typically entity ID) */
  seed: string;
  /** Entity title for initials */
  title: string;
  className?: string;
}

export function EntityThumb({ thumbPath, seed, title, className = "" }: EntityThumbProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!thumbPath) return;
    let cancelled = false;
    setFailed(false);
    setUrl(null);
    getResourceUrl(thumbPath)
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [thumbPath]);

  if (thumbPath && url && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={title}
        className={className}
        style={{ objectFit: "cover", width: "100%", height: "100%" }}
        onError={() => setFailed(true)}
      />
    );
  }

  return <GeneratedThumb seed={seed} title={title} className={className} />;
}
