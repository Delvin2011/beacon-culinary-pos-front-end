// T1-8: the name from GET /api/public/branding on every screen that names the business, and in the tab title,
// rendered inside the app's Providers as in the app (which fetch it once). The POS header and the receipt are tested
// with the till (src/app/pos/offline-reload.test.tsx, src/components/receipts/receipt-view.test.tsx).
import { render, screen, waitFor } from "@testing-library/react"
import type { ReactElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import BarPage from "@/app/bar/page"
import BarLoginPage from "@/app/bar/login/page"
import InvitePage from "@/app/invite/page"
import KitchenPage from "@/app/kitchen/page"
import KitchenLoginPage from "@/app/kitchen/login/page"
import MealPeriodsPage from "@/app/meal-periods/page"
import PosLoginPage from "@/app/pos/login/page"
import { PublicDisplayBoard } from "@/components/board/public-display-board"
import { LoginForm } from "@/components/login-form"
import { Providers } from "@/components/providers"
import { apiFetch } from "@/lib/api-fetch"
import { BRANDING_STORAGE_KEY } from "@/lib/customer-branding"
import { TOKEN } from "@/lib/invites.test-fixtures"

let pathname = "/"
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const auth = {
  authFetch: (path: string, init?: RequestInit) => apiFetch(path, { ...init, credentials: "include" }),
  isAuthenticated: true,
  isLoading: false,
  user: { email: "admin@x.co", name: "Admin", role: "ADMIN" },
  logout: vi.fn(),
  login: vi.fn(),
  pinLogin: vi.fn(),
  error: null,
  sessionEndedNotice: null,
  clearSessionEndedNotice: vi.fn(),
}
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth }))

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const fetchMock = vi.fn<typeof fetch>()

const SCREENS: Array<{ name: string; path: string; element: () => ReactElement }> = [
  { name: "/login", path: "/login", element: () => <LoginForm /> },
  { name: "the POS sign-in", path: "/pos/login", element: () => <PosLoginPage /> },
  { name: "the kitchen display", path: "/kitchen", element: () => <KitchenPage /> },
  { name: "the kitchen sign-in", path: "/kitchen/login", element: () => <KitchenLoginPage /> },
  { name: "the bar display", path: "/bar", element: () => <BarPage /> },
  { name: "the bar sign-in", path: "/bar/login", element: () => <BarLoginPage /> },
  { name: "the board", path: "/board", element: () => <PublicDisplayBoard /> },
  { name: "the invite page", path: "/invite", element: () => <InvitePage /> },
  { name: "the back office (meal periods, sidebar)", path: "/meal-periods", element: () => <MealPeriodsPage /> },
]

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }))
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const path = new URL(String(input), "http://x").pathname
    if (path === "/api/public/branding") return json(200, { name: "Riverside Canteen", logoUrl: null })
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe.each(SCREENS)("$name", ({ path, element }) => {
  it("shows the customer's name from the endpoint, and the tab title is that name", async () => {
    pathname = path
    window.history.replaceState(null, "", path === "/invite" ? `/invite#t=${TOKEN}` : path)
    render(<Providers>{element()}</Providers>)

    await waitFor(() => expect(screen.getAllByText(/Riverside Canteen/).length).toBeGreaterThan(0))
    expect(screen.queryByText(/Canteen POS/)).not.toBeInTheDocument()
    expect(document.title).toBe("Riverside Canteen")
    const branding = fetchMock.mock.calls.filter(([url]) => String(url) === "/api/public/branding")
    expect(branding).toHaveLength(1)
    expect(branding[0][1]?.credentials).toBe("omit")
    expect(JSON.parse(localStorage.getItem(BRANDING_STORAGE_KEY)!).name).toBe("Riverside Canteen")
  })
})
