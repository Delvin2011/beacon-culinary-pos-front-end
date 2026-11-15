// 403 DEVICE_NOT_REGISTERED (`required` mode) on the POS, bar and kitchen login screens: a clear message, never a
// sign-out, never an automatic retry.
import type { ComponentType } from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import PosLoginPage from "@/app/pos/login/page"
import BarLoginPage from "@/app/bar/login/page"
import KitchenLoginPage from "@/app/kitchen/login/page"

const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace }) }))

const fetchMock = vi.fn<typeof fetch>()

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

const notRegistered = () => json(403, { error: "This till isn't registered.", code: "DEVICE_NOT_REGISTERED" })
const calls = (part: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(part)).length

function renderPage(Page: ComponentType) {
  render(
    <AuthProvider>
      <Page />
    </AuthProvider>,
  )
}

async function click(name: string | RegExp) {
  const button = await screen.findByRole("button", { name })
  await act(async () => {
    fireEvent.click(button)
  })
}

async function enterPin(digits: string) {
  for (const digit of digits) await click(digit)
}

beforeEach(() => {
  replace.mockReset()
  localStorage.clear()
  sessionStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("POS login on an unregistered till", () => {
  it("shows the message for a refused cashier list, without signing out or retrying", async () => {
    fetchMock.mockImplementation(async () => notRegistered())
    renderPage(PosLoginPage)

    expect(await screen.findByText("This till is not registered. Ask a manager to register it.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Manager sign-in" })).toHaveAttribute("href", "/login?reauth=1&returnTo=%2Fdevices%2Fregister")
    expect(calls("/users/cashiers")).toBe(1)
    expect(replace).not.toHaveBeenCalled()

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(calls("/users/cashiers")).toBe(1)

    await click("Try again")
    expect(calls("/users/cashiers")).toBe(2)
  })

  it("shows the message for a refused PIN sign-in, sent once", async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).includes("/users/cashiers") ? json(200, [{ id: 1, name: "Ann Lee" }]) : notRegistered(),
    )
    renderPage(PosLoginPage)

    await click(/Ann Lee/)
    await enterPin("123456")

    expect(await screen.findByText("This till is not registered. Ask a manager to register it.")).toBeInTheDocument()
    expect(calls("/auth/pin-login")).toBe(1)
    expect(replace).not.toHaveBeenCalled()
  })

  it("still shows the countdown for a 429", async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).includes("/users/cashiers")
        ? json(200, [{ id: 1, name: "Ann Lee" }])
        : json(429, { code: "RATE_LIMITED", message: "x", retryAfterSeconds: 60 }, { "Retry-After": "60" }),
    )
    renderPage(PosLoginPage)

    await click(/Ann Lee/)
    await enterPin("123456")

    expect(await screen.findByText(/^Too many attempts\. Try again in [01]:\d\d\.$/)).toBeInTheDocument()
    expect(screen.queryByText(/not registered/)).not.toBeInTheDocument()
  })
})

describe.each<[string, ComponentType, string]>([
  ["bar", BarLoginPage, "screen=BAR"],
  ["kitchen", KitchenLoginPage, "screen=KITCHEN"],
])("%s login with a stale admin tile", (_screen, Page, tilesQuery) => {
  it("tells managers to use their password and reloads the tiles once", async () => {
    let pinStatus: () => Response = notRegistered
    fetchMock.mockImplementation(async (input) =>
      String(input).includes("/users/login-tiles") ? json(200, [{ id: 9, name: "Boss Admin" }]) : pinStatus(),
    )
    renderPage(Page)

    await click(/Boss Admin/)
    await enterPin("123456")

    expect(await screen.findByText(/Managers sign in with their password on this screen\./)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Password sign-in" })).toHaveAttribute("href", "/login")
    expect(calls("/auth/pin-login")).toBe(1)
    expect(calls(tilesQuery)).toBe(2)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(calls(tilesQuery)).toBe(2)

    // A normal wrong PIN afterwards is unchanged.
    pinStatus = () => json(401, undefined)
    await click(/Boss Admin/)
    expect(screen.queryByText(/Managers sign in/)).not.toBeInTheDocument()
    await enterPin("654321")
    expect(await screen.findByText("Incorrect PIN.")).toBeInTheDocument()
  })
})
