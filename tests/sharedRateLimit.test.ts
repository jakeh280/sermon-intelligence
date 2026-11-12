import test from "node:test";
import assert from "node:assert/strict";
import { limiterHealth, sharedRateLimit } from "../lib/sharedRateLimit.ts";
const settings = { url: "https://limits.example/consume/production", secret: "test-secret", required: true };
test("health checks authenticate against the matching environment without consuming admission", async () => {
  for (const environment of ["production", "preview"]) {
    assert.equal(await limiterHealth({ ...settings, url: `https://limits.example/consume/${environment}` }, async (url, init) => {
      assert.equal(String(url), `https://limits.example/health/${environment}`);
      assert.equal(init?.method ?? "GET", "GET");
      assert.equal(init?.body, undefined);
      assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${settings.secret}`);
      return Response.json({ healthy: true });
    }), true);
  }
  assert.equal(await limiterHealth({ ...settings, secret: undefined }), false);
  for (const answer of [() => new Response(null, { status: 401 }), () => new Response(null, { status: 500 }), () => Response.json({}), () => Response.json({ healthy: "true" }), () => { throw new TypeError("network failure"); }]) {
    assert.equal(await limiterHealth(settings, async () => answer()), false);
  }
});
test("limiter HTTP diagnostics identify failure without logging credentials or bodies", async (t) => {
  const logs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logs.push(args));
  for (const status of [401, 429, 500, 503]) {
    const result = await sharedRateLimit("private-address", settings, async () => new Response("private-body", { status }));
    assert.deepEqual(result, { allowed: false, status: 503, retryAfter: 60 });
    assert.deepEqual(logs.at(-1), ["ABUSE_LIMITER_UNAVAILABLE", { reason: "http_error", status }]);
  }
  const logged = JSON.stringify(logs);
  for (const privateValue of [settings.secret, settings.url, "private-address", "private-body"]) {
    assert.equal(logged.includes(privateValue), false);
  }
});
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
  assert.deepEqual(await sharedRateLimit("test", settings, async () => Response.json({ allowed: false, retryAfter: 601 })), { allowed: false, status: 429, retryAfter: 601, scope: "address" });
  for (const response of [() => Response.json({}), () => Response.json({ allowed: false, retryAfter: -1 }), () => Response.json({ allowed: "true" }), () => new Response("unavailable", { status: 503 }), () => { throw Error("timeout"); }]) {
    assert.deepEqual(await sharedRateLimit("test", settings, async () => response()), { allowed: false, status: 503, retryAfter: 60 });
  }
  assert.deepEqual(await sharedRateLimit("test", { url: undefined, secret: undefined, required: true }), { allowed: false, status: 503, retryAfter: 60 });
  assert.deepEqual(await sharedRateLimit("test", { url: undefined, secret: undefined, required: false }), { allowed: true });
  let contacted = false;
  await sharedRateLimit("test", { ...settings, url: "http://insecure.example" }, async () => { contacted = true; return Response.json({ allowed: true }); });
  assert.equal(contacted, false);
});
test("a sitewide refusal is told apart from a per-address one", async () => {
  const answer = (body: object) => sharedRateLimit("test", settings, async () => Response.json(body));
  assert.deepEqual(await answer({ allowed: false, retryAfter: 600, scope: "address" }), { allowed: false, status: 429, retryAfter: 600, scope: "address" });
  assert.deepEqual(await answer({ allowed: false, retryAfter: 86_400, scope: "site" }), { allowed: false, status: 429, retryAfter: 86_400, scope: "site" });
  assert.deepEqual(await answer({ allowed: false, retryAfter: 600, scope: "unexpected" }), { allowed: false, status: 429, retryAfter: 600, scope: "address" });
});
