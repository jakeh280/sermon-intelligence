import assert from "node:assert/strict";
import test from "node:test";
import nextConfig from "../next.config.ts";

test("all routes receive the report-only Content Security Policy", async () => {
  const rules = await nextConfig.headers?.();
  const rule = rules?.find(({ source }) => source === "/:path*");
  assert.ok(rule);
  const headers = new Headers(rule.headers.map(({ key, value }) => [key, value]));
  const policy = headers.get("Content-Security-Policy-Report-Only");
  assert.ok(policy);
  assert.equal(headers.has("Content-Security-Policy"), false);
  assert.ok(policy.split("; ").includes("connect-src 'self'"));
  assert.ok(policy.split("; ").includes("report-uri /api/csp-report"));
  assert.ok(policy.split("; ").includes("report-to csp-endpoint"));
  assert.equal(headers.get("Reporting-Endpoints"), 'csp-endpoint="/api/csp-report"');
});
