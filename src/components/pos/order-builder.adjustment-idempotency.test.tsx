// Voids and refunds send a clientRequestId; a resend after a lost answer reuses it, so it is never applied twice.
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { ConnectionProvider } from "@/contexts/connection-context"
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
const ok = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } })

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
const order = {
  id: 55,
  orderNumber: 1042,
  status: "PENDING",
  total: 40,
  lines: [],
  payments: [{ id: 901, method: "CARD", amount: 40 }],
  stations: [],
}
const voided = {
  ...order,
  status: "VOIDED",
  total: 0,
  adjustments: [{ id: 1, action: "VOID", scope: "WHOLE_ORDER", amount: 40, refundMethod: "CASH" }],
}

// What POST /orders/55/adjustments answers, one entry per call; the last one repeats.
let adjustmentAnswers: Array<() => Response> = []
const adjustmentBodies = () =>
  fetchMock.mock.calls
    .filter(([input, init]) => String(input).endsWith("/orders/55/adjustments") && init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  localStorage.clear()
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "me@x.co", name: "Me", role: "CASHIER" } }))
  adjustmentAnswers = []
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "")
    if (path === "/orders" && init?.method === "POST") return ok(order, 201)
    if (path === "/orders/55/adjustments") {
      const answer = adjustmentAnswers.length > 1 ? adjustmentAnswers.shift()! : adjustmentAnswers[0]
      return answer()
    }
    if (path === "/health") return new Response(null, { status: 404 })
    if (path === "/meal-periods") return ok([{ id: 1, name: "Lunch", startTime: "00:00:00", endTime: "23:59:59", plannable: false }])
    if (path.startsWith("/menu/today")) return ok({ options: [toastie], availableExtras: [] })
    if (path === "/orders/55") return ok(order)
    if (path.startsWith("/orders/today") || path.startsWith("/accounts")) return ok([])
    return ok({})
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }))
  })
}

// Rings up and completes a card sale, then opens the Void form.
async function sellThenOpenVoid() {
  render(
    <AuthProvider>
      <ConnectionProvider>
        <PosOrderBuilder
          managementSessionToken={null}
          managementSessionActive={false}
          managementRemainingMs={0}
          requestManagementSession={(onReady) => void onReady("mgr-1")}
          invalidateManagementSession={vi.fn()}
        />
      </ConnectionProvider>
    </AuthProvider>,
  )
  const item = await screen.findByText("Cheese Toastie")
  await act(async () => {
    fireEvent.click(item)
  })
  await click("Charge")
  await click("Card")
  await click("Confirm Payment")
  await screen.findByText("#1042")
  await click("Void Order")
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe("void with a clientRequestId", () => {
  it("resends the identical body after a network error", async () => {
    adjustmentAnswers = [
      () => {
        throw new TypeError("Failed to fetch")
      },
      () => ok(voided, 201),
    ]
    await sellThenOpenVoid()
    await click("Unlock & Apply")
    await advance(1_000)

    const [first, second] = adjustmentBodies()
    expect(first.clientRequestId).toEqual(expect.any(String))
    expect(second).toEqual(first)
    expect(await screen.findByText(/returned to today's stock/)).toBeInTheDocument()
  })

  it("keeps the id when the retries run out, so pressing again replays it", async () => {
    adjustmentAnswers = [
      () => ok({}, 503),
      () => ok({}, 503),
      () => ok({}, 503),
      () => ok({}, 503),
      () => ok(voided, 200, { "Idempotent-Replay": "true" }),
    ]
    await sellThenOpenVoid()
    await click("Unlock & Apply")
    await advance(1_000 + 2_000 + 4_000)

    expect(await screen.findByText(/Couldn't confirm the void or refund/)).toBeInTheDocument()
    expect(adjustmentBodies()).toHaveLength(4)

    await click("Unlock & Apply")
    const bodies = adjustmentBodies()
    expect(bodies).toHaveLength(5)
    expect(new Set(bodies.map((b) => b.clientRequestId)).size).toBe(1)
    expect(await screen.findByText(/returned to today's stock/)).toBeInTheDocument()
  })

  it("never retries 409 IDEMPOTENCY_CONFLICT, and the next press gets a new id", async () => {
    adjustmentAnswers = [() => ok({ code: "IDEMPOTENCY_CONFLICT", error: "Reused id." }, 409), () => ok(voided, 201)]
    await sellThenOpenVoid()
    await click("Unlock & Apply")
    await advance(10_000)

    expect(await screen.findByText(/matched to a different request/)).toBeInTheDocument()
    expect(adjustmentBodies()).toHaveLength(1)

    await click("Unlock & Apply")
    const [first, second] = adjustmentBodies()
    expect(second.clientRequestId).not.toBe(first.clientRequestId)
  })
})
