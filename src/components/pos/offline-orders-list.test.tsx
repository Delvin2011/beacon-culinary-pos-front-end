// O4 task 8: Today's Orders offline lists this till's offline sales of the day with their sync state.
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { OfflineOrdersList } from "@/components/pos/offline-orders-list"
import type { OutboxEntry } from "@/lib/offline/outbox"

const entry = (seq: number, status: OutboxEntry["status"], soldAt: string, tradingDay = "2026-11-18") =>
  ({
    clientOrderId: `sale-${seq}`,
    status,
    tradingDay,
    soldAt,
    payload: {
      collectionNumber: `T1-${seq}`,
      offlineReceiptNumber: `T1-20261118-000${seq}`,
      total: 50,
      lines: [{ name: "Beef stew", quantity: 1 }],
    },
  }) as unknown as OutboxEntry

describe("OfflineOrdersList", () => {
  it("lists today's offline sales, newest first, marked by their sync state", () => {
    render(
      <OfflineOrdersList
        tradingDay="2026-11-18"
        entries={[
          entry(1, "SYNCED", "2026-11-18T08:00:00.000Z"),
          entry(2, "PENDING", "2026-11-18T09:00:00.000Z"),
          entry(3, "INVALID", "2026-11-18T10:00:00.000Z"),
          entry(9, "PENDING", "2026-11-17T09:00:00.000Z", "2026-11-17"),
        ]}
      />,
    )
    const rows = screen.getAllByTestId("offline-order")
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("T1-3Needs support"),
      expect.stringContaining("T1-2Offline, not yet sent"),
      expect.stringContaining("T1-1Sent"),
    ])
    expect(rows[1]).toHaveTextContent("18/11/2026 11:00 · R 50.00 · T1-20261118-0002")
    expect(rows[1]).toHaveTextContent("1 × Beef stew")
    expect(screen.queryByText("T1-9")).not.toBeInTheDocument()
  })

  it("says when there are none", () => {
    render(<OfflineOrdersList tradingDay="2026-11-18" entries={[]} />)
    expect(screen.getByText("No offline sales today.")).toBeInTheDocument()
  })
})
