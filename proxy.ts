import { NextRequest, NextResponse } from "next/server";
import {
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from "@/lib/rateLimitConfig";
import { checkAndRecord, getClientIp } from "@/lib/proxyRateLimit";
import { rateLimitMessage } from "@/lib/rateLimitMessage";

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
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX_REQUESTS,
  );

  if (result.limited) {
    const retryAfter = result.resetInMinutes * 60;
    return new NextResponse(
      JSON.stringify({ error: rateLimitMessage(retryAfter) }),
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
