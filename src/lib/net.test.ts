import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  CONNECTION_MESSAGES,
  DEFAULT_TIMEOUT_MS,
  HEALTH_TIMEOUT_MS,
  ORDER_POST_TIMEOUT_MS,
  RequestTimeoutError,
  classifyError,
  classifyResponse,
  fetchWithTimeout,
  friendlyMessage,
  messageForError,
  parseRetryAfter,
  timeoutFor,
} from "./net"

// A fetch that never answers until its signal aborts.
const hangingFetch = vi.fn((_input: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")))
  }),
) as unknown as typeof fetch

describe("timeoutFor", () => {
  it("gives POST /orders 20 s, /health 5 s and everything else 15 s", () => {
    expect(timeoutFor("https://api.test/orders", "POST")).toBe(ORDER_POST_TIMEOUT_MS)
    expect(timeoutFor("https://api.test/orders/", "post")).toBe(ORDER_POST_TIMEOUT_MS)
    expect(timeoutFor("https://api.test/orders", "GET")).toBe(DEFAULT_TIMEOUT_MS)
    expect(timeoutFor("https://api.test/orders/12/adjustments", "POST")).toBe(DEFAULT_TIMEOUT_MS)
    expect(timeoutFor("https://api.test/health")).toBe(HEALTH_TIMEOUT_MS)
    expect(timeoutFor("https://api.test/menu/today?period=LUNCH")).toBe(DEFAULT_TIMEOUT_MS)
  })
})

describe("fetchWithTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("throws RequestTimeoutError when the time limit passes", async () => {
    const pending = fetchWithTimeout("https://api.test/orders", { method: "POST" }, 20_000, hangingFetch)
    const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError)
    await vi.advanceTimersByTimeAsync(19_999)
    await vi.advanceTimersByTimeAsync(1)
    await assertion
  })

  it("returns the response when it answers in time and clears the timer", async () => {
    const ok = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch
    const res = await fetchWithTimeout("https://api.test/x", undefined, 1000, ok)
    expect(res.status).toBe(200)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("passes on a caller's abort as the original error, not as a timeout", async () => {
    const caller = new AbortController()
    const pending = fetchWithTimeout("https://api.test/x", { signal: caller.signal }, 15_000, hangingFetch)
    caller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  })
})

describe("classifying failures", () => {
  it("sorts thrown errors into timeout and network", () => {
    expect(classifyError(new RequestTimeoutError(5000))).toEqual({ kind: "timeout" })
    expect(classifyError(new TypeError("Failed to fetch"))).toEqual({ kind: "network" })
  })

  it("sorts responses into server, rate-limited and http with the code", async () => {
    expect(await classifyResponse(new Response("{}", { status: 200 }))).toBeNull()
    expect(await classifyResponse(new Response("", { status: 503 }))).toEqual({ kind: "server", status: 503 })
    expect(await classifyResponse(new Response("", { status: 429, headers: { "Retry-After": "7" } }))).toEqual({
      kind: "rate-limited",
      status: 429,
      retryAfterMs: 7000,
    })
    const conflict = new Response(JSON.stringify({ error: "x", code: "IDEMPOTENCY_CONFLICT" }), { status: 409 })
    expect(await classifyResponse(conflict)).toEqual({ kind: "http", status: 409, code: "IDEMPOTENCY_CONFLICT" })
    // The body is still readable afterwards.
    expect(await conflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" })
  })

  it("reads Retry-After as seconds or a date", () => {
    expect(parseRetryAfter(null)).toBeNull()
    expect(parseRetryAfter("30")).toBe(30_000)
    const now = Date.parse("2026-11-16T10:00:00Z")
    expect(parseRetryAfter("Mon, 16 Nov 2026 10:00:20 GMT", now)).toBe(20_000)
    expect(parseRetryAfter("soon")).toBeNull()
  })
})

describe("messages", () => {
  it("never shows the browser's own text", () => {
    expect(messageForError(new TypeError("Failed to fetch"), "x")).toBe(CONNECTION_MESSAGES.network)
    expect(messageForError(new RequestTimeoutError(15_000), "x")).toBe(CONNECTION_MESSAGES.timeout)
    expect(messageForError(new DOMException("aborted", "AbortError"), "x")).toBe(CONNECTION_MESSAGES.network)
  })

  it("keeps a screen's own message and falls back when there is none", () => {
    expect(messageForError(new Error("Stock changed."), "x")).toBe("Stock changed.")
    expect(messageForError("weird", "Order submission failed.")).toBe("Order submission failed.")
  })

  it("gives plain messages per kind", () => {
    expect(friendlyMessage("network")).toBe("Can't reach the server. Nothing has been lost. Try again.")
    expect(friendlyMessage({ kind: "http", status: 400, code: null }, "Check the order.")).toBe("Check the order.")
  })
})
