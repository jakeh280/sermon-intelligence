// Premiere Pro writes timecode as hh:mm:ss:ff (non drop frame) or hh:mm:ss;ff
// (drop frame). Some export paths emit hh:mm:ss.mmm or hh:mm:ss,mmm instead, so
// the subsecond separator is accepted in any of those forms.
const FRAME_TIMECODE = String.raw`\d{2}:\d{2}:\d{2}[:;]\d{2}`;
const MILLISECOND_TIMECODE = String.raw`\d{2}:\d{2}:\d{2}[.,]\d{3}`;
const TIMECODE = `(?:${FRAME_TIMECODE}|${MILLISECOND_TIMECODE})`;

// The range separator stays a literal " - " with whitespace on both sides. SRT
// and WebVTT cue lines separate their timestamps with "-->", which cannot match
// this, so caption files fall through to the caption path below instead.
const PREMIERE_RANGE = new RegExp(`^(${TIMECODE})\\s+-\\s+(${TIMECODE})$`);

const TIMECODE_PARTS = /^(\d{2}:\d{2}:\d{2})([:;.,])(\d{2,3})$/;

// DaVinci Resolve's transcript export writes the same range wrapped in a
// single pair of square brackets, e.g. `[00:00:00:11 - 00:00:13:03]`, with no
// speaker line and no separate opening/closing bracket line. Stripping one
// matching pair before matching lets the same range regex cover both shapes.
function premiereRange(line: string): RegExpMatchArray | null {
  const trimmed = line.trim();
  const unwrapped =
    trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1).trim()
      : trimmed;
  return unwrapped.match(PREMIERE_RANGE);
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

// SRT writes hh:mm:ss,mmm. WebVTT writes hh:mm:ss.mmm and also allows the hours
// to be dropped, and permits cue settings after the end timestamp.
const CUE_TIMESTAMP = String.raw`(?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3}`;
const CUE_TIMING = new RegExp(
  `^(${CUE_TIMESTAMP})\\s+-->\\s+(${CUE_TIMESTAMP})(?:\\s+.*)?$`,
);
const CUE_INDEX = /^\d{1,6}$/;
const VTT_HEADER = /^WEBVTT\b/;
const VTT_BLOCK_KEYWORD = /^(?:NOTE|STYLE|REGION)\b/;

/** Renders an SRT or WebVTT start time as the prompt's [hh:mm:ss:ff] tag. */
function cueTimestampToPromptTag(timestamp: string): string {
  const parts = timestamp.split(":");
  const seconds = parts[parts.length - 1]?.split(/[.,]/)[0] ?? "00";
  const minutes = parts[parts.length - 2] ?? "00";
  const hours = parts.length >= 3 ? parts[parts.length - 3] ?? "0" : "0";
  // Frames are zeroed rather than derived from milliseconds, the same choice
  // the Premiere path makes, because the prompt tells the model to ignore them.
  return `[${hours.padStart(2, "0")}:${minutes}:${seconds}:00]`;
}

/**
 * Converts a caption file into the same timestamp tags the Premiere path emits.
 *
 * Deliberately all or nothing: anything this cannot account for returns null and
 * the caller passes the original text through untouched, which is what happened
 * to every caption file before. Cue text itself is never rewritten, so inline
 * WebVTT markup survives and the prompt's verbatim clip rule still holds against
 * what the user sees in their own file.
 */
function normalizeCaptions(lines: string[]): string | null {
  if (!lines.some((line) => CUE_TIMING.test(line.trim()))) return null;

  const output: string[] = [];
  let index = 0;
  let cues = 0;

  const skipBlock = () => {
    while (index < lines.length && lines[index]?.trim()) index += 1;
  };

  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";

    if (!line) {
      index += 1;
      continue;
    }

    if (VTT_HEADER.test(line) || VTT_BLOCK_KEYWORD.test(line)) {
      skipBlock();
      continue;
    }

    // An index line only counts as one when a timing line follows it.
    if (CUE_INDEX.test(line) && CUE_TIMING.test(lines[index + 1]?.trim() ?? "")) {
      index += 1;
      continue;
    }

    const timing = line.match(CUE_TIMING);
    if (!timing) return null;

    index += 1;
    const text: string[] = [];
    while (index < lines.length && lines[index]?.trim()) {
      const cueLine = lines[index] ?? "";
      // A second timing line inside cue text means this is not a shape worth
      // guessing at.
      if (CUE_TIMING.test(cueLine.trim())) return null;
      text.push(cueLine);
      index += 1;
    }

    if (text.length === 0) return null;

    if (cues > 0) output.push("");
    output.push(cueTimestampToPromptTag(timing[1]));
    output.push(...text);
    cues += 1;
  }

  return cues > 0 ? output.join("\n") : null;
}

/**
 * Converts Premiere/DaVinci Resolve style transcript blocks and caption files
 * into the timestamp tags the analysis prompt expects. Plain text and already
 * tagged transcripts pass through, as does any caption file this cannot parse
 * cleanly.
 *
 * Running this twice is a no-op: the tags it emits contain neither a Premiere
 * range separator nor a cue arrow, so the second pass finds nothing to convert.
 * Both `app/page.tsx` and `app/api/chat/route.ts` call it on the same text.
 */
export function normalizeTranscript(input: string): string {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  if (!lines.some((line) => premiereRange(line))) {
    return normalizeCaptions(lines) ?? input;
  }

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
