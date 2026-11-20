// T0-5b: GET /menu/today?period= answers 400 MEAL_PERIOD_UNKNOWN when the name is stale (usually a rename). The till
// reloads GET /meal-periods once and loads the menu again under the new name, keeping the chosen period; a second
// refusal for the same name shows the error instead of looping.
import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { PosOrderBuilder } from "@/components/pos/order-builder"

vi.mock("@/hooks/use-shift", () => ({
  useShift: () => ({
    shift: { id: 7, owner: { id: 1, name: "Me" }, openedAt: "2026-11-16T06:00:00Z", openingFloat: 0, ownedByCaller: true },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

const fetchMock = vi.fn<typeof fetch>()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const unknown = (name: string) => json({ error: `Unknown meal period: ${name}`, code: "MEAL_PERIOD_UNKNOWN" }, 400)

const stew = { id: 412, mealPeriodId: 1, optionDate: "2026-11-16", name: "Beef Stew", price: 85, plannedPortions: 20, portionsRemaining: 12 }
const period = (name: string) => ({ id: 1, name, startTime: "00:00:00", endTime: "23:59:59", plannable: true })

let periodLists: unknown[][]
let menuFor: (name: string) => Response

const paths = () => fetchMock.mock.calls.map(([input]) => String(input).replace(/^https?:\/\/[^/]+/, ""))
const periodLoads = () => paths().filter((p) => p === "/meal-periods").length
const menuLoads = (name: string) => paths().filter((p) => p === `/menu/today?period=${encodeURIComponent(name)}`).length

function renderBuilder() {
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "me@x.co", name: "Me", role: "CASHIER" } }))
  render(
    <AuthProvider>
      <PosOrderBuilder
        managementSessionToken={null}
        managementSessionActive={false}
        managementRemainingMs={0}
        requestManagementSession={vi.fn()}
        invalidateManagementSession={vi.fn()}
      />
    </AuthProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "")
    if (path === "/meal-periods") return json(periodLists.length > 1 ? periodLists.shift() : periodLists[0])
    const menu = path.match(/^\/menu\/today\?period=(.+)$/)
    if (menu) return menuFor(decodeURIComponent(menu[1]))
    if (path.startsWith("/menu/today")) return json({ options: [], availableExtras: [] })
    if (path.startsWith("/orders/today") || path.startsWith("/accounts")) return json([])
    return json({})
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("menu for a renamed meal period", () => {
  it("reloads the periods once and loads the menu under the new name", async () => {
    periodLists = [[period("Midday")], [period("Noon")]]
    menuFor = (name) => (name === "Noon" ? json({ options: [stew], availableExtras: [] }) : unknown(name))
    renderBuilder()

    expect(await screen.findByText("Beef Stew")).toBeInTheDocument()
    expect(periodLoads()).toBe(2)
    expect(menuLoads("Midday")).toBe(1)
    expect(menuLoads("Noon")).toBe(1)
    expect(screen.queryByText(/Unknown meal period/)).not.toBeInTheDocument()
  })

  it("shows the error when the name is still refused after the reload, without a loop", async () => {
    periodLists = [[period("Midday")]]
    menuFor = (name) => unknown(name)
    renderBuilder()

    expect(await screen.findByText("Unknown meal period: Midday")).toBeInTheDocument()
    // Give any loop a chance to show itself.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(periodLoads()).toBe(2)
    expect(menuLoads("Midday")).toBe(2)
  })

  it("does not reload the periods on a refusal without the code", async () => {
    periodLists = [[period("Midday")]]
    menuFor = () => json({ error: "Something else went wrong." }, 400)
    renderBuilder()

    expect(await screen.findByText("Something else went wrong.")).toBeInTheDocument()
    await waitFor(() => expect(menuLoads("Midday")).toBe(1))
    expect(periodLoads()).toBe(1)
  })
})
