export type BoundedBodyResult =
  | { ok: true; text: string }
  | { ok: false; reason: "too-large" };

/**
 * Reads a request body up to `maxBytes`, refusing before the rest of it is
 * ever buffered or decoded, rather than after.
 *
 * `await req.json()` fully reads, decodes, and JSON-parses the entire body
 * before any application code gets a chance to look at its size - so a
 * request large enough to matter pays that full cost regardless of what
 * happens next (AUDIT.md followup 5). This checks the declared
 * Content-Length first (a lying or absent header just skips straight to the
 * stream), then reads the stream chunk by chunk, cancelling it and bailing
 * out the moment the running total crosses `maxBytes` instead of waiting for
 * a `done` that may never come at a bounded size.
 */
export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  contentLength: string | null,
  maxBytes: number,
): Promise<BoundedBodyResult> {
  const declared = contentLength === null ? NaN : Number(contentLength);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: "too-large" };
  }

  if (!body) return { ok: true, text: "" };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {
        // The stream is being abandoned either way; a failed cancel doesn't
        // change that.
      });
      return { ok: false, reason: "too-large" };
    }

    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, text: new TextDecoder().decode(combined) };
}
