// T1-3: none of the customer's answers signs anyone out: CUSTOMER_SUSPENDED, CUSTOMER_UNAVAILABLE and an unknown
// address (an empty 404) leave the session, the stored sign-in and the cookies alone, and never start a refresh or a
// logout. A call made while suspended is refused without a request, and that isn't a sign-out either.
import { useContext, type ContextType } from "react"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthContext, AuthProvider } from "@/contexts/auth-context"
import { CustomerSuspendedError } from "@/lib/api-fetch"
import { getCustomerStatus } from "@/lib/customer-status"

type Auth = NonNullable<ContextType<typeof AuthContext>>

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const ANSWERS: Array<[string, () => Response]> = [
  ["CUSTOMER_SUSPENDED", () => json(503, { error: "Suspended.", code: "CUSTOMER_SUSPENDED" })],
  ["CUSTOMER_UNAVAILABLE", () => json(503, { error: "Unavailable.", code: "CUSTOMER_UNAVAILABLE" })],
  ["an empty 404 (unknown address)", () => new Response(null, { status: 404 })],
]

const fetchMock = vi.fn<typeof fetch>()
const STORED = JSON.stringify({ token: "a.b.c", user: { email: "t@x.co", name: "Thandi", role: "CASHIER", cashierId: 17 } })

function renderSignedIn(): () => Auth {
  localStorage.setItem("bar-talk.auth", STORED)
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

const authPaths = () => fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith("/api/auth/"))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe.each(ANSWERS)("%s", (_name, answer) => {
  it("keeps the session: no refresh, no logout, the stored sign-in and other cookies untouched", async () => {
    document.cookie = "deviceToken=till-1; path=/"
    fetchMock.mockImplementation(async (url) => (String(url) === "/api/health" ? new Response(null, { status: 404 }) : answer()))
    const auth = renderSignedIn()

    let status = 0
    await act(async () => {
      status = (await auth().authFetch("/orders/today")).status
    })
    await act(async () => {
      await auth().authFetch("/menu/today").catch((err: unknown) => err)
    })

    expect(status).toBe(answer().status)
    expect(auth().isAuthenticated).toBe(true)
    expect(auth().token).toBe("a.b.c")
    expect(localStorage.getItem("bar-talk.auth")).toBe(STORED)
    expect(authPaths()).toEqual([])
    expect(document.cookie).toContain("deviceToken=till-1")
    document.cookie = "deviceToken=; path=/; max-age=0"
  })
})

describe("while suspended", () => {
  it("a call is refused without a request, and the user stays signed in", async () => {
    fetchMock.mockResolvedValue(json(503, { code: "CUSTOMER_SUSPENDED" }))
    const auth = renderSignedIn()
    await act(async () => {
      await auth().authFetch("/orders/today")
    })
    expect(getCustomerStatus().suspended).toBe(true)
    const sent = fetchMock.mock.calls.length

    let error: unknown
    await act(async () => {
      error = await auth().authFetch("/shifts/open").catch((err: unknown) => err)
    })
    expect(error).toBeInstanceOf(CustomerSuspendedError)
    expect(fetchMock.mock.calls.length).toBe(sent)
    expect(auth().isAuthenticated).toBe(true)
    expect(localStorage.getItem("bar-talk.auth")).toBe(STORED)
  })
})
