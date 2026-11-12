import assert from "node:assert/strict";
import test from "node:test";
import { checkProduction } from "../scripts/check-production.ts";
import { DEMO_OUTPUT } from "../lib/demoContent.ts";

test("monitor refuses broken or misleading health responses", async () => {
  for (const response of [() => new Response(null, { status: 503 }), () => Response.json({ healthy: false }), () => Response.json({})]) {
    await assert.rejects(checkProduction(async () => response()), /health check failed/);
  }
});

test("scheduled health probes make no generation request", async () => {
  let calls = 0;
  await checkProduction(async (url) => {
    assert.equal(String(url), "https://www.sermonintelligence.com/api/health");
    calls++;
    return Response.json({ healthy: true });
  });
  assert.equal(calls, 1);
});

test("deployment smoke check catches HTTP errors and empty or partial successful streams", async () => {
  for (const response of [() => new Response(null, { status: 503 }), () => new Response(""), () => new Response("### Titles\nOnly a title")]) {
    await assert.rejects(checkProduction(async (url) => String(url).endsWith("/api/health")
      ? Response.json({ healthy: true }) : response(), true), /generation failed|output failed/);
  }
  await checkProduction(async (url, init) => {
    if (String(url).endsWith("/api/health")) return Response.json({ healthy: true });
    assert.equal(init?.method, "POST");
    assert.ok(JSON.parse(String(init?.body)).text.includes("John 15"));
    return new Response(DEMO_OUTPUT);
  }, true);
});
