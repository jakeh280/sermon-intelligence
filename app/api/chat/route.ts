import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamText } from "ai";
import { readBoundedBody } from "@/lib/boundedBody";
import { parseClipBounds } from "@/lib/clipRange";
import { buildSystemPrompt } from "@/lib/systemPrompt";
import { hasTimestampTags, normalizeTranscript } from "@/lib/transcript";
import {
  MAX_REQUEST_BODY_BYTES,
  MAX_TRANSCRIPT_CHARACTERS,
  TOO_LONG_MESSAGE,
} from "@/lib/transcriptInput";

// Explicitly configure the Google provider to ensure it uses the correct API key
const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

// Vercel Serverless (Node.js) runtime
export const maxDuration = 60;

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: Request) {
  // Rate limiting happens one layer up, in proxy.ts (Next's middleware
  // convention as of Next 16 - the root `proxy.ts` file with a `proxy`
  // export is auto-wired in, not a helper this route calls). It runs before
  // this handler on every /api/chat request and uses a sliding window (see
  // lib/proxyRateLimit.ts), so a second check here would add no coverage a
  // fixed-window route-level check used to close - it would just duplicate
  // the same guarantee proxy.ts already enforces.

  // `await req.json()` would fully buffer, decode, and parse the entire body
  // before any size check could run, so a request large enough to matter
  // pays that full cost regardless of what happens next. This bounds the
  // read itself, refusing as soon as either the declared Content-Length or
  // the actual bytes read cross the cap.
  const bounded = await readBoundedBody(
    req.body,
    req.headers.get("content-length"),
    MAX_REQUEST_BODY_BYTES,
  );
  if (!bounded.ok) {
    return jsonError(413, TOO_LONG_MESSAGE);
  }

  let body: unknown;
  try {
    body = JSON.parse(bounded.text);
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const rawText =
    typeof body === "object" &&
      body !== null &&
      "text" in body &&
      typeof (body as { text: unknown }).text === "string"
      ? (body as { text: string }).text.trim()
      : "";
  const text = normalizeTranscript(rawText);

  if (!text) {
    return jsonError(400, "Missing or empty `text` in request body");
  }

  if (text.length > MAX_TRANSCRIPT_CHARACTERS) {
    return jsonError(400, TOO_LONG_MESSAGE);
  }

  const clips = parseClipBounds(body);
  if (!clips) {
    return jsonError(400, "Invalid clip settings.");
  }

  // Without this the request reaches the provider, fails after the stream has
  // already returned 200, and the user sees an empty result with no reason.
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("AI_ROUTE_ERROR: GOOGLE_GENERATIVE_AI_API_KEY is not set");
    return jsonError(
      503,
      "The analysis service is not configured right now. Please try again later.",
    );
  }

  // Real AI Analysis with gemini-3.5-flash-lite
  try {
    const result = streamText({
      model: google("gemini-3.5-flash-lite"),
      system: buildSystemPrompt(clips.min, clips.max, hasTimestampTags(text)),
      messages: [
        {
          role: "user",
          content: `Transcript content:\n\n${text}`,
        },
      ],
      // Without this, a client disconnect (a reset, a stall timeout, a closed
      // tab) stops the client from reading the response but leaves this
      // function generating - and billing - against Gemini to completion
      // regardless. req.signal fires when the underlying connection closes;
      // the AI SDK and @ai-sdk/google both forward abortSignal into the
      // actual fetch() call to Gemini, so this genuinely cancels the upstream
      // request rather than just detaching from it.
      abortSignal: req.signal,
    });

    return result.toTextStreamResponse();
  } catch (err) {
    console.error("AI_ROUTE_ERROR:", err);
    return jsonError(
      500,
      err instanceof Error
        ? err.message
        : "AI connection failed. Please check your API key and quota.",
    );
  }
}
