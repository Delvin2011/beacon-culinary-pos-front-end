// O2b: the customer receipt, from a sample OrderDto and the receipt settings (handoff 3 and 4).
import { render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { ReceiptView } from "@/components/receipts/receipt-view"
import { BRANDING_STORAGE_KEY } from "@/lib/customer-branding"
import { formatReceiptAmount, formatReceiptDateTime, formatVatRate, receiptCopy, vatLine, type ReceiptOrder } from "@/lib/receipt"
import type { ReceiptSettings } from "@/lib/receipt-settings"

const settings: ReceiptSettings = {
  receiptTitle: "Tax Invoice",
  businessName: "Canteen at Riverside Park",
  addressLines: ["12 Main Road", "Riverside", "Cape Town", "8001"],
  phone: "021 555 0100",
  vatNumber: "4123456789",
  footerText: "Thank you!\nKeep this slip for refunds.",
  showVatLine: true,
}

const emptySettings: ReceiptSettings = {
  receiptTitle: null,
  businessName: null,
  addressLines: [],
  phone: null,
  vatNumber: null,
  footerText: null,
  showVatLine: false,
}

// As GET /orders/{id} sends it: createdAt in UTC without a zone suffix.
const sale: ReceiptOrder = {
  id: 9001,
  orderNumber: 37,
  receiptNumber: "20261118-0037",
  createdAt: "2026-11-18T10:31:07.123",
  orderKind: "SALE",
  tillCode: "T1",
  tillName: "Till 1 (front)",
  cashierName: "Thandi Mokoena",
  total: 85,
  originalTotal: 85,
  preDiscountTotal: 85,
  saleDiscount: 0,
  vatRate: 0.15,
  vatIncludedAmount: 11.09,
  lines: [
    {
      id: 1,
      name: "Beef stew",
      quantity: 1,
      lineTotal: 50,
      station: "KITCHEN",
      extras: [{ id: 11, componentName: "Extra beef", quantity: 1, lineTotal: 15 }],
    },
    { id: 2, name: "Still water 500 ml", quantity: 1, lineTotal: 20, station: "NONE" },
  ],
  payments: [{ id: 1, method: "CASH", amount: 85, amountTendered: 100, changeDue: 15 }],
}

const receipt = () => screen.getByTestId("receipt")

describe("ReceiptView", () => {
  it("prints the header, both numbers (the order number large), till, cashier and local time", () => {
    render(<ReceiptView order={sale} settings={settings} />)

    for (const text of ["Tax Invoice", "Canteen at Riverside Park", "12 Main Road", "8001", "Tel 021 555 0100", "VAT No. 4123456789"]) {
      expect(within(receipt()).getByText(text)).toBeInTheDocument()
    }
    expect(screen.getByText("Receipt 20261118-0037")).toBeInTheDocument()
    expect(screen.getByTestId("order-number")).toHaveTextContent("37")
    expect(screen.getByTestId("order-number").className).toContain("text-4xl")
    // 10:31 UTC is 12:31 in Johannesburg.
    expect(screen.getByText("18/11/2026 12:31")).toBeInTheDocument()
    expect(screen.getByText("Till T1 · Till 1 (front)")).toBeInTheDocument()
    expect(screen.getByText("Cashier: Thandi Mokoena")).toBeInTheDocument()
    expect(screen.getByText(/Keep this slip for refunds/)).toHaveClass("whitespace-pre-line")
  })

  it("prints the VAT line, tendered and change", () => {
    render(<ReceiptView order={sale} settings={settings} />)
    expect(screen.getByTestId("vat-line")).toHaveTextContent("Incl. VAT 15%: R 11.09")
    expect(screen.getByText("Tendered").nextSibling).toHaveTextContent("100.00")
    expect(screen.getByText("Change").nextSibling).toHaveTextContent("15.00")
    expect(screen.getByText("TOTAL").nextSibling).toHaveTextContent("85.00")
  })

  it("prints the card reference and the account's name", () => {
    const order: ReceiptOrder = {
      ...sale,
      payments: [
        { id: 1, method: "CARD", amount: 50, cardReference: "AUTH 004512" },
        { id: 2, method: "ACCOUNT", amount: 35, accountId: 7 },
      ],
    }
    render(<ReceiptView order={order} settings={settings} accountNames={{ 7: "Finance Department" }} />)
    expect(screen.getByText("Card ref AUTH 004512")).toBeInTheDocument()
    expect(screen.getByText("Account: Finance Department")).toBeInTheDocument()
    expect(screen.queryByText("Tendered")).not.toBeInTheDocument()
  })

  it("prints no VAT line when showVatLine is false", () => {
    render(<ReceiptView order={sale} settings={{ ...settings, showVatLine: false }} />)
    expect(screen.queryByTestId("vat-line")).not.toBeInTheDocument()
  })

  it("prints no VAT line for an order from before O2b (vatIncludedAmount null)", () => {
    render(<ReceiptView order={{ ...sale, vatRate: null, vatIncludedAmount: null }} settings={settings} />)
    expect(screen.queryByTestId("vat-line")).not.toBeInTheDocument()
  })

  it("prints originalTotal after a refund, with adjusted extras still listed", () => {
    const refunded: ReceiptOrder = {
      ...sale,
      total: 70,
      originalTotal: 85,
      lines: [
        {
          ...sale.lines![0],
          extras: [{ id: 11, componentName: "Extra beef", quantity: 1, lineTotal: 15, adjusted: true }],
        },
        sale.lines![1],
      ],
    }
    render(<ReceiptView order={refunded} settings={settings} />)
    expect(screen.getByText("TOTAL").nextSibling).toHaveTextContent("85.00")
    expect(screen.getByText("+ Extra beef")).toBeInTheDocument()
    expect(screen.queryByText("70.00")).not.toBeInTheDocument()
  })

  it("prints the discount at sale, and nothing when it is 0", () => {
    const { unmount } = render(<ReceiptView order={{ ...sale, preDiscountTotal: 95, saleDiscount: 10 }} settings={settings} />)
    expect(screen.getByText("Subtotal").nextSibling).toHaveTextContent("95.00")
    expect(screen.getByText("Discount").nextSibling).toHaveTextContent("-10.00")
    unmount()
    render(<ReceiptView order={sale} settings={settings} />)
    expect(screen.queryByText("Discount")).not.toBeInTheDocument()
  })

  it("complimentary order: 0.00 and the reason", () => {
    const comp: ReceiptOrder = {
      ...sale,
      orderKind: "COMPLIMENTARY",
      total: 0,
      originalTotal: 0,
      preDiscountTotal: 85,
      vatIncludedAmount: 0,
      payments: [],
      complimentary: { reasonCode: "STAFF_MEAL", note: null, authorizedBy: { id: 2, name: "Canteen Admin" } },
    }
    render(<ReceiptView order={comp} settings={settings} />)
    expect(screen.getByText("Complimentary")).toBeInTheDocument()
    expect(screen.getByText("TOTAL").nextSibling).toHaveTextContent("0.00")
    expect(screen.getByText("Reason: Staff meal")).toBeInTheDocument()
    expect(screen.getByTestId("vat-line")).toHaveTextContent("Incl. VAT 15%: R 0.00")
  })

  it("unregistered till: no till line, the time still printed", () => {
    render(<ReceiptView order={{ ...sale, tillCode: null, tillName: null }} settings={settings} />)
    expect(screen.queryByText(/Till/)).not.toBeInTheDocument()
    expect(screen.getByText("18/11/2026 12:31")).toBeInTheDocument()
  })

  it("prints with empty settings (fresh install) and with no settings at all (the fetch failed)", () => {
    const { unmount } = render(<ReceiptView order={sale} settings={emptySettings} />)
    expect(screen.getByText("Receipt 20261118-0037")).toBeInTheDocument()
    expect(screen.queryByText("Tax Invoice")).not.toBeInTheDocument()
    expect(screen.queryByTestId("vat-line")).not.toBeInTheDocument()
    unmount()

    render(<ReceiptView order={sale} settings={null} />)
    expect(screen.getByTestId("order-number")).toHaveTextContent("37")
    expect(screen.getByText("TOTAL")).toBeInTheDocument()
  })

  it("an order built locally (O4) without orderNumber, receiptNumber or VAT still prints", () => {
    const local: ReceiptOrder = { lines: sale.lines, total: 85, payments: sale.payments }
    render(<ReceiptView order={local} settings={settings} />)
    expect(screen.queryByTestId("order-number")).not.toBeInTheDocument()
    expect(screen.queryByText(/^Receipt /)).not.toBeInTheDocument()
    expect(screen.queryByTestId("vat-line")).not.toBeInTheDocument()
    expect(screen.getByText("TOTAL").nextSibling).toHaveTextContent("85.00")
  })

  it("copy marks: COPY n on an admin reprint, COPY with no number on a local reprint, none on the original", () => {
    const reprint: ReceiptOrder = { ...sale, reprint: { copyNumber: 2, reprintedBy: { id: 2, name: "Canteen Admin" }, reprintedAt: "2026-11-18T12:00:00Z" } }
    const { unmount } = render(<ReceiptView order={reprint} settings={settings} copy={receiptCopy(reprint)} />)
    expect(screen.getAllByTestId("copy-mark").map((mark) => mark.textContent)).toEqual(["** COPY 2 **", "** COPY 2 **"])
    expect(screen.getByText("Reprinted by Canteen Admin at 18/11/2026 14:00")).toBeInTheDocument()
    unmount()

    const local = render(<ReceiptView order={sale} settings={settings} copy={receiptCopy(sale, true)} />)
    expect(screen.getAllByTestId("copy-mark").map((mark) => mark.textContent)).toEqual(["** COPY **", "** COPY **"])
    local.unmount()

    render(<ReceiptView order={sale} settings={settings} copy={receiptCopy(sale)} />)
    expect(screen.queryByTestId("copy-mark")).not.toBeInTheDocument()
  })

  it("layout at 72 mm with no margins (snapshot)", () => {
    const { container } = render(<ReceiptView order={sale} settings={settings} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain("w-[72mm]")
    expect(root.className).toContain("m-0")
    expect(root.className).toContain("p-0")
    expect(container.innerHTML).toMatchSnapshot()
  })

  // T1-8: the receipt names the business: the receipt settings' business name, otherwise the customer's name, which
  // is remembered on the device (offline the settings can't load).
  describe("the business name", () => {
    beforeEach(() => localStorage.clear())
    const header = () => receipt().querySelector("header") as HTMLElement

    it("the receipt settings' business name wins", () => {
      localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify({ name: "Riverside Canteen", logoUrl: null }))
      render(<ReceiptView order={sale} settings={settings} />)
      expect(within(header()).getByText("Canteen at Riverside Park")).toBeInTheDocument()
      expect(screen.queryByText("Riverside Canteen")).not.toBeInTheDocument()
    })

    it("no business name in the settings: the customer's name", () => {
      localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify({ name: "Riverside Canteen", logoUrl: null }))
      render(<ReceiptView order={sale} settings={emptySettings} />)
      expect(within(header()).getByText("Riverside Canteen")).toBeInTheDocument()
    })

    it("offline (no settings): the remembered name", () => {
      localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify({ name: "Riverside Canteen", logoUrl: null }))
      render(<ReceiptView order={{ ...sale, recordedOffline: true }} settings={null} />)
      expect(header()).toHaveTextContent("Riverside Canteen")
    })

    it("offline with nothing remembered on this address: the neutral name", () => {
      render(<ReceiptView order={{ ...sale, recordedOffline: true }} settings={null} />)
      expect(header()).toHaveTextContent(/^Canteen POS$/)
    })
  })
})

describe("receipt helpers", () => {
  it("VAT rate without trailing zeros, and the line only with both switches", () => {
    expect(formatVatRate(0.15)).toBe("15")
    expect(formatVatRate(0.155)).toBe("15.5")
    expect(vatLine({ vatRate: 0.155, vatIncludedAmount: 1234.5 }, true)).toBe("Incl. VAT 15.5%: R 1 234.50")
    expect(vatLine({ vatRate: 0.15, vatIncludedAmount: 11.09 }, false)).toBeNull()
  })

  it("amounts and times", () => {
    expect(formatReceiptAmount(-10)).toBe("-10.00")
    expect(formatReceiptAmount(0)).toBe("0.00")
    expect(formatReceiptDateTime("2026-11-18T22:15:00")).toBe("19/11/2026 00:15")
    expect(formatReceiptDateTime("2026-11-18T10:31:07Z")).toBe("18/11/2026 12:31")
    expect(formatReceiptDateTime(null)).toBeNull()
  })
})
