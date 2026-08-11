import assert from "node:assert/strict";
import test from "node:test";

import type { HistoryItem } from "../lib/history.ts";
import {
  clearStoredHistory,
  createHistoryId,
  HISTORY_KEY,
  readHistory,
  writeHistory,
  type HistoryStorage,
} from "../lib/historyStorage.ts";
import {
  describeRequestFailure,
  GENERIC_MESSAGE,
  OFFLINE_MESSAGE,
  STALL_MESSAGE,
  StalledResponseError,
} from "../lib/requestErrors.ts";
import {
  decodeTranscriptBytes,
  describeFileProblem,
  describeTranscriptProblem,
  MAX_TRANSCRIPT_BYTES,
  MAX_TRANSCRIPT_CHARACTERS,
  TOO_LONG_MESSAGE,
} from "../lib/transcriptInput.ts";

function item(id: string, output = "Synthetic output"): HistoryItem {
  return {
    id,
    timestamp: 1,
    label: "Synthetic label",
    output,
    clipMinSec: 15,
    clipMaxSec: 120,
  };
}

function fakeStorage(options: { maxLength?: number } = {}): HistoryStorage & {
  value: string | null;
} {
  const max = options.maxLength ?? Infinity;
  return {
    value: null,
    getItem() {
      return this.value;
    },
    setItem(_key: string, value: string) {
      if (value.length > max) throw new Error("QuotaExceededError");
      this.value = value;
    },
    removeItem() {
      this.value = null;
    },
  };
}

test("history survives storage being unavailable entirely", () => {
  assert.deepEqual(readHistory(null), []);
  assert.deepEqual(writeHistory(null, [item("a")]), [item("a")]);
  assert.doesNotThrow(() => clearStoredHistory(null));
});

test("history survives a storage that throws on read", () => {
  const hostile: HistoryStorage = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {},
    removeItem() {},
  };
  assert.deepEqual(readHistory(hostile), []);
});

test("a write that fits is persisted and read back", () => {
  const storage = fakeStorage();
  const saved = writeHistory(storage, [item("a"), item("b")]);
  assert.equal(saved.length, 2);
  assert.deepEqual(readHistory(storage), saved);
  assert.equal(storage.value !== null, true);
});

test("writes are capped at ten entries", () => {
  const storage = fakeStorage();
  const many = Array.from({ length: 14 }, (_, i) => item(`id-${i}`));
  const saved = writeHistory(storage, many);
  assert.equal(saved.length, 10);
  assert.equal(saved[0]?.id, "id-0");
});

test("a quota failure drops the oldest entries instead of throwing", () => {
  const storage = fakeStorage();
  const three = [item("newest"), item("middle"), item("oldest")];
  const roomForTwo = JSON.stringify(three.slice(0, 2)).length;

  const capped = fakeStorage({ maxLength: roomForTwo });
  const saved = writeHistory(capped, three);

  assert.equal(saved.length, 2);
  assert.equal(saved[0]?.id, "newest");
  assert.deepEqual(readHistory(capped), saved);
  assert.deepEqual(readHistory(storage), []);
});

test("a storage that refuses every write reports an empty history", () => {
  const refusing = fakeStorage({ maxLength: 0 });
  assert.deepEqual(writeHistory(refusing, [item("a")]), []);
  assert.equal(refusing.value, null);
});

test("history ids are unique and survive crypto.randomUUID being unavailable", () => {
  const ids = new Set(Array.from({ length: 50 }, () => createHistoryId()));
  assert.equal(ids.size, 50);

  const original = globalThis.crypto.randomUUID;
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    configurable: true,
    value: () => {
      throw new Error("SecurityError");
    },
  });
  try {
    const fallback = createHistoryId();
    assert.equal(typeof fallback, "string");
    assert.equal(fallback.length > 0, true);
    assert.notEqual(fallback, createHistoryId());
  } finally {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: original,
    });
  }
});

test("clearing removes the stored entry", () => {
  const storage = fakeStorage();
  writeHistory(storage, [item("a")]);
  clearStoredHistory(storage);
  assert.equal(storage.getItem(HISTORY_KEY), null);
});

test("request failures are described in words a user can act on", () => {
  assert.equal(describeRequestFailure(new StalledResponseError()), STALL_MESSAGE);

  const aborted = new Error("The user aborted a request.");
  aborted.name = "AbortError";
  assert.equal(describeRequestFailure(aborted), STALL_MESSAGE);

  assert.equal(
    describeRequestFailure(new TypeError("Failed to fetch")),
    OFFLINE_MESSAGE,
  );
  assert.equal(
    describeRequestFailure(new Error("Transcript is too long.")),
    "Transcript is too long.",
  );
  assert.equal(describeRequestFailure(new Error("   ")), GENERIC_MESSAGE);
  assert.equal(describeRequestFailure("a bare string"), GENERIC_MESSAGE);
  assert.equal(describeRequestFailure(undefined), GENERIC_MESSAGE);
});

test("accepted uploads are limited by extension and size", () => {
  assert.equal(describeFileProblem({ name: "sermon.txt", size: 1000 }), null);
  assert.equal(describeFileProblem({ name: "sermon.srt", size: 1000 }), null);
  assert.equal(describeFileProblem({ name: "sermon.vtt", size: 1000 }), null);
  assert.equal(describeFileProblem({ name: "SERMON.TXT", size: 1000 }), null);

  assert.match(
    describeFileProblem({ name: "sermon.docx", size: 1000 }) ?? "",
    /\.txt, \.srt, or \.vtt/,
  );
  assert.match(
    describeFileProblem({ name: "noextension", size: 1000 }) ?? "",
    /\.txt, \.srt, or \.vtt/,
  );
  assert.match(
    describeFileProblem({ name: "sermon.txt", size: MAX_TRANSCRIPT_BYTES + 1 }) ?? "",
    /larger than this tool can read/,
  );
});

test("blank and oversized transcripts are refused before the request", () => {
  assert.match(describeTranscriptProblem("   \n ", "paste") ?? "", /Please paste/);
  assert.match(
    describeTranscriptProblem("", "upload") ?? "",
    /no readable text/,
  );
  assert.equal(
    describeTranscriptProblem("a".repeat(MAX_TRANSCRIPT_CHARACTERS + 1), "paste"),
    TOO_LONG_MESSAGE,
  );
  assert.equal(
    describeTranscriptProblem("a".repeat(MAX_TRANSCRIPT_CHARACTERS), "paste"),
    null,
  );
  assert.equal(describeTranscriptProblem("Synthetic transcript.", "upload"), null);
});

test("uploads are decoded according to their byte order mark", () => {
  const text = "Synthetic transcript line.";

  const utf8 = new TextEncoder().encode(text);
  assert.equal(decodeTranscriptBytes(utf8), text);

  const utf8Bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]);
  assert.equal(decodeTranscriptBytes(utf8Bom), text);

  const utf16le = new Uint8Array(2 + text.length * 2);
  utf16le[0] = 0xff;
  utf16le[1] = 0xfe;
  const leView = new DataView(utf16le.buffer);
  for (let i = 0; i < text.length; i += 1) {
    leView.setUint16(2 + i * 2, text.charCodeAt(i), true);
  }
  assert.equal(decodeTranscriptBytes(utf16le), text);

  const utf16be = new Uint8Array(2 + text.length * 2);
  utf16be[0] = 0xfe;
  utf16be[1] = 0xff;
  const beView = new DataView(utf16be.buffer);
  for (let i = 0; i < text.length; i += 1) {
    beView.setUint16(2 + i * 2, text.charCodeAt(i), false);
  }
  assert.equal(decodeTranscriptBytes(utf16be), text);

  assert.equal(decodeTranscriptBytes(new Uint8Array(0)), "");
});
