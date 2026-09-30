/**
 * Cloudflare's published edge ranges (https://www.cloudflare.com/ips-v4 and
 * /ips-v6, fetched 2026-09-30). The custom domain is proxied through
 * Cloudflare in front of Vercel, so a request's connecting address is a
 * Cloudflare edge and the visitor's own address arrives in `cf-connecting-ip`.
 * That header can be sent by anyone who calls the Vercel origin directly, so
 * it is only trusted when the connecting address is one of these ranges.
 *
 * Cloudflare changes this list rarely. If it does, an edge outside it simply
 * falls back to the old behavior (bucketing by edge address), never to trusting
 * a forged header.
 */
const V4 = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];
const V6 = [
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
  "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
];

function v4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    n = n * 256 + octet;
  }
  return n;
}

function v6ToBigInt(ip: string): bigint | null {
  const halves = ip.toLowerCase().split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  let n = BigInt(0);
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    n = (n << BigInt(16)) + BigInt(parseInt(group, 16));
  }
  return n;
}

function inV4(ip: number, cidr: string): boolean {
  const [base, bits] = cidr.split("/");
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return ((ip & mask) >>> 0) === ((v4ToInt(base)! & mask) >>> 0);
}

function inV6(ip: bigint, cidr: string): boolean {
  const [base, bits] = cidr.split("/");
  const shift = BigInt(128 - Number(bits));
  return ip >> shift === v6ToBigInt(base)! >> shift;
}

export function isCloudflareIp(ip: string): boolean {
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const v4 = v4ToInt(mapped ? mapped[1] : ip);
  if (v4 !== null) return V4.some((cidr) => inV4(v4, cidr));
  const v6 = v6ToBigInt(ip);
  if (v6 !== null) return V6.some((cidr) => inV6(v6, cidr));
  return false;
}
