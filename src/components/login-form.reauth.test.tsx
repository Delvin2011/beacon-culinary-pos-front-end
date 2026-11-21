import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { LoginForm } from "@/components/login-form"

const push = vi.fn()
const replace = vi.fn()
let search = ""

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(search),
}))
vi.mock("next/image", () => ({ default: () => null }))

const fetchMock = vi.fn<typeof fetch>()

// An unsigned token whose payload carries the role (the app reads claims without verifying them).
function token(role: string): string {
  const payload = btoa(JSON.stringify({ role })).replace(/=+$/, "")
  return `x.${payload}.y`
}

function signInResponse(role: string): Response {
  return new Response(JSON.stringify({ token: token(role) }), { status: 200, headers: { "Content-Type": "application/json" } })
}

function renderForm({ signedInAs }: { signedInAs?: string } = {}) {
  if (signedInAs) {
    localStorage.setItem("bar-talk.auth", JSON.stringify({ token: token(signedInAs), user: { email: "me@x.co", role: signedInAs } }))
  }
  render(
    <AuthProvider>
      <LoginForm />
    </AuthProvider>,
  )
}

async function signIn() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "me@x.co" } })
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret1" } })
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /login/i }))
  })
}

beforeEach(() => {
  push.mockReset()
  replace.mockReset()
  localStorage.clear()
  sessionStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("re-sign-in (/login?reauth=1&returnTo=…)", () => {
  it("keeps the form up for a signed-in admin, then returns to the device page after a fresh sign-in", async () => {
    search = "reauth=1&returnTo=%2Fdevices%2Fregister"
    renderForm({ signedInAs: "ADMIN" })
    await act(async () => {})

    expect(screen.getByText("Sign in again with your password to manage tills.")).toBeInTheDocument()
    expect(screen.getByLabelText("Password")).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()

    fetchMock.mockResolvedValueOnce(signInResponse("ADMIN"))
    await signIn()

    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/auth\/login$/)
    expect(replace).toHaveBeenCalledWith("/devices/register")
    expect(push).not.toHaveBeenCalled()
  })

  it("doesn't send a non-admin to the device pages", async () => {
    search = "reauth=1&returnTo=%2Fdevices%2Fregister"
    renderForm()
    fetchMock.mockResolvedValueOnce(signInResponse("CASHIER"))
    await signIn()

    expect(screen.getByText(/Only managers can register tills\./)).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it.each(["%2F%2Fevil.com", "https%3A%2F%2Fevil.com", "%2Finventory"])("ignores returnTo=%s and goes to the default page", async (raw) => {
    search = `reauth=1&returnTo=${raw}`
    renderForm()
    fetchMock.mockResolvedValueOnce(signInResponse("ADMIN"))
    await signIn()

    expect(replace).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith("/dashboard")
  })
})

describe("plain /login", () => {
  it("still sends a signed-in admin straight to the dashboard", async () => {
    search = ""
    renderForm({ signedInAs: "ADMIN" })
    await act(async () => {})
    expect(push).toHaveBeenCalledWith("/dashboard")
    expect(screen.queryByText(/manage tills/)).not.toBeInTheDocument()
  })
})
