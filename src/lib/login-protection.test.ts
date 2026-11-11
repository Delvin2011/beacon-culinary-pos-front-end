import { describe, expect, it } from "vitest"
import { formatWait, loginBlockMessage, readLoginBlock } from "@/lib/login-protection"

function response(status: number, body: string | null, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "Content-Type": "application/json", ...headers } })
}

describe("readLoginBlock", () => {
  it("returns null for anything but 429", async () => {
    expect(await readLoginBlock(response(401, null))).toBeNull()
    expect(await readLoginBlock(response(400, JSON.stringify({ pin: "PIN must be 6 digits" })))).toBeNull()
    expect(await readLoginBlock(response(200, "{}"))).toBeNull()
  })

  it("reads RATE_LIMITED with a time", async () => {
    const res = response(429, JSON.stringify({ code: "RATE_LIMITED", message: "x", retryAfterSeconds: 42 }), { "Retry-After": "42" })
    expect(await readLoginBlock(res)).toEqual({ code: "RATE_LIMITED", retryAfterSeconds: 42 })
  })

  it("reads ACCOUNT_LOCKED with a time", async () => {
    const res = response(429, JSON.stringify({ code: "ACCOUNT_LOCKED", message: "x", retryAfterSeconds: 900 }), { "Retry-After": "900" })
    expect(await readLoginBlock(res)).toEqual({ code: "ACCOUNT_LOCKED", retryAfterSeconds: 900 })
  })

  it("reads ACCOUNT_LOCKED without a time (needs a manager)", async () => {
    const res = response(429, JSON.stringify({ code: "ACCOUNT_LOCKED", message: "x", retryAfterSeconds: null }))
    expect(await readLoginBlock(res)).toEqual({ code: "ACCOUNT_LOCKED", retryAfterSeconds: null })
  })

  it("prefers the body's time over the header", async () => {
    const res = response(429, JSON.stringify({ code: "RATE_LIMITED", retryAfterSeconds: 30 }), { "Retry-After": "99" })
    expect((await readLoginBlock(res))?.retryAfterSeconds).toBe(30)
  })

  it("falls back to Retry-After when the body has no time", async () => {
    const res = response(429, JSON.stringify({ code: "RATE_LIMITED", retryAfterSeconds: null }), { "Retry-After": "60" })
    expect((await readLoginBlock(res))?.retryAfterSeconds).toBe(60)
  })

  it("treats an empty body as RATE_LIMITED, using the header", async () => {
    expect(await readLoginBlock(response(429, null, { "Retry-After": "15" }))).toEqual({ code: "RATE_LIMITED", retryAfterSeconds: 15 })
  })

  it("treats a malformed body as RATE_LIMITED", async () => {
    expect(await readLoginBlock(response(429, "<html>Too Many Requests</html>"))).toEqual({ code: "RATE_LIMITED", retryAfterSeconds: null })
  })

  it("treats an unknown code as RATE_LIMITED", async () => {
    const res = response(429, JSON.stringify({ code: "SOMETHING_ELSE", retryAfterSeconds: 5 }))
    expect(await readLoginBlock(res)).toEqual({ code: "RATE_LIMITED", retryAfterSeconds: 5 })
  })

  it("ignores an invalid time and an HTTP-date header", async () => {
    const res = response(429, JSON.stringify({ code: "RATE_LIMITED", retryAfterSeconds: "soon" }), {
      "Retry-After": "Wed, 11 Nov 2026 23:00:00 GMT",
    })
    expect((await readLoginBlock(res))?.retryAfterSeconds).toBeNull()
    const negative = response(429, JSON.stringify({ code: "RATE_LIMITED", retryAfterSeconds: -3 }))
    expect((await readLoginBlock(negative))?.retryAfterSeconds).toBeNull()
  })

  it("rounds a fractional time up", async () => {
    const res = response(429, JSON.stringify({ code: "RATE_LIMITED", retryAfterSeconds: 4.2 }))
    expect((await readLoginBlock(res))?.retryAfterSeconds).toBe(5)
  })

  it("leaves the body readable for the caller", async () => {
    const res = response(429, JSON.stringify({ code: "RATE_LIMITED", retryAfterSeconds: 5 }))
    await readLoginBlock(res)
    expect(await res.json()).toMatchObject({ code: "RATE_LIMITED" })
  })
})

describe("formatWait", () => {
  it.each([
    [0, "0:00"],
    [5, "0:05"],
    [59, "0:59"],
    [60, "1:00"],
    [900, "15:00"],
    [3599, "59:59"],
    [3600, "1:00:00"],
    [3661, "1:01:01"],
    [7325, "2:02:05"],
  ])("formats %i seconds as %s", (seconds, expected) => {
    expect(formatWait(seconds)).toBe(expected)
  })
})

describe("loginBlockMessage", () => {
  it("words RATE_LIMITED", () => {
    expect(loginBlockMessage("RATE_LIMITED", 75)).toBe("Too many attempts. Try again in 1:15.")
    expect(loginBlockMessage("RATE_LIMITED", null)).toBe("Too many attempts. Try again shortly.")
  })

  it("words ACCOUNT_LOCKED", () => {
    expect(loginBlockMessage("ACCOUNT_LOCKED", 900)).toBe("This account is temporarily locked. Try again in 15:00 or ask a manager.")
    expect(loginBlockMessage("ACCOUNT_LOCKED", 3600)).toBe("This account is temporarily locked. Try again in 1:00:00 or ask a manager.")
    expect(loginBlockMessage("ACCOUNT_LOCKED", null)).toBe("This account is locked. Ask a manager to unlock it.")
  })
})
