import { useContext, type ContextType } from "react"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthContext, AuthProvider } from "@/contexts/auth-context"
import { RequestTimeoutError } from "@/lib/net"

type Auth = NonNullable<ContextType<typeof AuthContext>>

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

// Never answers; rejects like the browser when its signal aborts.
function hang(_input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")))
  })
}

beforeEach(() => {
  localStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("authFetch timeouts", () => {
  it("throws RequestTimeoutError when the server doesn't answer in time", async () => {
    fetchMock.mockImplementation(hang)
    const auth = renderSignedIn()

    let caught: unknown
    await act(async () => {
      await auth()
        .authFetch("/menu/today", { timeoutMs: 20 })
        .catch((err: unknown) => {
          caught = err
        })
    })

    expect(caught).toBeInstanceOf(RequestTimeoutError)
    expect(auth().isAuthenticated).toBe(true)
  })

  it("uses 20 s for POST /orders, 5 s for /health and 15 s otherwise", async () => {
    fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }))
    const auth = renderSignedIn()
    const timerSpy = vi.spyOn(globalThis, "setTimeout")

    const limitFor = async (path: string, init?: RequestInit) => {
      timerSpy.mockClear()
      await act(async () => {
        await auth().authFetch(path, init)
      })
      const delays = timerSpy.mock.calls.map(([, ms]) => ms)
      return Math.max(...delays.filter((ms): ms is number => typeof ms === "number"))
    }

    expect(await limitFor("/orders", { method: "POST" })).toBe(20_000)
    expect(await limitFor("/health")).toBe(5_000)
    expect(await limitFor("/orders/today")).toBe(15_000)
  })

  it("passes the request through unchanged apart from the signal", async () => {
    fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }))
    const auth = renderSignedIn()

    await act(async () => {
      await auth().authFetch("/orders", { method: "POST", body: "{\"a\":1}", headers: { "Content-Type": "application/json" }, timeoutMs: 1000 })
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(init?.method).toBe("POST")
    expect(init?.body).toBe("{\"a\":1}")
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer old.token.x")
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(init).not.toHaveProperty("timeoutMs")
  })
})
