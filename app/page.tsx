"use client";

import {
  Camera,
  Check,
  CirclePlay,
  Copy,
  Info,
} from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const ACCENT = "#0B6ED0";
const ACCEPTED = new Set([".txt", ".srt"]);

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
  return (
    <article
      className="flex min-h-[8rem] flex-col rounded-xl border border-zinc-800/90 bg-zinc-900/50 p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] backdrop-blur-md transition-shadow hover:shadow-[0_0_0_1px_rgba(11,110,208,0.15)]"
      style={{
        boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.04), 0 8px 32px -12px rgba(0,0,0,0.5)",
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
        {streaming && !body && (
          <span className="shrink-0 text-xs text-zinc-500">Typing…</span>
        )}
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
  const [inputMode, setInputMode] = useState<"upload" | "paste">("upload");
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploadedText, setUploadedText] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const sections = useMemo(() => parseBentoSections(output), [output]);

  const runWithText = useCallback(async (text: string, name: string | null) => {
    setFileName(name);
    setOutput("");
    setErrorMessage(null);
    setStatus("loading");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
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
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setErrorMessage(e instanceof Error ? e.message : "Something went wrong");
    }
  }, []);

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
    [runWithText],
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

  const handleGenerate = useCallback(() => {
    if (status === "loading") return;
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
    void runWithText(trimmed, inputMode === "upload" ? fileName : "Pasted text");
  }, [fileName, inputMode, pastedText, runWithText, status, uploadedText]);

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
          <div className="flex justify-center">
            <div className="inline-flex items-center rounded-full border border-zinc-800 bg-zinc-900/60 p-1 backdrop-blur-md">
              <button
                type="button"
                onClick={() => setInputMode("upload")}
                className={[
                  "rounded-full px-4 py-2 text-sm font-medium transition-colors",
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
                  "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                  inputMode === "paste"
                    ? "bg-[#0B6ED0] text-white"
                    : "bg-transparent text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200",
                ].join(" ")}
                aria-pressed={inputMode === "paste"}
              >
                Paste Text
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
          ) : (
            <textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              rows={12}
              placeholder="Paste your sermon transcript here..."
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/50 px-5 py-4 text-sm leading-relaxed text-zinc-200 placeholder:text-zinc-500 outline-none transition-shadow focus:ring-2 focus:ring-[#0B6ED0]"
            />
          )}

          <div className="flex justify-center">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={status === "loading"}
              className="inline-flex items-center justify-center rounded-full bg-[#0B6ED0] px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#3d8fe8] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === "loading" ? "Generating..." : "Generate"}
            </button>
          </div>

          {status === "loading" && (
            <div
              className="flex items-center justify-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-4 backdrop-blur-md"
              aria-live="polite"
              aria-busy="true"
            >
              <span
                className="size-5 shrink-0 animate-spin rounded-full border-2 border-zinc-600 border-t-[#0B6ED0]"
                aria-hidden
              />
              <span className="text-sm text-zinc-300">
                Streaming markdown from the model…
              </span>
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
                  sections.map((s, i) => (
                    <BentoCard
                      key={`${s.title}-${i}`}
                      title={s.title}
                      body={s.body}
                      streaming={
                        streaming && i === sections.length - 1
                      }
                    />
                  ))
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
