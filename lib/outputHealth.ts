// The explicit .ts extension lets `npm test` load this under
// --experimental-strip-types, which does not resolve extensionless imports.
import {
  CLIP_FIELD_LABELS,
  DRAFT_SECTION_TITLE,
  isChaptersSectionTitle,
  isClipsSectionTitle,
  isDescriptionSectionTitle,
  isTitlesSectionTitle,
  parseBentoSections,
  parseClipOptions,
} from "./outputParsing.ts";

export type OutputIssueCode =
  | "empty"
  | "unstructured"
  | "missing-sections"
  | "incomplete-clips";

export type OutputIssue = {
  code: OutputIssueCode;
  message: string;
};

const EXPECTED_SECTIONS = [
  { label: "Titles", matches: isTitlesSectionTitle },
  { label: "Description", matches: isDescriptionSectionTitle },
  { label: "Chapters", matches: isChaptersSectionTitle },
  { label: "Clips", matches: isClipsSectionTitle },
] as const;

// The prompt asks for exactly 3 clip options (lib/systemPrompt.ts, "Identify
// 3 stand-alone moments"), each with every field in CLIP_FIELD_LABELS filled
// in. An untimed transcript's clips are still "filled in" in this sense: the
// prompt has them write the literal "Not available (...)" string into
// Timestamps and Duration rather than leaving those fields blank.
const EXPECTED_CLIP_COUNT = 3;

export const EMPTY_OUTPUT_MESSAGE =
  "The AI returned an empty response. Nothing was generated, so please try again.";

function listSectionNames(names: string[]): string {
  if (names.length === 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Describes what is wrong with a completed model response, so the UI can say so
 * instead of rendering a blank or half built view.
 *
 * Only call this once a stream has finished. Every partial stream is legitimately
 * missing sections, so running it mid stream reports issues that are about to
 * resolve themselves.
 */
export function describeOutputIssues(output: string): OutputIssue[] {
  if (!output.trim()) {
    return [{ code: "empty", message: EMPTY_OUTPUT_MESSAGE }];
  }

  const sections = parseBentoSections(output);
  const headed = sections.filter(
    (section) => section.title !== DRAFT_SECTION_TITLE,
  );

  if (headed.length === 0) {
    return [
      {
        code: "unstructured",
        message:
          "The AI response came back without any section headings, so it is shown below as plain text.",
      },
    ];
  }

  // A heading can arrive with nothing under it - a response cut off right
  // after "### Clips" still has a "Clips" heading, but no body worth calling
  // present. That reads the same as the heading never arriving at all, so
  // both count as missing rather than needing a separate issue code.
  const missing = EXPECTED_SECTIONS.filter((expected) => {
    const section = headed.find((s) => expected.matches(s.title));
    return !section || !section.body.trim();
  }).map((expected) => expected.label);

  if (missing.length > 0) {
    return [
      {
        code: "missing-sections",
        message: `This response looks incomplete. ${listSectionNames(
          missing,
        )} ${missing.length === 1 ? "is" : "are"} missing, so generate again for a full result.`,
      },
    ];
  }

  // Nonempty section bodies still can't prove the Clips section actually
  // finished: a response can be cut off mid-clip, or stop after only one or
  // two of the three requested options, while the body up to that point
  // reads as perfectly nonempty text.
  const clipsSection = headed.find((section) => isClipsSectionTitle(section.title));
  const clips = clipsSection ? parseClipOptions(clipsSection.body).clips : [];

  if (clips.length < EXPECTED_CLIP_COUNT) {
    return [
      {
        code: "incomplete-clips",
        message: `This response looks incomplete. Only ${clips.length} of ${EXPECTED_CLIP_COUNT} expected clips arrived, so generate again for a full result.`,
      },
    ];
  }

  const incompleteClip = clips.find((clip) =>
    CLIP_FIELD_LABELS.some((label) => !clip[label]?.trim()),
  );

  if (incompleteClip) {
    return [
      {
        code: "incomplete-clips",
        message: `This response looks incomplete. ${incompleteClip.optionLabel} is missing a field, so generate again for a full result.`,
      },
    ];
  }

  return [];
}
