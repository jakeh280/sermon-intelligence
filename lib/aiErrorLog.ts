const errorNames = new Set([
  "AbortError",
  "Error",
  "SyntaxError",
  "TimeoutError",
  "TypeError",
  "AI_APICallError",
  "AI_EmptyResponseBodyError",
  "AI_InvalidArgumentError",
  "AI_InvalidPromptError",
  "AI_InvalidResponseDataError",
  "AI_JSONParseError",
  "AI_LoadAPIKeyError",
  "AI_NoOutputGeneratedError",
  "AI_RetryError",
  "AI_StreamProviderError",
  "AI_TypeValidationError",
]);

const googleStatusCodes = new Set([
  "ABORTED",
  "ALREADY_EXISTS",
  "CANCELLED",
  "DATA_LOSS",
  "DEADLINE_EXCEEDED",
  "FAILED_PRECONDITION",
  "INTERNAL",
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "OUT_OF_RANGE",
  "PERMISSION_DENIED",
  "RESOURCE_EXHAUSTED",
  "UNAUTHENTICATED",
  "UNAVAILABLE",
  "UNIMPLEMENTED",
  "UNKNOWN",
]);

function fields(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function isHttpStatus(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599;
}

function isProviderCode(value: unknown): value is string | number {
  return typeof value === "string"
    ? googleStatusCodes.has(value)
    : isHttpStatus(value) || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 16);
}

export function sanitizeAiError(error: unknown) {
  const log: { event: "AI_ROUTE_ERROR"; errorName: string; statusCode?: number; providerCode?: string | number } = {
    event: "AI_ROUTE_ERROR",
    errorName: "UnknownError",
  };

  try {
    const outer = fields(error);
    const name = outer?.name;
    if (typeof name === "string" && errorNames.has(name)) log.errorName = name;

    // RetryError preserves the final failure. Inspect only the SDK's known metadata paths.
    const providerError = name === "AI_RetryError" ? fields(outer?.lastError) : outer;
    const statusCode = providerError?.statusCode;
    if (isHttpStatus(statusCode)) log.statusCode = statusCode;

    // Gemini HTTP errors carry structured status in data.error. In-stream errors
    // expose it as type/code. Both objects can also contain private free-form text.
    const data = fields(fields(providerError?.data)?.error);
    const providerCode = [providerError?.type, data?.status, providerError?.code, data?.code].find(isProviderCode);
    if (providerCode !== undefined) log.providerCode = providerCode;
  } catch {
    // Error reporting must tolerate unusual thrown values, including throwing getters.
  }

  return log;
}

export function protectAiStreamErrors(response: Response): Response {
  if (!response.body) return response;
  const reader = response.body.getReader();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (cancelled) return;
        if (done) {
          reader.releaseLock();
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        if (cancelled) return;
        reader.releaseLock();
        console.error(sanitizeAiError(error));
        // Next.js may log a rejected response stream, including its error cause.
        controller.error(new Error("AI response stream failed"));
      }
    },
    async cancel(reason) {
      cancelled = true;
      try {
        await reader.cancel(reason);
      } catch (error) {
        console.error(sanitizeAiError(error));
        throw new Error("AI response stream cancellation failed");
      } finally {
        reader.releaseLock();
      }
    },
  }, { highWaterMark: 0 });
  return new Response(body, response);
}
