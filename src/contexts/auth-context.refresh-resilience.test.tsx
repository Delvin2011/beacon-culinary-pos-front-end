import { useContext, type ContextType } from "react"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthContext, AuthProvider } from "@/contexts/auth-context"
import { RequestTimeoutError } from "@/lib/net"

type Auth = NonNullable<ContextType<typeof AuthContext>>

const API = "http://localhost:8080"
const fetchMock = vi.fn<typeof fetch>()

function renderSignedIn(): () => Auth {
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "old.token.x", user: { email: "c@x" } }))
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

// Calls authFetch and returns the response, or the error it threw.
async function call(auth: () => Auth, path: string): Promise<Response | unknown> {
  let result: Response | unknown
  await act(async () => {
    try {
      result = await auth().authFetch(path)
    } catch (err) {
      result = err
    }
  })
  return result
}

const urls = () => fetchMock.mock.calls.map(([url]) => String(url))
const expired = () => new Response(null, { status: 401 })

function expectStillSignedIn(auth: () => Auth) {
  expect(auth().isAuthenticated).toBe(true)
  expect(localStorage.getItem("bar-talk.auth")).not.toBeNull()
  expect(urls()).not.toContain(`${API}/auth/logout`)
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("refresh failures that aren't a sign-out", () => {
  it("keeps the session on a network error and throws it to the caller", async () => {
    fetchMock.mockResolvedValueOnce(expired()).mockRejectedValueOnce(new TypeError("Failed to fetch"))
    const auth = renderSignedIn()

    const result = await call(auth, "/orders/today")

    expect(result).toBeInstanceOf(TypeError)
    expect(urls()).toEqual([`${API}/orders/today`, `${API}/auth/refresh`])
    expectStillSignedIn(auth)
  })

  it("keeps the session when the refresh times out", async () => {
    fetchMock.mockResolvedValueOnce(expired()).mockImplementationOnce(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
        }),
    )
    const auth = renderSignedIn()
    vi.useFakeTimers()

    let result: unknown
    await act(async () => {
      const pending = auth()
        .authFetch("/orders/today")
        .catch((err: unknown) => err)
      await vi.advanceTimersByTimeAsync(15_000)
      result = await pending
    })

    expect(result).toBeInstanceOf(RequestTimeoutError)
    expectStillSignedIn(auth)
  })

  it("keeps the session on a 5xx and hands the 5xx back", async () => {
    fetchMock.mockResolvedValueOnce(expired()).mockResolvedValueOnce(new Response("{}", { status: 503 }))
    const auth = renderSignedIn()

    const result = (await call(auth, "/orders/today")) as Response

    expect(result.status).toBe(503)
    expectStillSignedIn(auth)
  })
})

describe("refresh 429 and Retry-After", () => {
  it("doesn't call /auth/refresh again until Retry-After has passed", async () => {
    let now = Date.parse("2026-11-16T10:00:00Z")
    vi.spyOn(Date, "now").mockImplementation(() => now)
    fetchMock
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "RATE_LIMITED" }), { status: 429, headers: { "Retry-After": "30" } }))
      .mockResolvedValueOnce(expired())
    const auth = renderSignedIn()

    expect(((await call(auth, "/orders/today")) as Response).status).toBe(429)

    // 10 s later: the request still gets 401, but the refresh is skipped and the same 429 comes back.
    now = Date.parse("2026-11-16T10:00:10Z")
    const second = (await call(auth, "/orders/today")) as Response
    expect(second.status).toBe(429)
    expect(await second.json()).toMatchObject({ code: "RATE_LIMITED" })
    expect(urls().filter((u) => u.endsWith("/auth/refresh"))).toHaveLength(1)

    // After 30 s the refresh is tried again.
    now = Date.parse("2026-11-16T10:00:31Z")
    fetchMock.mockResolvedValueOnce(expired()).mockResolvedValueOnce(new Response(JSON.stringify({ token: "new.token.y" }), { status: 200 }))
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 200 }))
    const third = (await call(auth, "/orders/today")) as Response
    expect(third.status).toBe(200)
    expect(urls().filter((u) => u.endsWith("/auth/refresh"))).toHaveLength(2)
    expectStillSignedIn(auth)
  })
})

describe("refresh refusals still sign out", () => {
  it("ends the session on a 401", async () => {
    fetchMock.mockResolvedValueOnce(expired()).mockResolvedValueOnce(new Response(null, { status: 401 }))
    const auth = renderSignedIn()

    await call(auth, "/orders/today")

    expect(auth().isAuthenticated).toBe(false)
    expect(urls()).toContain(`${API}/auth/logout`)
  })
})
