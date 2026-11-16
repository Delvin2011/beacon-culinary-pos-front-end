// Network helpers for the till: request timeouts, sorting failures into kinds, and plain messages for cashiers.
// Nothing here shows raw browser text such as "Failed to fetch".

export const DEFAULT_TIMEOUT_MS = 15_000;
export const ORDER_POST_TIMEOUT_MS = 20_000;
export const HEALTH_TIMEOUT_MS = 5_000;

// The request got no answer within its time limit. The server may still have received it.
export class RequestTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`No answer from the server within ${timeoutMs} ms.`);
    this.name = "RequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

// The time limit for a request: 20 s for POST /orders, 5 s for /health, 15 s for everything else.
export function timeoutFor(url: string, method?: string): number {
  const path = url.split("?")[0].replace(/\/+$/, "");
  if (path.endsWith("/health")) return HEALTH_TIMEOUT_MS;
  if ((method ?? "GET").toUpperCase() === "POST" && path.endsWith("/orders")) return ORDER_POST_TIMEOUT_MS;
  return DEFAULT_TIMEOUT_MS;
}

// fetch with a time limit. Uses an AbortController and a timer rather than AbortSignal.timeout/any, so it works
// on older Chrome/Edge kiosks. A signal from the caller still cancels the request.
// The limit covers the wait for the response headers; reading the body afterwards isn't timed.
export async function fetchWithTimeout(
  input: string,
  init: RequestInit | undefined,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const callerSignal = init?.signal ?? null;
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", onCallerAbort);
  }

  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) throw new RequestTimeoutError(timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}

export type Failure =
  | { kind: "network" }
  | { kind: "timeout" }
  | { kind: "server"; status: number }
  | { kind: "rate-limited"; status: 429; retryAfterMs: number | null }
  | { kind: "http"; status: number; code: string | null };

export type FailureKind = Failure["kind"];

// A thrown error: a timeout, or anything else fetch throws (offline, DNS, CORS, connection reset), which is "network".
export function classifyError(err: unknown): Failure {
  if (err instanceof RequestTimeoutError) return { kind: "timeout" };
  return { kind: "network" };
}

// True when the request never got an answer, so the server may or may not have acted on it.
export function isNoAnswer(failure: Failure): boolean {
  return failure.kind === "network" || failure.kind === "timeout";
}

// Retry-After as seconds or an HTTP date, in milliseconds from `now`. Null if missing or unreadable.
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

// Reads the JSON `code` from an error body without using up the response.
export async function readErrorCode(res: Response): Promise<string | null> {
  const body = (await res.clone().json().catch(() => null)) as { code?: unknown } | null;
  return body && typeof body.code === "string" ? body.code : null;
}

// A response: null when it succeeded, otherwise the kind of failure.
export async function classifyResponse(res: Response): Promise<Failure | null> {
  if (res.ok) return null;
  if (res.status === 429) {
    return { kind: "rate-limited", status: 429, retryAfterMs: parseRetryAfter(res.headers.get("Retry-After")) };
  }
  if (res.status >= 500) return { kind: "server", status: res.status };
  return { kind: "http", status: res.status, code: await readErrorCode(res) };
}

export const CONNECTION_MESSAGES = {
  network: "Can't reach the server. Nothing has been lost. Try again.",
  timeout: "The server is taking too long to answer. Nothing has been lost. Try again.",
  server: "The server has a problem right now. Nothing has been lost. Try again.",
  "rate-limited": "Too many requests. Wait a moment, then try again.",
} as const;

// A plain message for a failure that isn't the cashier's fault. Http failures use the server's own message, so
// callers pass a fallback for them.
export function friendlyMessage(failure: Failure | FailureKind, httpFallback = "Something went wrong. Try again."): string {
  const kind = typeof failure === "string" ? failure : failure.kind;
  if (kind === "http") return httpFallback;
  return CONNECTION_MESSAGES[kind];
}

// For catch blocks on POS screens: a message that is safe to show, whatever was thrown.
// Errors the screen threw itself (with a server or screen message) are kept; anything fetch threw is replaced.
export function messageForError(err: unknown, fallback: string): string {
  if (err instanceof RequestTimeoutError) return CONNECTION_MESSAGES.timeout;
  // fetch throws a TypeError ("Failed to fetch", "NetworkError when attempting to fetch resource", "Load failed").
  if (err instanceof TypeError) return CONNECTION_MESSAGES.network;
  if (err instanceof DOMException && err.name === "AbortError") return CONNECTION_MESSAGES.network;
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}
