/** No bytes for this long means the connection is dead, not that the model is slow. */
export const STALL_TIMEOUT_MS = 45_000;

export const STALL_MESSAGE =
  "The connection went quiet before a result arrived. Please try generating again.";

export const OFFLINE_MESSAGE =
  "Could not reach the server. Please check your connection and try again.";

export const GENERIC_MESSAGE = "Something went wrong. Please try again.";

export class StalledResponseError extends Error {
  constructor() {
    super(STALL_MESSAGE);
    this.name = "StalledResponseError";
  }
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/**
 * Turns a thrown request failure into something a church media director can act
 * on. `fetch` rejects with a bare "Failed to fetch" when the network is down,
 * and an aborted read surfaces as "The user aborted a request", neither of
 * which means anything to the person reading it.
 */
export function describeRequestFailure(error: unknown): string {
  if (error instanceof StalledResponseError) return STALL_MESSAGE;
  if (isAbort(error)) return STALL_MESSAGE;
  if (error instanceof TypeError) return OFFLINE_MESSAGE;
  if (error instanceof Error && error.message.trim()) return error.message;
  return GENERIC_MESSAGE;
}
