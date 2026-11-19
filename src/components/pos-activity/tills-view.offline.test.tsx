// O3 (offline contract 10.2): the Tills view's Offline column, per state, with the clock warning past 2 minutes.
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { OfflineCell } from "@/components/pos-activity/tills-view"
import type { AdminTillOffline } from "@/lib/tills-admin"

const report = (change: Partial<AdminTillOffline>): AdminTillOffline => ({
  state: "OK",
  pendingCount: 0,
  // 09:15 in Johannesburg.
  lastReportAt: "2026-11-18T07:15:00Z",
  clockSkewMs: 1520,
  offlineSince: null,
  appVersion: "0.1.0-abc",
  ...change,
})

describe("Offline column", () => {
  it("OK with the last report time", () => {
    render(<OfflineCell offline={report({})} />)
    expect(screen.getByText("OK · 09:15")).toBeInTheDocument()
    expect(screen.queryByText(/Clock/)).not.toBeInTheDocument()
  })

  it("PENDING: how many unsynced sales", () => {
    render(<OfflineCell offline={report({ state: "PENDING", pendingCount: 3 })} />)
    expect(screen.getByText("3 unsynced · 09:15")).toBeInTheDocument()
  })

  it("UNKNOWN: when it was last heard from, with what it still held", () => {
    render(<OfflineCell offline={report({ state: "UNKNOWN", pendingCount: 2 })} />)
    expect(screen.getByText("Not heard since 09:15 · 2 unsynced")).toBeInTheDocument()
  })

  it("NEVER_REPORTED", () => {
    render(<OfflineCell offline={report({ state: "NEVER_REPORTED", pendingCount: null, lastReportAt: null, clockSkewMs: null })} />)
    expect(screen.getByText("No report yet")).toBeInTheDocument()
  })

  it("the unregistered till, or a pre-O3 server: a dash", () => {
    render(<OfflineCell offline={null} />)
    expect(screen.getByText("—")).toBeInTheDocument()
  })

  it("warns when the till's clock is more than 2 minutes off, either way", () => {
    const { rerender } = render(<OfflineCell offline={report({ clockSkewMs: 3 * 60_000 })} />)
    expect(screen.getByText("Clock +3 min")).toBeInTheDocument()
    rerender(<OfflineCell offline={report({ clockSkewMs: -4 * 60_000 })} />)
    expect(screen.getByText("Clock −4 min")).toBeInTheDocument()
    rerender(<OfflineCell offline={report({ clockSkewMs: 90_000 })} />)
    expect(screen.queryByText(/Clock/)).not.toBeInTheDocument()
  })
})
