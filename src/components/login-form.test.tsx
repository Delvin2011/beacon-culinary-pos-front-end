import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { LoginForm } from "@/components/login-form"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock("next/image", () => ({ default: () => null }))

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  sessionStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function submit(email: string, password: string) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } })
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } })
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /login/i }))
  })
}

describe("LoginForm on 429", () => {
  it("counts down with Login disabled, clears the password, and re-enables without resending", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "RATE_LIMITED", message: "x", retryAfterSeconds: 2 }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "2" },
      }),
    )
    render(
      <AuthProvider>
        <LoginForm />
      </AuthProvider>,
    )

    await submit("a@b.c", "secret1")

    expect(screen.getByText("Too many attempts. Try again in 0:02.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /login/i })).toBeDisabled()
    expect(screen.getByLabelText("Password")).toHaveValue("")

    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByText("Too many attempts. Try again in 0:01.")).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByRole("button", { name: /login/i })).toBeEnabled()
    expect(screen.queryByText(/Too many attempts/)).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
