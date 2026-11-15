import { useContext, type ContextType } from "react"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthContext, AuthProvider } from "@/contexts/auth-context"

type Auth = NonNullable<ContextType<typeof AuthContext>>

const fetchMock = vi.fn<typeof fetch>()

function renderSignedIn(): () => Auth {
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "admin@x.co", role: "ADMIN" } }))
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
const logoutCalls = () => callsTo("/auth/logout")

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("sign-out (POST /auth/logout)", () => {
  it("clears the session first, then sends one POST /auth/logout with credentials and no token", async () => {
    const auth = renderSignedIn()
    let storedWhenCalled: string | null = "not called"
    fetchMock.mockImplementation(async () => {
      storedWhenCalled = localStorage.getItem("bar-talk.auth")
      return new Response(null, { status: 204 })
    })

    await act(async () => auth().logout())

    expect(logoutCalls()).toHaveLength(1)
    const [url, init] = logoutCalls()[0]
    expect(String(url)).toBe("http://localhost:8080/auth/logout")
    expect(init).toMatchObject({ method: "POST", credentials: "include", keepalive: true })
    expect(init?.body).toBeUndefined()
    expect(new Headers(init?.headers).has("Authorization")).toBe(false)
    expect(storedWhenCalled).toBeNull()
    expect(auth().isAuthenticated).toBe(false)
  })

  it.each([
    ["a network error", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a 500", () => Promise.resolve(new Response(null, { status: 500 }))],
    ["a 429", () => Promise.resolve(new Response(JSON.stringify({ code: "RATE_LIMITED", retryAfterSeconds: 5 }), { status: 429 }))],
  ])("stays signed out after %s, without throwing or retrying", async (_name, outcome) => {
    const auth = renderSignedIn()
    fetchMock.mockImplementation(outcome)

    await act(async () => {
      expect(() => auth().logout()).not.toThrow()
    })
    await act(async () => {})

    expect(auth().isAuthenticated).toBe(false)
    expect(logoutCalls()).toHaveLength(1)
  })

  it("still signs out when fetch throws immediately", async () => {
    const auth = renderSignedIn()
    fetchMock.mockImplementation(() => {
      throw new TypeError("fetch unavailable")
    })

    await act(async () => {
      expect(() => auth().logout()).not.toThrow()
    })

    expect(auth().isAuthenticated).toBe(false)
    expect(logoutCalls()).toHaveLength(1)
  })

  it("doesn't refresh after sign-out", async () => {
    const auth = renderSignedIn()
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith("/auth/logout") ? new Response(null, { status: 204 }) : new Response(null, { status: 401 }),
    )

    await act(async () => auth().logout())
    await act(async () => {
      await auth().authFetch("/orders")
    })

    expect(callsTo("/auth/refresh")).toHaveLength(0)
  })

  it("leaves other cookies (such as the till's) alone", async () => {
    document.cookie = "deviceToken=till-1; path=/"
    const auth = renderSignedIn()
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await act(async () => auth().logout())

    expect(document.cookie).toContain("deviceToken=till-1")
    document.cookie = "deviceToken=; path=/; max-age=0"
  })
})

describe("a session that ends on its own", () => {
  it("treats a 401 from refresh (no refresh cookie) as signed out: one refresh, one logout, no loop", async () => {
    const auth = renderSignedIn()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith("/auth/logout")) return new Response(null, { status: 204 })
      return new Response(null, { status: 401 })
    })

    let results: Response[] = []
    await act(async () => {
      results = await Promise.all([auth().authFetch("/orders/today"), auth().authFetch("/menu/today")])
    })
    await act(async () => {
      await auth().authFetch("/shifts/open")
    })

    expect(results.map((res) => res.status)).toEqual([401, 401])
    expect(auth().isAuthenticated).toBe(false)
    expect(callsTo("/auth/refresh")).toHaveLength(1)
    expect(logoutCalls()).toHaveLength(1)
  })

  it("signs out when a request still gets 401 after a successful refresh", async () => {
    const auth = renderSignedIn()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith("/auth/refresh")) return new Response(JSON.stringify({ token: "new.token.y" }), { status: 200 })
      if (url.endsWith("/auth/logout")) return new Response(null, { status: 204 })
      return new Response(null, { status: 401 })
    })

    await act(async () => {
      await auth().authFetch("/orders")
    })

    expect(auth().isAuthenticated).toBe(false)
    expect(callsTo("/auth/refresh")).toHaveLength(1)
    expect(logoutCalls()).toHaveLength(1)
  })

  it("keeps the session on a refresh 429 and doesn't call logout", async () => {
    const auth = renderSignedIn()
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith("/auth/refresh")
        ? new Response(JSON.stringify({ code: "RATE_LIMITED", retryAfterSeconds: 10 }), { status: 429 })
        : new Response(null, { status: 401 }),
    )

    await act(async () => {
      await auth().authFetch("/orders")
    })

    expect(auth().isAuthenticated).toBe(true)
    expect(logoutCalls()).toHaveLength(0)
  })
})
