import { useContext, type ContextType } from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthContext, AuthProvider } from "@/contexts/auth-context"
import { ManagementSessionProvider } from "@/contexts/management-session-context"
import { useManagementSession } from "@/hooks/use-management-session"

type Auth = NonNullable<ContextType<typeof AuthContext>>

const fetchMock = vi.fn<typeof fetch>()
const action = vi.fn()
let auth: Auth | undefined

function Trigger() {
  const { runWithManagementSession } = useManagementSession()
  auth = useContext(AuthContext)
  return (
    <button type="button" onClick={() => runWithManagementSession(action)}>
      Open approval
    </button>
  )
}

function renderSignedIn() {
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "c@x", cashierId: 4 } }))
  render(
    <AuthProvider>
      <ManagementSessionProvider>
        <Trigger />
      </ManagementSessionProvider>
    </AuthProvider>,
  )
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

async function clickButton(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }))
  })
}

async function enterPinAndSubmit(digits: string) {
  for (const digit of digits) await clickButton(digit)
  await clickButton("Unlock Management")
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  localStorage.clear()
  sessionStorage.clear()
  fetchMock.mockReset()
  action.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("manager-PIN approval", () => {
  it("counts down on a 429 with submit disabled, Back working, and nothing resent", async () => {
    fetchMock.mockResolvedValue(json(429, { code: "RATE_LIMITED", message: "x", retryAfterSeconds: 2 }, { "Retry-After": "2" }))
    renderSignedIn()

    await clickButton("Open approval")
    await enterPinAndSubmit("123456")

    expect(screen.getByText(/^Too many attempts\. Try again in 0:0[12]\.$/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Unlock Management" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "1" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled()
    expect(screen.getByText("------")).toBeInTheDocument()

    // Closing and reopening the popup keeps the countdown.
    await clickButton("Back")
    expect(screen.queryByText(/Too many attempts/)).not.toBeInTheDocument()
    await clickButton("Open approval")
    expect(screen.getByText(/^Too many attempts\. Try again in 0:0[12]\.$/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "1" })).toBeDisabled()

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.queryByText(/Too many attempts/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "1" })).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(action).not.toHaveBeenCalled()
    expect(auth?.isAuthenticated).toBe(true)
  })

  it("sends a wrong PIN once, without refreshing, and keeps the user signed in", async () => {
    fetchMock.mockResolvedValue(json(401, { error: "Invalid PIN." }))
    renderSignedIn()

    await clickButton("Open approval")
    await enterPinAndSubmit("654321")

    expect(screen.getByText("Incorrect manager PIN. Try again.")).toBeInTheDocument()
    expect(screen.getByText("------")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/admin\/authorize-session$/)
    expect(auth?.isAuthenticated).toBe(true)
  })

  it("clears the PIN after any other failure", async () => {
    fetchMock.mockResolvedValue(json(500, { message: "boom" }))
    renderSignedIn()

    await clickButton("Open approval")
    await enterPinAndSubmit("123456")

    expect(screen.getByText("------")).toBeInTheDocument()
    expect(action).not.toHaveBeenCalled()
  })

  it("runs the pending action after a correct PIN", async () => {
    fetchMock.mockResolvedValue(json(200, { sessionToken: "s1", adminId: 9, expiresAt: new Date(Date.now() + 300_000).toISOString() }))
    renderSignedIn()

    await clickButton("Open approval")
    await enterPinAndSubmit("123456")

    expect(action).toHaveBeenCalledWith("s1")
    expect(screen.queryByRole("button", { name: "Unlock Management" })).not.toBeInTheDocument()
  })
})
