const PREMIERE_RANGE =
  /^(\d{2}:\d{2}:\d{2}:\d{2})\s+-\s+(\d{2}:\d{2}:\d{2}:\d{2})\s*$/;

function premiereRange(line: string): RegExpMatchArray | null {
  return line.trim().match(PREMIERE_RANGE);
}

/**
 * Converts Premiere style transcript blocks into the timestamp tags the analysis
 * prompt expects. Plain text, SRT, and already tagged transcripts pass through.
 */
export function normalizeTranscript(input: string): string {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  if (!lines.some((line) => premiereRange(line))) return input;

  const output: string[] = [];
  let awaitingSpeaker = false;

  for (const line of lines) {
    const match = premiereRange(line);
    if (match) {
      output.push(`[${match[1]}]`);
      awaitingSpeaker = true;
      continue;
    }

    if (awaitingSpeaker) {
      if (!line.trim()) {
        output.push(line);
        continue;
      }

      awaitingSpeaker = false;
      if (line.trim().toLowerCase() === "unknown") continue;
    }

    output.push(line);
  }

  return output.join("\n");
}
