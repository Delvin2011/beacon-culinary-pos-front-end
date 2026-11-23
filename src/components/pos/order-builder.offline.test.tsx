// While the till is offline, Confirm waits for the connection and the cart is kept (selling offline is not O1).
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { ConnectionProvider } from "@/contexts/connection-context"
import { PosOrderBuilder } from "@/components/pos/order-builder"
import { reportConnectionSignal, type ConnectionSignal } from "@/lib/connection-signals"

vi.mock("@/hooks/use-shift", () => ({
  useShift: () => ({
    shift: { id: 7, owner: { id: 1, name: "Me" }, openedAt: "2026-11-16T06:00:00Z", openingFloat: 0, ownedByCaller: true },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

const fetchMock = vi.fn<typeof fetch>()
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

const toastie = {
  id: 501,
  mealPeriodId: 1,
  optionDate: "2026-11-16",
  name: "Cheese Toastie",
  price: 40,
  plannedPortions: null,
  portionsRemaining: null,
  group: "LIGHT_MEALS",
}

let clock = Date.parse("2026-11-16T10:00:00Z")

// Signals 2 s apart, so they aren't merged into one blip.
function signal(s: ConnectionSignal, times: number) {
  for (let i = 0; i < times; i += 1) {
    clock += 2_000
    act(() => reportConnectionSignal(s))
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(Date, "now").mockImplementation(() => clock)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const path = String(input).replace(/^(?:https?:\/\/[^/]+)?\/api(?=\/)/, "")
    if (path === "/health") return new Response(null, { status: 404 }) // no /health yet: requests decide
    if (path === "/meal-periods") return ok([{ id: 1, name: "Lunch", startTime: "00:00:00", endTime: "23:59:59", plannable: false }])
    if (path.startsWith("/menu/today")) return ok({ options: [toastie], availableExtras: [] })
    if (path.startsWith("/orders/today") || path.startsWith("/accounts")) return ok([])
    return ok({})
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("Confirm while offline", () => {
  it("waits for the connection and keeps the cart", async () => {
    localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "me@x.co", name: "Me", role: "CASHIER" } }))
    render(
      <AuthProvider>
        <ConnectionProvider>
          <PosOrderBuilder
            managementSessionToken={null}
            managementSessionActive={false}
            managementRemainingMs={0}
            requestManagementSession={vi.fn()}
            invalidateManagementSession={vi.fn()}
          />
        </ConnectionProvider>
      </AuthProvider>,
    )

    const item = await screen.findByText("Cheese Toastie")
    await act(async () => {
      fireEvent.click(item)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Charge" }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Card" }))
    })
    expect(screen.getByRole("button", { name: "Confirm Payment" })).toBeEnabled()

    signal({ ok: false, reason: "no-connection" }, 3)

    const waiting = screen.getByRole("button", { name: "Waiting for connection" })
    expect(waiting).toBeDisabled()
    expect(screen.getAllByText("Cheese Toastie").length).toBeGreaterThan(1) // menu tile and cart line
    const postsBefore = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").length
    fireEvent.click(waiting)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").length).toBe(postsBefore)

    signal({ ok: true }, 2)
    expect(screen.getByRole("button", { name: "Confirm Payment" })).toBeEnabled()
  })
})
