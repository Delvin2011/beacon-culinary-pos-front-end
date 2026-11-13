import type { ComponentType } from "react"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import BarLoginPage from "@/app/bar/login/page"
import KitchenLoginPage from "@/app/kitchen/login/page"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))

const fetchMock = vi.fn<typeof fetch>()

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

// Person 1's response; person 2 always gets a 401.
let personOneResponse: () => Response

const pinLoginCalls = (id: number) =>
  fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/auth/pin-login") && JSON.parse(String(init?.body)).cashierId === id)
    .length

async function enterPin(digits: string) {
  for (const digit of digits) {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: digit }))
    })
  }
}

async function click(name: RegExp | string) {
  // Find outside act(): waiting inside it would hold back the render being waited for.
  const button = await screen.findByRole("button", { name })
  await act(async () => {
    fireEvent.click(button)
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  localStorage.clear()
  sessionStorage.clear()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.includes("/users/login-tiles")) {
      return json(200, [
        { id: 1, name: "Ann Lee" },
        { id: 2, name: "Bob Ray" },
      ])
    }
    if (url.endsWith("/auth/pin-login")) {
      const { cashierId } = JSON.parse(String(init?.body)) as { cashierId: number }
      return cashierId === 1 ? personOneResponse() : json(401, undefined)
    }
    throw new Error(`Unexpected request ${url}`)
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe.each<[string, ComponentType]>([
  ["bar", BarLoginPage],
  ["kitchen", KitchenLoginPage],
])("%s PIN sign-in on 429", (_screen, Page) => {
  function renderPage() {
    render(
      <AuthProvider>
        <Page />
      </AuthProvider>,
    )
  }

  it("blocks only the person who got the 429, and re-enables without resending", async () => {
    personOneResponse = () => json(429, { code: "ACCOUNT_LOCKED", message: "x", retryAfterSeconds: 2 }, { "Retry-After": "2" })
    renderPage()

    await click(/Ann Lee/)
    await enterPin("111111")

    expect(await screen.findByText(/^This account is temporarily locked\. Try again in 0:0[12] or ask a manager\.$/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "1" })).toBeDisabled()

    await click("Back")
    expect(within(screen.getByRole("button", { name: /Ann Lee/ })).getByText(/0:0[12]/)).toBeInTheDocument()

    await click(/Bob Ray/)
    expect(screen.getByRole("button", { name: "1" })).toBeEnabled()
    await enterPin("222222")
    expect(await screen.findByText("Incorrect PIN.")).toBeInTheDocument()
    expect(pinLoginCalls(2)).toBe(1)

    await click("Back")
    await click(/Ann Lee/)
    expect(screen.getByRole("button", { name: "1" })).toBeDisabled()
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByRole("button", { name: "1" })).toBeEnabled()
    expect(screen.queryByText(/temporarily locked/)).not.toBeInTheDocument()
    expect(pinLoginCalls(1)).toBe(1)
  })

  it("shows a lock that needs a manager without disabling the keypad", async () => {
    personOneResponse = () => json(429, { code: "ACCOUNT_LOCKED", message: "x", retryAfterSeconds: null })
    renderPage()

    await click(/Ann Lee/)
    await enterPin("111111")

    expect(await screen.findByText("This account is locked. Ask a manager to unlock it.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "1" })).toBeEnabled()

    await click("Back")
    expect(within(screen.getByRole("button", { name: /Ann Lee/ })).getByText("Locked")).toBeInTheDocument()
  })
})
