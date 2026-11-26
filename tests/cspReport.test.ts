import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/csp-report/route.ts";

const endpoint = "https://sermon.example/api/csp-report";
const legacyType = "application/csp-report";
const reportingType = "application/reports+json";

function request(type: string, body: string) {
  return new Request(endpoint, {
    method: "POST",
    headers: { "Content-Type": type, Cookie: "secret=fixture", "X-Forwarded-For": "192.0.2.12" },
    body,
  });
}

test("legacy reports log only the directive, blocked origin, document path and disposition", async (t) => {
  const log = t.mock.method(console, "info", () => {});
  const response = await POST(request(`${legacyType}; charset=utf-8`, JSON.stringify({
    "csp-report": {
      "violated-directive": "script-src 'self'",
      "blocked-uri": "https://user:password@cdn.example:8443/script.js?secret=fixture#token",
      "document-uri": "https://sermon.example/demo?secret=fixture#token",
      "script-sample": "private script sample",
      "source-file": "https://sermon.example/source.js?secret=fixture",
      "disposition": "report",
    },
  })));
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.deepEqual(log.mock.calls.map(({ arguments: args }) => args), [
    ['{"directive":"script-src","blocked":"https://cdn.example:8443","path":"/demo","disposition":"report"}'],
  ]);
});

test("Reporting API batches log each CSP violation with safe URL keywords and no IP literals", async (t) => {
  const log = t.mock.method(console, "info", () => {});
  const blockedValues = [
    ["inline", "inline"],
    ["eval", "eval"],
    ["data:text/javascript,private source", "data"],
    ["blob:https://sermon.example/opaque-id", "blob"],
    ["self", "self"],
    ["https://192.0.2.12/script.js", null],
    ["https://[2001:db8::1]/script.js", null],
    ["javascript:private source", null],
  ] as const;
  const reports = blockedValues.map(([blockedURL]) => ({
    type: "csp-violation",
    url: "https://sermon.example/private?secret=fixture",
    body: {
      effectiveDirective: "script-src-elem",
      blockedURL,
      documentURL: "https://sermon.example/?secret=fixture",
      sample: "private source",
      disposition: "enforce",
    },
  }));
  const response = await POST(request(reportingType, JSON.stringify([
    { type: "deprecation", body: reports[0].body },
    { type: "csp-violation", body: { ...reports[0].body, effectiveDirective: "private source" } },
    { type: "csp-violation", body: null },
    ...reports,
  ])));
  assert.equal(response.status, 204);
  assert.deepEqual(log.mock.calls.map(({ arguments: args }) => args), blockedValues.map(([, blocked]) => [
    JSON.stringify({ directive: "script-src-elem", blocked, path: "/", disposition: "enforce" }),
  ]));
});

test("unsupported, malformed, oversized and unreadable bodies receive an empty 204", async (t) => {
  const log = t.mock.method(console, "info", () => {});
  const payload = JSON.stringify({
    "csp-report": {
      "effective-directive": "img-src",
      "document-uri": "https://sermon.example/",
      "blocked-uri": "https://cdn.example/",
    },
  });
  const oversized = request(legacyType, payload + " ".repeat(8192));
  oversized.headers.set("Content-Length", String(payload.length));
  const unreadable = request(legacyType, payload);
  await unreadable.text();

  for (const input of [
    request("text/plain", payload),
    request(legacyType, "{"),
    request(reportingType, "{}"),
    oversized,
    unreadable,
  ]) {
    const response = await POST(input);
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
  }
  assert.equal(log.mock.callCount(), 0);
});

test("valid reports share a bounded log allowance that recovers after a minute", async (t) => {
  const log = t.mock.method(console, "info", () => {});
  const now = t.mock.method(Date, "now", () => Date.UTC(2099, 0, 1));
  const violation = {
    type: "csp-violation",
    body: { effectiveDirective: "img-src", documentURL: "https://sermon.example/" },
  };
  const batch = JSON.stringify(Array(40).fill(violation));
  for (let i = 0; i < 2; i++) {
    assert.equal((await POST(request(reportingType, batch))).status, 204);
  }
  assert.equal(log.mock.callCount(), 60);
  now.mock.mockImplementation(() => Date.UTC(2099, 0, 1, 0, 1));
  await POST(request(reportingType, JSON.stringify([violation])));
  assert.equal(log.mock.callCount(), 61);
});
