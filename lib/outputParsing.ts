export type BentoSection = { title: string; body: string };

export function parseBentoSections(markdown: string): BentoSection[] {
  const trimmed = markdown.replace(/^\uFEFF/, "");
  const parts = trimmed.split(/^###\s+/m);
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

    for (const key of CLIP_FIELD_LABELS) {
      const starred = new RegExp(
        `^\\s*\\*\\*${escapeRegExp(key)}\\*\\*\\s*:\\s*(.*)$`,
        "i",
      );
      const plain = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:\\s*(.*)$`, "i");
      const match = line.match(starred) ?? line.match(plain);
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
    if (/^Option\s+[123]\s*$/i.test(line.trim())) {
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
      optionLabel: lines[0]?.trim() || "Option",
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
