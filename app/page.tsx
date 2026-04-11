"use client";

import {
  Camera,
  Check,
  CirclePlay,
  Copy,
  Info,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { extractYouTubeVideoId } from "@/lib/youtube";
import type { ComponentProps, CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const ACCENT = "#0B6ED0";
const ACCEPTED = new Set([".txt", ".srt"]);

const COMMUNITY_DISCLAIMER =
  "Sermon Intelligence is a free community tool. During times of high demand, processing may be temporarily limited to keep it free for everyone. Please try again shortly if it pauses.";

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

/**
 * Split streamed markdown on `### ` headings so each major section becomes a bento card.
 * Handles preamble before the first ### and incomplete final sections while streaming.
 */
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

/** Parse labeled lines in an option block; values may span lines until the next known label. */
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
      className="flex min-h-[8rem] flex-col rounded-xl border border-zinc-800/90 bg-zinc-900/50 p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] backdrop-blur-md transition-shadow hover:shadow-[0_0_0_1px_rgba(11,110,208,0.15)]"
      style={{
        boxShadow: "inset 0 1px 0_0_rgba(255,255,255,0.04), 0_8px_32px_-12px_rgba(0,0,0,0.5)",
      }}
    >
      <header className="mb-3 flex items-start justify-between gap-3 border-b border-zinc-800/80 pb-3">
        <h2 className="text-sm font-semibold tracking-tight text-white">
          <span
            className="mr-2 inline-block h-2 w-2 shrink-0 rounded-full align-middle"
            style={{ backgroundColor: ACCENT }}
            aria-hidden
          />
          {title}
        </h2>
        <div className="flex items-center gap-3">
          {streaming && !body && (
            <span className="shrink-0 text-xs text-zinc-500">Typing…</span>
          )}
          {body && !streaming && (
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded bg-zinc-800/50 px-2 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-zinc-700/50 hover:text-white"
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
          <p className="text-sm text-zinc-500">Waiting for content…</p>
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
    "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-zinc-950 [&::-webkit-slider-thumb]:bg-[#0B6ED0] [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-zinc-950 [&::-moz-range-thumb]:bg-[#0B6ED0] [&::-moz-range-thumb]:shadow-md";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-sm text-zinc-300">
        <span className="font-medium tabular-nums text-[#7EB8F0]">
          {formatDurationSec(clipMinSec)}
        </span>
        <span className="text-xs uppercase tracking-wider text-zinc-500">
          Range
        </span>
        <span className="font-medium tabular-nums text-[#7EB8F0]">
          {formatDurationSec(clipMaxSec)}
        </span>
      </div>
      <div className="relative py-3">
        <div
          className="pointer-events-none absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-zinc-800"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[#0B6ED0]/65"
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
      className="col-span-1 flex min-h-[8rem] flex-col rounded-xl border border-zinc-800/90 bg-zinc-900/50 p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] backdrop-blur-md transition-shadow hover:shadow-[0_0_0_1px_rgba(11,110,208,0.15)] md:col-span-2 xl:col-span-3"
      style={{
        boxShadow:
          "inset 0 1px 0 0 rgba(255,255,255,0.04), 0 8px 32px -12px rgba(0,0,0,0.5)",
      }}
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800/80 pb-4">
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-white sm:text-2xl">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full align-middle"
            style={{ backgroundColor: ACCENT }}
            aria-hidden
          />
          {title}
        </h2>
        {streaming && !body && (
          <span className="shrink-0 text-xs text-zinc-500">Typing…</span>
        )}
      </header>

      {preamble ? (
        <p className="mb-4 text-sm text-zinc-400">{preamble}</p>
      ) : null}

      {showClipGrid ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {clips.map((clip, i) => (
            <div
              key={`${clip.optionLabel}-${i}`}
              className="flex flex-col rounded-lg border border-zinc-700/90 bg-zinc-950/40 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]"
            >
              <div className="mb-3 flex flex-col gap-2 border-b border-zinc-800/90 pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  {clip["Favorable Percentage"] ? (
                    <span className="rounded-md bg-[#0B6ED0]/15 px-2 py-0.5 text-xs font-semibold text-[#7EB8F0]">
                      {clip["Favorable Percentage"]}
                    </span>
                  ) : null}
                  {clip.Duration ? (
                    <span className="text-xs font-medium tabular-nums tracking-wide text-zinc-500">
                      {clip.Duration}
                    </span>
                  ) : null}
                </div>
                {clip.Timestamps ? (
                  <p className="font-mono text-xs font-semibold tracking-tight text-[#5A9FE8]">
                    {clip.Timestamps}
                  </p>
                ) : null}
                {clip.Title ? (
                  <h3 className="text-base font-semibold leading-snug text-white">
                    {clip.Title}
                  </h3>
                ) : null}
              </div>
              {clip.Transcript ? (
                <blockquote className="mb-3 grow border-l-2 border-[#0B6ED0]/45 pl-3 text-sm italic leading-relaxed text-zinc-400">
                  {clip.Transcript}
                </blockquote>
              ) : null}
              {clip.Description ? (
                <p className="mb-2 text-sm leading-relaxed text-zinc-300">
                  {clip.Description}
                </p>
              ) : null}
              {clip["Why it works"] ? (
                <p className="mt-auto text-xs leading-relaxed text-zinc-500">
                  <span className="font-medium text-zinc-400">
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
            <p className="text-sm text-zinc-500">Waiting for content…</p>
          ) : null}
        </div>
      )}
    </article>
  );
}

function PromoCard() {
  return (
    <article
      className="relative col-span-1 overflow-hidden rounded-xl border border-[#0B6ED0]/25 bg-gradient-to-br from-zinc-900/80 via-zinc-900/50 to-[#0B6ED0]/15 p-6 shadow-[0_0_60px_-20px_rgba(11,110,208,0.35)] backdrop-blur-md md:col-span-2 xl:col-span-3"
    >
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-40 blur-3xl"
        style={{ backgroundColor: ACCENT }}
        aria-hidden
      />
      <div className="relative">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#7EB8F0]">
          Overflow Creative
        </p>
        <p className="mt-2 max-w-xl text-lg font-semibold tracking-tight text-white sm:text-xl">
          Ready to build better church videos?
        </p>
        <p className="mt-2 text-sm text-zinc-400">
          The complete course that contains everything I know about church video production.
        </p>
        <Link
          href="https://overflowcreative.net/betterchurchvideo"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 rounded-lg px-0 text-sm font-medium text-[#0B6ED0] underline decoration-[#0B6ED0]/40 underline-offset-4 transition-colors hover:text-[#3d8fe8]"
        >
          Learn more
          <span aria-hidden>→</span>
        </Link>
      </div>
    </article>
  );
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputMode, setInputMode] = useState<"upload" | "paste" | "youtube">(
    "upload",
  );
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploadedText, setUploadedText] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubePreviewLoading, setYoutubePreviewLoading] = useState(false);
  const [youtubePreviewTitle, setYoutubePreviewTitle] = useState<string | null>(
    null,
  );
  const [youtubePreviewError, setYoutubePreviewError] = useState<string | null>(
    null,
  );
  const [clipMinSec, setClipMinSec] = useState(15);
  const [clipMaxSec, setClipMaxSec] = useState(120);
  const [processingLabel, setProcessingLabel] = useState("");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [limitNotice, setLimitNotice] = useState(false);
  const [copied, setCopied] = useState(false);

  const sections = useMemo(() => parseBentoSections(output), [output]);

  useEffect(() => {
    if (inputMode !== "youtube") {
      setYoutubePreviewLoading(false);
      setYoutubePreviewTitle(null);
      setYoutubePreviewError(null);
      return;
    }
    const url = youtubeUrl.trim();
    const id = extractYouTubeVideoId(url);
    if (!url || !id) {
      setYoutubePreviewTitle(null);
      setYoutubePreviewError(null);
      setYoutubePreviewLoading(false);
      return;
    }

    setYoutubePreviewLoading(true);
    setYoutubePreviewError(null);
    setYoutubePreviewTitle(null);

    const ac = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/youtube-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
          signal: ac.signal,
        });
        const data = (await res.json()) as { error?: string; title?: string };
        if (!res.ok) {
          throw new Error(data.error || "Could not load video.");
        }
        const title =
          typeof data.title === "string" && data.title.trim()
            ? data.title.trim()
            : null;
        setYoutubePreviewTitle(title);
      } catch (e) {
        if (ac.signal.aborted) return;
        setYoutubePreviewTitle(null);
        setYoutubePreviewError(
          e instanceof Error ? e.message : "Could not load video.",
        );
      } finally {
        if (!ac.signal.aborted) setYoutubePreviewLoading(false);
      }
    }, 450);

    return () => {
      window.clearTimeout(t);
      ac.abort();
    };
  }, [youtubeUrl, inputMode]);

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
    async (text: string, minSec: number, maxSec: number) => {
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
        } catch {
          /* ignore */
        }
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
      setStatus("loading");

      try {
        await streamChatResponse(text, minSec, maxSec);
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

    if (inputMode === "youtube") {
      const url = youtubeUrl.trim();
      if (!url) {
        setStatus("error");
        setErrorMessage("Please paste a YouTube link.");
        return;
      }
      setProcessingLabel("YouTube video");
      setOutput("");
      setErrorMessage(null);
      setStatus("loading");
      try {
        const tr = await fetch("/api/youtube-transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const data = (await tr.json()) as { error?: string; title?: string; text?: string };
        if (!tr.ok) {
          if (isAiLimitHttpStatus(tr.status)) {
            throw aiLimitError();
          }
          throw new Error(data.error || "Could not load YouTube captions.");
        }
        const transcript = typeof data.text === "string" ? data.text.trim() : "";
        if (!transcript) {
          throw new Error("No transcript text returned.");
        }
        const title =
          typeof data.title === "string" && data.title.trim()
            ? data.title.trim()
            : "YouTube video";
        setProcessingLabel(title);
        await streamChatResponse(transcript, minSec, maxSec);
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
      return;
    }

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
        ? fileName ?? "file"
        : "text input";
    void runWithText(trimmed, label, minSec, maxSec);
  }, [
    clipMaxSec,
    clipMinSec,
    fileName,
    inputMode,
    pastedText,
    runWithText,
    status,
    streamChatResponse,
    uploadedText,
    youtubeUrl,
  ]);

  const showBento = output.length > 0 || status === "loading";
  const streaming = status === "loading";

  return (
    <main className="flex min-h-full flex-col bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-16 pt-10 sm:px-6 lg:px-8 lg:pt-14">
        <header className="mb-8 lg:mb-10">
          <a
            href="https://overflowcreative.net"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-[11px] font-semibold uppercase tracking-[0.28em] text-[#0B6ED0] transition-colors hover:text-[#3d8fe8]"
            aria-label="Overflow Creative — home"
          >
            Overflow Creative
          </a>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Sermon Intelligence
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Upload a transcript or subtitles. We stream structured markdown you
            can drop straight into YouTube and social—organized by section.
          </p>

          <div
            className="mt-5 flex gap-3 rounded-xl border border-[#0B6ED0]/20 bg-[#0B6ED0]/10 px-4 py-3 backdrop-blur-sm"
            role="note"
          >
            <Info
              className="mt-0.5 size-5 shrink-0 text-[#5A9FE8]"
              aria-hidden
            />
            <p className="text-sm leading-relaxed text-zinc-300">
              Only have an audio or video file? Use a free tool like{" "}
              <a
                href="https://transcrisper.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#0B6ED0] underline decoration-[#0B6ED0]/40 underline-offset-2 hover:text-[#3d8fe8]"
              >
                Transcrisper
              </a>{" "}
              to convert it to a .txt file first.
            </p>
          </div>
        </header>

        <section className="flex flex-col gap-6">
        {limitNotice && (
            <div
              className="rounded-xl border border-amber-500/35 bg-amber-950/30 px-4 py-3 text-center backdrop-blur-sm"
              role="status"
            >
              <p className="text-sm leading-relaxed text-amber-100/95">
                {inputMode === "youtube"
                  ? "The YouTube processing limit for the day has been reached. Please download the transcript from YouTube and upload it as a .txt file instead—it uses a different, much larger limit!"
                  : AI_LIMIT_NOTICE}
              </p>
            </div>
          )}

          {status !== "loading" && (
            <>
              <div className="flex justify-center">
                <div className="inline-flex max-w-full flex-wrap items-center justify-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/60 p-1 backdrop-blur-md">
                  <button
                    type="button"
                    onClick={() => setInputMode("upload")}
                    className={[
                      "rounded-full px-3 py-2 text-sm font-medium transition-colors sm:px-4",
                      inputMode === "upload"
                        ? "bg-[#0B6ED0] text-white"
                        : "bg-transparent text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200",
                    ].join(" ")}
                    aria-pressed={inputMode === "upload"}
                  >
                    File Upload
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputMode("paste")}
                    className={[
                      "rounded-full px-3 py-2 text-sm font-medium transition-colors sm:px-4",
                      inputMode === "paste"
                        ? "bg-[#0B6ED0] text-white"
                        : "bg-transparent text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200",
                    ].join(" ")}
                    aria-pressed={inputMode === "paste"}
                  >
                    Paste Text
                  </button>
                  <button
  type="button"
  disabled 
  // Comment out or remove the onClick so the state physically cannot change
  // onClick={() => setInputMode("youtube")} 
  className={[
    // Added 'pointer-events-none' to completely kill mouse interactions
    "rounded-full px-3 py-2 text-sm font-medium transition-colors sm:px-4 cursor-not-allowed opacity-50 pointer-events-none", 
    inputMode === "youtube"
      ? "bg-[#0B6ED0] text-white"
      : "bg-transparent text-zinc-400",
  ].join(" ")}
  aria-pressed={inputMode === "youtube"}
>
  YouTube link (Under Review)
</button>
                </div>
              </div>

              {inputMode === "upload" ? (
                <>
                  <div
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        inputRef.current?.click();
                      }
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragActive(true);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragActive(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setDragActive(false);
                      }
                    }}
                    onDrop={onDrop}
                    onClick={() => inputRef.current?.click()}
                    className={[
                      "group cursor-pointer rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-all duration-200",
                      dragActive
                        ? "border-[#0B6ED0] bg-[#0B6ED0]/10 shadow-[0_0_40px_-8px_rgba(11,110,208,0.45)]"
                        : "border-zinc-700 bg-zinc-900/30 hover:border-zinc-500 hover:bg-zinc-900/50",
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
                    <p className="text-sm font-medium text-zinc-200 transition-colors group-hover:text-white">
                      Drag and drop{" "}
                      <span className="text-[#0B6ED0]">.txt</span> or{" "}
                      <span className="text-[#0B6ED0]">.srt</span>
                    </p>
                    <p className="mt-2 text-xs text-zinc-500 transition-colors group-hover:text-zinc-400">
                      or click to browse — release to upload
                    </p>
                  </div>

                  {fileName && (
                    <p className="text-center text-xs text-zinc-500">
                      Last file:{" "}
                      <span className="font-mono text-zinc-400">{fileName}</span>
                    </p>
                  )}
                </>
              ) : inputMode === "paste" ? (
                <textarea
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  rows={12}
                  placeholder="Paste your sermon transcript here..."
                  className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/50 px-5 py-4 text-sm leading-relaxed text-zinc-200 placeholder:text-zinc-500 outline-none transition-shadow focus:ring-2 focus:ring-[#0B6ED0]"
                />
              ) : (
                <div className="space-y-2">
                  <input
                    type="url"
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=…"
                    className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/50 px-5 py-4 text-sm text-zinc-200 placeholder:text-zinc-500 outline-none transition-shadow focus:ring-2 focus:ring-[#0B6ED0]"
                    autoComplete="off"
                  />
                  {youtubeUrl.trim() &&
                    extractYouTubeVideoId(youtubeUrl.trim()) && (
                      <div className="flex min-h-[1.25rem] items-start gap-2 px-1">
                        {youtubePreviewLoading ? (
                          <>
                            <Loader2
                              className="mt-0.5 size-3.5 shrink-0 animate-spin text-[#0B6ED0]"
                              aria-hidden
                            />
                            <span className="text-xs text-zinc-400">
                              Finding video…
                            </span>
                          </>
                        ) : youtubePreviewTitle ? (
                          <strong className="text-sm font-semibold leading-snug text-white">
                            {youtubePreviewTitle}
                          </strong>
                        ) : youtubePreviewError ? (
                          <span className="text-xs text-red-300/90">
                            {youtubePreviewError}
                          </span>
                        ) : null}
                      </div>
                    )}
                </div>
              )}

              <div className="space-y-4 rounded-2xl border border-zinc-800/90 bg-zinc-900/40 px-5 py-5 backdrop-blur-md">
                <p className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Clip length
                </p>
                <DualClipRangeSlider
                  clipMinSec={clipMinSec}
                  clipMaxSec={clipMaxSec}
                  onMinChange={applyClipMin}
                  onMaxChange={applyClipMax}
                />
              </div>

              <div className="flex flex-col items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  className="inline-flex cursor-pointer items-center justify-center rounded-full bg-[#0B6ED0] px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#3d8fe8]"
                >
                  Generate
                </button>
                <p className="max-w-md text-center text-xs leading-relaxed text-zinc-500">
                  {COMMUNITY_DISCLAIMER}
                </p>
              </div>
            </>
          )}

          {status === "loading" && (
            <div
              className="flex flex-col items-center justify-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-5 text-center backdrop-blur-md"
              aria-live="polite"
              aria-busy="true"
            >
              <p className="text-sm font-medium text-zinc-200">
                Processing:{" "}
                <span className="text-[#7EB8F0]">{processingLabel}</span>
              </p>
              <div className="flex items-center justify-center gap-3">
                <span
                  className="size-5 shrink-0 animate-spin rounded-full border-2 border-zinc-600 border-t-[#0B6ED0]"
                  aria-hidden
                />
                <span className="text-sm text-zinc-400">
                  Streaming markdown from the model…
                </span>
              </div>
            </div>
          )}

          {status === "error" && errorMessage && (
            <p
              className="rounded-xl border border-red-900/50 bg-red-950/25 px-4 py-3 text-center text-sm text-red-200 backdrop-blur-sm"
              role="alert"
            >
              {errorMessage}
            </p>
          )}

          {showBento && (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Results
                </h2>
                <button
                  type="button"
                  onClick={() => void copyOutput()}
                  disabled={!output.trim()}
                  className="inline-flex items-center justify-center gap-2 self-end rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-xs font-medium text-zinc-200 backdrop-blur-md transition-all hover:border-[#0B6ED0]/50 hover:bg-zinc-800/80 hover:text-white disabled:pointer-events-none disabled:opacity-40 sm:self-auto"
                >
                  {copied ? (
                    <Check className="size-3.5 text-emerald-400" aria-hidden />
                  ) : (
                    <Copy className="size-3.5 text-zinc-400" aria-hidden />
                  )}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                        streaming={
                          streaming && i === sections.length - 1
                        }
                      />
                    ),
                  )
                ) : (
                  <div className="col-span-1 rounded-xl border border-dashed border-zinc-700 bg-zinc-900/30 p-8 text-center text-sm text-zinc-500 backdrop-blur-sm md:col-span-2 xl:col-span-3">
                    Processing…
                  </div>
                )}

                <PromoCard />
              </div>
            </div>
          )}
        </section>
      </div>

      <footer className="mt-auto border-t border-zinc-800/80 bg-black/40 px-4 py-10 backdrop-blur-md sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
          <div className="space-y-1">
            <p className="text-sm text-zinc-400">
              Built by{" "}
              <a
                href="https://overflowcreative.net"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-zinc-200 underline decoration-zinc-600 underline-offset-2 transition-colors hover:text-[#0B6ED0]"
              >
                Overflow Creative
              </a>
              .
            </p>
            <a
              href="https://tally.so/r/wkJPlj"
              className="text-xs font-medium text-[#0B6ED0] underline decoration-[#0B6ED0]/35 underline-offset-2 hover:text-[#3d8fe8]"
            >
              Provide Feedback
            </a>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://www.instagram.com/jake.crtv/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex size-10 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/50 text-zinc-400 transition-colors hover:border-[#0B6ED0]/40 hover:text-[#0B6ED0]"
              aria-label="Overflow Creative on Instagram"
            >
              <Camera className="size-[18px]" strokeWidth={2} />
            </a>
            <a
              href="https://www.youtube.com/@overflow.creative"
              target="_blank"
              rel="noopener noreferrer"
              className="flex size-10 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/50 text-zinc-400 transition-colors hover:border-[#0B6ED0]/40 hover:text-[#0B6ED0]"
              aria-label="Overflow Creative on YouTube"
            >
              <CirclePlay className="size-[18px]" strokeWidth={2} />
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
