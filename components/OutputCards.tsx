"use client";

import { Check, Copy, Loader2, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  isClipsSectionTitle,
  isTitlesSectionTitle,
  parseClipOptions,
  type BentoSection,
} from "@/lib/outputParsing";
import { ACCENT } from "@/lib/theme";
import {
  markdownComponents,
  titleMarkdownComponents,
} from "@/components/markdownComponents";

// Loaded on demand; see components/Markdown.tsx. The page prefetches it once idle,
// so output (streamed, restored from history, or the demo) never waits on it.
export const loadMarkdown = () => import("@/components/Markdown");
const Markdown = dynamic(loadMarkdown);

/** Shared by every card's "Copy section" button - same clipboard write, same 2s "Copied" flash. */
function useCopyToClipboard(text: string) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef(0);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch (err) {
      console.error("Failed to copy", err);
      setCopyState("failed");
    }
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopyState("idle"), 2000);
  };

  return { copyState, handleCopy };
}

function SectionCopyButton({ text }: { text: string }) {
  const { copyState, handleCopy } = useCopyToClipboard(text);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
      title="Copy section"
    >
      {copyState === "copied" ? (
        <Check className="size-3 text-emerald-400" aria-hidden />
      ) : copyState === "failed" ? (
        <X className="size-3 text-red-400" aria-hidden />
      ) : (
        <Copy className="size-3" aria-hidden />
      )}
      {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy"}
    </button>
  );
}

type CardProps = {
  title: string;
  body: string;
  streaming: boolean;
};

/**
 * The frame every output card shares: heading with the accent dot, a "Typing…"
 * hint until the section has text, and a copy button once it has finished.
 * `wide` is the larger, full-width treatment used for Titles and Clips.
 */
function CardShell({
  title,
  body,
  streaming,
  wide,
  enterClassName,
  className,
  children,
}: CardProps & {
  wide: boolean;
  enterClassName: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <article
      className={[
        "flex min-h-[8rem] flex-col rounded-xl border border-white/5 bg-zinc-900/40 shadow-2xl backdrop-blur-xl transition-all hover:border-white/10 hover:shadow-indigo-500/5 animate-in fade-in",
        wide ? "p-6" : "p-5",
        enterClassName,
        className,
      ].join(" ")}
    >
      <header
        className={[
          "flex flex-wrap items-start justify-between gap-3 border-b border-white/5",
          wide ? "mb-4 pb-4" : "mb-3 pb-3",
        ].join(" ")}
      >
        {wide ? (
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-white/95 sm:text-2xl">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_12px_rgba(11,110,208,0.6)]"
              style={{ backgroundColor: ACCENT }}
              aria-hidden
            />
            {title}
          </h2>
        ) : (
          <h2 className="text-sm font-semibold tracking-tight text-white/90">
            <span
              className="mr-2 inline-block h-2 w-2 shrink-0 rounded-full align-middle shadow-[0_0_8px_rgba(11,110,208,0.5)]"
              style={{ backgroundColor: ACCENT }}
              aria-hidden
            />
            {title}
          </h2>
        )}
        <div className="flex items-center gap-3">
          {streaming && !body && (
            <span className="shrink-0 text-xs text-zinc-400 animate-pulse">Typing…</span>
          )}
          {body && !streaming && <SectionCopyButton text={body} />}
        </div>
      </header>
      {children}
    </article>
  );
}

function BentoCard({ title, body, streaming }: CardProps) {
  return (
    <CardShell
      title={title}
      body={body}
      streaming={streaming}
      wide={false}
      enterClassName="slide-in-from-bottom-2 duration-500"
      className="col-span-1"
    >
      <div className="min-w-0 flex-1 whitespace-pre-wrap text-zinc-300">
        {body ? (
          <Markdown components={markdownComponents}>{body}</Markdown>
        ) : streaming ? (
          <div className="space-y-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-white/5" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-white/5" />
          </div>
        ) : null}
      </div>
    </CardShell>
  );
}

function TitlesBentoCard({ title, body, streaming }: CardProps) {
  return (
    <CardShell
      title={title}
      body={body}
      streaming={streaming}
      wide
      enterClassName="slide-in-from-bottom-2 duration-500"
      className="col-span-1 md:col-span-2"
    >
      <div className="min-w-0 flex-1 whitespace-pre-wrap text-zinc-300 w-full">
        {body ? (
          <Markdown components={titleMarkdownComponents}>{body}</Markdown>
        ) : streaming ? (
          <div className="flex flex-col md:flex-row gap-4 w-full">
            <div className="h-20 flex-1 animate-pulse rounded-2xl bg-white/5" />
            <div className="h-20 flex-1 animate-pulse rounded-2xl bg-white/5" />
            <div className="h-20 flex-1 animate-pulse rounded-2xl bg-white/5" />
          </div>
        ) : null}
      </div>
    </CardShell>
  );
}

function ClipsBentoCard({ title, body, streaming }: CardProps) {
  const { preamble, clips } = useMemo(() => parseClipOptions(body), [body]);
  const clipsLookStructured = clips.some((c) =>
    Boolean(c.Title || c.Timestamps || c.Transcript || c.Description || c.Duration),
  );
  const showClipGrid = clips.length > 0 && clipsLookStructured;

  return (
    <CardShell
      title={title}
      body={body}
      streaming={streaming}
      wide
      enterClassName="slide-in-from-bottom-4 duration-700"
      className="col-span-1 md:col-span-2"
    >
      {/* Gated on showClipGrid: when it's false, the fallback branch below
          renders the full raw `body` (which still contains this same
          preamble text), so rendering it here too would show it twice. */}
      {showClipGrid && preamble ? (
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
                {clip.Duration ? (
                  <span className="text-xs font-semibold tabular-nums tracking-widest text-zinc-400">
                    {clip.Duration}
                  </span>
                ) : null}
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
                <p className="mb-3 text-base leading-7 text-zinc-300">{clip.Description}</p>
              ) : null}
              {clip["Why it works"] ? (
                <p className="mt-auto text-base leading-7 text-zinc-400 italic">
                  <span className="font-semibold text-zinc-400">Why it works: </span>
                  {clip["Why it works"]}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="min-w-0 flex-1 whitespace-pre-wrap text-zinc-300">
          {body ? (
            <Markdown components={markdownComponents}>{body}</Markdown>
          ) : streaming ? (
            <div className="flex flex-col gap-2">
              <div className="h-4 w-full animate-pulse rounded bg-white/5" />
              <div className="h-4 w-5/6 animate-pulse rounded bg-white/5" />
            </div>
          ) : null}
        </div>
      )}
    </CardShell>
  );
}

function PromoCard() {
  return (
    <article className="relative col-span-1 overflow-hidden rounded-xl border border-white/5 bg-gradient-to-br from-zinc-900/80 via-zinc-900/40 to-[#0B6ED0]/10 p-6 shadow-2xl backdrop-blur-xl transition-all hover:border-white/10 group md:col-span-2">
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

/** The bento grid: one card per parsed section, then the promo once streaming ends. */
export function OutputSections({
  sections,
  streaming,
}: {
  sections: BentoSection[];
  streaming: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {sections.length > 0 ? (
        sections.map((s, i) => {
          const Card = isClipsSectionTitle(s.title)
            ? ClipsBentoCard
            : isTitlesSectionTitle(s.title)
              ? TitlesBentoCard
              : BentoCard;
          return (
            <Card
              key={`${s.title}-${i}`}
              title={s.title}
              body={s.body}
              streaming={streaming && i === sections.length - 1}
            />
          );
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

      {!streaming && <PromoCard />}
    </div>
  );
}
