// O2b: an admin reprint after a refund shows originalTotal, the original cashier and till, the copy number, the
// current header and the account's name.
import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { resetReceiptSettingsCache } from "@/hooks/use-receipt-settings"
import { ReceiptReprintDialog, type ReceiptPayload } from "@/components/reports/receipt-reprint"

const fetchMock = vi.fn<typeof fetch>()

const reprinted: ReceiptPayload = {
  id: 9001,
  orderNumber: 37,
  receiptNumber: "20261118-0037",
  createdAt: "2026-11-18T10:31:07.123",
  orderKind: "SALE",
  tillCode: "T1",
  tillName: "Till 1 (front)",
  cashierName: "Thandi Mokoena",
  total: 35,
  originalTotal: 85,
  vatRate: 0.15,
  vatIncludedAmount: 11.09,
  lines: [
    { id: 1, name: "Beef stew", quantity: 1, lineTotal: 50, station: "KITCHEN", extras: [{ id: 11, componentName: "Extra beef", quantity: 1, lineTotal: 15, adjusted: true }] },
    { id: 2, name: "Still water 500 ml", quantity: 1, lineTotal: 20, station: "NONE" },
  ],
  payments: [{ id: 1, method: "ACCOUNT", amount: 85, accountId: 7 }],
  reprint: { copyNumber: 2, reprintedBy: { id: 2, name: "Canteen Admin" }, reprintedAt: "2026-11-18T12:00:00Z" },
}

beforeEach(() => {
  localStorage.clear()
  resetReceiptSettingsCache()
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "boss@x.co", role: "ADMIN" } }))
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url.endsWith("/pos/receipt-settings")) {
      return new Response(
        JSON.stringify({ receiptTitle: "Tax Invoice", businessName: "Canteen at Riverside Park", addressLines: [], phone: null, vatNumber: null, footerText: null, showVatLine: true }),
        { status: 200 },
      )
    }
    if (url.endsWith("/accounts")) return new Response(JSON.stringify([{ id: 7, name: "Finance Department" }]), { status: 200 })
    return new Response("{}", { status: 404 })
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

it("shows the reprint with originalTotal, the original cashier and till, COPY 2, the header and the account", async () => {
  render(
    <AuthProvider>
      <ReceiptReprintDialog receipt={reprinted} onClose={() => {}} />
    </AuthProvider>,
  )

  await waitFor(() => expect(screen.getByText("Canteen at Riverside Park")).toBeInTheDocument())
  await waitFor(() => expect(screen.getByText("Account: Finance Department")).toBeInTheDocument())
  expect(screen.getByText("TOTAL").nextSibling).toHaveTextContent("85.00")
  expect(screen.getByText("Cashier: Thandi Mokoena")).toBeInTheDocument()
  expect(screen.getByText("Till T1 · Till 1 (front)")).toBeInTheDocument()
  expect(screen.getByText("+ Extra beef")).toBeInTheDocument()
  expect(screen.getAllByTestId("copy-mark")[0]).toHaveTextContent("COPY 2")
  expect(screen.getByTestId("vat-line")).toHaveTextContent("Incl. VAT 15%: R 11.09")
})
