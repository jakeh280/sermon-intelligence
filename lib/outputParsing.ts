export type BentoSection = { title: string; body: string };

function splitOnHeading(markdown: string, heading: RegExp): BentoSection[] {
  const parts = markdown.split(heading);
  const sections: BentoSection[] = [];

  const preamble = parts[0]?.trim() ?? "";
  if (preamble) {
    sections.push({ title: DRAFT_SECTION_TITLE, body: preamble });
  }

  for (let index = 1; index < parts.length; index += 1) {
    const chunk = parts[index] ?? "";
    const newline = chunk.indexOf("\n");
    const title = newline === -1 ? chunk.trim() : chunk.slice(0, newline).trim();
    const body = newline === -1 ? "" : chunk.slice(newline + 1).trimEnd();
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

export function parseBentoSections(markdown: string): BentoSection[] {
  const trimmed = markdown.replace(/^\uFEFF/, "");
  const sections = splitOnHeading(trimmed, /^###\s+/m);
  if (hasHeadedSection(sections)) return mergeStraySections(sections);

  // The prompt asks for "### " headings, but a model that answers with "## "
  // instead would otherwise collapse into one untitled card. Only "##" is worth
  // retrying: "####" is plausible as a subheading inside a well formed section,
  // so falling back to it could shred a response rather than rescue one.
  const relaxed = splitOnHeading(trimmed, /^##\s+/m);
  return hasHeadedSection(relaxed) ? mergeStraySections(relaxed) : sections;
}

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
