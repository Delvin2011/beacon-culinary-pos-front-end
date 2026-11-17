// O2: the shift list shows each shift's till and cash count; an uncounted shift never shows 0.00.
import { render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import PosActivityPage from "@/app/pos-activity/page"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }))
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarTrigger: () => null,
}))

const fetchMock = vi.fn<typeof fetch>()
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })

const shiftRow = (overrides: Record<string, unknown>) => ({
  owner: { id: 17, name: "Thandi Mokoena" },
  displayStatus: "CLOSED",
  openedAt: "2026-11-18T05:58:12Z",
  closedAt: "2026-11-18T15:02:40Z",
  openingFloat: 500,
  expectedCash: 1200,
  orderCount: 10,
  ...overrides,
})

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "boss@x.co", role: "ADMIN" } }))
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes("/admin/shifts?")) {
      return json({
        content: [
          shiftRow({ shiftId: 412, tillCode: "T1", tillName: "Till 1 (front)", closingCash: null, variance: null, forceClosed: true, cashCount: "UNCOUNTED" }),
          shiftRow({ shiftId: 413, owner: { id: 19, name: "Lerato Khumalo" }, tillCode: null, tillName: "Unregistered till", closingCash: 1200, variance: 0, forceClosed: false, cashCount: "COUNTED" }),
        ],
        page: 0,
        size: 25,
        totalElements: 2,
        totalPages: 1,
      })
    }
    if (url.endsWith("/admin/tills")) return json([])
    if (url.endsWith("/admin/staff")) return json([])
    return json({})
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("POS Activity shift list (O2)", () => {
  it("shows the till and the cash count, and blanks for an uncounted shift", async () => {
    render(
      <AuthProvider>
        <PosActivityPage />
      </AuthProvider>,
    )

    const thandi = (await screen.findByText("Thandi Mokoena")).closest("tr") as HTMLElement
    expect(within(thandi).getByText("T1")).toBeInTheDocument()
    expect(within(thandi).getByText("Not counted")).toBeInTheDocument()
    expect(within(thandi).getByText("Force-closed")).toBeInTheDocument()
    // No zero amount for counted cash or variance (the start float, R 500,00, is fine).
    expect(within(thandi).queryByText(/^R\s?0[.,]00$/)).not.toBeInTheDocument()
    expect(within(thandi).getAllByText("—").length).toBeGreaterThanOrEqual(2) // counted cash and variance

    const lerato = screen.getByText("Lerato Khumalo").closest("tr") as HTMLElement
    expect(within(lerato).getByText("Unregistered till")).toBeInTheDocument()
    expect(within(lerato).queryByText("Not counted")).not.toBeInTheDocument()
  })
})
