// T0-5b: Daily planning takes period names from GET /meal-periods and sends them as given (plan, ingredient
// requirements, confirm), says MEAL_PERIOD_INACTIVE in plain words, reloads the periods once on "Unknown meal period",
// keeps the selected period across a reload, and names the All Day period from the API.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import DailyPlanningPage from "@/app/daily-planning/page"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/daily-planning" }))
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }))
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarTrigger: () => null,
}))
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }))

const authFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()
// One object, as the real auth context keeps it between renders.
const auth = { isAuthenticated: true, isLoading: false, user: { name: "Ayanda", role: "ADMIN" }, authFetch }
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth }))

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

// Renamed periods: nothing in the app may depend on the seeded names.
const PERIODS = [
  { id: 1, name: "Mornings & Tea", startTime: "07:00:00", endTime: "10:00:00", allDay: false, accepts: "SET_MEALS", plannable: true },
  { id: 2, name: "Midday", startTime: "12:00:00", endTime: "14:30:00", allDay: false, accepts: "SET_MEALS", plannable: true },
  { id: 3, name: "Anytime", startTime: null, endTime: null, allDay: true, accepts: "LIGHT_MEALS", plannable: false },
]
const plan = (periodId: number) => ({
  options: [
    { id: 40 + periodId, mealCatalogId: 7, mealPeriodId: periodId, optionDate: "2026-11-20", name: "Beef stew", price: 55, status: "PLANNED", plannedPortions: 30, actualPortions: null, sold: 0, portionsRemaining: 30 },
  ],
  componentStock: [],
})

let answer: (path: string, method: string) => Response | null
const paths = () => authFetch.mock.calls.map(([path]) => path)
const periodLoads = () => paths().filter((p) => p === "/meal-periods").length

beforeEach(() => {
  answer = () => null
  authFetch.mockReset()
  authFetch.mockImplementation(async (path, init) => {
    const method = init?.method ?? "GET"
    const custom = answer(path, method)
    if (custom) return custom
    if (path === "/meal-periods") return json(PERIODS)
    if (path === "/admin/component-catalog") return json([])
    if (path.startsWith("/admin/meal-catalog?group=")) return json([])
    if (path.startsWith("/admin/meal-catalog")) return json([{ id: 7, name: "Beef stew", price: 55, active: true }])
    const planMatch = path.match(/^\/admin\/daily-planning\/[\d-]+\?period=(.+)$/)
    if (planMatch) return json(plan(PERIODS.find((p) => p.name === decodeURIComponent(planMatch[1]))?.id ?? 0))
    if (path.includes("/ingredient-requirements?")) return json({ requirements: [{ ingredientId: 1, name: "Beef", unit: "kg", calculatedQuantity: 3 }], uncovered: [] })
    if (path.includes("/confirm-ingredient-requirements")) return json({ shortfalls: [] })
    return json([])
  })
})

const renderPage = async () => {
  render(<DailyPlanningPage />)
  await screen.findByRole("cell", { name: "Beef stew" })
}

describe("Daily planning and meal periods", () => {
  it("loads the plan with the period's name as the API gives it, encoded", async () => {
    await renderPage()
    expect(paths()).toContainEqual(expect.stringMatching(/^\/admin\/daily-planning\/\d{4}-\d{2}-\d{2}\?period=Mornings%20%26%20Tea$/))
    expect(paths().some((p) => /period=(MORNINGS|MIDDAY)/.test(p))).toBe(false)
  })

  it("names the always-open period from the API", async () => {
    await renderPage()
    expect(screen.getByText(/Light meals \(Anytime\) and beverages are always available/)).toBeInTheDocument()
  })

  it("sends the name as given for the ingredient requirements and the confirm", async () => {
    await renderPage()
    fireEvent.click(screen.getByRole("button", { name: /Midday 12:00/ }))
    await waitFor(() => expect(paths().some((p) => p.endsWith("?period=Midday"))).toBe(true))
    fireEvent.click(await screen.findByRole("button", { name: "Review Ingredient Requirements" }))
    await waitFor(() => expect(paths().some((p) => p.endsWith("/ingredient-requirements?period=Midday"))).toBe(true))
    fireEvent.click(await screen.findByRole("button", { name: "Confirm Ingredient Requirements" }))
    await waitFor(() => expect(paths().some((p) => p.includes("/confirm-ingredient-requirements"))).toBe(true))
    const confirm = authFetch.mock.calls.find(([p]) => p.includes("/confirm-ingredient-requirements"))!
    expect(JSON.parse(String(confirm[1]?.body)).period).toBe("Midday")
  })

  it("says MEAL_PERIOD_INACTIVE in plain words on an edit, reloads the periods and keeps the selected one", async () => {
    answer = (path, method) =>
      method === "PUT" && path.startsWith("/admin/daily-options/")
        ? json({ error: "Meal period Midday is inactive.", code: "MEAL_PERIOD_INACTIVE" }, 400)
        : null
    await renderPage()
    fireEvent.click(screen.getByRole("button", { name: /Midday 12:00/ }))
    await waitFor(() => expect(paths().some((p) => p.endsWith("?period=Midday"))).toBe(true))
    await screen.findByRole("cell", { name: "Beef stew" })
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0])
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Planned portions"), { target: { value: "25" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }))
    expect(await within(dialog).findByText("Midday has been deactivated, so nothing can be planned under it. Choose another period.")).toBeInTheDocument()
    await waitFor(() => expect(periodLoads()).toBe(2))
    // Still on Midday after the reload, not back on the first period.
    // (The dialog is still open, so the page behind it is aria-hidden.)
    await waitFor(() => expect(screen.getByRole("button", { name: /Midday 12:00/, hidden: true })).toHaveClass("bg-foreground"))
    expect(screen.getByRole("button", { name: /Mornings & Tea 07:00/, hidden: true })).not.toHaveClass("bg-foreground")
  })

  it("on 'Unknown meal period' (400, no code) shows the message and reloads the periods once, without a loop", async () => {
    let failed = false
    answer = (path) => {
      if (!failed && path.includes("?period=Mornings")) {
        failed = true
        return json({ error: "Unknown meal period: Mornings & Tea" }, 400)
      }
      return null
    }
    render(<DailyPlanningPage />)
    expect(await screen.findByText("Unknown meal period: Mornings & Tea")).toBeInTheDocument()
    await waitFor(() => expect(periodLoads()).toBe(2))
    // Give any loop a chance to show itself.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(periodLoads()).toBe(2)
  })
})
