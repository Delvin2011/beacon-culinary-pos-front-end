// O2: 401 SESSION_ENDED ends the session without a refresh; Lock till; till-rule refusals at sign-in.
import { useContext, type ContextType } from "react"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthContext, AuthProvider, ShiftOpenOnOtherTillError, TillLockedError } from "@/contexts/auth-context"
import { onSessionEnding } from "@/lib/session-events"

type Auth = NonNullable<ContextType<typeof AuthContext>>

const fetchMock = vi.fn<typeof fetch>()
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const sessionEndedBody = (reason: string) => ({ error: "x", code: "SESSION_ENDED", details: { reason } })

function renderAuth(signedIn = true): () => Auth {
  if (signedIn) {
    localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "t@x.co", role: "CASHIER", cashierId: 17 } }))
  }
  let current: Auth | undefined
  function Probe() {
    current = useContext(AuthContext)
    return null
  }
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )
  return () => current as Auth
}

const callsTo = (pathEnd: string) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(pathEnd))
const ending = vi.fn()
let unsubscribe: () => void

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  fetchMock.mockReset()
  ending.mockReset()
  unsubscribe = onSessionEnding(ending)
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  unsubscribe()
  vi.unstubAllGlobals()
})

describe("401 SESSION_ENDED", () => {
  it.each([
    ["REPLACED", "You were signed out because a newer sign-in replaced this one."],
    ["LOCK", "This till was locked."],
    ["IDLE", "You were signed out after a period without activity."],
    ["SHIFT_FORCE_CLOSED", "A manager closed your shift."],
    ["ADMIN", "A manager ended this session."],
    ["LOGOUT", "You signed out."],
    ["EXPIRED", "Your session has expired. Please sign in again."],
  ])("from a POS write (%s): no refresh, tokens dropped, cart kept, reason shown", async (reason, message) => {
    const auth = renderAuth()
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith("/orders") ? json(401, sessionEndedBody(reason)) : new Response(null, { status: 204 }),
    )

    let res: Response | undefined
    await act(async () => {
      res = await auth().authFetch("/orders", { method: "POST", body: "{}" })
    })

    expect(res?.status).toBe(401)
    expect(callsTo("/auth/refresh")).toHaveLength(0)
    expect(auth().isAuthenticated).toBe(false)
    expect(localStorage.getItem("bar-talk.auth")).toBeNull()
    expect(ending).toHaveBeenCalledWith("SESSION_ENDED")
    expect(auth().sessionEndedNotice).toBe(message)
  })

  it("from refresh: ends the session with the reason, and the next sign-in clears the notice", async () => {
    const auth = renderAuth()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith("/auth/refresh")) return json(401, sessionEndedBody("IDLE"))
      if (url.endsWith("/auth/pin-login")) return json(200, { token: "n.e.w", user: { name: "Thandi" } })
      if (url.endsWith("/auth/logout")) return new Response(null, { status: 204 })
      return new Response(null, { status: 401 })
    })

    await act(async () => {
      await auth().authFetch("/menu/today")
    })
    expect(auth().isAuthenticated).toBe(false)
    expect(auth().sessionEndedNotice).toBe("You were signed out after a period without activity.")
    expect(callsTo("/auth/refresh")).toHaveLength(1)

    await act(async () => {
      await auth().pinLogin({ cashierId: 17, pin: "123456" })
    })
    expect(auth().sessionEndedNotice).toBeNull()
  })

  it("leaves AUTHORIZATION_INVALID and an empty 401 to today's handling", async () => {
    const auth = renderAuth()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith("/orders")) return json(401, { error: "Approval expired.", code: "AUTHORIZATION_INVALID" })
      if (url.endsWith("/auth/refresh")) return json(200, { token: "fresh.t.k" })
      if (url.endsWith("/menu/today")) return fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/menu/today")).length === 1
        ? new Response(null, { status: 401 })
        : json(200, {})
      return new Response(null, { status: 204 })
    })

    await act(async () => {
      await auth().authFetch("/orders", { method: "POST", body: "{}" })
    })
    expect(auth().isAuthenticated).toBe(true)
    expect(auth().sessionEndedNotice).toBeNull()

    let menu: Response | undefined
    await act(async () => {
      menu = await auth().authFetch("/menu/today")
    })
    expect(menu?.status).toBe(200)
    expect(auth().isAuthenticated).toBe(true)
    expect(ending).not.toHaveBeenCalled()
  })
})

describe("Lock till", () => {
  it("keeps the cart, sends POST /pos/lock with the bearer token and drops the tokens", async () => {
    const auth = renderAuth()
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await act(async () => auth().lockTill())

    expect(ending).toHaveBeenCalledWith("LOCK")
    const [url, init] = callsTo("/pos/lock")[0]
    expect(String(url)).toBe("http://localhost:8080/pos/lock")
    expect(init).toMatchObject({ method: "POST", credentials: "include" })
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer a.b.c")
    expect(auth().isAuthenticated).toBe(false)
    expect(callsTo("/auth/logout")).toHaveLength(0)
  })

  it("locks locally when offline, and retries once when the connection returns", async () => {
    const auth = renderAuth()
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))

    await act(async () => auth().lockTill())
    expect(auth().isAuthenticated).toBe(false)
    expect(callsTo("/pos/lock")).toHaveLength(1)

    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await act(async () => {
      window.dispatchEvent(new Event("online"))
    })
    await act(async () => {
      window.dispatchEvent(new Event("online"))
    })
    expect(callsTo("/pos/lock")).toHaveLength(2)
    expect(new Headers(callsTo("/pos/lock")[1][1]?.headers).get("Authorization")).toBe("Bearer a.b.c")
  })
})

describe("till rules at sign-in", () => {
  it("PIN: TILL_LOCKED names the owner and the till", async () => {
    const auth = renderAuth(false)
    fetchMock.mockResolvedValue(json(409, { error: "x", code: "TILL_LOCKED", details: { ownerName: "Thandi Mokoena", tillCode: "T1" } }))

    let caught: unknown
    await act(async () => {
      await auth().pinLogin({ cashierId: 23, pin: "123456" }).catch((err: unknown) => {
        caught = err
      })
    })
    expect(caught).toBeInstanceOf(TillLockedError)
    expect((caught as Error).message).toBe("In use by Thandi Mokoena (T1). Only they or a manager can sign in.")
  })

  it("password: SHIFT_OPEN_ON_OTHER_TILL on the unregistered till", async () => {
    const auth = renderAuth(false)
    fetchMock.mockResolvedValue(
      json(409, { error: "x", code: "SHIFT_OPEN_ON_OTHER_TILL", details: { tillCode: null, tillName: "Unregistered till" } }),
    )

    let caught: unknown
    await act(async () => {
      await auth().login({ email: "a@x.co", password: "pw" }).catch((err: unknown) => {
        caught = err
      })
    })
    expect(caught).toBeInstanceOf(ShiftOpenOnOtherTillError)
    expect((caught as Error).message).toBe("You have an open shift on Unregistered till. Close it there first, or ask a manager.")
  })

  it("PIN: SHIFT_OPEN_ON_OTHER_TILL with a till code", async () => {
    const auth = renderAuth(false)
    fetchMock.mockResolvedValue(
      json(409, { error: "x", code: "SHIFT_OPEN_ON_OTHER_TILL", details: { tillCode: "T2", tillName: "Till 2 (back)" } }),
    )
    let caught: unknown
    await act(async () => {
      await auth().pinLogin({ cashierId: 23, pin: "123456" }).catch((err: unknown) => {
        caught = err
      })
    })
    expect((caught as Error).message).toBe("You have an open shift on T2. Close it there first, or ask a manager.")
  })
})
