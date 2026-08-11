import {
  DRAFT_SECTION_TITLE,
  isChaptersSectionTitle,
  isClipsSectionTitle,
  isDescriptionSectionTitle,
  isTitlesSectionTitle,
  parseBentoSections,
// Explicit extension so `npm test` can load this under --experimental-strip-types.
} from "./outputParsing.ts";

export type OutputIssueCode = "empty" | "unstructured" | "missing-sections";

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

  const missing = EXPECTED_SECTIONS.filter(
    (expected) => !headed.some((section) => expected.matches(section.title)),
  ).map((expected) => expected.label);

  if (missing.length === 0) return [];

  return [
    {
      code: "missing-sections",
      message: `This response looks incomplete. ${listSectionNames(
        missing,
      )} ${missing.length === 1 ? "is" : "are"} missing, so generate again for a full result.`,
    },
  ];
}
