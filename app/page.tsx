"use client";

import {
  Camera,
  Check,
  CirclePlay,
  Copy,
  Eye,
  EyeOff,
  History,
  Info,
  Loader2,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import type { ComponentProps, CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  CLIP_CEIL_SEC,
  CLIP_FLOOR_SEC,
  CLIP_STEP,
  formatDurationSec,
  snapClipSec,
} from "@/lib/clipRange";
import { type HistoryItem } from "@/lib/history";
import {
  clearStoredHistory,
  createHistoryId,
  historyStorage,
  readHistory,
  writeHistory,
} from "@/lib/historyStorage";
import {
  isClipsSectionTitle,
  isTitlesSectionTitle,
  parseBentoSections,
  parseClipOptions,
} from "@/lib/outputParsing";
import { describeOutputIssues, type OutputIssue } from "@/lib/outputHealth";
import {
  describeRequestFailure,
  STALL_TIMEOUT_MS,
  StalledResponseError,
} from "@/lib/requestErrors";
import { hasTimestampTags, normalizeTranscript } from "@/lib/transcript";
import { DEMO_ATTRIBUTION, DEMO_LABEL, DEMO_OUTPUT } from "@/lib/demoContent";
import {
  ACCEPTED_EXTENSIONS_LABEL,
  decodeTranscriptBytes,
  describeFileProblem,
  describeTranscriptProblem,
} from "@/lib/transcriptInput";

// lucide-react dropped brand/logo icons (Github, Twitter, etc.) from its
// exports, so the GitHub mark is inlined here instead of imported.
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.333-1.755-1.333-1.755-1.089-.744.083-.729.083-.729 1.205.084 1.84 1.236 1.84 1.236 1.07 1.835 2.807 1.305 3.492.998.108-.775.42-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

// Brand accent, used for FILLS (buttons, slider thumb, glows) where white text
// sits on top and contrast already passes comfortably.
const ACCENT = "#0B6ED0";
// For accent-coloured TEXT on the dark background, use #3B93E8 instead. ACCENT
// as text measures 3.79:1, under the WCAG 4.5:1 minimum; #3B93E8 measures 5.96:1.
// It appears as a literal in Tailwind classes rather than a constant, because
// arbitrary values have to be statically visible to the Tailwind compiler.
const COMMUNITY_DISCLAIMER =
  "Sermon Intelligence is a free community tool. During times of high demand, processing may be temporarily limited to keep it free for everyone.";

const AI_LIMIT_NOTICE =
  "We have hit our free limit for the hour. Please try again in a few minutes.";

const FULL_COPY_ATTRIBUTION =
  "Generated with [sermonintelligence.com](https://sermonintelligence.com/)";

function isAiLimitHttpStatus(status: number) {
  return status === 429 || status === 504;
}

function aiLimitError(): Error & { isAiLimit: true } {
  const err = new Error(AI_LIMIT_NOTICE) as Error & { isAiLimit: true };
  err.isAiLimit = true;
  return err;
}

function isAiLimitError(e: unknown): e is Error & { isAiLimit: true } {
  return (
    typeof e === "object" &&
    e !== null &&
    "isAiLimit" in e &&
    (e as { isAiLimit?: boolean }).isAiLimit === true
  );
}

const markdownComponents: NonNullable<
  ComponentProps<typeof ReactMarkdown>["components"]
> = {
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      className="font-medium underline decoration-[#0B6ED0]/50 underline-offset-2 transition-colors hover:text-[#3B93E8]"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
  p: ({ children, ...props }) => (
    <p className="mb-3 text-base leading-7 text-zinc-300 last:mb-0" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    <ul
      className="mb-3 list-disc space-y-1.5 pl-5 text-base leading-7 text-zinc-300 last:mb-0"
      {...props}
    >
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol
      className="mb-3 list-decimal space-y-1.5 pl-5 text-base leading-7 text-zinc-300 last:mb-0"
      {...props}
    >
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="leading-relaxed [&>p]:mb-0" {...props}>
      {children}
    </li>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-zinc-100" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="text-zinc-200" {...props}>
      {children}
    </em>
  ),
  h1: ({ children, ...props }) => (
    <h4 className="mb-2 text-base font-semibold text-white" {...props}>
      {children}
    </h4>
  ),
  h2: ({ children, ...props }) => (
    <h4 className="mb-2 text-base font-semibold text-white" {...props}>
      {children}
    </h4>
  ),
  h3: ({ children, ...props }) => (
    <h4 className="mb-2 mt-4 text-sm font-semibold text-zinc-100 first:mt-0" {...props}>
      {children}
    </h4>
  ),
  h4: ({ children, ...props }) => (
    <h4 className="mb-2 text-sm font-semibold text-zinc-200" {...props}>
      {children}
    </h4>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="mb-3 border-l-2 border-[#0B6ED0]/60 pl-3 text-base italic leading-7 text-zinc-400"
      {...props}
    >
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-zinc-700/80" />,
  code: ({ className, children, ...props }) => {
    const inline = !className;
    if (inline) {
      return (
        <code
          className="rounded bg-zinc-800/90 px-1.5 py-0.5 font-mono text-[0.8125rem] text-[#7EB8F0]"
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children, ...props }) => (
    <pre
      className="mb-3 overflow-x-auto rounded-lg border border-zinc-800 bg-black/40 p-3 text-xs text-zinc-300 last:mb-0"
      {...props}
    >
      {children}
    </pre>
  ),
  table: ({ children, ...props }) => (
    <div className="mb-3 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-left text-sm text-zinc-300" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => (
    <thead className="border-b border-zinc-700 bg-zinc-900/80" {...props}>
      {children}
    </thead>
  ),
  th: ({ children, ...props }) => (
    <th className="px-3 py-2 font-semibold text-zinc-100" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="border-b border-zinc-800/80 px-3 py-2 align-top" {...props}>
      {children}
    </td>
  ),
};

function BentoCard({
  title,
  body,
  streaming,
  className,
}: {
  title: string;
  body: string;
  streaming: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!body) return;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy", err);
    }
  };

  return (
    <article
      className={`flex min-h-[8rem] flex-col rounded-xl border border-white/5 bg-zinc-900/40 p-5 shadow-2xl backdrop-blur-xl transition-all hover:border-white/10 hover:shadow-indigo-500/5 animate-in fade-in slide-in-from-bottom-2 duration-500 ${className || ""}`}
    >
      <header className="mb-3 flex items-start justify-between gap-3 border-b border-white/5 pb-3">
        <h2 className="text-sm font-semibold tracking-tight text-white/90">
          <span
            className="mr-2 inline-block h-2 w-2 shrink-0 rounded-full align-middle shadow-[0_0_8px_rgba(11,110,208,0.5)]"
            style={{ backgroundColor: ACCENT }}
            aria-hidden
          />
          {title}
        </h2>
        <div className="flex items-center gap-3">
          {streaming && !body && (
            <span className="shrink-0 text-xs text-zinc-400 animate-pulse">Typing…</span>
          )}
          {body && !streaming && (
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
              title="Copy section"
            >
              {copied ? (
                <Check className="size-3 text-emerald-400" aria-hidden />
              ) : (
                <Copy className="size-3" aria-hidden />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>
      </header>
      <div className="min-w-0 flex-1 whitespace-pre-wrap text-zinc-300">
        {body ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {body}
          </ReactMarkdown>
        ) : streaming ? (
          <div className="space-y-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-white/5" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-white/5" />
          </div>
        ) : null}
      </div>
    </article>
  );
}

function TitlesBentoCard({
  title,
  body,
  streaming,
  className,
}: {
  title: string;
  body: string;
  streaming: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!body) return;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy", err);
    }
  };

  const titleMarkdownComponents: NonNullable<ComponentProps<typeof ReactMarkdown>["components"]> = {
    ...markdownComponents,
    ol: ({ children, ...props }) => (
      <ol className="flex flex-col md:flex-row gap-4 w-full list-none" {...props}>
        {children}
      </ol>
    ),
    ul: ({ children, ...props }) => (
      <ul className="flex flex-col md:flex-row gap-4 w-full list-none" {...props}>
        {children}
      </ul>
    ),
    li: ({ children, ...props }) => (
      <li className="flex-1 rounded-2xl bg-black/20 border border-white/5 p-4 text-center text-sm font-semibold text-white shadow-lg list-none flex items-center justify-center [&>p]:mb-0 [&>p]:flex-1" {...props}>
        {children}
      </li>
    ),
  };

  return (
    <article
      className={`flex min-h-[8rem] flex-col rounded-xl border border-white/5 bg-zinc-900/40 p-6 shadow-2xl backdrop-blur-xl transition-all hover:border-white/10 hover:shadow-indigo-500/5 animate-in fade-in slide-in-from-bottom-2 duration-500 ${className || ""}`}
    >
      <header className="mb-4 flex items-start justify-between gap-3 border-b border-white/5 pb-4">
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-white/95 sm:text-2xl">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_12px_rgba(11,110,208,0.6)]"
            style={{ backgroundColor: ACCENT }}
            aria-hidden
          />
          {title}
        </h2>
        <div className="flex items-center gap-3">
          {streaming && !body && (
            <span className="shrink-0 text-xs text-zinc-400 animate-pulse">Typing…</span>
          )}
          {body && !streaming && (
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
              title="Copy section"
            >
              {copied ? (
                <Check className="size-3 text-emerald-400" aria-hidden />
              ) : (
                <Copy className="size-3" aria-hidden />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>
      </header>
      <div className="min-w-0 flex-1 whitespace-pre-wrap text-zinc-300 w-full">
        {body ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={titleMarkdownComponents}>
            {body}
          </ReactMarkdown>
        ) : streaming ? (
          <div className="flex flex-col md:flex-row gap-4 w-full">
            <div className="h-20 flex-1 animate-pulse rounded-2xl bg-white/5" />
            <div className="h-20 flex-1 animate-pulse rounded-2xl bg-white/5" />
            <div className="h-20 flex-1 animate-pulse rounded-2xl bg-white/5" />
          </div>
        ) : null}
      </div>
    </article>
  );
}

function DualClipRangeSlider({
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

function ClipsBentoCard({
  title,
  body,
  streaming,
  className,
}: {
  title: string;
  body: string;
  streaming: boolean;
  className?: string;
}) {
  const { preamble, clips } = useMemo(() => parseClipOptions(body), [body]);
  const clipsLookStructured = clips.some(
    (c) =>
      Boolean(
        c.Title ||
        c.Timestamps ||
        c.Transcript ||
        c.Description ||
        c.Duration,
      ),
  );
  const showClipGrid = clips.length > 0 && clipsLookStructured;

  return (
    <article
      className={`flex min-h-[8rem] flex-col rounded-xl border border-white/5 bg-zinc-900/40 p-6 shadow-2xl backdrop-blur-xl transition-all hover:border-white/10 animate-in fade-in slide-in-from-bottom-4 duration-700 ${className || ""}`}
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-white/5 pb-4">
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-white/95 sm:text-2xl">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_12px_rgba(11,110,208,0.6)]"
            style={{ backgroundColor: ACCENT }}
            aria-hidden
          />
          {title}
        </h2>
        {streaming && !body && (
          <span className="shrink-0 text-xs text-zinc-400 animate-pulse">Typing…</span>
        )}
      </header>

      {preamble ? (
        <p className="mb-6 max-w-3xl text-base leading-7 text-zinc-400">{preamble}</p>
      ) : null}

      {showClipGrid ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {clips.map((clip, i) => (
            <div
              key={`${clip.optionLabel}-${i}`}
              className="flex flex-col rounded-xl border border-white/5 bg-black/20 p-5 transition-transform hover:scale-[1.02] hover:bg-black/30"
            >
              <div className="mb-3 flex flex-col gap-2 border-b border-white/5 pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  {clip.Duration ? (
                    <span className="text-xs font-semibold tabular-nums tracking-widest text-zinc-400">
                      {clip.Duration}
                    </span>
                  ) : null}
                </div>
                {clip.Timestamps ? (
                  <p className="font-mono text-xs font-semibold tracking-tighter text-[#5A9FE8]">
                    {clip.Timestamps}
                  </p>
                ) : null}
                {clip.Title ? (
                  <h3 className="text-base font-semibold leading-tight text-white/90">
                    {clip.Title}
                  </h3>
                ) : null}
              </div>
              {clip.Transcript ? (
                <blockquote className="mb-4 grow border-l-2 border-[#0B6ED0]/30 pl-3 text-base italic leading-7 text-zinc-400">
                  {clip.Transcript}
                </blockquote>
              ) : null}
              {clip.Description ? (
                <p className="mb-3 text-base leading-7 text-zinc-300">
                  {clip.Description}
                </p>
              ) : null}
              {clip["Why it works"] ? (
                <p className="mt-auto text-base leading-7 text-zinc-400 italic">
                  <span className="font-semibold text-zinc-400">
                    Why it works:{" "}
                  </span>
                  {clip["Why it works"]}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="min-w-0 flex-1 whitespace-pre-wrap text-zinc-300">
          {body ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {body}
            </ReactMarkdown>
          ) : streaming ? (
            <div className="flex flex-col gap-2">
              <div className="h-4 w-full animate-pulse rounded bg-white/5" />
              <div className="h-4 w-5/6 animate-pulse rounded bg-white/5" />
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}

function PromoCard({ className }: { className?: string } = {}) {
  return (
    <article
      className={`relative overflow-hidden rounded-xl border border-white/5 bg-gradient-to-br from-zinc-900/80 via-zinc-900/40 to-[#0B6ED0]/10 p-6 shadow-2xl backdrop-blur-xl transition-all hover:border-white/10 group ${className || ""}`}
    >
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-25 blur-3xl transition-transform group-hover:scale-125"
        style={{ backgroundColor: ACCENT }}
        aria-hidden
      />
      <div className="relative">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#7EB8F0]/80">
          Overflow Creative
        </p>
        <p className="mt-2 max-w-xl text-lg font-bold tracking-tight text-white sm:text-2xl">
          Elevate Your Church Video Production
        </p>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          The complete masterclass for creators building the next generation of sermon content.
        </p>
        <Link
          href="https://overflowcreative.net/betterchurchvideo"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#0B6ED0] px-5 py-2 text-xs font-bold text-white transition-all hover:bg-[#3d8fe8] hover:shadow-[0_0_15px_rgba(11,110,208,0.4)]"
        >
          Explore the Course
          <span aria-hidden className="transition-transform group-hover:translate-x-1">→</span>
        </Link>
      </div>
    </article>
  );
}

function HistoryModal({
  items,
  onSelect,
  onDelete,
  onClear,
  onClose,
}: {
  items: HistoryItem[];
  onSelect: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="relative w-full max-w-md bg-zinc-950 border border-white/10 rounded-2xl shadow-3xl overflow-hidden animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between p-4 border-b border-white/5">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <History className="size-4" />
            Recent Generations
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-white/5 rounded-lg transition-colors cursor-pointer">
            <X className="size-5 text-zinc-400" />
          </button>
        </header>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {items.length === 0 ? (
            <div className="py-12 text-center">
              <History className="size-10 text-zinc-800 mx-auto mb-3" />
              <p className="text-sm text-zinc-400">No history yet.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="group flex items-center justify-between gap-3 p-3 rounded-xl hover:bg-white/5 transition-all text-left"
                >
                  <button
                    onClick={() => onSelect(item)}
                    className="flex-1 min-w-0 cursor-pointer text-left"
                  >
                    <p className="text-sm font-semibold text-white truncate group-hover:text-[#7EB8F0] transition-colors text-left">
                      {item.label}
                    </p>
                    <p className="text-xs text-zinc-400 font-mono text-left">
                      {new Date(item.timestamp).toLocaleString()} • {formatDurationSec(item.clipMinSec)}-{formatDurationSec(item.clipMaxSec)}
                    </p>
                  </button>
                  <button
                    onClick={() => onDelete(item.id)}
                    className="p-2 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all cursor-pointer"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <footer className="p-3 border-t border-white/5">
            <button
              onClick={onClear}
              className="w-full py-2 text-xs font-bold text-red-500/80 hover:text-red-400 hover:bg-red-500/5 rounded-lg transition-all cursor-pointer"
            >
              Clear All History
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const strategyOutputRef = useRef<HTMLDivElement>(null);
  const [inputMode, setInputMode] = useState<"upload" | "paste">("upload");
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploadedText, setUploadedText] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [clipMinSec, setClipMinSec] = useState(15);
  const [clipMaxSec, setClipMaxSec] = useState(120);
  const [processingLabel, setProcessingLabel] = useState("");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [limitNotice, setLimitNotice] = useState(false);
  const [outputIssues, setOutputIssues] = useState<OutputIssue[]>([]);
  const [copied, setCopied] = useState(false);

  const [history, setHistory] = useState<HistoryItem[]>(() =>
    readHistory(historyStorage()),
  );
  const [showHistory, setShowHistory] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [isDemo, setIsDemo] = useState(false);

  // Save history helper. Storage can refuse the write (private browsing, quota),
  // so state follows whatever actually persisted rather than assuming it stuck.
  const saveToHistory = useCallback((label: string, text: string, min: number, max: number) => {
    const newItem: HistoryItem = {
      id: createHistoryId(),
      timestamp: Date.now(),
      label,
      output: text,
      clipMinSec: min,
      clipMaxSec: max,
    };
    setHistory((prev) => writeHistory(historyStorage(), [newItem, ...prev]));
  }, []);

  const deleteHistoryItem = (id: string) => {
    setHistory((prev) =>
      writeHistory(
        historyStorage(),
        prev.filter((i) => i.id !== id),
      ),
    );
  };

  const clearHistory = () => {
    setHistory([]);
    clearStoredHistory(historyStorage());
  };

  const loadFromHistory = (item: HistoryItem) => {
    // Same race as viewDemo(): the History button lives in the header,
    // outside the block that hides while a generation streams, so without
    // this guard the in-flight stream's own setOutput calls would overwrite
    // the loaded history item moments after it appears.
    if (status === "loading") return;
    setOutput(item.output);
    setClipMinSec(item.clipMinSec);
    setClipMaxSec(item.clipMaxSec);
    setProcessingLabel(item.label);
    setShowHistory(false);
    setIsDemo(false);

    // Entries saved before empty responses were rejected can still be blank, and
    // a blank one renders no cards at all. Say so rather than showing an empty page.
    const issues = describeOutputIssues(item.output);
    const empty = issues.find((issue) => issue.code === "empty");
    setStatus(empty ? "error" : "idle");
    setErrorMessage(empty ? empty.message : null);
    setOutputIssues(empty ? [] : issues);
  };

  const sections = useMemo(() => parseBentoSections(output), [output]);

  const applyClipMin = useCallback((raw: number) => {
    const v = snapClipSec(raw);
    setClipMinSec(v);
    setClipMaxSec((m) => (m < v ? v : m));
  }, []);

  const applyClipMax = useCallback((raw: number) => {
    const v = snapClipSec(raw);
    setClipMaxSec(v);
    setClipMinSec((m) => (m > v ? v : m));
  }, []);

  const streamChatResponse = useCallback(
    async (text: string, minSec: number, maxSec: number): Promise<string> => {
      // Nothing else bounds this request from the client's side. Without a stall
      // guard a dropped connection leaves the spinner running with no way out.
      const controller = new AbortController();
      let stalled = false;
      let stallTimer = 0;
      const armStallTimer = () => {
        window.clearTimeout(stallTimer);
        stallTimer = window.setTimeout(() => {
          stalled = true;
          controller.abort();
        }, STALL_TIMEOUT_MS);
      };

      armStallTimer();

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            clipMinSec: minSec,
            clipMaxSec: maxSec,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          if (isAiLimitHttpStatus(res.status)) {
            throw aiLimitError();
          }
          let detail = res.statusText;
          try {
            const err = (await res.json()) as { error?: string };
            if (err.error) detail = err.error;
          } catch { /* ignore */ }
          throw new Error(detail || "Request failed");
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          // Each chunk re-arms the timer, so a long but healthy generation is
          // never cut off. Only silence counts against it.
          armStallTimer();
          accumulated += decoder.decode(value, { stream: true });
          setOutput(accumulated);
        }

        accumulated += decoder.decode();
        setOutput(accumulated);
        return accumulated;
      } catch (e) {
        if (stalled) throw new StalledResponseError();
        throw e;
      } finally {
        window.clearTimeout(stallTimer);
      }
    },
    [],
  );

  const runWithText = useCallback(
    async (
      text: string,
      label: string,
      minSec: number,
      maxSec: number,
    ) => {
      setProcessingLabel(label);
      setOutput("");
      setErrorMessage(null);
      setLimitNotice(false);
      setOutputIssues([]);
      setStatus("loading");
      setIsDemo(false);

      try {
        const result = await streamChatResponse(text, minSec, maxSec);

        // The response headers arrive before the model emits a single token, so
        // a 200 is no promise of usable content. Inspect what actually streamed.
        const issues = describeOutputIssues(result);
        const empty = issues.find((issue) => issue.code === "empty");
        if (empty) {
          setOutput("");
          setStatus("error");
          setErrorMessage(empty.message);
          return;
        }

        saveToHistory(label, result, minSec, maxSec);
        setOutputIssues(issues);
        setLimitNotice(false);
        setStatus("idle");
      } catch (e) {
        if (isAiLimitError(e)) {
          setLimitNotice(true);
          setErrorMessage(null);
          setStatus("idle");
          return;
        }
        setStatus("error");
        setErrorMessage(describeRequestFailure(e));
      }
    },
    [saveToHistory, streamChatResponse],
  );

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      const file = list[0];
      if (!file) return;

      const fileProblem = describeFileProblem(file);
      if (fileProblem) {
        setStatus("error");
        setErrorMessage(fileProblem);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        // Read as bytes rather than text so a byte order mark can pick the
        // encoding. Windows transcript exports are still often UTF-16.
        const buffer =
          reader.result instanceof ArrayBuffer ? reader.result : new ArrayBuffer(0);
        const text = decodeTranscriptBytes(new Uint8Array(buffer));

        const textProblem = describeTranscriptProblem(text, "upload");
        if (textProblem) {
          setFileName(null);
          setUploadedText("");
          setStatus("error");
          setErrorMessage(textProblem);
          return;
        }

        setFileName(file.name);
        setUploadedText(text);
        setErrorMessage(null);
        setStatus("idle");
      };
      reader.onerror = () => {
        setStatus("error");
        setErrorMessage("Could not read that file.");
      };
      reader.readAsArrayBuffer(file);
    },
    [],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const copyOutput = useCallback(async () => {
    if (!output.trim()) return;
    try {
      await navigator.clipboard.writeText(
        `${output.trimEnd()}\n\n${FULL_COPY_ATTRIBUTION}`,
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setErrorMessage("Could not copy to clipboard.");
      setStatus("error");
    }
  }, [output]);

  const analyzeAnotherSermon = useCallback(() => {
    setOutput("");
    setProcessingLabel("");
    setFileName(null);
    setUploadedText("");
    setPastedText("");
    setErrorMessage(null);
    setLimitNotice(false);
    setOutputIssues([]);
    setStatus("idle");
    setCopied(false);
    setIsDemo(false);
    if (inputRef.current) inputRef.current.value = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Loads the frozen demo output directly, with no request and no rate limit
  // spent: DEMO_OUTPUT is a real, previously generated and hand verified
  // result (see lib/demoContent.ts), not something regenerated per view.
  const viewDemo = useCallback(() => {
    // The "View Demo" button lives in the header, outside the
    // `status !== "loading"` block that hides Generate mid-stream, so it stays
    // clickable during a real generation. Bailing here (same guard
    // handleGenerate uses) avoids a race where the in-flight stream's own
    // setOutput calls overwrite the demo a moment after it appears.
    if (status === "loading") return;
    setOutput(DEMO_OUTPUT);
    setProcessingLabel(DEMO_LABEL);
    setFileName(null);
    setUploadedText("");
    setPastedText("");
    setErrorMessage(null);
    setLimitNotice(false);
    setOutputIssues([]);
    setStatus("idle");
    setCopied(false);
    setIsDemo(true);
    // No scroll call here: the button sits at the very top of the page, so
    // scrolling to 0 (the pattern used elsewhere) is a no-op when already
    // there, and the results div doesn't exist in the DOM until this state
    // change commits. See the isDemo effect below instead.
  }, [status]);

  // Runs after the results div above has actually committed to the DOM
  // (unlike requestAnimationFrame, a passive effect isn't tied to the
  // browser's own paint/compositor loop, so it isn't at risk of being
  // throttled in a backgrounded or non-visible tab). Only viewDemo sets
  // isDemo to true, so this only fires for that transition, not for a
  // normal generate or a history load. Deliberately not "smooth": the
  // button lives far from the results, and an instant jump is the more
  // reliable way to make sure the click visibly did something.
  useEffect(() => {
    if (isDemo) {
      strategyOutputRef.current?.scrollIntoView({ block: "start" });
    }
  }, [isDemo]);

  const handleGenerate = useCallback(async () => {
    if (status === "loading") return;

    setLimitNotice(false);

    const minSec = clipMinSec;
    const maxSec = clipMaxSec;

    const text = inputMode === "paste" ? pastedText : uploadedText;
    const trimmed = text.trim();
    const problem =
      inputMode === "upload" && !fileName
        ? `Please upload a ${ACCEPTED_EXTENSIONS_LABEL} file before generating.`
        : describeTranscriptProblem(trimmed, inputMode);
    if (problem) {
      setStatus("error");
      setErrorMessage(problem);
      if (inputMode === "paste") {
        document.getElementById("paste-input")?.focus();
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      return;
    }
    const label =
      inputMode === "upload"
        ? fileName ?? "File Upload"
        : `Pasted Text (${pastedText.trim().split(/\s+/).length} words)`;
    void runWithText(normalizeTranscript(trimmed), label, minSec, maxSec);
  }, [
    clipMaxSec,
    clipMinSec,
    fileName,
    inputMode,
    pastedText,
    runWithText,
    status,
    uploadedText,
  ]);

  const showBento = output.trim().length > 0 || status === "loading";
  const streaming = status === "loading";

  // Warn before generating, not after: a transcript with no timing at all
  // (e.g. a "whole text" export) still produces a result, just one where
  // Chapters and Clips can't report real times. Checked against the same
  // normalized text handleGenerate() would send.
  const currentText = inputMode === "paste" ? pastedText : uploadedText;
  const missingTimestamps = useMemo(() => {
    const trimmed = currentText.trim();
    if (!trimmed) return false;
    return !hasTimestampTags(normalizeTranscript(trimmed));
  }, [currentText]);

  return (
    <main className="flex min-h-full flex-col bg-zinc-950 text-zinc-100 font-sans selection:bg-[#0B6ED0]/30 selection:text-white">
      {/* Background Glow */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-[15%] -left-[10%] w-[50%] h-[50%] bg-[#0B6ED0]/10 rounded-full blur-[120px]" />
        <div className="absolute top-[20%] -right-[10%] w-[40%] h-[40%] bg-indigo-600/5 rounded-full blur-[100px]" />
      </div>

      <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 pb-16 pt-12 sm:pt-16 lg:px-8">
        <header className="mb-12 lg:mb-16">
          <div className="flex items-center justify-between mb-4">
            <a
              href="https://overflowcreative.net"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#3B93E8] transition-colors hover:text-white"
            >
              Overflow Creative
              <span className="h-px w-6 bg-[#0B6ED0]/40 transition-all group-hover:w-12 group-hover:bg-[#0B6ED0]" />
            </a>

            <div className="flex items-center gap-2">
              <button
                onClick={isDemo ? analyzeAnotherSermon : viewDemo}
                aria-pressed={isDemo}
                className={[
                  "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer",
                  isDemo
                    ? "bg-[#0B6ED0] border border-[#0B6ED0] text-white shadow-lg shadow-indigo-500/20 hover:bg-[#3d8fe8]"
                    : "bg-[#0B6ED0]/10 border border-[#0B6ED0]/20 text-[#7DBEF7] hover:bg-[#0B6ED0]/20 hover:text-white",
                ].join(" ")}
              >
                {isDemo ? (
                  <>
                    <EyeOff className="size-3.5" />
                    Hide Demo
                  </>
                ) : (
                  <>
                    <Eye className="size-3.5" />
                    View Demo
                  </>
                )}
              </button>
              <button
                onClick={() => setShowHistory(true)}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/5 text-xs font-semibold text-zinc-400 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
              >
                <History className="size-3.5" />
                History
              </button>
            </div>
          </div>

          <h1 className="text-5xl font-extrabold tracking-tight text-white sm:text-6xl">
            Sermon Intelligence
          </h1>

          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/5 px-3.5 py-1.5 text-xs font-semibold text-amber-300/80">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400/70" />
            Early access, still in development.{" "}
            <a
              href="https://tally.so/r/VL14Rg"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-amber-400/30 underline-offset-2 hover:text-amber-200 transition-colors"
            >
              Send me feedback
            </a>
          </div>

          <p className="mt-6 max-w-2xl text-base leading-relaxed text-zinc-400 font-medium">
            Generate a description, YouTube chapters, and social media clips from your sermon transcript.
          </p>

          <div
            className="mt-8 flex items-center gap-4 rounded-2xl border border-white/5 bg-white/5 p-4 backdrop-blur-md shadow-xl"
            role="note"
          >
            <div className="bg-[#0B6ED0]/10 p-2 rounded-xl shrink-0 h-fit">
              <Info className="size-5 text-[#5A9FE8]" aria-hidden />
            </div>
            <p className="text-base leading-7 text-zinc-400">
              <span className="text-white font-semibold"></span> Only have audio or video? Use a tool like{" "}
              <a
                href="https://transcrisper.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-[#3B93E8] hover:text-[#7DBEF7] underline decoration-[#3B93E8]/40 underline-offset-4"
              >
                Transcrisper
              </a>{" "}
              to get a transcript first. Export as <span className="text-zinc-300 font-semibold">SRT</span> or <span className="text-zinc-300 font-semibold">VTT</span>, not TXT, so chapter and clip timestamps carry over.
            </p>
          </div>
        </header>

        <section className="flex flex-col gap-8">
          {limitNotice && (
            <div
              className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-6 py-4 text-center backdrop-blur-md animate-in slide-in-from-top-2"
              role="status"
            >
              <p className="text-sm font-semibold text-amber-200/90 flex items-center justify-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                {AI_LIMIT_NOTICE}
              </p>
            </div>
          )}

          {status !== "loading" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div className="flex justify-center">
                <div className="inline-flex p-1.5 rounded-2xl bg-white/5 border border-white/5 backdrop-blur-xl">
                  <button
                    type="button"
                    onClick={() => setInputMode("upload")}
                    className={[
                      "cursor-pointer rounded-xl px-6 py-2.5 text-xs font-bold uppercase tracking-widest transition-all",
                      inputMode === "upload"
                        ? "bg-[#0B6ED0] text-white shadow-lg shadow-indigo-500/20"
                        : "bg-transparent text-zinc-400 hover:text-white",
                    ].join(" ")}
                    aria-pressed={inputMode === "upload"}
                  >
                    File Drop
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputMode("paste")}
                    className={[
                      "cursor-pointer rounded-xl px-6 py-2.5 text-xs font-bold uppercase tracking-widest transition-all",
                      inputMode === "paste"
                        ? "bg-[#0B6ED0] text-white shadow-lg shadow-indigo-500/20"
                        : "bg-transparent text-zinc-400 hover:text-white",
                    ].join(" ")}
                    aria-pressed={inputMode === "paste"}
                  >
                    Direct Paste
                  </button>
                </div>
              </div>

              {inputMode === "upload" ? (
                <div className="relative group">
                  <div
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        inputRef.current?.click();
                      }
                    }}
                    onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
                    onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                    onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
                    onDrop={onDrop}
                    onClick={() => inputRef.current?.click()}
                    className={[
                      "cursor-pointer rounded-3xl border-2 border-dashed px-8 py-20 text-center transition-all duration-300",
                      dragActive
                        ? "border-[#0B6ED0] bg-[#0B6ED0]/10 ring-4 ring-indigo-500/10"
                        : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.08]",
                    ].join(" ")}
                  >
                    <input
                      ref={inputRef}
                      type="file"
                      accept=".txt,.srt,.vtt,text/plain"
                      aria-label="Upload a sermon transcript, .txt, .srt, or .vtt"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files;
                        if (f?.length) handleFiles(f);
                        e.target.value = "";
                      }}
                    />
                    <div className="flex flex-col items-center">
                      <div className="mb-4 p-4 rounded-full bg-white/5 border border-white/5 group-hover:scale-110 transition-transform">
                        <Camera className="size-8 text-[#0B6ED0]" />
                      </div>
                      <p className="text-lg font-bold text-white tracking-tight">
                        Drop your transcript here
                      </p>
                      <p className="mt-2 text-sm text-zinc-400 font-medium">
                        Supports <span className="text-zinc-300">.txt</span>, <span className="text-zinc-300">.srt</span>, or <span className="text-zinc-300">.vtt</span> files
                      </p>
                    </div>
                  </div>
                  {fileName && (
                    <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/10">
                      <Check className="size-3 text-emerald-400" />
                      <span className="text-xs font-semibold text-white/90 truncate max-w-[200px]">{fileName}</span>
                    </div>
                  )}
                </div>
              ) : (
                <textarea
                  id="paste-input"
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  rows={10}
                  placeholder="Paste your verbatim sermon transcript content here..."
                  className="w-full rounded-3xl border border-white/10 bg-white/5 px-6 py-6 text-base leading-7 text-zinc-200 placeholder:text-zinc-400 outline-none transition-all focus:ring-4 focus:ring-[#0B6ED0]/20 focus:border-[#0B6ED0]/50"
                />
              )}

              {missingTimestamps && (
                <div
                  className="rounded-2xl border border-amber-400/20 bg-amber-400/5 px-6 py-4 text-center"
                  role="status"
                >
                  <p className="flex items-center justify-center gap-2 text-sm font-bold text-amber-100/90">
                    <TriangleAlert className="size-4 shrink-0" />
                    No timestamps found in this transcript
                  </p>
                  <p className="mt-1 text-xs text-amber-100/70">
                    Chapters and clip timestamps need timing in the source, so they will come back marked as unavailable. If this came from Transcrisper, re-export as SRT or VTT instead of TXT to keep timing.
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
                  <div className="flex flex-col justify-center space-y-4 rounded-3xl border border-white/5 bg-white/5 px-6 py-6 backdrop-blur-xl shadow-2xl">
                    <DualClipRangeSlider
                      clipMinSec={clipMinSec}
                      clipMaxSec={clipMaxSec}
                      onMinChange={applyClipMin}
                      onMaxChange={applyClipMax}
                    />
                  </div>

                  <div className="flex flex-col justify-center gap-3 rounded-3xl border border-white/5 bg-white/5 px-6 py-6 backdrop-blur-xl shadow-2xl">
                    <div className="text-center space-y-1">
                      <p className="text-xs font-bold text-zinc-300 uppercase tracking-widest">Cloud AI</p>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        Smarter results • Handles any length transcript
                      </p>
                      <p className="text-xs text-zinc-400 font-medium">
                        Limited free uses per hour
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  {status === "error" && errorMessage && (
                    <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-6 py-4 text-center animate-in shake duration-500">
                      <p className="text-sm font-bold text-red-200/90 flex items-center justify-center gap-2">
                        <X className="size-4" />
                        {errorMessage}
                      </p>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleGenerate()}
                    className="w-full inline-flex cursor-pointer items-center justify-center rounded-3xl bg-[#0B6ED0] py-5 text-sm font-bold uppercase tracking-[0.2em] text-white transition-all hover:bg-[#3d8fe8] hover:shadow-[0_0_25px_rgba(11,110,208,0.3)] active:scale-[0.98]"
                  >
                    Generate
                  </button>
                  <p className="px-4 text-center text-xs leading-relaxed text-zinc-400 font-semibold uppercase tracking-[0.12em]">
                    {COMMUNITY_DISCLAIMER}
                  </p>
                </div>
              </div>
            </div>
          )}

          {status === "loading" && (
            <div
              className="flex flex-col items-center justify-center gap-6 rounded-3xl border border-white/10 bg-white/5 py-24 px-6 text-center backdrop-blur-3xl animate-in zoom-in-95 duration-500"
              aria-live="polite"
              aria-busy="true"
            >
              <div className="relative">
                <div className="absolute inset-0 size-16 bg-[#0B6ED0] blur-2xl opacity-20 animate-pulse" />
                <Loader2 className="size-16 animate-spin text-[#0B6ED0]" strokeWidth={1.5} />
              </div>
              <div className="space-y-2">
                <p className="text-xl font-bold text-white tracking-tight">
                  Processing: <span className="text-[#7EB8F0]">{processingLabel}</span>
                </p>
                <p className="text-sm text-zinc-400 font-medium">
                  Designing your digital strategy. This takes a few moments.
                </p>
              </div>
            </div>
          )}



          {showBento && (
            <div ref={strategyOutputRef} id="strategy-output" className="space-y-6 pt-8 border-t border-white/5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400 mb-1">
                    Strategy Output
                  </h2>
                  <p className="text-xs text-zinc-400 font-medium">
                    Content derived from <span className="text-white">{processingLabel}</span>
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={analyzeAnotherSermon}
                    disabled={!output.trim()}
                    className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-transparent px-5 py-2 text-xs font-bold text-zinc-300 transition-all hover:bg-white/5 hover:text-white disabled:opacity-30"
                  >
                    {isDemo ? "Try Your Own Transcript" : "Analyze Another Sermon"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyOutput()}
                    disabled={!output.trim()}
                    className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-2 text-xs font-bold text-white backdrop-blur-md transition-all hover:bg-white/10 disabled:opacity-30"
                  >
                    {copied ? (
                      <Check className="size-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                    {copied ? "Copied All" : "Copy Full Markdown"}
                  </button>
                </div>
              </div>

              {isDemo && (
                <div
                  className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#0B6ED0]/20 bg-[#0B6ED0]/5 px-6 py-4 text-sm text-zinc-300"
                  role="status"
                >
                  <Eye className="size-4 shrink-0 text-[#5A9FE8]" aria-hidden />
                  <span className="font-bold text-white">You&apos;re viewing a demo.</span>
                  <span>
                    Real sermon by {DEMO_ATTRIBUTION.speaker} at{" "}
                    <a
                      href={DEMO_ATTRIBUTION.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-[#3B93E8] underline decoration-[#3B93E8]/40 underline-offset-2 hover:text-[#7DBEF7]"
                    >
                      {DEMO_ATTRIBUTION.church}
                    </a>
                    , used with permission. Upload your own transcript above to try it for real.
                  </span>
                </div>
              )}

              {!streaming && outputIssues.length > 0 && (
                <div
                  className="rounded-2xl border border-amber-400/20 bg-amber-400/5 px-6 py-4"
                  role="status"
                >
                  {outputIssues.map((issue) => (
                    <p
                      key={issue.code}
                      className="flex items-center justify-center gap-2 text-center text-sm font-bold text-amber-100/90"
                    >
                      <TriangleAlert className="size-4 shrink-0" />
                      {issue.message}
                    </p>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {sections.length > 0 ? (
                  sections.map((s, i) => {
                    const isTitlesSection = isTitlesSectionTitle(s.title);
                    const isClipsSection = isClipsSectionTitle(s.title);

                    let cardClassName = "col-span-1";
                    if (isTitlesSection || isClipsSection) {
                       cardClassName = "col-span-1 md:col-span-2";
                    }

                    if (isClipsSection) {
                      return (
                        <ClipsBentoCard
                          key={`${s.title}-${i}`}
                          title={s.title}
                          body={s.body}
                          className={cardClassName}
                          streaming={streaming && i === sections.length - 1}
                        />
                      );
                    } else if (isTitlesSection) {
                      return (
                        <TitlesBentoCard
                          key={`${s.title}-${i}`}
                          title={s.title}
                          body={s.body}
                          className={cardClassName}
                          streaming={streaming && i === sections.length - 1}
                        />
                      );
                    } else {
                      return (
                        <BentoCard
                          key={`${s.title}-${i}`}
                          title={s.title}
                          body={s.body}
                          className={cardClassName}
                          streaming={streaming && i === sections.length - 1}
                        />
                      );
                    }
                  })
                ) : streaming ? (
                  <div className="col-span-1 md:col-span-2 py-20 text-center rounded-3xl border border-dashed border-white/5 bg-white/5">
                    <Loader2 className="size-10 animate-spin text-zinc-800 mx-auto mb-4" />
                    <p className="text-sm text-zinc-400 font-bold uppercase tracking-widest">Constructing View...</p>
                  </div>
                ) : (
                  // A finished response with nothing parseable in it would
                  // otherwise spin here forever, which reads as a hung page.
                  <div className="col-span-1 md:col-span-2 py-20 text-center rounded-3xl border border-dashed border-white/5 bg-white/5">
                    <TriangleAlert className="size-10 text-amber-300/70 mx-auto mb-4" />
                    <p className="text-sm text-zinc-400 font-bold uppercase tracking-widest">
                      Nothing to display
                    </p>
                  </div>
                )}

                {!streaming && <PromoCard className="col-span-1 md:col-span-2" />}
              </div>
            </div>
          )}
        </section>
      </div>

      {showHistory && (
        <HistoryModal
          items={history}
          onSelect={loadFromHistory}
          onDelete={deleteHistoryItem}
          onClear={clearHistory}
          onClose={() => setShowHistory(false)}
        />
      )}

      {showDisclaimer && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center pb-8 sm:items-center"
          onClick={() => setShowDisclaimer(false)}
        >
          <div
            className="mx-4 w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Privacy</h3>
              <button
                onClick={() => setShowDisclaimer(false)}
                className="text-zinc-400 hover:text-white transition-colors"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <ul className="space-y-3 text-xs text-zinc-400 leading-relaxed">
              <li>
                <span className="font-semibold text-zinc-300">Cloud processing</span> sends your transcript to Google Gemini to create the results. Only submit material you are allowed to share. Google may use inputs to improve their models per their{" "}
                <a
                  href="https://policies.google.com/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#3B93E8] underline underline-offset-2"
                >
                  terms of service
                </a>
                .
              </li>
              <li>
                <span className="font-semibold text-zinc-300">Local history</span> keeps up to 10 generated results in this browser only. You can remove them at any time from History.
              </li>
              <li>
                <span className="font-semibold text-zinc-300">Anonymous analytics</span> uses Vercel Web Analytics to understand aggregate traffic, such as page views and referral sources. It does not use cookies or session recordings, and no transcript or generated content is sent to analytics. See Vercel&apos;s{" "}
                <a
                  href="https://vercel.com/docs/analytics/privacy-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#3B93E8] underline underline-offset-2"
                >
                  privacy information
                </a>
                .
              </li>
            </ul>
          </div>
        </div>
      )}

      <footer className="mt-auto border-t border-white/5 bg-black/40 px-6 py-12 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 text-center sm:flex-row sm:justify-between sm:text-left">
          <div className="space-y-4">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Engineered by</p>
              <a
                href="https://overflowcreative.net"
                target="_blank"
                rel="noopener noreferrer"
                className="text-lg font-bold text-white hover:text-[#3B93E8] transition-colors"
              >
                Overflow Creative
              </a>
            </div>
            <a
              href="https://tally.so/r/VL14Rg"
              className="inline-flex py-1 text-xs font-bold text-[#3B93E8] hover:text-white transition-colors underline decoration-[#3B93E8]/40 underline-offset-4"
            >
              Share Feedback
            </a>
          </div>

          <div className="flex items-center gap-4">
            <a
              href="https://www.instagram.com/jake.crtv/"
              className="flex size-12 items-center justify-center rounded-2xl bg-white/5 border border-white/5 text-zinc-400 hover:text-white hover:border-white/10 transition-all hover:scale-110"
              aria-label="Instagram"
            >
              <Camera className="size-5" />
            </a>
            <a
              href="https://www.youtube.com/@overflow.creative"
              className="flex size-12 items-center justify-center rounded-2xl bg-white/5 border border-white/5 text-zinc-400 hover:text-white hover:border-white/10 transition-all hover:scale-110"
              aria-label="YouTube"
            >
              <CirclePlay className="size-5" />
            </a>
            <a
              href="https://github.com/jakeh280/sermon-intelligence"
              className="flex size-12 items-center justify-center rounded-2xl bg-white/5 border border-white/5 text-zinc-400 hover:text-white hover:border-white/10 transition-all hover:scale-110"
              aria-label="GitHub"
            >
              <GithubIcon className="size-5" />
            </a>
          </div>
        </div>
        <div className="mx-auto max-w-6xl mt-12 pt-8 border-t border-white/5 flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-between">
          <p className="text-xs text-zinc-400 font-semibold uppercase tracking-[0.18em]">
            © {new Date().getFullYear()} Overflow Creative. All Rights Reserved.
          </p>
          <button
            onClick={() => setShowDisclaimer(true)}
            className="text-xs text-zinc-400 font-semibold uppercase tracking-[0.18em] hover:text-white transition-colors"
          >
            Privacy
          </button>
        </div>
      </footer>
    </main>
  );
}
