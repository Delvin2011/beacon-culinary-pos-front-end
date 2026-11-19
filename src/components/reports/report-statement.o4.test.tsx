// O4 (contract 9): the X and Z gain an "Offline sales" section, a late-offline-cash line and an "offline-exceptions"
// check (WARN). The statement viewer and the checks render them from the server's data, with no O4 code.
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ReportChecks } from "@/components/reports/report-checks"
import { ReportStatement } from "@/components/reports/report-statement"
import type { ReportEnvelope } from "@/lib/reports"

const envelope: ReportEnvelope = {
  meta: {
    key: "z-reading",
    title: "Z Reading",
    category: "DAILY_STATEMENTS",
    definitionVersion: 3,
    generatedAt: "2026-11-18T18:00:00Z",
    timezone: "Africa/Johannesburg",
    currency: "ZAR",
    amountsInclVat: true,
    params: {},
    statementTitle: "Z Reading",
    reference: "Z-0043",
  },
  columns: null,
  rows: null,
  totals: null,
  sections: [
    {
      key: "offline",
      type: "KEY_VALUE",
      title: "Offline sales",
      items: [
        { label: "Offline sales", type: "COUNT", value: 12 },
        { label: "Offline sales total", type: "MONEY", value: 640 },
        { label: "Open exceptions to review", type: "COUNT", value: 2 },
        { label: "Late offline cash after close: 2 sales", type: "MONEY", value: 95 },
      ],
    },
  ],
  checks: [
    { key: "offline-exceptions", label: "Offline sale exceptions to review", status: "WARN", unit: "COUNT", expected: 0, actual: 2, difference: 2 },
  ],
  page: null,
}

describe("the offline parts of the X and Z", () => {
  it("renders the Offline sales section", () => {
    render(<ReportStatement envelope={envelope} />)
    expect(screen.getByRole("heading", { name: "Offline sales" })).toBeInTheDocument()
    expect(screen.getByText("Open exceptions to review")).toBeInTheDocument()
    expect(screen.getByText("Late offline cash after close: 2 sales")).toBeInTheDocument()
  })

  it("shows the offline-exceptions check as a warning", () => {
    render(<ReportChecks meta={envelope.meta} checks={envelope.checks} />)
    // A warning keeps the panel closed until opened (only a FAIL opens it).
    fireEvent.click(screen.getByRole("button", { name: /reconciliation check/ }))
    expect(screen.getByText("Offline sale exceptions to review")).toBeInTheDocument()
    expect(screen.getByText("WARN")).toBeInTheDocument()
  })
})
