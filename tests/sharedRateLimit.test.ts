import test from "node:test";
import assert from "node:assert/strict";
import { sharedRateLimit } from "../lib/sharedRateLimit.ts";
const settings = { url: "https://limits.example/consume/production", secret: "test-secret", required: true };
test("shared admission hashes addresses and sends no transcript", async () => {
  const result = await sharedRateLimit("192.0.2.10", settings, async (url, init) => {
    assert.equal(String(url), settings.url);
    const body = JSON.parse(String(init?.body));
    assert.match(body.ip, /^[a-f0-9]{64}$/);
    assert.equal(String(init?.body).includes("192.0.2.10"), false);
    assert.deepEqual(Object.keys(body), ["ip"]);
    assert.equal(init?.redirect, "error");
    return Response.json({ allowed: true });
  });
  assert.deepEqual(result, { allowed: true });
});
test("shared limits preserve reset time and failures never admit a provider call", async () => {
  assert.deepEqual(await sharedRateLimit("test", settings, async () => Response.json({ allowed: false, retryAfter: 601 })), { allowed: false, status: 429, retryAfter: 601 });
  for (const response of [() => Response.json({}), () => Response.json({ allowed: false, retryAfter: -1 }), () => Response.json({ allowed: "true" }), () => new Response("unavailable", { status: 503 }), () => { throw Error("timeout"); }]) {
    assert.deepEqual(await sharedRateLimit("test", settings, async () => response()), { allowed: false, status: 503, retryAfter: 60 });
  }
  assert.deepEqual(await sharedRateLimit("test", { url: undefined, secret: undefined, required: true }), { allowed: false, status: 503, retryAfter: 60 });
  assert.deepEqual(await sharedRateLimit("test", { url: undefined, secret: undefined, required: false }), { allowed: true });
  let contacted = false;
  await sharedRateLimit("test", { ...settings, url: "http://insecure.example" }, async () => { contacted = true; return Response.json({ allowed: true }); });
  assert.equal(contacted, false);
});
