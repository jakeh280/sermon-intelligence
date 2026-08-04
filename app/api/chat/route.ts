import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamText } from "ai";
import { buildSystemPrompt } from "@/lib/systemPrompt";
import { isRateLimited, clientKey } from "@/lib/rateLimit";

// Explicitly configure the Google provider to ensure it uses the correct API key
const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

// Vercel Serverless (Node.js) runtime
export const maxDuration = 60;

const CLIP_MIN_ALLOWED = 15;
const CLIP_MAX_ALLOWED = 600;
const CLIP_STEP = 5;
const MAX_TRANSCRIPT_LENGTH = 150000;

function snapClipSec(n: number): number {
  const r = Math.round(n / CLIP_STEP) * CLIP_STEP;
  return Math.min(CLIP_MAX_ALLOWED, Math.max(CLIP_MIN_ALLOWED, r));
}

function parseClipBounds(body: unknown): { min: number; max: number } | null {
  if (typeof body !== "object" || body === null) return null;
  const o = body as Record<string, unknown>;
  const minRaw = o.clipMinSec;
  const maxRaw = o.clipMaxSec;
  if (typeof minRaw !== "number" || typeof maxRaw !== "number") return null;
  if (!Number.isFinite(minRaw) || !Number.isFinite(maxRaw)) return null;
  const min = snapClipSec(minRaw);
  const max = snapClipSec(maxRaw);
  if (min < CLIP_MIN_ALLOWED || max > CLIP_MAX_ALLOWED) return null;
  if (min > max) return null;
  return { min, max };
}

export async function POST(req: Request) {
  if (isRateLimited(clientKey(req))) {
    return new Response(
      JSON.stringify({ error: "Too many requests. Please try again later." }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const text =
    typeof body === "object" &&
      body !== null &&
      "text" in body &&
      typeof (body as { text: unknown }).text === "string"
      ? (body as { text: string }).text.trim()
      : "";

  if (!text) {
    return new Response(
      JSON.stringify({ error: "Missing or empty `text` in request body" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (text.length > MAX_TRANSCRIPT_LENGTH) {
    return new Response(
      JSON.stringify({
        error:
          "Transcript is too long. Please trim it to under 150,000 characters (approximately 2 hours of speech).",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const clips = parseClipBounds(body);
  if (!clips) {
    return new Response(
      JSON.stringify({
        error: "Invalid clip settings.",
      }),
      { status: 400 },
    );
  }

  // Real AI Analysis with gemini-3.5-flash-lite
  try {
    const result = streamText({
      model: google("gemini-3.5-flash-lite"),
      system: buildSystemPrompt(clips.min, clips.max),
      messages: [
        {
          role: "user",
          content: `Transcript content:\n\n${text}`,
        },
      ],
    });

    return result.toTextStreamResponse();
  } catch (err) {
    console.error("AI_ROUTE_ERROR:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "AI connection failed. Please check your API key and quota.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}