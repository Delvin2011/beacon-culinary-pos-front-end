import { useContext, type ContextType } from "react"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthContext, AuthProvider, LoginBlockedError } from "@/contexts/auth-context"

type Auth = NonNullable<ContextType<typeof AuthContext>>

const fetchMock = vi.fn<typeof fetch>()

function renderAuth(): () => Auth {
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

function blocked(body: unknown, retryAfter?: string): Response {
  return new Response(JSON.stringify(body), {
    status: 429,
    headers: { "Content-Type": "application/json", ...(retryAfter ? { "Retry-After": retryAfter } : {}) },
  })
}

async function caught(run: () => Promise<void>): Promise<unknown> {
  let error: unknown
  await act(async () => {
    await run().catch((err: unknown) => {
      error = err
    })
  })
  return error
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("login on 429", () => {
  it("throws LoginBlockedError with the code and wait", async () => {
    fetchMock.mockResolvedValueOnce(blocked({ code: "ACCOUNT_LOCKED", message: "x", retryAfterSeconds: 900 }, "900"))
    const auth = renderAuth()

    const err = await caught(() => auth().login({ email: "a@b.c", password: "secret1" }))

    expect(err).toBeInstanceOf(LoginBlockedError)
    expect((err as LoginBlockedError).block).toEqual({ code: "ACCOUNT_LOCKED", retryAfterSeconds: 900 })
    expect((err as Error).message).toBe("This account is temporarily locked. Try again in 15:00 or ask a manager.")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("never shows the body's own message", async () => {
    fetchMock.mockResolvedValueOnce(blocked({ code: "RATE_LIMITED", message: "Account a@b.c is real", retryAfterSeconds: 60 }))
    const auth = renderAuth()

    const err = await caught(() => auth().login({ email: "a@b.c", password: "secret1" }))

    expect((err as Error).message).toBe("Too many attempts. Try again in 1:00.")
    expect(auth().error).not.toContain("a@b.c")
  })

  it("words a lock that needs a manager", async () => {
    fetchMock.mockResolvedValueOnce(blocked({ code: "ACCOUNT_LOCKED", message: "x", retryAfterSeconds: null }))
    const auth = renderAuth()
    const err = await caught(() => auth().login({ email: "a@b.c", password: "secret1" }))
    expect((err as Error).message).toBe("This account is locked. Ask a manager to unlock it.")
  })
})

describe("pinLogin on 429", () => {
  it("throws LoginBlockedError rather than Incorrect PIN", async () => {
    fetchMock.mockResolvedValueOnce(blocked({ code: "RATE_LIMITED", message: "x", retryAfterSeconds: 120 }, "120"))
    const auth = renderAuth()

    const err = await caught(() => auth().pinLogin({ cashierId: 3, pin: "123456" }))

    expect(err).toBeInstanceOf(LoginBlockedError)
    expect((err as LoginBlockedError).block).toEqual({ code: "RATE_LIMITED", retryAfterSeconds: 120 })
    expect((err as Error).message).toBe("Too many attempts. Try again in 2:00.")
    expect(auth().isAuthenticated).toBe(false)
  })

  it("uses the Retry-After header when the body is empty", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "45" } }))
    const auth = renderAuth()
    const err = await caught(() => auth().pinLogin({ cashierId: 3, pin: "123456" }))
    expect((err as LoginBlockedError).block).toEqual({ code: "RATE_LIMITED", retryAfterSeconds: 45 })
  })
})
