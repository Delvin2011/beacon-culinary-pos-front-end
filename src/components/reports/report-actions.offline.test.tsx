// O3 (offline contract 10.3): Close Day blocked by a till's unsynced offline sales shows the server's message with a
// link to the Tills view. The override is O4's.
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { BlockerList } from "@/components/reports/report-actions"

describe("Close Day blocker OFFLINE_SALES_PENDING", () => {
  it("shows the message and links to the Tills view", () => {
    render(
      <BlockerList
        blockers={[
          {
            code: "OFFLINE_SALES_PENDING",
            message: "T1 (Till 1 (front)) has 3 unsynced sales for this day (last report 09:15).",
            date: "2026-11-18",
            tillCode: "T1",
          },
        ]}
      />,
    )
    expect(screen.getByText(/T1 \(Till 1 \(front\)\) has 3 unsynced sales for this day/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/pos-activity")
  })
})
