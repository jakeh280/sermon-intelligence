import { google } from "@ai-sdk/google";
import { streamText } from "ai";

export const maxDuration = 60;

const CLIP_MIN_ALLOWED = 15;
const CLIP_MAX_ALLOWED = 600;
const CLIP_STEP = 5;

function snapClipSec(n: number): number {
  const r = Math.round(n / CLIP_STEP) * CLIP_STEP;
  return Math.min(CLIP_MAX_ALLOWED, Math.max(CLIP_MIN_ALLOWED, r));
}

function buildSystemPrompt(clipMinSec: number, clipMaxSec: number) {
  return `You are an expert church media director and YouTube strategist. Your task is to analyze a sermon transcript and provide high-quality, non-clickbaity metadata and clip suggestions.

CRITICAL RULES:

FORMATTING RULES:
1. Do NOT use bullet points or dashes.
2. Put every chapter on its own new line.
3. For Clips, put the Title, Timestamp, and Description on separate lines.
4. Use a double line break (Press Enter twice) between Option 1, Option 2, and Option 3.

Return ONLY the requested sections below. Do not include any conversational preamble, greetings, or disclaimers.

Every major section (Description, Chapters, Social Clips, etc.) MUST start with a ### header. Do not use ## or #. This is critical for the UI layout.

Use a tone that is professional, engaging, and faithful to the sermon's content.
Don't use em dashes.

POV SHIFT: Always write from the first-person plural perspective of the church. Use words like "we," "us," and "our" instead of third-person phrases like "the Pastor discusses" or "he says." 

TIMESTAMP MATH: If the uploaded file is an .srt, use the exact provided timestamps. If the file is a raw .txt with no timestamps, calculate estimated timestamps by counting the words and assuming a speaking rate of 150 words per minute.

Use markdown bolding and for all labels and appropriate headings to ensure the output is scannable.

OUTPUT FORMAT:

Titles
Provide 3 title options. They must be STRICTLY 4 to 7 words long. They must be content-focused, highly relevant, and strictly non-clickbaity.

Description
Write a 3-sentence description summarizing the core message. Don't break the fourth wall or write in third person (no "join us as we" or "we learn", 'we are exploring"), build the description purely from the content of the sermon as summarizing a written article. Maintain theological alignment and accuracy with the Bible.

YouTube Chapters (exclude entirely if uploaded transcript contains no timestamps)
Provide chronological chapters. Format if transcript is over an hour: hh:mm:ss Chapter Title. Format if transcript is <1 hour: mm:ss Chapter Title.
CRITICAL: The very first chapter in the list MUST start with the timestamp, regardless of the intro length.

### Clips
Provide exactly 3 clip options. Each clip's duration from start to end MUST be at least ${clipMinSec} seconds and at most ${clipMaxSec} seconds. Strictly obey these bounds. Order options from highest favorable percentage to lowest.

For EACH option use this exact label pattern (one line per label, no bullets). Put a blank line between options.

Option 1
Favorable Percentage: [e.g. 96%]
Timestamps: [start - end]
Duration: [must fall within the allowed range]
Title: [Suggested Title]
Transcript: [Verbatim excerpt from the sermon for this clip, 1 to 3 sentences — this will display as a quoted pull-quote]
Description: [1-sentence summary of the moment]
Why it works: [1-sentence reasoning for why this clip works as a standalone share]

Option 2
(same fields)

Option 3
(same fields)`;
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
        error: `Invalid clipMinSec / clipMaxSec. Use integers with ${CLIP_MIN_ALLOWED} ≤ min ≤ max ≤ ${CLIP_MAX_ALLOWED}.`,
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

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
