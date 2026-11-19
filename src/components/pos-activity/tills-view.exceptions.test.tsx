// O4: the Tills view shows each till's open REVIEW exceptions, linked to that till's list.
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { OfflineCell } from "@/components/pos-activity/tills-view"
import type { AdminTillOffline } from "@/lib/tills-admin"

const offline = (openExceptions: number | null | undefined): AdminTillOffline => ({
  state: "OK",
  pendingCount: 0,
  lastReportAt: "2026-11-18T13:05:00Z",
  clockSkewMs: 0,
  offlineSince: null,
  appVersion: "v1",
  openExceptions,
})

describe("OfflineCell: open exceptions", () => {
  it("links the count to that till's exceptions", () => {
    render(<OfflineCell offline={offline(3)} deviceId="dev 1" />)
    expect(screen.getByRole("link", { name: "3 to review" })).toHaveAttribute("href", "/sale-exceptions?deviceId=dev%201")
  })

  it("shows nothing for 0, or from a pre-O4 server", () => {
    const { rerender } = render(<OfflineCell offline={offline(0)} deviceId="dev-1" />)
    expect(screen.queryByText(/to review/)).not.toBeInTheDocument()
    rerender(<OfflineCell offline={offline(undefined)} deviceId="dev-1" />)
    expect(screen.queryByText(/to review/)).not.toBeInTheDocument()
  })
})
