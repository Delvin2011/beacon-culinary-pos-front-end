// Every sign-out path calls POST /auth/logout (contract 7.1), and the POS still works as a registered till after
// sign-out: nothing on sign-out touches the till cookie.
import type { ComponentType, ReactNode } from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { NavUser } from "@/components/nav-user"
import BarPage from "@/app/bar/page"
import KitchenPage from "@/app/kitchen/page"
import StockMovementPage from "@/app/stock-movement/page"
import PosMainPage from "@/app/pos/page"
import PosLoginPage from "@/app/pos/login/page"

const push = vi.fn()
const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }))

// Live boards and the order builder aren't part of sign-out.
vi.mock("@/components/bar/bar-queue-board", () => ({ BarQueueBoard: () => null }))
vi.mock("@/components/kitchen/kitchen-queue-board", () => ({ KitchenQueueBoard: () => null }))
vi.mock("@/components/pos/order-builder", () => ({ PosOrderBuilder: () => null }))

// The sidebar menu and dropdown, flattened so the "Log out" item is a plain button.
vi.mock("@/components/ui/sidebar", () => ({
  SidebarMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useSidebar: () => ({ isMobile: false }),
}))
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => null,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}))

// The POS page: another cashier's shift is open, so the "Till in use" screen with its Log Out button shows.
vi.mock("@/hooks/use-shift", () => ({
  useShift: () => ({
    shift: { id: 7, owner: { id: 2, name: "Ann Lee" }, openedAt: "2026-11-14T06:00:00Z", ownedByCaller: false },
    isLoading: false,
    refetch: vi.fn(),
  }),
}))

const fetchMock = vi.fn<typeof fetch>()
const logoutCalls = () =>
  fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/auth/logout") && init?.method === "POST")

function signIn(role: string) {
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "me@x.co", name: "Me", role } }))
}

function renderPage(Page: ComponentType) {
  render(
    <AuthProvider>
      <Page />
    </AuthProvider>,
  )
}

beforeEach(() => {
  push.mockReset()
  replace.mockReset()
  localStorage.clear()
  sessionStorage.clear()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url.endsWith("/auth/logout")) return new Response(null, { status: 204 })
    if (url.endsWith("/users/cashiers")) return new Response(JSON.stringify([{ id: 1, name: "Ann Lee" }]), { status: 200 })
    return new Response("{}", { status: 200 })
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("sign-out buttons call POST /auth/logout", () => {
  it.each<[string, ComponentType, string, string, string | RegExp]>([
    ["back-office user menu", NavUser, "ADMIN", "/login", /Log out/],
    ["bar header", BarPage, "BARISTA", "/bar/login", /Logout/],
    ["kitchen header", KitchenPage, "KITCHEN", "/kitchen/login", /Logout/],
    ["stock-movement header", StockMovementPage, "STOCK_CLERK", "/stock-movement/login", /Logout/],
    ["POS 'Till in use' screen", PosMainPage, "CASHIER", "/pos/login", /Log Out/],
  ])("%s", async (_name, Page, role, destination, buttonName) => {
    signIn(role)
    renderPage(Page)

    const button = await screen.findByRole("button", { name: buttonName })
    await act(async () => {
      fireEvent.click(button)
    })

    expect(logoutCalls()).toHaveLength(1)
    expect(logoutCalls()[0][1]).toMatchObject({ credentials: "include" })
    expect(localStorage.getItem("bar-talk.auth")).toBeNull()
    expect(replace).toHaveBeenCalledWith(destination)
  })
})

describe("automatic sign-outs call POST /auth/logout", () => {
  it.each<[string, ComponentType, string]>([
    ["bar", BarPage, "/bar/login"],
    ["kitchen", KitchenPage, "/kitchen/login"],
    ["stock movement", StockMovementPage, "/stock-movement/login"],
  ])("signs a user without access out of the %s screen", async (_name, Page, destination) => {
    signIn("CASHIER")
    renderPage(Page)
    await act(async () => {})

    expect(logoutCalls()).toHaveLength(1)
    expect(replace).toHaveBeenCalledWith(destination)
  })
})

describe("after sign-out the POS still works as a registered till", () => {
  it("keeps the till cookie and loads the cashier tiles with credentials", async () => {
    document.cookie = "deviceToken=till-1; path=/"
    signIn("CASHIER")
    renderPage(PosMainPage)

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /Log Out/ }))
    })
    expect(document.cookie).toContain("deviceToken=till-1")

    renderPage(PosLoginPage)

    expect(await screen.findByRole("button", { name: /Ann Lee/ })).toBeInTheDocument()
    const listCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/users/cashiers"))
    expect(listCall?.[1]).toMatchObject({ credentials: "include" })
    document.cookie = "deviceToken=; path=/; max-age=0"
  })
})
