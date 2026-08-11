/** Kept in sync with the same limit enforced by `app/api/chat/route.ts`. */
export const MAX_TRANSCRIPT_CHARACTERS = 150_000;

/**
 * Generous next to the character limit, because UTF-16 exports carry two bytes
 * per character. This only exists to reject a file that would lock the tab up
 * while `FileReader` works through it.
 */
export const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024;

export const ACCEPTED_EXTENSIONS = [".txt", ".srt", ".vtt"] as const;

export const ACCEPTED_EXTENSIONS_LABEL = ".txt, .srt, or .vtt";

export const TOO_LONG_MESSAGE =
  "Transcript is too long. Please trim it to under 150,000 characters (approximately 2 hours of speech).";

export function extension(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

function formatMegabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/** Returns a message to show the user, or null when the file looks usable. */
export function describeFileProblem(file: {
  name: string;
  size: number;
}): string | null {
  const ext = extension(file.name);
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
    return `Please upload a ${ACCEPTED_EXTENSIONS_LABEL} file.`;
  }
  if (file.size > MAX_TRANSCRIPT_BYTES) {
    return `That file is ${formatMegabytes(
      file.size,
    )}, which is larger than this tool can read. Please upload a transcript under ${formatMegabytes(
      MAX_TRANSCRIPT_BYTES,
    )}.`;
  }
  return null;
}

/**
 * Returns a message to show the user, or null when the text can be sent. The
 * server checks the length too; checking here as well saves a round trip and
 * tells the user immediately.
 */
export function describeTranscriptProblem(
  text: string,
  source: "upload" | "paste",
): string | null {
  if (!text.trim()) {
    return source === "paste"
      ? "Please paste a transcript before generating."
      : "That file has no readable text in it. Please upload a transcript with content.";
  }
  if (text.length > MAX_TRANSCRIPT_CHARACTERS) return TOO_LONG_MESSAGE;
  return null;
}

/**
 * Decodes an uploaded transcript, honouring a byte order mark. Windows tools
 * still export UTF-16, which decodes to mojibake if it is assumed to be UTF-8,
 * and `FileReader.readAsText` assumes UTF-8 unless told otherwise.
 */
export function decodeTranscriptBytes(bytes: Uint8Array): string {
  const [a, b, c] = bytes;

  if (a === 0xff && b === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (a === 0xfe && b === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  if (a === 0xef && b === 0xbb && c === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  return new TextDecoder("utf-8").decode(bytes);
}
