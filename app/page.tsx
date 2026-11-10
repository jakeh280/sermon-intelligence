"use client";

import {
  Check,
  Clock,
  Copy,
  Eye,
  EyeOff,
  FileUp,
  History,
  Info,
  Loader2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { snapClipSec } from "@/lib/clipRange";
import { type HistoryItem } from "@/lib/history";
import { DualClipRangeSlider } from "@/components/ClipRangeSlider";
import { Faq } from "@/components/Faq";
import { HistoryModal } from "@/components/HistoryModal";
import { loadMarkdown, OutputSections } from "@/components/OutputCards";
import { PrivacyDialog } from "@/components/PrivacyDialog";
import { SiteFooter } from "@/components/SiteFooter";
import {
  clearStoredHistory,
  createHistoryId,
  historyStorage,
  readHistory,
  writeHistory,
} from "@/lib/historyStorage";
import { parseBentoSections } from "@/lib/outputParsing";
import { describeOutputIssues, type OutputIssue } from "@/lib/outputHealth";
import {
  describeRequestFailure,
  STALL_TIMEOUT_MS,
  StalledResponseError,
} from "@/lib/requestErrors";
import { hasTimestampTags, normalizeTranscript } from "@/lib/transcript";
import { DEMO_ATTRIBUTION, DEMO_LABEL, DEMO_OUTPUT } from "@/lib/demoContent";
import {
  ACCEPTED_EXTENSIONS,
  ACCEPTED_EXTENSIONS_LABEL,
  decodeTranscriptBytes,
  describeFileProblem,
  describeTranscriptProblem,
} from "@/lib/transcriptInput";

const COMMUNITY_DISCLAIMER =
  "Sermon Intelligence is a free community tool. During times of high demand, processing may be temporarily limited to keep it free for everyone.";

const AI_LIMIT_NOTICE =
  "We have hit our free limit for the hour. Please try again in a few minutes.";

// A gateway timeout means the connection gave up waiting, not that the quota
// is exhausted. Conflating it with 429 used to show the "we're out of free
// uses" message for what might just be a slow upstream, which points the
// user at the wrong fix (waiting out the hour, instead of just retrying).
const GATEWAY_TIMEOUT_MESSAGE =
  "The server took too long to respond. Please try again.";

const FULL_COPY_ATTRIBUTION =
  "Generated with [sermonintelligence.com](https://sermonintelligence.com/)";

function isAiLimitHttpStatus(status: number) {
  return status === 429;
}

function isGatewayTimeoutStatus(status: number) {
  return status === 504;
}

// `detail` carries the server's actual 429 body, from either proxy.ts's
// in-process limiter or the route's persistent admission check. Both compute a
// real "try again in ..." from their own window. The server's message is worth
// showing when there is one, with AI_LIMIT_NOTICE only as the fallback for
// a body that didn't parse.
function aiLimitError(detail?: string): Error & { isAiLimit: true } {
  const err = new Error(detail || AI_LIMIT_NOTICE) as Error & {
    isAiLimit: true;
  };
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
  // A plain "latest value" ref, read from inside async callbacks (a
  // FileReader's onload/onerror) that closed over status when they were
  // created and would otherwise act on a status that's since moved on.
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Holds the message to show, not just whether to show one: a 504 and a 429
  // both used to collapse into the same hardcoded AI_LIMIT_NOTICE text, which
  // discarded whatever the server actually said (see aiLimitError() above).
  const [limitNotice, setLimitNotice] = useState<string | null>(null);
  const [outputIssues, setOutputIssues] = useState<OutputIssue[]>([]);
  // writeHistory can end up not persisting this generation at all (storage
  // already full, private browsing) - it degrades gracefully rather than
  // throwing, but that silence would otherwise look identical to a save
  // that quietly worked. This flag is what tells the two apart on screen.
  const [historySaveFailed, setHistorySaveFailed] = useState(false);
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
    setHistory((prev) => {
      const result = writeHistory(historyStorage(), [newItem, ...prev]);
      // If this generation didn't make it in, the returned list's newest
      // entry isn't newItem - either the write failed at every size down to
      // one item (writeHistory then hands back whatever was already
      // persisted, unchanged), or it's a plain read failure returning [].
      setHistorySaveFailed(result[0]?.id !== newItem.id);
      return result;
    });
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
    resetResultState(false);

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

  // Cancelling a generation isn't just about the UI stopping: the previous
  // implementation created its own AbortController *inside*
  // streamChatResponse, so nothing outside that closure could ever reach it.
  // A reset had no way to actually stop the old stream, and its already
  // queued `setOutput` calls kept landing after the reset until the browser
  // finally finished (or failed) reading it. generationIdRef gives every
  // call to runWithText an identity; every state update it makes is gated on
  // still being the current generation, and activeControllerRef lets a reset
  // actually abort the underlying fetch instead of just outrunning it.
  const generationIdRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);

  const streamChatResponse = useCallback(
    async (
      text: string,
      minSec: number,
      maxSec: number,
      controller: AbortController,
      onChunk: (accumulated: string) => void,
    ): Promise<string> => {
      // Nothing else bounds this request from the client's side. Without a stall
      // guard a dropped connection leaves the spinner running with no way out.
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
          if (isGatewayTimeoutStatus(res.status)) {
            throw new Error(GATEWAY_TIMEOUT_MESSAGE);
          }

          // Only a message that actually came from the parsed body counts as
          // "the server's message" below - res.statusText is just the
          // generic HTTP reason phrase (e.g. "Too Many Requests"), and
          // showing that in place of AI_LIMIT_NOTICE on a body-parse failure
          // would be a worse fallback, not a better one.
          let bodyMessage: string | undefined;
          try {
            const err = (await res.json()) as { error?: string };
            if (err.error) bodyMessage = err.error;
          } catch { /* ignore */ }

          if (isAiLimitHttpStatus(res.status)) {
            throw aiLimitError(bodyMessage);
          }
          throw new Error(bodyMessage || res.statusText || "Request failed");
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
          onChunk(accumulated);
        }

        accumulated += decoder.decode();
        onChunk(accumulated);
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

  // The state that has to be cleared every time a new result is about to
  // replace whatever's currently showing - a fresh generation starting, a
  // reset, or the demo loading - regardless of which of those three it is.
  // outputIssues and historySaveFailed were both added, one at a time, to
  // all three call sites individually; consolidating here means the next
  // one only has to be added once.
  const resetResultState = useCallback((isDemo: boolean) => {
    setErrorMessage(null);
    setLimitNotice(null);
    setOutputIssues([]);
    setHistorySaveFailed(false);
    setIsDemo(isDemo);
  }, []);

  const runWithText = useCallback(
    async (
      text: string,
      label: string,
      minSec: number,
      maxSec: number,
    ) => {
      // Superseding a request should stop it, not just stop listening to it:
      // without this abort, a request A that "Analyze Another Sermon" walked
      // away from keeps streaming (and billing) on the server after request
      // B starts.
      activeControllerRef.current?.abort();
      const controller = new AbortController();
      activeControllerRef.current = controller;

      const generationId = (generationIdRef.current += 1);
      const isCurrent = () => generationIdRef.current === generationId;

      setProcessingLabel(label);
      setOutput("");
      resetResultState(false);
      setStatus("loading");

      try {
        const result = await streamChatResponse(
          text,
          minSec,
          maxSec,
          controller,
          (accumulated) => {
            if (isCurrent()) setOutput(accumulated);
          },
        );

        // A reset that landed after the stream finished but before this line
        // runs must not resurrect the output it just cleared, save a history
        // entry for a generation the user walked away from, or flip status
        // back off "idle".
        if (!isCurrent()) return;

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
        setLimitNotice(null);
        setStatus("idle");
      } catch (e) {
        if (!isCurrent()) return;
        if (isAiLimitError(e)) {
          setLimitNotice(e.message);
          setErrorMessage(null);
          setStatus("idle");
          return;
        }
        setStatus("error");
        setErrorMessage(describeRequestFailure(e));
      } finally {
        if (activeControllerRef.current === controller) {
          activeControllerRef.current = null;
        }
      }
    },
    [resetResultState, saveToHistory, streamChatResponse],
  );

  // Every call claims a new id; a read whose id no longer matches
  // fileReadIdRef.current by the time it finishes came from a selection the
  // user has since replaced (with another file, or with one that failed
  // validation immediately), and must not resurrect stale state over
  // whatever is current now. Without this, selecting file A and then
  // quickly file B let whichever FileReader finished last win, regardless
  // of which one the user actually meant to keep.
  const fileReadIdRef = useRef(0);

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      const file = list[0];
      if (!file) return;

      const readId = (fileReadIdRef.current += 1);
      const isCurrentRead = () => fileReadIdRef.current === readId;

      const fileProblem = describeFileProblem(file);
      if (fileProblem) {
        setStatus("error");
        setErrorMessage(fileProblem);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        if (!isCurrentRead()) return;

        // Read as bytes rather than text so a byte order mark can pick the
        // encoding. Windows transcript exports are still often UTF-16.
        const buffer =
          reader.result instanceof ArrayBuffer ? reader.result : new ArrayBuffer(0);
        const text = decodeTranscriptBytes(new Uint8Array(buffer));

        const textProblem = describeTranscriptProblem(text, "upload");
        if (textProblem) {
          setFileName(null);
          setUploadedText("");
          setErrorMessage(textProblem);
          // A generation already running takes priority: this read finishing
          // after the user moved on to Generate must not flip status back to
          // error out from under it. The file data above is still captured
          // (or cleared) either way - only the status transition is skipped.
          if (statusRef.current !== "loading") setStatus("error");
          return;
        }

        setFileName(file.name);
        setUploadedText(text);
        setErrorMessage(null);
        if (statusRef.current !== "loading") setStatus("idle");
      };
      reader.onerror = () => {
        if (!isCurrentRead()) return;
        setErrorMessage("Could not read that file.");
        if (statusRef.current !== "loading") setStatus("error");
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

  const stopGeneration = useCallback(() => {
    // Invalidating the generation id first means every callback the
    // in-flight streamChatResponse still has queued (a chunk already read, a
    // saveToHistory about to run) checks isCurrent(), finds it stale, and
    // becomes a no-op instead of overwriting what the caller is about to set.
    // Aborting on top of that actually stops the fetch, rather than merely
    // ignoring it while it keeps streaming (and billing) on the server.
    generationIdRef.current += 1;
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
  }, []);

  // Stops a generation in progress but keeps the transcript, so the user can
  // change the clip range and generate again without re-uploading.
  const cancelGeneration = useCallback(() => {
    stopGeneration();
    setOutput("");
    setProcessingLabel("");
    resetResultState(false);
    setStatus("idle");
  }, [resetResultState, stopGeneration]);

  const analyzeAnotherSermon = useCallback(() => {
    stopGeneration();
    setOutput("");
    setProcessingLabel("");
    setFileName(null);
    setUploadedText("");
    setPastedText("");
    resetResultState(false);
    setStatus("idle");
    setCopied(false);
    if (inputRef.current) inputRef.current.value = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [resetResultState, stopGeneration]);

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
    resetResultState(true);
    setStatus("idle");
    setCopied(false);
    // No scroll call here: the button sits at the very top of the page, so
    // scrolling to 0 (the pattern used elsewhere) is a no-op when already
    // there, and the results div doesn't exist in the DOM until this state
    // change commits. See the isDemo effect below instead.
  }, [resetResultState, status]);

  // Prefetch the Markdown renderer off the critical path, so it is ready
  // before anyone can produce output.
  useEffect(() => {
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(() => void loadMarkdown());
      return () => cancelIdleCallback(id);
    }
    const timer = setTimeout(() => void loadMarkdown(), 1500);
    return () => clearTimeout(timer);
  }, []);

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

    setLimitNotice(null);

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
                disabled={status === "loading"}
                className={[
                  "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-40",
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

          <p className="mt-5 max-w-2xl text-base leading-relaxed text-zinc-400 font-medium">
            Generate YouTube titles and descriptions, chapter markers, and social clip suggestions from your sermon transcript.
          </p>

          <div
            className="mt-8 flex items-center gap-4 rounded-2xl border border-white/5 bg-white/5 p-4 backdrop-blur-md shadow-xl"
            role="note"
          >
            <div className="bg-[#0B6ED0]/10 p-2 rounded-xl shrink-0 h-fit">
              <Info className="size-5 text-[#5A9FE8]" aria-hidden />
            </div>
            <p className="text-base leading-7 text-zinc-400">
              Only have audio or video? Use a tool like{" "}
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
                <Clock className="size-4 shrink-0" aria-hidden />
                {limitNotice}
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
                  <input
                    ref={inputRef}
                    type="file"
                    accept={[...ACCEPTED_EXTENSIONS, "text/plain"].join(",")}
                    // Beside the drop zone rather than inside it: the zone is the control
                    // (it opens this picker on click, Enter and Space), and a focusable
                    // input inside a role=button was a second, invisible tab stop that
                    // screen readers could still reach (axe nested-interactive).
                    tabIndex={-1}
                    aria-hidden="true"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files;
                      if (f?.length) handleFiles(f);
                      e.target.value = "";
                    }}
                  />
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
                    <div className="flex flex-col items-center">
                      <div className="mb-4 p-4 rounded-full bg-white/5 border border-white/5 group-hover:scale-110 transition-transform">
                        <FileUp className="size-8 text-[#0B6ED0]" aria-hidden />
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
                        Smarter results • Handles transcripts up to about 2 hours
                      </p>
                      <p className="text-xs text-zinc-400 font-medium">
                        Limited free uses per hour
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  {status === "error" && errorMessage && (
                    <div
                      className="rounded-2xl border border-red-500/20 bg-red-500/5 px-6 py-4 text-center animate-in shake duration-500"
                      role="alert"
                    >
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
                    onClick={streaming ? cancelGeneration : analyzeAnotherSermon}
                    // Enabled while streaming, even before the first chunk, so a
                    // slow or stuck generation always has a way out.
                    disabled={!streaming && !output.trim()}
                    className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-transparent px-5 py-2 text-xs font-bold text-zinc-300 transition-all hover:bg-white/5 hover:text-white disabled:opacity-30"
                  >
                    {streaming
                      ? "Cancel"
                      : isDemo
                        ? "Try Your Own Transcript"
                        : "Analyze Another Sermon"}
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

              {!streaming && !isDemo && historySaveFailed && (
                <div
                  className="rounded-2xl border border-amber-400/20 bg-amber-400/5 px-6 py-4"
                  role="status"
                >
                  <p className="flex items-center justify-center gap-2 text-center text-sm font-bold text-amber-100/90">
                    <TriangleAlert className="size-4 shrink-0" />
                    This result could not be saved to History. Your
                    browser&apos;s local storage may be full or unavailable;
                    copy it below before leaving this page.
                  </p>
                </div>
              )}

              <OutputSections sections={sections} streaming={streaming} />
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
          busy={status === "loading"}
        />
      )}

      {showDisclaimer && <PrivacyDialog onClose={() => setShowDisclaimer(false)} />}

      <Faq />
      <SiteFooter onShowPrivacy={() => setShowDisclaimer(true)} />
    </main>
  );
}
