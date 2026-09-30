import assert from "node:assert/strict";
import test from "node:test";

import { isCloudflareIp } from "../lib/cloudflareIps.ts";

test("recognizes Cloudflare edge addresses, IPv4 and IPv6", () => {
  assert.equal(isCloudflareIp("172.68.10.20"), true); // 172.64.0.0/13
  assert.equal(isCloudflareIp("104.23.255.255"), true); // top of 104.16.0.0/13
  assert.equal(isCloudflareIp("162.159.0.1"), true); // 162.158.0.0/15
  assert.equal(isCloudflareIp("2606:4700:3033::ac43:a1f1"), true);
  assert.equal(isCloudflareIp("2a06:98c7::1"), true); // inside the /29
  assert.equal(isCloudflareIp("::ffff:172.68.10.20"), true); // IPv4-mapped
});

test("rejects everything else, including malformed input", () => {
  assert.equal(isCloudflareIp("1.2.3.4"), false);
  assert.equal(isCloudflareIp("104.24.0.0"), true); // start of 104.24.0.0/14
  assert.equal(isCloudflareIp("104.28.0.0"), false); // just past it
  assert.equal(isCloudflareIp("2a06:98c8::1"), false); // just past the /29
  assert.equal(isCloudflareIp("2001:db8::1"), false);
  assert.equal(isCloudflareIp("unknown"), false);
  assert.equal(isCloudflareIp("999.1.1.1"), false);
  assert.equal(isCloudflareIp(""), false);
});
