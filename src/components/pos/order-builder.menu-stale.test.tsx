// A failed menu refresh keeps the menu on screen and marks it stale; it never empties the till.
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { PosOrderBuilder } from "@/components/pos/order-builder"
import { CONNECTION_MESSAGES } from "@/lib/net"

vi.mock("@/hooks/use-shift", () => ({
  useShift: () => ({
    shift: { id: 7, owner: { id: 1, name: "Me" }, openedAt: "2026-11-16T06:00:00Z", openingFloat: 0, ownedByCaller: true },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

const fetchMock = vi.fn<typeof fetch>()
const failing = new Set<string>()

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

const periods = [
  { id: 1, name: "Lunch", startTime: "00:00:00", endTime: "23:59:59", plannable: true },
  { id: 2, name: "Dinner", startTime: "23:59:59", endTime: "23:59:59", plannable: true },
]

const burger = {
  id: 412,
  mealPeriodId: 1,
  optionDate: "2026-11-16",
  name: "Beef Burger",
  price: 85,
  plannedPortions: 20,
  portionsRemaining: 12,
  period: { id: 1, name: "Lunch" },
}

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
  failing.clear()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    const path = url.replace(/^https?:\/\/[^/]+/, "")
    if (failing.has(path)) throw new TypeError("Failed to fetch")
    if (path === "/meal-periods") return ok(periods)
    if (path === "/menu/today?period=LUNCH") return ok({ options: [burger], availableExtras: [] })
    if (path.startsWith("/menu/today")) return ok({ options: [], availableExtras: [] })
    if (path.startsWith("/orders/today") || path.startsWith("/accounts")) return ok([])
    return ok({})
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("menu refresh failures", () => {
  it("keeps the last menu and shows when it was last updated", async () => {
    renderBuilder()
    expect(await screen.findByText("Beef Burger")).toBeInTheDocument()

    failing.add("/menu/today?period=LUNCH")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Refresh$/ }))
    })

    expect(await screen.findByText(/Last updated \d\d:\d\d/)).toBeInTheDocument()
    expect(screen.getByText("Beef Burger")).toBeInTheDocument()
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument()

    // The next good refresh clears the stale marker.
    failing.clear()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Refresh$/ }))
    })
    await vi.waitFor(() => expect(screen.queryByText(/Last updated/)).not.toBeInTheDocument())
    expect(screen.getByText("Beef Burger")).toBeInTheDocument()
  })

  it("doesn't show another period's items when a new period fails to load", async () => {
    renderBuilder()
    expect(await screen.findByText("Beef Burger")).toBeInTheDocument()

    failing.add("/menu/today?period=DINNER")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dinner" }))
    })

    expect(await screen.findByText(CONNECTION_MESSAGES.network)).toBeInTheDocument()
    expect(screen.queryByText("Beef Burger")).not.toBeInTheDocument()
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument()
  })
})
