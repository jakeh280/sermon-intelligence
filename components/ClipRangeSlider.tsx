"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import {
  CLIP_CEIL_SEC,
  CLIP_FLOOR_SEC,
  CLIP_STEP,
  formatDurationSec,
} from "@/lib/clipRange";

export function DualClipRangeSlider({
  clipMinSec,
  clipMaxSec,
  onMinChange,
  onMaxChange,
}: {
  clipMinSec: number;
  clipMaxSec: number;
  onMinChange: (v: number) => void;
  onMaxChange: (v: number) => void;
}) {
  const [activeThumb, setActiveThumb] = useState<"min" | "max" | null>(null);
  const span = CLIP_CEIL_SEC - CLIP_FLOOR_SEC;
  const minPct = ((clipMinSec - CLIP_FLOOR_SEC) / span) * 100;
  const maxPct = ((clipMaxSec - CLIP_FLOOR_SEC) / span) * 100;

  const rangeThumbTw =
    "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:active:cursor-grabbing [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-zinc-950 [&::-webkit-slider-thumb]:bg-[#0B6ED0] [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:active:cursor-grabbing [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-zinc-950 [&::-moz-range-thumb]:bg-[#0B6ED0] [&::-moz-range-thumb]:shadow-md";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-sm text-zinc-300">
        <span className="font-medium tabular-nums text-[#7EB8F0]">
          {formatDurationSec(clipMinSec)}
        </span>
        <span className="text-xs uppercase tracking-[0.14em] text-zinc-400 font-semibold">
          Clip Target Duration
        </span>
        <span className="font-medium tabular-nums text-[#7EB8F0]">
          {formatDurationSec(clipMaxSec)}
        </span>
      </div>
      <div className="relative py-3">
        <div
          className="pointer-events-none absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/5"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[#0B6ED0]/80 shadow-[0_0_12px_rgba(11,110,208,0.4)]"
          style={{
            left: `${minPct}%`,
            width: `${Math.max(0, maxPct - minPct)}%`,
          }}
          aria-hidden
        />
        <input
          type="range"
          min={CLIP_FLOOR_SEC}
          max={CLIP_CEIL_SEC}
          step={CLIP_STEP}
          value={clipMinSec}
          aria-label="Minimum clip length"
          onMouseDown={() => setActiveThumb("min")}
          onMouseUp={() => setActiveThumb(null)}
          onMouseLeave={() => setActiveThumb(null)}
          onTouchStart={() => setActiveThumb("min")}
          onTouchEnd={() => setActiveThumb(null)}
          onChange={(e) => onMinChange(Number(e.target.value))}
          className={[
            "absolute inset-x-0 top-1/2 h-6 w-full -translate-y-1/2 appearance-none bg-transparent",
            "pointer-events-none [&::-moz-range-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:pointer-events-auto",
            rangeThumbTw,
            activeThumb === "min" ? "z-30" : "z-20",
          ].join(" ")}
          style={{ WebkitAppearance: "none" } as CSSProperties}
        />
        <input
          type="range"
          min={CLIP_FLOOR_SEC}
          max={CLIP_CEIL_SEC}
          step={CLIP_STEP}
          value={clipMaxSec}
          aria-label="Maximum clip length"
          onMouseDown={() => setActiveThumb("max")}
          onMouseUp={() => setActiveThumb(null)}
          onMouseLeave={() => setActiveThumb(null)}
          onTouchStart={() => setActiveThumb("max")}
          onTouchEnd={() => setActiveThumb(null)}
          onChange={(e) => onMaxChange(Number(e.target.value))}
          className={[
            "absolute inset-x-0 top-1/2 h-6 w-full -translate-y-1/2 appearance-none bg-transparent",
            "pointer-events-none [&::-moz-range-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:pointer-events-auto",
            rangeThumbTw,
            activeThumb === "max" ? "z-30" : "z-10",
          ].join(" ")}
          style={{ WebkitAppearance: "none" } as CSSProperties}
        />
      </div>
    </div>
  );
}
