// O4 contract 7: order views mark offline sales: "Offline sale", the collection number, soldAt, and a late booking.
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { OfflineOrderMarks, formatTradingDay, offlineOrderMarkTexts } from "@/components/orders/offline-order-marks"

describe("offline order marks", () => {
  it("marks an offline sale with its collection number, local sale time and the day it was booked to", () => {
    expect(
      offlineOrderMarkTexts({ recordedOffline: true, collectionNumber: "T1-7", soldAt: "2026-11-18T10:42:15Z", bookedTradingDay: "2026-11-19" }),
    ).toEqual(["Offline sale", "Collection T1-7", "Sold 18/11/2026 12:42", "Booked to 19/11/2026"])
  })

  it("an online sale that took a slip's numbers shows its collection number only", () => {
    expect(offlineOrderMarkTexts({ recordedOffline: false, collectionNumber: "T1-5", soldAt: null })).toEqual(["Collection T1-5"])
  })

  it("shows nothing for an ordinary online order", () => {
    const { container } = render(<OfflineOrderMarks order={{ recordedOffline: false, soldAt: null, collectionNumber: null }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders the marks", () => {
    render(<OfflineOrderMarks order={{ recordedOffline: true, collectionNumber: "T1-7", soldAt: "2026-11-18T10:42:15Z" }} />)
    expect(screen.getByText("Offline sale")).toBeInTheDocument()
    expect(screen.getByText("Collection T1-7")).toBeInTheDocument()
  })

  it("formats a trading day", () => {
    expect(formatTradingDay("2026-11-19")).toBe("19/11/2026")
  })
})
