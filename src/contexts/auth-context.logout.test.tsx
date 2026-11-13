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

const logoutCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/auth/logout"))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("sign-out with the server switch off (default)", () => {
  it("signs out locally and sends nothing", async () => {
    const auth = renderSignedIn()
    expect(auth().isAuthenticated).toBe(true)

    await act(async () => auth().logout())

    expect(auth().isAuthenticated).toBe(false)
    expect(localStorage.getItem("bar-talk.auth")).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("sign-out with NEXT_PUBLIC_AUTH_LOGOUT_ENABLED=true", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_LOGOUT_ENABLED", "true")
  })

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
    expect(new Headers(init?.headers).has("Authorization")).toBe(false)
    expect(storedWhenCalled).toBeNull()
    expect(auth().isAuthenticated).toBe(false)
  })

  it.each([
    ["a network error", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a 500", () => Promise.resolve(new Response(null, { status: 500 }))],
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

  it("doesn't refresh after sign-out", async () => {
    const auth = renderSignedIn()
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith("/auth/logout") ? new Response(null, { status: 204 }) : new Response(null, { status: 401 }),
    )

    await act(async () => auth().logout())
    await act(async () => {
      await auth().authFetch("/orders")
    })

    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/auth/refresh"))).toBe(false)
  })
})
