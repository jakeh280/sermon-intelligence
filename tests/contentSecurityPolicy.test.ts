import assert from "node:assert/strict";
import test from "node:test";
import nextConfig from "../next.config.ts";

test("all routes receive the report-only Content Security Policy", async () => {
  const rules = await nextConfig.headers?.();
  const rule = rules?.find(({ source }) => source === "/:path*");
  const header = rule?.headers.find(({ key }) => key === "Content-Security-Policy-Report-Only");
  assert.ok(header);
  assert.ok(header.value.split("; ").includes("connect-src 'self'"));
});
