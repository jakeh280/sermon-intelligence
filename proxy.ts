import { NextRequest, NextResponse } from "next/server";

const ipStore = new Map<string, { count: number; windowStart: number }>();

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS = 5;

function getIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

function evictStale() {
  const now = Date.now();
  for (const [ip, entry] of ipStore) {
    if (now - entry.windowStart > WINDOW_MS) ipStore.delete(ip);
  }
}

export function proxy(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/api/chat")) {
    return NextResponse.next();
  }

  evictStale();

  const ip = getIp(req);
  const now = Date.now();
  const entry = ipStore.get(ip);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    ipStore.set(ip, { count: 1, windowStart: now });
    return NextResponse.next();
  }

  if (entry.count >= MAX_REQUESTS) {
    const resetInMs = WINDOW_MS - (now - entry.windowStart);
    const resetInMin = Math.ceil(resetInMs / 60000);
    return new NextResponse(
      JSON.stringify({
        error: `Rate limit reached. Try again in ${resetInMin} minute${resetInMin !== 1 ? "s" : ""}.`,
      }),
      {
        status: 429,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  entry.count++;
  return NextResponse.next();
}

export const config = {
  matcher: "/api/chat",
};
