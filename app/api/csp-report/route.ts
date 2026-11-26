import { isIP } from "node:net";
import { readBoundedBody } from "../../../lib/boundedBody.ts";

const MAX_REPORT_BYTES = 8 * 1024;
const MAX_LOGS_PER_MINUTE = 60;
let logWindowEndsAt = 0;
let loggedReports = 0;
const LEGACY_REPORT = "application/csp-report";
const REPORTING_API = "application/reports+json";

// Browsers can report a more specific directive than the policy declares.
const directives = new Set([
  "base-uri", "child-src", "connect-src", "default-src", "font-src",
  "form-action", "frame-ancestors", "frame-src", "img-src", "manifest-src",
  "media-src", "object-src", "script-src", "script-src-attr", "script-src-elem",
  "style-src", "style-src-attr", "style-src-elem", "worker-src",
]);

function object(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
}

function parseUrl(value: unknown): URL | undefined {
  if (typeof value === "string" && URL.canParse(value)) return new URL(value);
}

function blockedOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value === "inline" || value === "eval" || value === "self") return value;
  const scheme = /^(data|blob)(?::|$)/i.exec(value);
  if (scheme) return scheme[1].toLowerCase();

  const url = parseUrl(value);
  if (!url || url.origin === "null" || isIP(url.hostname.replace(/^\[|\]$/g, ""))) {
    return null;
  }
  return url.origin;
}

function logViolation(fields: Record<string, unknown>, legacy: boolean) {
  const rawDirective = legacy
    ? fields["effective-directive"] ?? fields["violated-directive"]
    : fields.effectiveDirective;
  // Some legacy reports append the directive's source list.
  const directive = typeof rawDirective === "string" ? rawDirective.split(/\s/, 1)[0] : "";
  const document = parseUrl(legacy ? fields["document-uri"] : fields.documentURL);
  if (!directives.has(directive) || !document || !["https:", "http:"].includes(document.protocol)) {
    return;
  }

  const now = Date.now();
  if (now >= logWindowEndsAt) {
    logWindowEndsAt = now + 60_000;
    loggedReports = 0;
  }
  if (loggedReports >= MAX_LOGS_PER_MINUTE) return;
  loggedReports++;

  const { disposition } = fields;
  console.info(JSON.stringify({
    directive,
    blocked: blockedOrigin(legacy ? fields["blocked-uri"] : fields.blockedURL),
    path: document.pathname.slice(0, 512),
    disposition: disposition === "report" || disposition === "enforce" ? disposition : null,
  }));
}

export async function POST(request: Request): Promise<Response> {
  try {
    const type = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (type === LEGACY_REPORT || type === REPORTING_API) {
      const body = await readBoundedBody(request.body, request.headers.get("content-length"), MAX_REPORT_BYTES);
      if (body.ok) {
        const payload: unknown = JSON.parse(body.text);
        if (type === LEGACY_REPORT) {
          const violation = object(object(payload)?.["csp-report"]);
          if (violation) logViolation(violation, true);
        } else if (Array.isArray(payload)) {
          for (const item of payload) {
            const report = object(item);
            const violation = report?.type === "csp-violation" ? object(report.body) : undefined;
            if (violation) logViolation(violation, false);
          }
        }
      }
    }
  } catch {
    // Discard malformed reports and failed body reads without logging raw data.
  }
  return new Response(null, { status: 204 });
}
