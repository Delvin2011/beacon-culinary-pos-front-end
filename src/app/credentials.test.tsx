// Every API request includes credentials so the till's deviceToken cookie is sent (WS1-1b), except /public/**.
import { useContext, type ComponentType, type ContextType } from "react"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthContext, AuthProvider } from "@/contexts/auth-context"
import PosLoginPage from "@/app/pos/login/page"
import BarLoginPage from "@/app/bar/login/page"
import KitchenLoginPage from "@/app/kitchen/login/page"
import { PublicDisplayBoard } from "@/components/board/public-display-board"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))

type Auth = NonNullable<ContextType<typeof AuthContext>>

const fetchMock = vi.fn<typeof fetch>()

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function renderAuth(signedIn = false): () => Auth {
  if (signedIn) localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "me@x.co" } }))
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

function initFor(pathEnd: string): RequestInit | undefined {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith(pathEnd))
  expect(call, `no request ending in ${pathEnd}`).toBeDefined()
  return call?.[1]
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes("/users/")) return json(200, [])
    if (url.includes("/public/board/")) return json(200, [])
    return json(401, undefined)
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("credentials on every API request", () => {
  it("authFetch includes credentials", async () => {
    fetchMock.mockImplementation(async () => json(200, {}))
    const auth = renderAuth(true)
    await act(async () => {
      await auth().authFetch("/admin/devices")
    })
    expect(initFor("/admin/devices")?.credentials).toBe("include")
  })

  it("password sign-in includes credentials", async () => {
    const auth = renderAuth()
    await act(async () => {
      await auth().login({ email: "a@b.c", password: "secret1" }).catch(() => {})
    })
    expect(initFor("/auth/login")?.credentials).toBe("include")
  })

  it("PIN sign-in includes credentials", async () => {
    const auth = renderAuth()
    await act(async () => {
      await auth().pinLogin({ cashierId: 1, pin: "123456" }).catch(() => {})
    })
    expect(initFor("/auth/pin-login")?.credentials).toBe("include")
  })

  it("refresh includes credentials", async () => {
    const auth = renderAuth(true)
    await act(async () => {
      await auth().authFetch("/orders")
    })
    expect(initFor("/auth/refresh")?.credentials).toBe("include")
  })

  it.each<[string, ComponentType, string]>([
    ["POS cashier list", PosLoginPage, "/users/cashiers"],
    ["bar tiles", BarLoginPage, "/users/login-tiles?screen=BAR"],
    ["kitchen tiles", KitchenLoginPage, "/users/login-tiles?screen=KITCHEN"],
  ])("the %s includes credentials", async (_name, Page, pathEnd) => {
    render(
      <AuthProvider>
        <Page />
      </AuthProvider>,
    )
    await act(async () => {})
    expect(initFor(pathEnd)?.credentials).toBe("include")
  })

  it("the public board does not (the /public/** exception)", async () => {
    render(<PublicDisplayBoard />)
    await act(async () => {})
    expect(initFor("/public/board/today")?.credentials).toBeUndefined()
  })
})
