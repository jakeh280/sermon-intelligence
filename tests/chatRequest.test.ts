import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const aliases = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith("@/")
      ? new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href
      : specifier, context);
  },
});
const { POST } = await import("../app/api/chat/route.ts");
aliases.deregister();

test("chat checks the complete JSON media type and accepts parameters", async () => {
  for (const [type, status] of [
    ["application/jsonp", 415],
    ["Application/JSON; charset=utf-8", 400],
  ] as const) {
    const request = new Request("https://example.test/api/chat", {
      method: "POST", headers: { "content-type": type }, body: "{",
    });
    assert.equal((await POST(request)).status, status);
  }
});

test("an interrupted chat upload returns the existing invalid JSON response", async () => {
  const request = new Request("https://example.test/api/chat", {
    method: "POST", headers: { "content-type": "application/json" }, body: new ReadableStream({
      start(controller) { controller.error(new Error("upload interrupted")); },
    }), duplex: "half",
  } as RequestInit);
  const response = await POST(request);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid JSON body" });
});
