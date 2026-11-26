// T1-3: each response on the kitchen and bar displays, the board, a back-office page (meal periods) and the invite
// page, rendered inside the app's Providers as in the app:
//  - CUSTOMER_SUSPENDED: the full-page message; the screen's own loops stop (no call but the /health check every
//    60 s ± 15 s), and the screen picks up again on its own once /health answers.
//  - CUSTOMER_UNAVAILABLE: the shared banner ("Can't reach the server…"); the screen keeps its own retries.
//  - an unknown address (empty 404 everywhere, /health included): the banner "This address isn't set up."
import { act, render, screen } from "@testing-library/react"
import type { ReactElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import InvitePage from "@/app/invite/page"
import MealPeriodsPage from "@/app/meal-periods/page"
import { BarQueueBoard } from "@/components/bar/bar-queue-board"
import { PublicDisplayBoard } from "@/components/board/public-display-board"
import { KitchenQueueBoard } from "@/components/kitchen/kitchen-queue-board"
import { Providers } from "@/components/providers"
import { apiFetch } from "@/lib/api-fetch"
import { SUSPENDED_MESSAGE, UNKNOWN_ADDRESS_MESSAGE } from "@/lib/customer-status"
import { TOKEN } from "@/lib/invites.test-fixtures"

let pathname = "/"
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

// The signed-in user's authFetch, as the auth context makes it: apiFetch with credentials.
const auth = {
  authFetch: (path: string, init?: RequestInit) => apiFetch(path, { ...init, credentials: "include" }),
  isAuthenticated: true,
  isLoading: false,
  user: { email: "admin@x.co", name: "Admin", role: "ADMIN" },
  logout: vi.fn(),
}
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth }))
// The back office's sidebar, as in the page's own tests.
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }))
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarTrigger: () => null,
}))

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const ANSWERS = {
  suspended: () => json(503, { error: "Suspended.", code: "CUSTOMER_SUSPENDED" }),
  unavailable: () => json(503, { error: "Unavailable.", code: "CUSTOMER_UNAVAILABLE" }),
  unknown: () => new Response(null, { status: 404 }),
}
let answer: () => Response
const fetchMock = vi.fn<typeof fetch>()
const paths = () => fetchMock.mock.calls.map(([url]) => new URL(String(url), "http://x").pathname)

// reloads: the screen has its own loop (the displays) and loads again by itself once the suspension ends; the others
// keep their own message and wait for the user, as after any failed load.
const SCREENS: Array<{ name: string; path: string; element: () => ReactElement; firstCall: string; reloads: boolean }> = [
  { name: "the kitchen display", path: "/kitchen", element: () => <KitchenQueueBoard />, firstCall: "/api/kitchen/orders", reloads: true },
  { name: "the bar display", path: "/bar", element: () => <BarQueueBoard />, firstCall: "/api/bar/orders", reloads: true },
  { name: "the board", path: "/board", element: () => <PublicDisplayBoard />, firstCall: "/api/public/board/today", reloads: true },
  { name: "a back-office page (meal periods)", path: "/meal-periods", element: () => <MealPeriodsPage />, firstCall: "/api/admin/meal-periods", reloads: false },
  { name: "the invite page", path: "/invite", element: () => <InvitePage />, firstCall: "/api/auth/invites/lookup", reloads: false },
]

// The shared banner, among the screen's own alerts (screens keep their messages).
const bannerWith = (text: string) => screen.getAllByRole("alert").find((element) => element.textContent?.includes(text))

const advance = (ms: number) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms)
})

function renderScreen(path: string, element: ReactElement) {
  pathname = path
  window.history.replaceState(null, "", path === "/invite" ? `/invite#t=${TOKEN}` : path)
  return render(<Providers>{element}</Providers>)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(Math, "random").mockReturnValue(0.5)
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }))
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => answer())
  vi.stubGlobal("fetch", fetchMock)
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe.each(SCREENS)("$name", ({ path, element, firstCall, reloads }) => {
  it("CUSTOMER_SUSPENDED: the full-page message, no calls but the /health check, then back on its own", async () => {
    answer = ANSWERS.suspended
    renderScreen(path, element())
    await advance(100)
    expect(screen.getByRole("alertdialog")).toHaveTextContent(SUSPENDED_MESSAGE)
    expect(paths()).toContain(firstCall)

    // Nothing else is called while suspended: the next call is the /health check, 60 s on.
    const before = fetchMock.mock.calls.length
    await advance(59_000)
    expect(fetchMock.mock.calls.length).toBe(before)
    await advance(1_000)
    expect(paths().slice(before)).toEqual(["/api/health"])

    // The customer is active again: the next check sees it and the message goes; a display loads again by itself.
    answer = () => json(200, [])
    await advance(60_000)
    expect(paths().slice(before, before + 2)).toEqual(["/api/health", "/api/health"])
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    await advance(3_000)
    // T1-8: the customer's name, refused while suspended, is fetched once more when the suspension ends.
    const after = paths().slice(before + 2)
    expect(after.filter((path) => path === "/api/public/branding")).toHaveLength(1)
    if (reloads) expect(after).toContain(firstCall)
    else expect(after.filter((path) => path !== "/api/public/branding")).toEqual([])
  })

  it("CUSTOMER_UNAVAILABLE: the shared banner, no full-page message", async () => {
    answer = ANSWERS.unavailable
    renderScreen(path, element())
    await advance(100)
    expect(bannerWith("Can't reach the server. Nothing has been lost. Try again.")).toBeDefined()
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  })

  it("an unknown address: the banner, once /health confirms it", async () => {
    answer = ANSWERS.unknown
    renderScreen(path, element())
    await advance(100)
    expect(paths()).toContain("/api/health")
    expect(bannerWith(UNKNOWN_ADDRESS_MESSAGE)).toBeDefined()
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  })
})
