// O4: an offline sale prints from its outbox entry: the till's numbers, soldAt, "Offline sale", the local VAT.
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { KitchenTicket } from "@/components/receipts/kitchen-ticket"
import { ReceiptView } from "@/components/receipts/receipt-view"
import { claimAutoPrint, clearAutoPrinted } from "@/lib/auto-print-guard"
import { buildOfflineSale, type OfflinePaymentDraft } from "@/lib/offline/offline-sale"
import { offlineReceiptOrder } from "@/lib/offline/offline-receipt"
import type { NewOutboxEntry } from "@/lib/offline/outbox"
import type { ReceiptSettings } from "@/lib/receipt-settings"

const settings = (showVatLine: boolean): ReceiptSettings => ({
  receiptTitle: null,
  businessName: "Canteen",
  addressLines: [],
  phone: null,
  vatNumber: null,
  footerText: null,
  showVatLine,
})

function entry(payments: OfflinePaymentDraft[], wasPendingOnline = false): NewOutboxEntry {
  const result = buildOfflineSale({
    clientOrderId: "3b8f1c2e-4a5d-4e6f-9a0b-1c2d3e4f5a6b",
    grant: { grantId: "g1", shiftId: 412, cashierId: 17 },
    tillCode: "T1",
    tradingDay: "2026-11-18",
    offlineSeq: 7,
    soldAt: "2026-11-18T10:42:15.000Z",
    unlockedOffline: false,
    snapshotVersion: "v1",
    vatRate: 0.15,
    lines: [
      {
        dailyMealOptionId: 801,
        name: "Beef stew",
        station: "KITCHEN",
        unitPriceCents: 5000,
        quantity: 1,
        extras: [{ dailyComponentStockId: 3102, name: "Extra beef", priceDeltaCents: 1500, quantity: 1 }],
      },
      { dailyMealOptionId: 912, name: "Still water 500 ml", station: "NONE", unitPriceCents: 2000, quantity: 2, extras: [] },
    ],
    payments,
    rules: { accountsEnabled: true },
  })
  if (!result.ok) throw new Error(result.message)
  return {
    clientOrderId: result.sale.clientOrderId,
    payload: result.sale,
    grant: "signed.g1",
    grantId: "g1",
    shiftId: 412,
    tradingDay: "2026-11-18",
    soldAt: result.sale.soldAt,
    recordedAt: result.sale.soldAt,
    wasPendingOnline,
    print: { tillCode: "T1", tillName: "Till 1 (front)", cashierName: "Thandi Mokoena", accountNames: { 55: "Finance Dept" } },
  }
}

const cash = entry([{ method: "CASH", amountCents: 10500, tenderedCents: 20000 }])

afterEach(() => clearAutoPrinted())

describe("the receipt of an offline sale", () => {
  it("prints the collection number large, the offline receipt number, soldAt and 'Offline sale'; no order number", () => {
    render(<ReceiptView order={offlineReceiptOrder(cash)} settings={settings(false)} />)
    expect(screen.getByTestId("collection-number")).toHaveTextContent("T1-7")
    expect(screen.queryByTestId("order-number")).not.toBeInTheDocument()
    expect(screen.getByText("Receipt T1-20261118-0007")).toBeInTheDocument()
    expect(screen.getByText("Offline sale")).toBeInTheDocument()
    expect(screen.getByText("18/11/2026 12:42")).toBeInTheDocument() // soldAt in Johannesburg time
    expect(screen.getByText("Cashier: Thandi Mokoena")).toBeInTheDocument()
  })

  it("lists lines and extras with their own totals, and the cash change", () => {
    render(<ReceiptView order={offlineReceiptOrder(cash)} settings={settings(false)} />)
    expect(screen.getByText("1 x Beef stew").nextSibling).toHaveTextContent("50.00")
    expect(screen.getByText("+ Extra beef").nextSibling).toHaveTextContent("15.00")
    expect(screen.getByText("2 x Still water 500 ml").nextSibling).toHaveTextContent("40.00")
    expect(screen.getByText("TOTAL").nextSibling).toHaveTextContent("105.00")
    expect(screen.getByText("Tendered").nextSibling).toHaveTextContent("200.00")
    expect(screen.getByText("Change").nextSibling).toHaveTextContent("95.00")
  })

  it("prints the local VAT only when showVatLine is on", () => {
    const { rerender } = render(<ReceiptView order={offlineReceiptOrder(cash)} settings={settings(false)} />)
    expect(screen.queryByTestId("vat-line")).not.toBeInTheDocument()
    rerender(<ReceiptView order={offlineReceiptOrder(cash)} settings={settings(true)} />)
    expect(screen.getByTestId("vat-line")).toHaveTextContent("Incl. VAT 15%: R 13.70")
  })

  it("prints the card slip reference and the account's name", () => {
    render(<ReceiptView order={offlineReceiptOrder(entry([{ method: "CARD", amountCents: 10500, cardReference: "004512" }]))} settings={null} />)
    expect(screen.getByText("Card ref 004512")).toBeInTheDocument()
  })

  it("an online order still prints its order number and createdAt", () => {
    render(<ReceiptView order={{ orderNumber: 37, createdAt: "2026-11-18T10:31:07.123", lines: [], total: 0 }} settings={null} />)
    expect(screen.getByTestId("order-number")).toHaveTextContent("37")
    expect(screen.queryByText("Offline sale")).not.toBeInTheDocument()
    expect(screen.getByText("18/11/2026 12:31")).toBeInTheDocument()
  })

  it("an online sale that took a slip's numbers (DUPLICATE) prints its collection number large", () => {
    render(<ReceiptView order={{ orderNumber: 51, collectionNumber: "T1-5", receiptNumber: "T1-20261118-0005", recordedOffline: false, lines: [] }} settings={null} />)
    expect(screen.getByTestId("collection-number")).toHaveTextContent("T1-5")
    expect(screen.queryByText("51")).not.toBeInTheDocument()
    expect(screen.queryByText("Offline sale")).not.toBeInTheDocument()
  })
})

describe("the kitchen ticket of an offline sale", () => {
  it("has the collection number large, 'Offline sale', and only the kitchen lines", () => {
    render(<KitchenTicket order={offlineReceiptOrder(cash)} />)
    expect(screen.getByTestId("ticket-order-number")).toHaveTextContent("T1-7")
    expect(screen.getByText("Offline sale")).toBeInTheDocument()
    expect(screen.getByText("1 x Beef stew")).toBeInTheDocument()
    expect(screen.queryByText(/Still water/)).not.toBeInTheDocument()
    expect(screen.queryByTestId("was-pending-online")).not.toBeInTheDocument()
  })

  it("marks a sale that was pending online", () => {
    render(<KitchenTicket order={offlineReceiptOrder(entry([{ method: "CASH", amountCents: 10500, tenderedCents: 10500 }], true))} />)
    expect(screen.getByTestId("was-pending-online")).toHaveTextContent("Was pending online: check the kitchen screen before preparing")
  })
})

describe("auto-print of an offline sale", () => {
  it("is claimed once per clientOrderId", () => {
    expect(claimAutoPrint("cashier:17", cash.clientOrderId)).toBe(true)
    expect(claimAutoPrint("cashier:17", cash.clientOrderId)).toBe(false)
    expect(claimAutoPrint("cashier:17", 9301)).toBe(true)
  })
})
