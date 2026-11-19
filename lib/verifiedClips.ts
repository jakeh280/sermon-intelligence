import { normalizeTranscript } from "./transcript.ts";
import { isChaptersSectionTitle, isClipsSectionTitle, parseBentoSections, parseClipOptions, CLIP_FIELD_LABELS } from "./outputParsing.ts";

const TAG = /\[(\d{2}):(\d{2}):(\d{2}):\d{2}\]/g;
const RANGE = /(?:\[)?(\d{2}:\d{2}:\d{2})[:;.,]\d{2,3}\s+-\s+(\d{2}:\d{2}:\d{2})[:;.,]\d{2,3}(?:\])?|(?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3}\s+-->\s+(?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3}/g;

function clockSeconds(clock: string): number | null {
  const parts = clock.split(":").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN) || parts[1] >= 60 || parts[2] >= 60) return null;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return h ? `${h}:${m}:${s}` : `${m}:${s}`;
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

type Segment = { start: number; end: number | null; text: string };

function segments(source: string): Segment[] {
  const normalized = normalizeTranscript(source);
  const tags = [...normalized.matchAll(TAG)];
  const ranges = [...source.matchAll(RANGE)];
  const result: Segment[] = [];
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    const start = clockSeconds(`${tag[1]}:${tag[2]}:${tag[3]}`);
    if (start === null) return [];
    const endAt = tags[i + 1]?.index ?? normalized.length;
    const text = clean(normalized.slice((tag.index ?? 0) + tag[0].length, endAt));
    let end: number | null = null;
    if (ranges.length === tags.length) {
      const times = ranges[i][0].match(/(?:\d{1,3}:)?\d{2}:\d{2}(?=[:;.,]\d{2,3})/g);
      if (times?.length === 2) {
        const startClock = times[0].split(":").length === 2 ? `00:${times[0]}` : times[0];
        const endClock = times[1].split(":").length === 2 ? `00:${times[1]}` : times[1];
        const candidate = clockSeconds(endClock);
        if (clockSeconds(startClock) === start && candidate !== null && candidate >= start) end = candidate;
      }
    }
    result.push({ start, end, text });
  }
  return result;
}

/** Keep generated clip times out of the result unless grounded in the source. */
export function verifyClipTiming(output: string, source: string): string {
  const timeline = segments(source);
  const combined = timeline.map((segment) => segment.text).join(" ");
  const sections = parseBentoSections(output);
  if (!sections.some((section) => isClipsSectionTitle(section.title))) {
    return "### Draft\n\nThe response could not be verified. Please generate again.";
  }
  return sections.map((section) => {
    if (isChaptersSectionTitle(section.title)) return `### ${section.title}\n\nChapter times are suggestions. Check them against the recording.\n\n${section.body}`;
    if (!isClipsSectionTitle(section.title)) return `### ${section.title}\n\n${section.body}`;
    const parsed = parseClipOptions(section.body);
    if (!parsed.clips.length) return `### ${section.title}\n\nClip timing could not be verified. Please generate again.`;
    const clips = parsed.clips.map((clip) => {
      const quote = clean(clip.Transcript ?? "");
      const index = quote ? combined.indexOf(quote) : -1;
      const unique = index >= 0 && combined.indexOf(quote, index + 1) === -1;
      let startIndex = -1;
      let endIndex = -1;
      let cursor = 0;
      if (unique) for (let i = 0; i < timeline.length; i++) {
        const end = cursor + timeline[i].text.length;
        if (index >= cursor && index < end) startIndex = i;
        if (index + quote.length > cursor && index + quote.length <= end) endIndex = i;
        cursor = end + 1;
      }
      const first = timeline[startIndex];
      const last = timeline[endIndex];
      const wholeFirst = first && combined.slice(index, index + first.text.length) === first.text;
      const wholeLast = last && combined.slice(index, index + quote.length).endsWith(last.text);
      clip.Timestamps = first ? `From source marker ${clock(first.start)} (approximate); check the recording for the end` : "Not available (passage could not be matched uniquely to a source marker)";
      clip.Duration = "Not available (check the recording)";
      if (first && last && wholeFirst && wholeLast && last.end !== null && last.end >= first.start) {
        clip.Timestamps = `${clock(first.start)} - ${clock(last.end)} (source segment boundaries, approximate)`;
        clip.Duration = `Approximately ${last.end - first.start} seconds`;
      }
      return [clip.optionLabel, ...CLIP_FIELD_LABELS.map((key) => `${key}: ${clip[key] ?? "Not available"}`)].join("\n");
    });
    return `### ${section.title}\n\n${[parsed.preamble, ...clips].filter(Boolean).join("\n\n")}`;
  }).join("\n\n");
}
