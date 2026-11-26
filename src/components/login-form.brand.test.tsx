// T1-8: /login names the customer at this address (GET /public/branding), shows its logo only when it has one, and
// has no built-in picture.
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { LoginForm } from "@/components/login-form"
import { BRANDING_STORAGE_KEY } from "@/lib/customer-branding"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal("fetch", vi.fn())
})

function renderLogin() {
  return render(
    <AuthProvider>
      <LoginForm />
    </AuthProvider>,
  )
}

describe("login brand", () => {
  it("names the customer, with no logo and no picture when it has no logo", () => {
    localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify({ name: "Riverside Canteen", logoUrl: null }))
    const { container } = renderLogin()
    expect(screen.getByText("Login to your Riverside Canteen Account")).toBeInTheDocument()
    expect(container.querySelector("img")).toBeNull()
  })

  it("shows the customer's logo when it has one", () => {
    localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify({ name: "Riverside Canteen", logoUrl: "https://cdn.example/logo.png" }))
    renderLogin()
    expect(screen.getByRole("img", { name: "Riverside Canteen logo" })).toHaveAttribute("src", "https://cdn.example/logo.png")
  })

  it("a fresh address: the neutral name", () => {
    renderLogin()
    expect(screen.getByText("Login to your Canteen POS Account")).toBeInTheDocument()
  })
})
