"use client";

import {
  Camera,
  Check,
  CirclePlay,
  Copy,
  History,
  Info,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import type { ComponentProps, CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CreateMLCEngine } from "@mlc-ai/web-llm";
import { buildSystemPrompt } from "@/lib/systemPrompt";

const ACCENT = "#0B6ED0";
const ACCEPTED = new Set([".txt", ".srt"]);

const COMMUNITY_DISCLAIMER =
  "Sermon Intelligence is a free community tool. During times of high demand, processing may be temporarily limited to keep it free for everyone.";

const AI_LIMIT_NOTICE =
  "We have hit our free limit for the hour. Please try again in a few minutes.";

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

const CLIP_FLOOR_SEC = 15;
const CLIP_CEIL_SEC = 600;
const CLIP_STEP = 5;

function snapClipSec(n: number): number {
  const r = Math.round(n / CLIP_STEP) * CLIP_STEP;
  return Math.min(CLIP_CEIL_SEC, Math.max(CLIP_FLOOR_SEC, r));
}

function formatDurationSec(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}m` : `${m}m ${r}s`;
}

function extension(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

type BentoSection = { title: string; body: string };

function parseBentoSections(markdown: string): BentoSection[] {
  const trimmed = markdown.replace(/^\uFEFF/, "");
  const parts = trimmed.split(/^###\s+/m);
  const sections: BentoSection[] = [];

  const preamble = parts[0]?.trim() ?? "";
  if (preamble) {
    sections.push({ title: "Draft", body: preamble });
  }

  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i] ?? "";
    const nl = chunk.indexOf("\n");
    const title =
      nl === -1 ? chunk.trim() : chunk.slice(0, nl).trim();
    const body = nl === -1 ? "" : chunk.slice(nl + 1).trimEnd();
    if (title || body) {
      sections.push({ title: title || "Section", body });
    }
  }

  return sections;
}

const CLIP_FIELD_LABELS = [
  "Favorable Percentage",
  "Timestamps",
  "Duration",
  "Title",
  "Transcript",
  "Description",
  "Why it works",
] as const;

type ClipFieldKey = (typeof CLIP_FIELD_LABELS)[number];

type ParsedClip = Partial<Record<ClipFieldKey, string>> & {
  optionLabel: string;
};

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseClipFieldLines(block: string): Partial<Record<ClipFieldKey, string>> {
  const lines = block.split("\n");
  const out: Partial<Record<ClipFieldKey, string>> = {};
  let current: ClipFieldKey | null = null;

  const flush = (buf: string[]) => {
    const text = buf.join(" ").replace(/\s+/g, " ").replace(/\*\*/g, "").trim();
    if (current && text) out[current] = text;
  };

  let buf: string[] = [];
  for (const line of lines) {
    let matchedKey: ClipFieldKey | null = null;
    let valuePart = "";
    for (const k of CLIP_FIELD_LABELS) {
      const starred = new RegExp(
        `^\\s*\\*\\*${escapeRegExp(k)}\\*\\*\\s*:\\s*(.*)$`,
        "i",
      );
      const plain = new RegExp(
        `^\\s*${escapeRegExp(k)}\\s*:\\s*(.*)$`,
        "i",
      );
      const m = line.match(starred) ?? line.match(plain);
      if (m) {
        matchedKey = k;
        valuePart = m[1]?.trim() ?? "";
        break;
      }
    }
    if (matchedKey) {
      flush(buf);
      current = matchedKey;
      buf = valuePart ? [valuePart] : [];
    } else if (current && line.trim()) {
      buf.push(line.trim());
    }
  }
  flush(buf);
  return out;
}

function splitClipOptionBlocks(body: string): { preamble: string; blocks: string[] } {
  const lines = body.split("\n");
  const preamble: string[] = [];
  const blocks: string[] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (/^Option\s+[123]\s*$/i.test(line.trim())) {
      if (current) blocks.push(current.join("\n"));
      current = [line];
    } else if (current) {
      current.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) blocks.push(current.join("\n"));

  return {
    preamble: preamble.join("\n").trim(),
    blocks,
  };
}

function parseClipOptions(body: string): {
  preamble: string;
  clips: ParsedClip[];
} {
  const { preamble, blocks } = splitClipOptionBlocks(body);
  const clips: ParsedClip[] = [];
  for (const block of blocks) {
    const firstLine = block.split("\n")[0]?.trim() ?? "Option";
    const rest = block.split("\n").slice(1).join("\n");
    const fields = parseClipFieldLines(rest);
    clips.push({
      optionLabel: firstLine,
      ...fields,
    });
  }
  return { preamble, clips };
}

function isClipsSectionTitle(title: string) {
  return /^clips\b/i.test(title.trim());
}

const markdownComponents: NonNullable<
  ComponentProps<typeof ReactMarkdown>["components"]
> = {
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      className="font-medium underline decoration-[#0B6ED0]/50 underline-offset-2 transition-colors hover:text-[#0B6ED0]"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
  p: ({ children, ...props }) => (
    <p className="mb-3 text-sm leading-relaxed text-zinc-300 last:mb-0" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    <ul
      className="mb-3 list-disc space-y-1.5 pl-5 text-sm text-zinc-300 last:mb-0"
      {...props}
    >
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol
      className="mb-3 list-decimal space-y-1.5 pl-5 text-sm text-zinc-300 last:mb-0"
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
      className="mb-3 border-l-2 border-[#0B6ED0]/60 pl-3 text-sm italic text-zinc-400"
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
}: {
  title: string;
  body: string;
  streaming: boolean;
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
      className="flex min-h-[8rem] flex-col rounded-xl border border-white/5 bg-zinc-900/40 p-5 shadow-2xl backdrop-blur-xl transition-all hover:border-white/10 hover:shadow-indigo-500/5 animate-in fade-in slide-in-from-bottom-2 duration-500"
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
            <span className="shrink-0 text-xs text-zinc-500 animate-pulse">Typing…</span>
          )}
          {body && !streaming && (
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-medium text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
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
        <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
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
            "absolute inset-x-0 top-1/2 h-3 w-full -translate-y-1/2 appearance-none bg-transparent",
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
            "absolute inset-x-0 top-1/2 h-3 w-full -translate-y-1/2 appearance-none bg-transparent",
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
}: {
  title: string;
  body: string;
  streaming: boolean;
}) {
  const { preamble, clips } = useMemo(() => parseClipOptions(body), [body]);
  const clipsLookStructured = clips.some(
    (c) =>
      Boolean(
        c.Title ||
        c.Timestamps ||
        c.Transcript ||
        c.Description ||
        c.Duration ||
        c["Favorable Percentage"],
      ),
  );
  const showClipGrid = clips.length > 0 && clipsLookStructured;

  return (
    <article
      className="col-span-1 flex min-h-[8rem] flex-col rounded-xl border border-white/5 bg-zinc-900/40 p-6 shadow-2xl backdrop-blur-xl md:col-span-2 xl:col-span-3 transition-all hover:border-white/10 animate-in fade-in slide-in-from-bottom-4 duration-700"
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
          <span className="shrink-0 text-xs text-zinc-500 animate-pulse">Typing…</span>
        )}
      </header>

      {preamble ? (
        <p className="mb-6 text-sm leading-relaxed text-zinc-400">{preamble}</p>
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
                  {clip["Favorable Percentage"] ? (
                    <span className="rounded-md bg-[#0B6ED0]/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#7EB8F0]">
                      {clip["Favorable Percentage"]} Match
                    </span>
                  ) : null}
                  {clip.Duration ? (
                    <span className="text-[10px] font-bold tabular-nums tracking-widest text-zinc-500">
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
                <blockquote className="mb-4 grow border-l-2 border-[#0B6ED0]/30 pl-3 text-sm italic leading-relaxed text-zinc-400">
                  {clip.Transcript}
                </blockquote>
              ) : null}
              {clip.Description ? (
                <p className="mb-3 text-sm leading-relaxed text-zinc-300">
                  {clip.Description}
                </p>
              ) : null}
              {clip["Why it works"] ? (
                <p className="mt-auto text-sm leading-relaxed text-zinc-500 italic">
                  <span className="font-semibold text-zinc-400">
                    Hook:{" "}
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

function PromoCard() {
  return (
    <article
      className="relative col-span-1 overflow-hidden rounded-xl border border-white/5 bg-gradient-to-br from-zinc-900/80 via-zinc-900/40 to-[#0B6ED0]/10 p-6 shadow-2xl backdrop-blur-xl md:col-span-2 xl:col-span-3 transition-all hover:border-white/10 group"
    >
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-25 blur-3xl transition-transform group-hover:scale-125"
        style={{ backgroundColor: ACCENT }}
        aria-hidden
      />
      <div className="relative">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#7EB8F0]/80">
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

type HistoryItem = {
  id: string;
  timestamp: number;
  label: string;
  output: string;
  clipMinSec: number;
  clipMaxSec: number;
};

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-zinc-950 border border-white/10 rounded-2xl shadow-3xl overflow-hidden animate-in zoom-in-95 duration-200">
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
              <p className="text-sm text-zinc-500">No history yet.</p>
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
                    <p className="text-[10px] text-zinc-500 font-mono text-left">
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
  const [copied, setCopied] = useState(false);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [engineChoice, setEngineChoice] = useState<"local" | "cloud">("local");

  // WebLLM State
  const [isInitializingEngine, setIsInitializingEngine] = useState(false);
  const [engineProgress, setEngineProgress] = useState(0);
  const [engineInitText, setEngineInitText] = useState("");

  // Load history on mount
  useEffect(() => {
    const saved = localStorage.getItem("sermon_history");
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }
  }, []);

  // Save history helper
  const saveToHistory = useCallback((label: string, text: string, min: number, max: number) => {
    const newItem: HistoryItem = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      label,
      output: text,
      clipMinSec: min,
      clipMaxSec: max,
    };
    setHistory((prev) => {
      const next = [newItem, ...prev].slice(0, 10); // Keep last 10
      localStorage.setItem("sermon_history", JSON.stringify(next));
      return next;
    });
  }, []);

  const deleteHistoryItem = (id: string) => {
    setHistory((prev) => {
      const next = prev.filter((i) => i.id !== id);
      localStorage.setItem("sermon_history", JSON.stringify(next));
      return next;
    });
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem("sermon_history");
  };

  const loadFromHistory = (item: HistoryItem) => {
    setOutput(item.output);
    setClipMinSec(item.clipMinSec);
    setClipMaxSec(item.clipMaxSec);
    setProcessingLabel(item.label);
    setShowHistory(false);
    setStatus("idle");
    setErrorMessage(null);
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
    async (text: string, minSec: number, maxSec: number, label: string) => {
      // 1. Try local WebGPU execution if supported
      if (engineChoice === "local" && typeof navigator !== "undefined" && (navigator as any).gpu) {
        try {
          setIsInitializingEngine(true);
          const engine = await CreateMLCEngine("Phi-3-mini-4k-instruct-q4f16_1-MLC", {
            initProgressCallback: (p) => {
              setEngineProgress(p.progress * 100);
              setEngineInitText(p.text);
            },
          });
          setIsInitializingEngine(false);

          const systemMessage = buildSystemPrompt(minSec, maxSec);
          const chunks = await engine.chat.completions.create({
            messages: [
              { role: "system", content: systemMessage },
              { role: "user", content: `Transcript content:\n\n${text}` },
            ],
            stream: true,
            temperature: 0.7,
          });

          let accumulated = "";
          for await (const chunk of chunks) {
             const content = chunk.choices[0]?.delta?.content;
             if (content) {
                 accumulated += content;
                 setOutput(accumulated);
             }
          }
          saveToHistory(label, accumulated, minSec, maxSec);
          return; // Local completion succeeded!
        } catch (err) {
          console.warn("Local WebGPU inference failed, falling back to server...", err);
          setIsInitializingEngine(false);
          // Allow code execution to fall through to the normal server fetch.
        }
      }

      // 2. Server API fallback processing
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          clipMinSec: minSec,
          clipMaxSec: maxSec,
        }),
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
        accumulated += decoder.decode(value, { stream: true });
        setOutput(accumulated);
      }

      accumulated += decoder.decode();
      setOutput(accumulated);
      saveToHistory(label, accumulated, minSec, maxSec);
    },
    [saveToHistory, engineChoice],
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
      setStatus("loading");

      try {
        await streamChatResponse(text, minSec, maxSec, label);
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
        setErrorMessage(
          e instanceof Error ? e.message : "Something went wrong",
        );
      }
    },
    [streamChatResponse],
  );

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      const file = list[0];
      if (!file) return;

      const ext = extension(file.name);
      if (!ACCEPTED.has(ext)) {
        setStatus("error");
        setErrorMessage("Please upload a .txt or .srt file.");
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === "string" ? reader.result : "";
        setFileName(file.name);
        setUploadedText(text);
        setErrorMessage(null);
        setStatus("idle");
      };
      reader.onerror = () => {
        setStatus("error");
        setErrorMessage("Could not read that file.");
      };
      reader.readAsText(file);
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
      await navigator.clipboard.writeText(output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setErrorMessage("Could not copy to clipboard.");
      setStatus("error");
    }
  }, [output]);

  const handleGenerate = useCallback(async () => {
    if (status === "loading") return;

    setLimitNotice(false);

    const minSec = clipMinSec;
    const maxSec = clipMaxSec;

    const text = inputMode === "paste" ? pastedText : uploadedText;
    const trimmed = text.trim();
    if (!trimmed) {
      setStatus("error");
      setErrorMessage(
        inputMode === "paste"
          ? "Please paste a transcript before generating."
          : "Please upload a .txt or .srt file before generating.",
      );
      return;
    }
    const label =
      inputMode === "upload"
        ? fileName ?? "File Upload"
        : "Pastes Content";
    void runWithText(trimmed, label, minSec, maxSec);
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

  const showBento = output.length > 0 || status === "loading";
  const streaming = status === "loading";

  return (
    <main className="flex min-h-full flex-col bg-[#020202] text-zinc-100 font-sans selection:bg-[#0B6ED0]/30 selection:text-white">
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
              className="group inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.4em] text-[#0B6ED0] transition-colors hover:text-white"
            >
              Overflow Creative
              <span className="h-px w-6 bg-[#0B6ED0]/40 transition-all group-hover:w-12 group-hover:bg-[#0B6ED0]" />
            </a>

            <button
              onClick={() => setShowHistory(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/5 text-[11px] font-bold text-zinc-400 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
            >
              <History className="size-3.5" />
              History
            </button>
          </div>

          <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-6xl bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent">
            Sermon Intelligence
          </h1>
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
            <p className="text-sm leading-relaxed text-zinc-400">
              <span className="text-white font-semibold"></span> Only have audio or video? Use a tool like{" "}
              <a
                href="https://transcrisper.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-[#0B6ED0] hover:text-[#3d8fe8] underline decoration-[#0B6ED0]/30 underline-offset-4"
              >
                Transcrisper
              </a>{" "}
              to get a clean text transcript first.
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
                        : "bg-transparent text-zinc-500 hover:text-white",
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
                        : "bg-transparent text-zinc-500 hover:text-white",
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
                      accept=".txt,.srt,text/plain"
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
                      <p className="mt-2 text-sm text-zinc-500 font-medium">
                        Supports <span className="text-zinc-300">.txt</span> or <span className="text-zinc-300">.srt</span> files
                      </p>
                    </div>
                  </div>
                  {fileName && (
                    <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/10">
                      <Check className="size-3 text-emerald-400" />
                      <span className="text-[10px] font-bold text-white/90 truncate max-w-[200px]">{fileName}</span>
                    </div>
                  )}
                </div>
              ) : (
                <textarea
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  rows={10}
                  placeholder="Paste your verbatim sermon transcript content here..."
                  className="w-full rounded-3xl border border-white/10 bg-white/5 px-6 py-6 text-sm leading-relaxed text-zinc-200 placeholder:text-zinc-600 outline-none transition-all focus:ring-4 focus:ring-[#0B6ED0]/20 focus:border-[#0B6ED0]/50"
                />
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
                    <div className="flex text-[10px] font-bold uppercase tracking-widest text-center bg-transparent">
                      <button
                        type="button"
                        onClick={() => setEngineChoice("local")}
                        className={`cursor-pointer flex-1 rounded-2xl py-3 px-2 transition-all ${engineChoice === "local" ? "bg-[#0B6ED0] text-white shadow-[0_0_15px_rgba(11,110,208,0.3)]" : "text-zinc-500 hover:text-zinc-300"}`}
                        title="Faster, unlimited usage, smaller model"
                      >
                        Local Device
                      </button>
                      <button
                        type="button"
                        onClick={() => setEngineChoice("cloud")}
                        className={`cursor-pointer flex-1 rounded-2xl py-3 px-2 transition-all border border-transparent ${engineChoice === "cloud" ? "!border-[#0B6ED0] text-[#7EB8F0] bg-[#0B6ED0]/10 shadow-[0_0_15px_rgba(11,110,208,0.15)]" : "text-zinc-500 hover:text-zinc-300"}`}
                        title="Smarter, unlimited long transcripts, limited usage"
                      >
                        Cloud AI
                      </button>
                    </div>
                    <div className="px-2 pt-1 text-center text-xs text-zinc-400 leading-tight font-medium">
                      {engineChoice === "local" 
                        ? "Faster • Unlimited Uses • Smaller Model (Limited Max Length)" 
                        : "Smarter • Unlimited Length • Limited free uses per hour"}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <button
                    type="button"
                    onClick={() => void handleGenerate()}
                    className="w-full inline-flex cursor-pointer items-center justify-center rounded-3xl bg-[#0B6ED0] py-5 text-sm font-bold uppercase tracking-[0.2em] text-white transition-all hover:bg-[#3d8fe8] hover:shadow-[0_0_25px_rgba(11,110,208,0.3)] active:scale-[0.98]"
                  >
                    Generate
                  </button>
                  <p className="px-4 text-center text-[10px] leading-relaxed text-zinc-600 font-bold uppercase tracking-wider">
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
              {isInitializingEngine ? (
                <div className="w-full max-w-sm mx-auto space-y-6">
                  <div className="flex flex-col items-center gap-4">
                    <Loader2 className="size-10 animate-spin text-[#0B6ED0]" strokeWidth={2} />
                    <p className="text-xl font-bold text-white tracking-tight">
                      Downloading Required Resources...
                    </p>
                  </div>
                  <div className="space-y-2">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full bg-[#0B6ED0] transition-all duration-300 shadow-[0_0_12px_rgba(11,110,208,0.8)]"
                        style={{ width: `${Math.max(0, Math.min(100, engineProgress))}%` }}
                      />
                    </div>
                    <p className="text-xs text-[#7EB8F0] font-mono text-center tracking-widest font-bold">
                      {Math.round(engineProgress)}%
                    </p>
                  </div>
                  <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest text-center mt-4">
                    This only happens once
                  </p>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <div className="absolute inset-0 size-16 bg-[#0B6ED0] blur-2xl opacity-20 animate-pulse" />
                    <Loader2 className="size-16 animate-spin text-[#0B6ED0]" strokeWidth={1.5} />
                  </div>
                  <div className="space-y-2">
                    <p className="text-xl font-bold text-white tracking-tight">
                      Processing: <span className="text-[#7EB8F0]">{processingLabel}</span>
                    </p>
                    <p className="text-sm text-zinc-500 font-medium">
                      Designing your digital strategy. This takes a few moments.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {status === "error" && errorMessage && (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-6 py-4 text-center animate-in shake duration-500">
              <p className="text-sm font-bold text-red-200/90 flex items-center justify-center gap-2">
                <X className="size-4" />
                {errorMessage}
              </p>
            </div>
          )}

          {showBento && (
            <div className="space-y-6 pt-8 border-t border-white/5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.4em] text-zinc-500 mb-1">
                    Strategy Output
                  </h2>
                  <p className="text-xs text-zinc-400 font-medium">
                    Content derived from <span className="text-white">{processingLabel}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void copyOutput()}
                  disabled={!output.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-2 text-xs font-bold text-white backdrop-blur-md transition-all hover:bg-white/10 disabled:opacity-30 cursor-pointer"
                >
                  {copied ? (
                    <Check className="size-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  {copied ? "Copied All" : "Copy Full Markdown"}
                </button>
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                {sections.length > 0 ? (
                  sections.map((s, i) =>
                    isClipsSectionTitle(s.title) ? (
                      <ClipsBentoCard
                        key={`${s.title}-${i}`}
                        title={s.title}
                        body={s.body}
                        streaming={streaming && i === sections.length - 1}
                      />
                    ) : (
                      <BentoCard
                        key={`${s.title}-${i}`}
                        title={s.title}
                        body={s.body}
                        streaming={streaming && i === sections.length - 1}
                      />
                    ),
                  )
                ) : (
                  <div className="col-span-full py-20 text-center rounded-3xl border border-dashed border-white/5 bg-white/5">
                    <Loader2 className="size-10 animate-spin text-zinc-800 mx-auto mb-4" />
                    <p className="text-sm text-zinc-500 font-bold uppercase tracking-widest">Constructing View...</p>
                  </div>
                )}

                {!streaming && <PromoCard />}
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

      <footer className="mt-auto border-t border-white/5 bg-black/40 px-6 py-12 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 text-center sm:flex-row sm:justify-between sm:text-left">
          <div className="space-y-4">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Engineered by</p>
              <a
                href="https://overflowcreative.net"
                target="_blank"
                rel="noopener noreferrer"
                className="text-lg font-bold text-white hover:text-[#0B6ED0] transition-colors"
              >
                Overflow Creative
              </a>
            </div>
            <a
              href="https://tally.so/r/wkJPlj"
              className="inline-flex py-1 text-xs font-bold text-[#0B6ED0] hover:text-white transition-colors underline decoration-[#0B6ED0]/30 underline-offset-4"
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
          </div>
        </div>
        <div className="mx-auto max-w-6xl mt-12 pt-8 border-t border-white/5 text-center">
          <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-[0.3em]">
            © {new Date().getFullYear()} Overflow Creative. All Rights Reserved.
          </p>
        </div>
      </footer>
    </main>
  );
}