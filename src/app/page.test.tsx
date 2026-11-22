// T0-8 part 2: "/" has no page of its own. Signed in: the landing page sign-in uses (landingPathFor). Signed out:
// /login. While the auth state loads: nothing yet.
import { render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Home from "@/app/page"

const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace }) }))

const auth: { isAuthenticated: boolean; isLoading: boolean; user: { role: string } | null } = { isAuthenticated: false, isLoading: false, user: null }
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth }))

beforeEach(() => {
  replace.mockReset()
  auth.isAuthenticated = false
  auth.isLoading = false
  auth.user = null
})

describe("/", () => {
  it("waits while the auth state loads", () => {
    auth.isLoading = true
    const { container } = render(<Home />)
    expect(replace).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })

  it("signed out: goes to /login", () => {
    render(<Home />)
    expect(replace).toHaveBeenCalledWith("/login")
  })

  it.each([
    ["ADMIN", "/dashboard"],
    ["HEAD_CHEF", "/dashboard"],
    ["CASHIER", "/pos/login"],
    ["KITCHEN", "/kitchen"],
    ["BARISTA", "/bar"],
    ["STOCK_ADMIN", "/inventory"],
    ["STOCK_CLERK", "/stock-movement"],
  ])("signed in as %s: goes to %s", (role, path) => {
    auth.isAuthenticated = true
    auth.user = { role }
    render(<Home />)
    expect(replace).toHaveBeenCalledWith(path)
  })
})
