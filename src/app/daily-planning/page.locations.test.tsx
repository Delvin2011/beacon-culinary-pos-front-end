// T0-5d: the ingredient requirements label currentStock with primaryLocation.name and kitchenStock with
// productionLocation.name; confirming says the issue sheet was sent for approval (from the primary to production), and
// shortfalls are named at the primary, where they are measured.
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import DailyPlanningPage from "@/app/daily-planning/page"
import { PRIMARY, PRODUCTION } from "@/lib/locations.test-fixtures"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/daily-planning" }))
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }))
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarTrigger: () => null,
}))
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }))

const authFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()
const auth = { isAuthenticated: true, isLoading: false, user: { name: "Ayanda", role: "ADMIN" }, authFetch }
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth }))

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const PERIODS = [{ id: 2, name: "Midday", startTime: "12:00:00", endTime: "14:30:00", allDay: false, accepts: "SET_MEALS", plannable: true }]
const PLAN = {
  options: [
    { id: 42, mealCatalogId: 7, mealPeriodId: 2, optionDate: "2026-11-20", name: "Beef stew", price: 55, status: "PLANNED", plannedPortions: 30, actualPortions: null, sold: 0, portionsRemaining: 30 },
  ],
  componentStock: [],
}
const REQUIREMENTS = {
  requirements: [{ ingredientId: 1, name: "Beef", unit: "KG", calculatedQuantity: 3, currentStock: 12.5, kitchenStock: 1 }],
  uncovered: [],
  primaryLocation: { id: PRIMARY.id, name: PRIMARY.name, kind: "PRIMARY", sortOrder: 10 },
  productionLocation: { id: PRODUCTION.id, name: PRODUCTION.name, kind: "SECONDARY", sortOrder: 20 },
}

let confirmBody: Record<string, unknown>

beforeEach(() => {
  confirmBody = { shortfalls: [] }
  authFetch.mockReset()
  authFetch.mockImplementation(async (path) => {
    if (path === "/meal-periods") return json(PERIODS)
    if (path === "/admin/component-catalog") return json([])
    if (path.startsWith("/admin/meal-catalog?group=")) return json([])
    if (path.startsWith("/admin/meal-catalog")) return json([{ id: 7, name: "Beef stew", price: 55, active: true }])
    if (/^\/admin\/daily-planning\/[\d-]+\?period=/.test(path)) return json(PLAN)
    if (path.includes("/ingredient-requirements?")) return json(REQUIREMENTS)
    if (path.includes("/confirm-ingredient-requirements")) return json(confirmBody)
    return json([])
  })
})

async function openRequirements() {
  render(<DailyPlanningPage />)
  await screen.findByRole("cell", { name: "Beef stew" })
  fireEvent.click(await screen.findByRole("button", { name: "Review Ingredient Requirements" }))
  await screen.findByRole("cell", { name: "Beef" })
}

describe("ingredient requirements and locations", () => {
  it("labels the two stock columns with the names from the API", async () => {
    await openRequirements()
    expect(screen.getByRole("columnheader", { name: `${PRIMARY.name} stock` })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: `${PRODUCTION.name} stock` })).toBeInTheDocument()
    expect(screen.getByRole("cell", { name: "12.5" })).toBeInTheDocument()
    // 3 kg needed, 1 kg at production: low there.
    expect(screen.getByText(`${PRODUCTION.name} stock is low: the issue sheet requests it from ${PRIMARY.name}.`)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`sends an issue sheet\\s+from ${PRIMARY.name} to ${PRODUCTION.name} for approval`))).toBeInTheDocument()
  })

  it("says the issue sheet was sent for approval, with the request number when the server gives it", async () => {
    confirmBody = { shortfalls: [], stockRequestId: 501 }
    await openRequirements()
    fireEvent.click(screen.getByRole("button", { name: "Confirm Ingredient Requirements" }))
    expect(await screen.findByText(`Issue sheet sent for approval: from ${PRIMARY.name} to ${PRODUCTION.name} (request #501).`)).toBeInTheDocument()
  })

  it("leaves out the request number when there is none, and names shortfalls at the primary", async () => {
    confirmBody = { shortfalls: [{ ingredientId: 1, name: "Beef", unit: "KG", finalQuantity: 15, resultingStock: -2.5 }] }
    await openRequirements()
    fireEvent.click(screen.getByRole("button", { name: "Confirm Ingredient Requirements" }))
    expect(await screen.findByText(`Issue sheet sent for approval: from ${PRIMARY.name} to ${PRODUCTION.name}.`)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(new RegExp(`^Short at ${PRIMARY.name}: Beef, 2\\.5 KG short`))).toBeInTheDocument())
  })
})
