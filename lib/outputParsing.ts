export type BentoSection = { title: string; body: string };

const FENCE_DELIMITER = /^(?:```|~~~)/;

/**
 * Replaces every line strictly inside a fenced code block (the delimiter
 * lines themselves are never heading shaped, so they're left alone) with an
 * opaque placeholder that can't match a heading pattern - so a "### "/"## "
 * shaped line quoted inside a fence can't be mistaken for a real section
 * boundary. The prompt never asks the model to fence anything, so this is
 * about robustness against drift rather than a case seen in practice.
 *
 * Not extended to blockquotes: a `> ### heading` is, per CommonMark, a
 * heading *inside* the blockquote rather than a top-level one, which this
 * string-based splitter (it works on raw section boundaries, not a real
 * markdown AST) doesn't model correctly either way - narrower than this
 * audit finding, and not worth solving as a side effect of it.
 */
function maskFencedLines(markdown: string): {
  masked: string;
  restore: (text: string) => string;
} {
  let inFence = false;
  const placeholders = new Map<string, string>();

  const maskedLines = markdown.split("\n").map((line, index) => {
    const isDelimiter = FENCE_DELIMITER.test(line);
    const wasInFence = inFence;
    if (isDelimiter) inFence = !inFence;
    if (!wasInFence || isDelimiter) return line;

    const placeholder = `FENCE_LINE_${index}`;
    placeholders.set(placeholder, line);
    return placeholder;
  });

  return {
    masked: maskedLines.join("\n"),
    restore: (text: string) => {
      let result = text;
      for (const [placeholder, original] of placeholders) {
        result = result.split(placeholder).join(original);
      }
      return result;
    },
  };
}

function splitOnHeading(markdown: string, heading: RegExp): BentoSection[] {
  const { masked, restore } = maskFencedLines(markdown);
  const parts = masked.split(heading);
  const sections: BentoSection[] = [];

  const preamble = restore(parts[0]?.trim() ?? "");
  if (preamble) {
    sections.push({ title: DRAFT_SECTION_TITLE, body: preamble });
  }

  for (let index = 1; index < parts.length; index += 1) {
    const chunk = parts[index] ?? "";
    const newline = chunk.indexOf("\n");
    const title = restore(
      newline === -1 ? chunk.trim() : chunk.slice(0, newline).trim(),
    );
    const body = restore(
      newline === -1 ? "" : chunk.slice(newline + 1).trimEnd(),
    );
    if (title || body) {
      sections.push({ title: title || "Section", body });
    }
  }

  return sections;
}

function hasHeadedSection(sections: BentoSection[]): boolean {
  return sections.some((section) => section.title !== DRAFT_SECTION_TITLE);
}

/** True for the four section titles the prompt actually defines, plus the preamble bucket. */
function isCanonicalSectionTitle(title: string): boolean {
  return (
    title === DRAFT_SECTION_TITLE ||
    isTitlesSectionTitle(title) ||
    isDescriptionSectionTitle(title) ||
    isChaptersSectionTitle(title) ||
    isClipsSectionTitle(title)
  );
}

/**
 * A model that takes "every section MUST start with '### '" too literally
 * will sometimes heading-ify each individual chapter (or other list entry)
 * instead of listing them as plain lines under one "### Chapters" heading.
 * `splitOnHeading` then shreds that into one empty "Chapters" card plus one
 * near-empty card per chapter, since it has no way to know those headings
 * weren't real sections.
 *
 * The prompt only ever defines four headings (Titles, Description, Chapters,
 * Clips), so any other "### " heading is folded back into the section before
 * it as a list line rather than kept as its own card. This runs after both
 * the "###" and the "##" fallback split, so it also cleans up a "##"
 * response that drifts the same way.
 */
function mergeStraySections(sections: BentoSection[]): BentoSection[] {
  const merged: BentoSection[] = [];

  for (const section of sections) {
    const previous = merged[merged.length - 1];
    if (isCanonicalSectionTitle(section.title) || !previous) {
      merged.push({ ...section });
      continue;
    }

    const line = section.body ? `${section.title}\n${section.body}` : section.title;
    previous.body = previous.body ? `${previous.body}\n- ${line}` : `- ${line}`;
  }

  return merged;
}

/** How many of the four sections the prompt actually defines this split recovered. */
function countCanonicalSections(sections: BentoSection[]): number {
  return sections.filter(
    (section) =>
      isTitlesSectionTitle(section.title) ||
      isDescriptionSectionTitle(section.title) ||
      isChaptersSectionTitle(section.title) ||
      isClipsSectionTitle(section.title),
  ).length;
}

export function parseBentoSections(markdown: string): BentoSection[] {
  const trimmed = markdown.replace(/^\uFEFF/, "");
  const strict = splitOnHeading(trimmed, /^###\s+/m);

  // The prompt asks for "### " headings, but a model that answers with "## "
  // instead would otherwise collapse into one untitled card. Only "##" is worth
  // retrying: "####" is plausible as a subheading inside a well formed section,
  // so falling back to it could shred a response rather than rescue one.
  const relaxed = splitOnHeading(trimmed, /^##\s+/m);

  // The mere presence of a "###" heading isn't proof the response is well
  // formed at that level: a model that writes "## Titles" ... "## Clips" and
  // then nests "### Option 1" inside Clips has one "###" heading, which used
  // to be enough to block the "##" fallback from ever running and firing on
  // the four real sections. Compare how many *canonical* sections each split
  // actually recovers and prefer whichever level does better, so a stray
  // deeper heading can't defeat the shallower one that would have worked.
  if (countCanonicalSections(relaxed) > countCanonicalSections(strict)) {
    return mergeStraySections(relaxed);
  }

  if (hasHeadedSection(strict)) return mergeStraySections(strict);
  return hasHeadedSection(relaxed) ? mergeStraySections(relaxed) : strict;
}

// Order matters here beyond display: it is also the canonical field sequence
// the prompt's "Use this exact format" block asks for (lib/systemPrompt.ts),
// and parseClipFieldLines() below relies on that sequence to decide whether a
// line that looks like a field label is a real field transition or just
// quoted text. Reordering this array changes both what renders first and
// what parseClipFieldLines() will accept as a forward transition.
export const CLIP_FIELD_LABELS = [
  "Timestamps",
  "Duration",
  "Title",
  "Transcript",
  "Description",
  "Why it works",
] as const;

export type ClipFieldKey = (typeof CLIP_FIELD_LABELS)[number];

export type ParsedClip = Partial<Record<ClipFieldKey, string>> & {
  optionLabel: string;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Wordings seen instead of the labels the prompt asks for. The model is told to
 * use the canonical label, but a near miss should still fill the card rather
 * than drop the whole Clips section back to raw Markdown.
 */
const CLIP_FIELD_ALIASES: Record<ClipFieldKey, string[]> = {
  Timestamps: ["Timestamps", "Timestamp", "Time", "Times"],
  Duration: ["Duration", "Length"],
  Title: ["Title", "Hook"],
  Transcript: ["Transcript", "Quote"],
  Description: ["Description", "Context"],
  "Why it works": ["Why it works", "Why this works", "Why"],
};

/**
 * Matches one field label at the head of a line, tolerating the decorations
 * models add around it: a list bullet, bold or italic markers either side of the
 * colon, and surrounding whitespace. A colon is always required, so ordinary
 * prose starting with one of these words is not mistaken for a label.
 */
function fieldLabelPattern(aliases: string[]): RegExp {
  const alternatives = aliases.map(escapeRegExp).join("|");
  return new RegExp(
    `^\\s*(?:[-*+]\\s+)?[*_]{0,2}\\s*(?:${alternatives})\\s*[*_]{0,2}\\s*:\\s*[*_]{0,2}\\s*(.*)$`,
    "i",
  );
}

const CLIP_FIELD_PATTERNS = CLIP_FIELD_LABELS.map(
  (key) => [key, fieldLabelPattern(CLIP_FIELD_ALIASES[key])] as const,
);

// Matches only a field's own literal label (no aliases), used to tell a
// deliberate field transition from a coincidental alias collision below.
const CANONICAL_FIELD_PATTERNS = CLIP_FIELD_LABELS.map(
  (key) => [key, fieldLabelPattern([key])] as const,
);

const FIELD_ORDER = new Map(CLIP_FIELD_LABELS.map((key, index) => [key, index]));

/**
 * Matches a line that is nothing but an option header. Bold markers, a heading
 * prefix, a list bullet, and trailing punctuation are all tolerated, but the
 * header has to be the entire line: a clip whose transcript quotes "Option 1"
 * mid sentence must not start a new block.
 */
const OPTION_HEADER =
  /^\s*(?:[-*+]\s+)?(?:#{1,6}\s*)?[*_]{0,2}\s*(?:option|clip)\s*#?\s*\d{1,2}\s*[*_]{0,2}\s*[:.)]?\s*[*_]{0,2}\s*$/i;

function cleanOptionLabel(line: string): string {
  const cleaned = line
    .replace(/[*_#]/g, "")
    .replace(/^\s*[-+]\s+/, "")
    .replace(/[:.)]\s*$/, "")
    .trim();
  return cleaned || "Option";
}

export function parseClipFieldLines(
  block: string,
): Partial<Record<ClipFieldKey, string>> {
  const lines = block.split("\n");
  const output: Partial<Record<ClipFieldKey, string>> = {};
  let current: ClipFieldKey | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join(" ").replace(/\s+/g, " ").replace(/\*\*/g, "").trim();
    if (current && text) output[current] = text;
  };

  for (const line of lines) {
    let matchedKey: ClipFieldKey | null = null;
    let valuePart = "";

    for (const [key, pattern] of CLIP_FIELD_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        matchedKey = key;
        valuePart = match[1]?.trim() ?? "";
        break;
      }
    }

    // A field label can also just be quoted: a sermon transcript that
    // literally says "time to reap" or a stray "Why:" mid quote matches one
    // of the patterns above without being a real new field. Once a field is
    // already open, only accept the match as a genuine transition when:
    //  - it moves to the very next field in the prompt's order, or
    //  - it skips further ahead, but only via that field's own exact label
    //    rather than a looser alias (an alias is the ambiguous case; the
    //    literal label is a much stronger signal a field really started), or
    //  - it moves backward (or restates the current field) to a field that
    //    hasn't been filled yet, and again only via the exact label. A model
    //    that emits fields out of the prompt's order still writes each one
    //    exactly once, so "already filled" is what tells that apart from a
    //    quote that happens to repeat an earlier field's exact label.
    if (matchedKey && current) {
      const currentIndex = FIELD_ORDER.get(current) ?? -1;
      const matchedIndex = FIELD_ORDER.get(matchedKey) ?? -1;
      const isNextField = matchedIndex === currentIndex + 1;
      const isCanonicalLabel = CANONICAL_FIELD_PATTERNS.some(
        ([key, pattern]) => key === matchedKey && pattern.test(line),
      );
      const isUnfilledReorderedField =
        isCanonicalLabel && !output[matchedKey];
      const accepted =
        isNextField ||
        (matchedIndex > currentIndex && isCanonicalLabel) ||
        (matchedIndex <= currentIndex && isUnfilledReorderedField);
      if (!accepted) {
        matchedKey = null;
      }
    }

    if (matchedKey) {
      flush();
      current = matchedKey;
      buffer = valuePart ? [valuePart] : [];
    } else if (current && line.trim()) {
      buffer.push(line.trim());
    }
  }

  flush();
  return output;
}

export function splitClipOptionBlocks(
  body: string,
): { preamble: string; blocks: string[] } {
  const lines = body.split("\n");
  const preamble: string[] = [];
  const blocks: string[] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (OPTION_HEADER.test(line)) {
      if (current) blocks.push(current.join("\n"));
      current = [line];
    } else if (current) {
      current.push(line);
    } else {
      preamble.push(line);
    }
  }

  if (current) blocks.push(current.join("\n"));
  return { preamble: preamble.join("\n").trim(), blocks };
}

export function parseClipOptions(body: string): {
  preamble: string;
  clips: ParsedClip[];
} {
  const { preamble, blocks } = splitClipOptionBlocks(body);
  const clips = blocks.map((block) => {
    const lines = block.split("\n");
    return {
      optionLabel: cleanOptionLabel(lines[0] ?? ""),
      ...parseClipFieldLines(lines.slice(1).join("\n")),
    };
  });
  return { preamble, clips };
}

export function isClipsSectionTitle(title: string) {
  return /^clips\b/i.test(title.trim());
}

export function isTitlesSectionTitle(title: string) {
  return /^titles\b/i.test(title.trim());
}

export function isDescriptionSectionTitle(title: string) {
  return /^description\b/i.test(title.trim());
}

export function isChaptersSectionTitle(title: string) {
  return /^chapters\b/i.test(title.trim());
}

/** The preamble bucket `parseBentoSections()` uses for text before any heading. */
export const DRAFT_SECTION_TITLE = "Draft";
