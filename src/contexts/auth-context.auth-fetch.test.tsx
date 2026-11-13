import { useContext, type ContextType } from "react"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthContext, AuthProvider } from "@/contexts/auth-context"

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

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

async function call(auth: () => Auth, path: string): Promise<Response> {
  let res: Response | undefined
  await act(async () => {
    res = await auth().authFetch(path, { method: "POST" })
  })
  return res as Response
}

const urls = () => fetchMock.mock.calls.map(([url]) => String(url))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("authFetch on 401", () => {
  it("doesn't refresh or resend a wrong manager PIN ({error} body)", async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: "Invalid PIN." }))
    const auth = renderSignedIn()

    const res = await call(auth, "/admin/authorize-session")

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "Invalid PIN." })
    expect(urls()).toEqual([`${API}/admin/authorize-session`])
    expect(auth().isAuthenticated).toBe(true)
  })

  it("doesn't refresh a 401 with a code", async () => {
    fetchMock.mockResolvedValueOnce(json(401, { code: "AUTHORIZATION_INVALID" }))
    const auth = renderSignedIn()
    await call(auth, "/orders")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(auth().isAuthenticated).toBe(true)
  })

  it("refreshes an empty 401 (expired token) and resends once with the new token", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(json(200, { token: "new.token.y" }))
      .mockResolvedValueOnce(json(200, { ok: true }))
    const auth = renderSignedIn()

    const res = await call(auth, "/admin/authorize")

    expect(res.status).toBe(200)
    expect(urls()).toEqual([`${API}/admin/authorize`, `${API}/auth/refresh`, `${API}/admin/authorize`])
    const retryHeaders = new Headers(fetchMock.mock.calls[2][1]?.headers)
    expect(retryHeaders.get("Authorization")).toBe("Bearer new.token.y")
    expect(auth().isAuthenticated).toBe(true)
  })

  it("keeps the session and returns the 429 when refresh is rate limited, without retrying", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(json(429, { code: "RATE_LIMITED", message: "x", retryAfterSeconds: 30 }, { "Retry-After": "30" }))
    const auth = renderSignedIn()

    const res = await call(auth, "/shifts/1/close")

    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("30")
    expect(await res.json()).toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 30 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(auth().isAuthenticated).toBe(true)
    expect(localStorage.getItem("bar-talk.auth")).not.toBeNull()
  })

  it("shares one refresh between parallel requests and gives each a readable 429", async () => {
    let releaseRefresh: (res: Response) => void = () => {}
    fetchMock.mockImplementation((input) => {
      const url = String(input)
      if (url.endsWith("/auth/refresh")) {
        return new Promise<Response>((resolve) => {
          releaseRefresh = resolve
        })
      }
      return Promise.resolve(new Response(null, { status: 401 }))
    })
    const auth = renderSignedIn()

    let results: Response[] = []
    await act(async () => {
      const pending = Promise.all([auth().authFetch("/orders/today"), auth().authFetch("/menu/today")])
      await vi.waitFor(() => expect(urls().filter((u) => u.endsWith("/auth/refresh"))).toHaveLength(1))
      releaseRefresh(json(429, { code: "RATE_LIMITED", retryAfterSeconds: 10 }))
      results = await pending
    })

    expect(results.map((r) => r.status)).toEqual([429, 429])
    for (const res of results) expect(await res.json()).toMatchObject({ code: "RATE_LIMITED" })
    expect(urls().filter((u) => u.endsWith("/auth/refresh"))).toHaveLength(1)
    expect(auth().isAuthenticated).toBe(true)
  })

  it("signs out when refresh returns 401 (session ended, e.g. account locked)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 })).mockResolvedValueOnce(new Response(null, { status: 401 }))
    const auth = renderSignedIn()

    const res = await call(auth, "/orders")

    expect(res.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(auth().isAuthenticated).toBe(false)
  })

  it("passes a 429 from the endpoint itself straight through", async () => {
    fetchMock.mockResolvedValueOnce(json(429, { code: "RATE_LIMITED", retryAfterSeconds: 5 }))
    const auth = renderSignedIn()
    const res = await call(auth, "/admin/authorize")
    expect(res.status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(auth().isAuthenticated).toBe(true)
  })
})
