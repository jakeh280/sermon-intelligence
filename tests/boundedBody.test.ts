import assert from "node:assert/strict";
import test from "node:test";

import { readBoundedBody } from "../lib/boundedBody.ts";

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
}

test("a body under the cap is read back whole", async () => {
  const result = await readBoundedBody(
    streamFrom(['{"text":"hello"}']),
    null,
    1000,
  );
  assert.deepEqual(result, { ok: true, text: '{"text":"hello"}' });
});

test("a body split across multiple chunks is reassembled in order", async () => {
  const result = await readBoundedBody(
    streamFrom(["{\"text\":\"", "hello ", "world\"}"]),
    null,
    1000,
  );
  assert.deepEqual(result, { ok: true, text: '{"text":"hello world"}' });
});

test("a declared Content-Length over the cap is refused without reading the stream", async () => {
  // A bare `new ReadableStream()` can have its underlying source's `pull`
  // called eagerly by the engine to prime the internal queue, independent of
  // whether anything ever attaches a reader - so `getReader` itself (what
  // readBoundedBody would have to call to actually consume the stream) is
  // the precise thing to spy on here, not `pull`.
  const stream = streamFrom(["a".repeat(2000)]);
  let readerRequested = false;
  const realGetReader = stream.getReader.bind(stream);
  // readBoundedBody only ever calls the no-argument, default-reader overload,
  // so the spy doesn't need to reproduce ReadableStream.getReader's full
  // overload set - it only needs to intercept that one call shape.
  (stream as { getReader: () => ReadableStreamDefaultReader<Uint8Array> }).getReader =
    () => {
      readerRequested = true;
      return realGetReader();
    };

  const result = await readBoundedBody(stream, "2000", 1000);
  assert.deepEqual(result, { ok: false, reason: "too-large" });
  assert.equal(readerRequested, false);
});

test("actual bytes crossing the cap are refused even with no Content-Length header", async () => {
  const result = await readBoundedBody(
    streamFrom(["a".repeat(600), "a".repeat(600)]),
    null,
    1000,
  );
  assert.deepEqual(result, { ok: false, reason: "too-large" });
});

test("a lying Content-Length under the cap does not exempt the actual bytes from the check", async () => {
  const result = await readBoundedBody(
    streamFrom(["a".repeat(2000)]),
    "10",
    1000,
  );
  assert.deepEqual(result, { ok: false, reason: "too-large" });
});

test("exactly at the cap is accepted, one byte over is refused", async () => {
  const atCap = await readBoundedBody(streamFrom(["a".repeat(1000)]), null, 1000);
  assert.equal(atCap.ok, true);

  const overCap = await readBoundedBody(streamFrom(["a".repeat(1001)]), null, 1000);
  assert.deepEqual(overCap, { ok: false, reason: "too-large" });
});

test("a null body reads as empty text", async () => {
  const result = await readBoundedBody(null, null, 1000);
  assert.deepEqual(result, { ok: true, text: "" });
});

test("multi-byte UTF-8 text decodes correctly within the cap", async () => {
  const text = '{"text":"Grace and peace to you 🙏"}';
  const result = await readBoundedBody(streamFrom([text]), null, 1000);
  assert.deepEqual(result, { ok: true, text });
});
