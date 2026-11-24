import test from "node:test";
import assert from "node:assert/strict";
import { APICallError, StreamProviderError } from "ai";
import { protectAiStreamErrors, sanitizeAiError } from "../lib/aiErrorLog.ts";

function geminiHttpError() {
  return new APICallError({
    message: "private sermon text https://provider.example/?key=fixture-key",
    url: "https://provider.example/?key=fixture-key",
    requestBodyValues: { system: "private prompt", text: "private sermon text" },
    statusCode: 429,
    responseHeaders: { authorization: "Bearer fixture-key" },
    responseBody: "private response body",
    cause: new Error("private cause"),
    data: { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "private model response" } },
  });
}

test("Gemini HTTP and retry errors retain only recognized diagnostics", () => {
  const error = geminiHttpError();
  const expected = {
    event: "AI_ROUTE_ERROR",
    errorName: "AI_APICallError",
    statusCode: 429,
    providerCode: "RESOURCE_EXHAUSTED",
  };
  assert.deepEqual(sanitizeAiError(error), expected);
  assert.deepEqual(sanitizeAiError({ name: "AI_RetryError", lastError: error, errors: [error] }), {
    ...expected,
    errorName: "AI_RetryError",
  });
});

test("Gemini stream errors retain a recognized type or numeric code", () => {
  assert.deepEqual(sanitizeAiError(new StreamProviderError({
    message: "private stream data",
    type: "UNAVAILABLE",
    code: 503,
    statusCode: 503,
  })), {
    event: "AI_ROUTE_ERROR",
    errorName: "AI_StreamProviderError",
    statusCode: 503,
    providerCode: "UNAVAILABLE",
  });
  assert.deepEqual(sanitizeAiError(new StreamProviderError({
    message: "private stream data",
    type: "PRIVATE_SERMON_TEXT",
    code: 14,
  })), {
    event: "AI_ROUTE_ERROR",
    errorName: "AI_StreamProviderError",
    providerCode: 14,
  });
});

test("arbitrary names, codes, fields and thrown values are excluded", () => {
  const unknown = { event: "AI_ROUTE_ERROR", errorName: "UnknownError" };
  for (const value of [
    null,
    "private transcript",
    { get name() { throw new Error("private message"); } },
    { name: "PrivateError", statusCode: 600, code: "PRIVATE_TOKEN", type: "key=fixture-key" },
    { statusCode: "429", data: { error: { status: "PRIVATE_TEXT", code: 4.5 } } },
  ]) {
    assert.deepEqual(sanitizeAiError(value), unknown);
  }
  assert.deepEqual(sanitizeAiError(new TypeError("private message")), { ...unknown, errorName: "TypeError" });
});

test("a rejected response stream forwards a fixed error and logs only safe fields", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const source = new ReadableStream<Uint8Array>({
    pull(controller) { controller.error(geminiHttpError()); },
  });
  const response = protectAiStreamErrors(new Response(source));
  await assert.rejects(response.text(), (error: Error) => {
    assert.equal(error.message, "AI response stream failed");
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.deepEqual(log.mock.calls.map(call => call.arguments), [[{
    event: "AI_ROUTE_ERROR",
    errorName: "AI_APICallError",
    statusCode: 429,
    providerCode: "RESOURCE_EXHAUSTED",
  }]]);
});

test("the stream guard preserves successful responses and forwards cancellation", async () => {
  const response = protectAiStreamErrors(new Response("analysis", { headers: { "Content-Type": "text/plain" } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/plain");
  assert.equal(await response.text(), "analysis");

  let cancelledWith: unknown;
  const source = new ReadableStream<Uint8Array>({
    cancel(reason) { cancelledWith = reason; },
  });
  const reader = protectAiStreamErrors(new Response(source)).body!.getReader();
  const pending = reader.read();
  await reader.cancel("client disconnected");
  assert.deepEqual(await pending, { done: true, value: undefined });
  assert.equal(cancelledWith, "client disconnected");
  assert.equal(source.locked, false);
});

test("upstream cancellation failures also exclude provider details", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const source = new ReadableStream<Uint8Array>({
    cancel() { throw new TypeError("private cancellation reason"); },
  });
  const response = protectAiStreamErrors(new Response(source));
  await assert.rejects(response.body!.cancel(), (error: Error) => {
    assert.equal(error.message, "AI response stream cancellation failed");
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.deepEqual(log.mock.calls.map(call => call.arguments), [[{
    event: "AI_ROUTE_ERROR",
    errorName: "TypeError",
  }]]);
  assert.equal(source.locked, false);
});
