import { google } from "@ai-sdk/google";
import { streamText } from "ai";
import { buildSystemPrompt } from "@/lib/systemPrompt";

export const maxDuration = 60;

const CLIP_MIN_ALLOWED = 15;
const CLIP_MAX_ALLOWED = 600;
const CLIP_STEP = 5;

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

  const clips = parseClipBounds(body);
  if (!clips) {
    return new Response(
      JSON.stringify({
        error: "Invalid clip settings.",
      }),
      { status: 400 },
    );
  }

  // RESTORED: Using the original model and text-only content block
  const result = streamText({
    model: google("gemini-3-flash-preview"),
    system: buildSystemPrompt(clips.min, clips.max),
    messages: [
      {
        role: "user",
        content: `Transcript or subtitle file content:\n\n${text}`,
      },
    ],
  });

  return result.toTextStreamResponse();
}