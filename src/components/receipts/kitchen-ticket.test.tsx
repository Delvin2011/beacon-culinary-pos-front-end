// O2b: the kitchen ticket lists only KITCHEN lines, with no prices, and is skipped when there are none.
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { KitchenTicket } from "@/components/receipts/kitchen-ticket"
import { hasKitchenLines, type ReceiptOrder } from "@/lib/receipt"

const mixed: ReceiptOrder = {
  orderNumber: 37,
  createdAt: "2026-11-18T10:31:07.123",
  tillCode: "T1",
  tillName: "Till 1 (front)",
  lines: [
    { id: 1, name: "Beef stew", quantity: 2, lineTotal: 100, station: "KITCHEN", extras: [{ id: 11, componentName: "Extra beef", quantity: 1, lineTotal: 15 }] },
    { id: 2, name: "Cappuccino", quantity: 1, lineTotal: 30, station: "BAR" },
    { id: 3, name: "Still water 500 ml", quantity: 1, lineTotal: 20, station: "NONE" },
  ],
}

describe("KitchenTicket", () => {
  it("lists only the KITCHEN lines with extras and quantities, no prices", () => {
    render(<KitchenTicket order={mixed} />)
    expect(screen.getByText("2 x Beef stew")).toBeInTheDocument()
    expect(screen.getByText("+ Extra beef")).toBeInTheDocument()
    expect(screen.queryByText(/Cappuccino/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Still water/)).not.toBeInTheDocument()
    expect(screen.getByTestId("kitchen-ticket").textContent).not.toMatch(/\d+\.\d{2}(?!\d)/)
  })

  it("has a very large order number, local time and the till code", () => {
    render(<KitchenTicket order={mixed} />)
    expect(screen.getByTestId("ticket-order-number")).toHaveTextContent("37")
    expect(screen.getByTestId("ticket-order-number").className).toContain("text-6xl")
    expect(screen.getByText("18/11/2026 12:31")).toBeInTheDocument()
    expect(screen.getByText("Till T1")).toBeInTheDocument()
  })

  it("prints no till on the unregistered till", () => {
    render(<KitchenTicket order={{ ...mixed, tillCode: null, tillName: null }} />)
    expect(screen.queryByText(/Till/)).not.toBeInTheDocument()
  })

  it("is skipped for an order of NONE lines only (and of BAR lines only)", () => {
    const drinks: ReceiptOrder = { ...mixed, lines: [mixed.lines![1], mixed.lines![2]] }
    expect(hasKitchenLines(drinks)).toBe(false)
    expect(hasKitchenLines(mixed)).toBe(true)
    const { container } = render(<KitchenTicket order={drinks} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("a local reprint says COPY", () => {
    render(<KitchenTicket order={mixed} copy />)
    expect(screen.getByText("** COPY **")).toBeInTheDocument()
  })
})
