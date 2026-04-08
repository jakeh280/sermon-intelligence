"use client";

import { useCallback, useRef, useState } from "react";

const ACCENT = "#0B6ED0";
const ACCEPTED = new Set([".txt", ".srt"]);

function extension(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
        void runWithText(text, file.name);
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

  return (
    <main className="min-h-full flex flex-col bg-black text-zinc-100">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-14">
        <header className="mb-10">
          <p
            className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500"
            style={{ color: ACCENT }}
          >
            Overflow Creative
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Sermon Intelligence
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-zinc-400">
            Drop a transcript (.txt) or subtitles (.srt). We stream packaging
            ideas from Gemini—description, chapters, titles, and clip ideas.
          </p>
        </header>

        <section className="flex flex-col gap-6">
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
              setDragActive(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={[
              "cursor-pointer rounded-2xl border border-dashed px-8 py-14 text-center transition-colors",
              dragActive
                ? "border-[color:var(--accent)] bg-zinc-950/80"
                : "border-zinc-700 bg-zinc-950/40 hover:border-zinc-500",
            ].join(" ")}
            style={
              {
                "--accent": ACCENT,
              } as React.CSSProperties
            }
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
            <p className="text-sm font-medium text-zinc-200">
              Drag and drop{" "}
              <span style={{ color: ACCENT }}>.txt</span> or{" "}
              <span style={{ color: ACCENT }}>.srt</span>
            </p>
            <p className="mt-2 text-xs text-zinc-500">
              or click to choose a file
            </p>
          </div>

          {fileName && (
            <p className="text-center text-xs text-zinc-500">
              Last file: <span className="text-zinc-300">{fileName}</span>
            </p>
          )}

          {status === "loading" && (
            <div
              className="flex items-center justify-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-4"
              aria-live="polite"
              aria-busy="true"
            >
              <span
                className="size-5 shrink-0 animate-spin rounded-full border-2 border-zinc-600 border-t-transparent"
                style={{ borderTopColor: ACCENT }}
              />
              <span className="text-sm text-zinc-300">
                Generating… streaming response from the model
              </span>
            </div>
          )}

          {status === "error" && errorMessage && (
            <p
              className="rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-center text-sm text-red-200"
              role="alert"
            >
              {errorMessage}
            </p>
          )}

          {(output || status === "loading") && (
            <div className="flex flex-col gap-2">
              <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                Output
              </h2>
              <div className="min-h-[12rem] rounded-2xl border border-zinc-800 bg-zinc-950/50 p-5">
                {output ? (
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-200">
                    {output}
                  </pre>
                ) : (
                  <p className="text-sm text-zinc-500">
                    Waiting for first tokens…
                  </p>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
