import { NextRequest, NextResponse } from "next/server";
import {
  BURST_MAX_REQUESTS,
  BURST_WINDOW_MS,
} from "@/lib/rateLimitConfig";
import { checkAndRecord, getClientIp } from "@/lib/proxyRateLimit";

const ipStore = new Map<string, number[]>();

export function proxy(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/api/chat")) {
    return NextResponse.next();
  }

  const ip = getClientIp(req.headers);
  const result = checkAndRecord(
    ipStore,
    ip,
    Date.now(),
    BURST_WINDOW_MS,
    BURST_MAX_REQUESTS,
  );

  if (result.limited) {
    const retryAfter = result.resetInMinutes * 60;
    return new NextResponse(
      JSON.stringify({ error: "Too many requests at once. Please wait a minute and try again." }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfter),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/chat",
};
