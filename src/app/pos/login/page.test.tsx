import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import PosLoginPage from "@/app/pos/login/page"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))

const fetchMock = vi.fn<typeof fetch>()

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

const pinLoginCalls = (cashierId: number) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).endsWith("/auth/pin-login") && JSON.parse(String(init?.body)).cashierId === cashierId,
  ).length

async function enterPin(digits: string) {
  for (const digit of digits) {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: digit }))
    })
  }
}

async function openTile(name: RegExp) {
  // Find outside act(): waiting inside it would hold back the render being waited for.
  const tile = await screen.findByRole("button", { name })
  await act(async () => {
    fireEvent.click(tile)
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  localStorage.clear()
  sessionStorage.clear()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.endsWith("/users/cashiers")) {
      return json(200, [
        { id: 1, name: "Ann Lee" },
        { id: 2, name: "Bob Ray" },
      ])
    }
    if (url.endsWith("/auth/pin-login")) {
      const { cashierId } = JSON.parse(String(init?.body)) as { cashierId: number }
      return cashierId === 1
        ? json(429, { code: "RATE_LIMITED", message: "x", retryAfterSeconds: 3 }, { "Retry-After": "3" })
        : json(401, undefined)
    }
    throw new Error(`Unexpected request ${url}`)
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("POS PIN sign-in on 429", () => {
  it("blocks only the cashier who got the 429, and re-enables without resending", async () => {
    render(
      <AuthProvider>
        <PosLoginPage />
      </AuthProvider>,
    )

    await openTile(/Ann Lee/)
    await enterPin("111111")

    expect(await screen.findByText(/^Too many attempts\. Try again in 0:0[23]\.$/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "1" })).toBeDisabled()
    expect(pinLoginCalls(1)).toBe(1)

    // Back to the tiles: Ann's tile shows the wait; Bob can still sign in.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back" }))
    })
    expect(within(screen.getByRole("button", { name: /Ann Lee/ })).getByText(/0:0[123]/)).toBeInTheDocument()

    await openTile(/Bob Ray/)
    expect(screen.queryByText(/Too many attempts/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "1" })).toBeEnabled()
    await enterPin("222222")
    expect(await screen.findByText("Incorrect PIN.")).toBeInTheDocument()
    expect(pinLoginCalls(2)).toBe(1)

    // Reopening Ann still shows her countdown with the keypad disabled.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back" }))
    })
    await openTile(/Ann Lee/)
    expect(screen.getByText(/^Too many attempts\. Try again in 0:0[123]\.$/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "1" })).toBeDisabled()

    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.queryByText(/Too many attempts/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "1" })).toBeEnabled()
    expect(pinLoginCalls(1)).toBe(1)
  })
})
