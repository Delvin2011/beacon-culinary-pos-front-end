// O2b: after a sale the till prints the receipt, then the kitchen ticket; each switch turns its print off; an order is
// auto-printed once; "print again" copies say COPY and are gone once the next sale starts.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { ConnectionProvider } from "@/contexts/connection-context"
import { PosOrderBuilder } from "@/components/pos/order-builder"
import { resetReceiptSettingsCache } from "@/hooks/use-receipt-settings"
import { AUTO_PRINTED_KEY, clearAutoPrinted } from "@/lib/auto-print-guard"
import { resetPrintSettingsSnapshot, savePrintSettings } from "@/lib/print-settings"

vi.mock("@/hooks/use-shift", () => ({
  useShift: () => ({
    shift: { id: 7, owner: { id: 1, name: "Me" }, openedAt: "2026-11-16T06:00:00Z", openingFloat: 0, ownedByCaller: true },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

const fetchMock = vi.fn<typeof fetch>()
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

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

// A full OrderDto with O2b's receipt data: one KITCHEN line and one NONE line.
const order = {
  id: 55,
  orderNumber: 37,
  receiptNumber: "20261118-0037",
  createdAt: "2026-11-18T10:31:07.123",
  status: "PENDING",
  orderKind: "SALE",
  tillCode: "T1",
  tillName: "Till 1 (front)",
  cashierName: "Me",
  subtotal: 60,
  total: 60,
  originalTotal: 60,
  vatRate: 0.15,
  vatIncludedAmount: 7.83,
  lines: [
    { id: 1, dailyMealOptionId: 501, station: "KITCHEN", name: "Cheese Toastie", unitPrice: 40, quantity: 1, lineTotal: 40, extras: [] },
    { id: 2, dailyMealOptionId: 502, station: "NONE", name: "Still water 500 ml", unitPrice: 20, quantity: 1, lineTotal: 20, extras: [] },
  ],
  payments: [{ id: 901, method: "CARD", amount: 60, cardReference: "AUTH 004512" }],
  stations: [{ station: "KITCHEN", status: "PENDING" }],
}

let settingsResponse: () => Response
let printed: string[] = []

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  clearAutoPrinted()
  resetReceiptSettingsCache()
  resetPrintSettingsSnapshot()
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "me@x.co", name: "Me", role: "CASHIER" } }))
  printed = []
  settingsResponse = () =>
    ok({ receiptTitle: "Tax Invoice", businessName: "Canteen at Riverside Park", addressLines: [], phone: null, vatNumber: null, footerText: null, showVatLine: true })
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "")
    if (path === "/orders" && init?.method === "POST") return ok(order, 201)
    if (path === "/health") return new Response(null, { status: 404 })
    if (path === "/pos/receipt-settings") return settingsResponse()
    if (path === "/meal-periods") return ok([{ id: 1, name: "Lunch", startTime: "00:00:00", endTime: "23:59:59", plannable: false }])
    if (path.startsWith("/menu/today")) return ok({ options: [toastie], availableExtras: [] })
    if (path === "/orders/55") return ok(order)
    if (path.startsWith("/orders/today") || path.startsWith("/accounts")) return ok([])
    return ok({})
  })
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number)
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id))
  // A normal browser: print() blocks, then `afterprint` fires.
  vi.spyOn(window, "print").mockImplementation(() => {
    printed.push(document.querySelector(".print-portal")?.textContent ?? "")
    window.dispatchEvent(new Event("afterprint"))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderTill() {
  return render(
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
}

async function sell() {
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
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Confirm Payment" }))
  })
  await screen.findByText("#37", {}, { timeout: 4_000 })
}

const isReceipt = (text: string) => text.includes("Receipt 20261118-0037")
const isTicket = (text: string) => text.startsWith("Kitchen") || text.includes("Kitchen37")

describe("automatic printing after a sale", () => {
  it("prints the receipt (with the header), then the kitchen ticket", async () => {
    renderTill()
    await sell()

    await waitFor(() => expect(printed).toHaveLength(2))
    expect(isReceipt(printed[0])).toBe(true)
    expect(printed[0]).toContain("Canteen at Riverside Park")
    expect(printed[0]).toContain("Card ref AUTH 004512")
    expect(printed[0]).toContain("Incl. VAT 15%: R 7.83")
    expect(isTicket(printed[1])).toBe(true)
    expect(printed[1]).toContain("1 x Cheese Toastie")
    expect(printed[1]).not.toContain("Still water")
  })

  it("still prints, without the header, when the receipt settings can't be read", async () => {
    settingsResponse = () => new Response(null, { status: 500 })
    renderTill()
    await sell()

    await waitFor(() => expect(printed).toHaveLength(2))
    expect(isReceipt(printed[0])).toBe(true)
    expect(printed[0]).not.toContain("Canteen at Riverside Park")
    expect(printed[0]).not.toContain("Incl. VAT")
  })

  it("prints only the kitchen ticket when the receipt switch is off", async () => {
    savePrintSettings({ autoPrintReceipt: false, autoPrintKitchenTicket: true })
    renderTill()
    await sell()

    await waitFor(() => expect(printed).toHaveLength(1))
    expect(isTicket(printed[0])).toBe(true)
  })

  it("prints only the receipt when the kitchen-ticket switch is off", async () => {
    savePrintSettings({ autoPrintReceipt: true, autoPrintKitchenTicket: false })
    renderTill()
    await sell()

    await waitFor(() => expect(printed).toHaveLength(1))
    expect(isReceipt(printed[0])).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(printed).toHaveLength(1)
  })

  it("prints an order id once: an order already auto-printed this session isn't printed again", async () => {
    sessionStorage.setItem(AUTO_PRINTED_KEY, JSON.stringify({ owner: "email:me@x.co", ids: [55] }))
    renderTill()
    await sell()

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(printed).toHaveLength(0)
    expect(screen.getByRole("button", { name: /Print receipt again/ })).toBeInTheDocument()
  })
})

describe("print again from the completion screen", () => {
  it("prints local copies marked COPY with no number, and the buttons go once the next sale starts", async () => {
    savePrintSettings({ autoPrintReceipt: false, autoPrintKitchenTicket: false })
    renderTill()
    await sell()
    expect(printed).toHaveLength(0)

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Print receipt again/ }))
    })
    await waitFor(() => expect(printed).toHaveLength(1))
    expect(isReceipt(printed[0])).toBe(true)
    expect(printed[0]).toContain("** COPY **")
    expect(printed[0]).not.toMatch(/COPY \d/)

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Print kitchen ticket again/ }))
    })
    await waitFor(() => expect(printed).toHaveLength(2))
    expect(printed[1]).toContain("** COPY **")
    expect(printed[1]).toContain("1 x Cheese Toastie")
    // Only the order on screen was used: GET /orders/55 once, after the sale.
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/orders/55"))).toHaveLength(1)

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next Customer" }))
    })
    expect(screen.queryByRole("button", { name: /Print receipt again/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Print kitchen ticket again/ })).not.toBeInTheDocument()
  })
})
