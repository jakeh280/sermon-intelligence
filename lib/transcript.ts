// Premiere Pro writes timecode as hh:mm:ss:ff (non drop frame) or hh:mm:ss;ff
// (drop frame). Some export paths emit hh:mm:ss.mmm or hh:mm:ss,mmm instead, so
// the subsecond separator is accepted in any of those forms.
const FRAME_TIMECODE = String.raw`\d{2}:\d{2}:\d{2}[:;]\d{2}`;
const MILLISECOND_TIMECODE = String.raw`\d{2}:\d{2}:\d{2}[.,]\d{3}`;
const TIMECODE = `(?:${FRAME_TIMECODE}|${MILLISECOND_TIMECODE})`;

// The range separator stays a literal " - " with whitespace on both sides. SRT
// and WebVTT cue lines separate their timestamps with "-->", which cannot match
// this, so caption files keep passing through untouched.
const PREMIERE_RANGE = new RegExp(`^(${TIMECODE})\\s+-\\s+(${TIMECODE})$`);

const TIMECODE_PARTS = /^(\d{2}:\d{2}:\d{2})([:;.,])(\d{2,3})$/;

function premiereRange(line: string): RegExpMatchArray | null {
  return line.trim().match(PREMIERE_RANGE);
}

/**
 * Renders one timecode as the `[hh:mm:ss:ff]` tag documented in
 * `buildSystemPrompt()`. That prompt tells the model to ignore the frames
 * component, so millisecond exports collapse to `:00` frames rather than
 * guessing a frame rate to convert with.
 */
function toPromptTag(timecode: string): string {
  const match = timecode.match(TIMECODE_PARTS);
  if (!match) return `[${timecode}]`;
  const [, clock, separator, subsecond] = match;
  const frames = separator === ":" || separator === ";" ? subsecond : "00";
  return `[${clock}:${frames}]`;
}

/** Premiere leaves unattributed blocks labelled "Unknown", sometimes with a colon. */
function isUnknownSpeaker(line: string): boolean {
  return line.trim().replace(/:$/, "").trim().toLowerCase() === "unknown";
}

/**
 * Converts Premiere style transcript blocks into the timestamp tags the analysis
 * prompt expects. Plain text, SRT, and already tagged transcripts pass through.
 *
 * Running this twice is a no-op: the tags it emits contain no range separator,
 * so the second pass finds nothing to convert. Both `app/page.tsx` and
 * `app/api/chat/route.ts` call it on the same text.
 */
export function normalizeTranscript(input: string): string {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  if (!lines.some((line) => premiereRange(line))) return input;

  const output: string[] = [];
  let awaitingSpeaker = false;

  for (const line of lines) {
    const match = premiereRange(line);
    if (match) {
      output.push(toPromptTag(match[1]));
      awaitingSpeaker = true;
      continue;
    }

    if (awaitingSpeaker) {
      if (!line.trim()) {
        output.push(line);
        continue;
      }

      awaitingSpeaker = false;
      if (isUnknownSpeaker(line)) continue;
    }

    output.push(line);
  }

  return output.join("\n");
}
