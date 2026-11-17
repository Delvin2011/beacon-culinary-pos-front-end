// O2 reports are server data: the generic viewer must accept Z version 1 and 2 (Till column, Tills section), the
// Cash-up's till column and "Not counted" rows, and never show 0.00 where counted cash or variance is null.
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ReportStatement } from "@/components/reports/report-statement"
import { ReportTable } from "@/components/reports/report-table"
import { moneyOrDash } from "@/lib/money"
import type { ReportColumn, ReportEnvelope, ReportSection, TableSection } from "@/lib/reports"

const ZERO = /^R\s?0[.,]00$/

function envelope(definitionVersion: number, sections: ReportSection[], overrides: Partial<ReportEnvelope["meta"]> = {}): ReportEnvelope {
  return {
    meta: {
      key: "z-reading",
      title: "Z Reading",
      category: "DAILY_STATEMENTS",
      definitionVersion,
      generatedAt: "2026-11-18T18:00:00Z",
      timezone: "Africa/Johannesburg",
      currency: "ZAR",
      amountsInclVat: true,
      params: {},
      statementTitle: "Z Reading",
      reference: "Z-0042",
      ...overrides,
    },
    columns: null,
    rows: null,
    totals: null,
    sections,
    checks: [],
    page: null,
  }
}

const shiftColumnsV1: ReportColumn[] = [
  { key: "cashier", label: "Cashier", type: "TEXT", total: "LABEL" },
  { key: "expectedCash", label: "Expected", type: "MONEY", total: "SUM" },
  { key: "countedCash", label: "Counted", type: "MONEY", total: "SUM" },
  { key: "variance", label: "Variance", type: "VARIANCE", total: "SUM" },
]

const shiftsV1: TableSection = {
  key: "shifts",
  type: "TABLE",
  title: "Shifts",
  columns: shiftColumnsV1,
  rows: [{ cashier: "Thandi Mokoena", expectedCash: 1200, countedCash: 1180.5, variance: -19.5 }],
  totals: { cashier: "Total", expectedCash: 1200, countedCash: 1180.5, variance: -19.5 },
}

// Version 2: a Till column after Cashier, and an uncounted shift.
const shiftsV2: TableSection = {
  ...shiftsV1,
  columns: [shiftColumnsV1[0], { key: "till", label: "Till", type: "TEXT", total: "NONE" }, ...shiftColumnsV1.slice(1)],
  rows: [
    { cashier: "Thandi Mokoena", till: "T1 · Till 1 (front)", expectedCash: 1200, countedCash: 1180.5, variance: -19.5 },
    { cashier: "Sipho Dlamini", till: "Unregistered till", expectedCash: 600, countedCash: null, variance: null },
  ],
}

// The contract's Tills section (11), as sent.
const tillsV2: TableSection = {
  key: "tills",
  type: "TABLE",
  title: "Tills",
  columns: [
    { key: "till", label: "Till", type: "TEXT", total: "LABEL" },
    { key: "shifts", label: "Shifts", type: "INT", total: "SUM" },
    { key: "openingFloat", label: "Float", type: "MONEY", total: "SUM" },
    { key: "cashSales", label: "Cash sales", type: "MONEY", total: "SUM" },
    { key: "cashRefunds", label: "Cash refunds", type: "MONEY", total: "SUM" },
    { key: "refundsOfOtherTills", label: "of which other tills' sales", type: "MONEY", total: "SUM" },
    { key: "expectedCash", label: "Expected", type: "MONEY", total: "SUM" },
    { key: "countedCash", label: "Counted", type: "MONEY", total: "SUM" },
    { key: "variance", label: "Variance", type: "VARIANCE", total: "SUM" },
    { key: "uncounted", label: "Not counted", type: "INT", total: "SUM" },
  ],
  slipColumns: ["till", "expectedCash", "variance"],
  rows: [
    { till: "T1 · Till 1 (front)", shifts: 2, openingFloat: 1000, cashSales: 4210, cashRefunds: 45, refundsOfOtherTills: 0, expectedCash: 5165, countedCash: 5160, variance: -5, uncounted: 0 },
    { till: "T2 · Till 2 (back)", shifts: 1, openingFloat: 500, cashSales: 1980, cashRefunds: 60, refundsOfOtherTills: 35, expectedCash: 2420, countedCash: 2420, variance: 0, uncounted: 0 },
  ],
  totals: { till: "Total", shifts: 3, openingFloat: 1500, cashSales: 6190, cashRefunds: 105, refundsOfOtherTills: 35, expectedCash: 7585, countedCash: 7580, variance: -5, uncounted: 0 },
}

const headers = (table: HTMLElement) => within(table).getAllByRole("columnheader").map((th) => th.textContent)

describe("Z reading", () => {
  it("version 1 (before O2) renders as stored: no Till column, no Tills section", () => {
    render(<ReportStatement envelope={envelope(1, [shiftsV1])} />)
    expect(headers(screen.getByRole("table", { name: "Shifts" }))).toEqual(["Cashier", "Expected", "Counted", "Variance"])
    expect(screen.queryByRole("table", { name: "Tills" })).not.toBeInTheDocument()
  })

  it("version 2: a Till column in Shifts, the Tills section, and blanks for an uncounted shift", () => {
    render(<ReportStatement envelope={envelope(2, [shiftsV2, tillsV2])} />)

    const shifts = screen.getByRole("table", { name: "Shifts" })
    expect(headers(shifts)).toEqual(["Cashier", "Till", "Expected", "Counted", "Variance"])
    const sipho = within(shifts).getByText("Sipho Dlamini").closest("tr") as HTMLElement
    expect(within(sipho).getByText("Unregistered till")).toBeInTheDocument()
    expect(within(sipho).getAllByText("—")).toHaveLength(2)
    expect(within(sipho).queryByText(ZERO)).not.toBeInTheDocument()

    const tills = screen.getByRole("table", { name: "Tills" })
    expect(headers(tills)).toContain("of which other tills' sales")
    expect(within(tills).getByText("T2 · Till 2 (back)")).toBeInTheDocument()
    expect(within(tills).getByText("Total")).toBeInTheDocument()
  })

  it("version 2 on the 80 mm slip: the Tills section prints its three slip columns", () => {
    render(<ReportStatement envelope={envelope(2, [shiftsV2, tillsV2])} medium="SLIP80" />)
    expect(headers(screen.getByRole("table", { name: "Tills" }))).toEqual(["Till", "Expected", "Variance"])
  })
})

describe("Cashier reading", () => {
  it("shows the till and 'Not counted', with blank counted cash and variance", () => {
    const header: ReportSection = {
      key: "header",
      type: "KEY_VALUE",
      items: [
        { label: "Cashier", type: "TEXT", value: "Thandi Mokoena" },
        { label: "Till", type: "TEXT", value: "T1 · Till 1 (front)" },
      ],
    }
    const cash: ReportSection = {
      key: "cash",
      type: "KEY_VALUE",
      title: "Cash",
      items: [
        { label: "Expected cash", type: "MONEY", value: 1200 },
        { label: "Counted cash", type: "MONEY", value: null },
        { label: "Variance", type: "VARIANCE", value: null },
        { label: "Cash count", type: "TEXT", value: "Not counted" },
      ],
    }
    render(<ReportStatement envelope={envelope(1, [header, cash], { key: "cashier-reading", statementTitle: "Cashier Reading" })} />)

    expect(screen.getByText("T1 · Till 1 (front)")).toBeInTheDocument()
    expect(screen.getByText("Not counted")).toBeInTheDocument()
    const counted = screen.getByText("Counted cash").parentElement as HTMLElement
    expect(within(counted).getByText("—")).toBeInTheDocument()
    expect(within(screen.getByText("Variance").parentElement as HTMLElement).queryByText(ZERO)).not.toBeInTheDocument()
  })
})

describe("Cash-up & Variance", () => {
  it("has a till column; a 'Not counted' row shows blanks, never 0.00", () => {
    const columns: ReportColumn[] = [
      { key: "cashier", label: "Cashier", type: "TEXT", total: "LABEL" },
      { key: "till", label: "Till", type: "TEXT", total: "NONE" },
      { key: "countedCash", label: "Counted", type: "MONEY", total: "SUM" },
      { key: "variance", label: "Variance", type: "VARIANCE", total: "SUM" },
      { key: "reason", label: "Reason", type: "TEXT", total: "NONE" },
    ]
    render(
      <ReportTable
        title="Cash-up & Variance"
        columns={columns}
        rows={[
          { cashier: "Thandi Mokoena", till: "T1 · Till 1 (front)", countedCash: 1180.5, variance: -19.5, reason: "Cash counting error" },
          { cashier: "Sipho Dlamini", till: "T2 · Till 2 (back)", countedCash: null, variance: null, reason: "Not counted" },
        ]}
        totals={{ cashier: "Total", countedCash: 1180.5, variance: -19.5 }}
      />,
    )
    const sipho = screen.getByText("Sipho Dlamini").closest("tr") as HTMLElement
    expect(within(sipho).getByText("T2 · Till 2 (back)")).toBeInTheDocument()
    expect(within(sipho).getByText("Not counted")).toBeInTheDocument()
    expect(within(sipho).getAllByText("—")).toHaveLength(2)
    expect(within(sipho).queryByText(ZERO)).not.toBeInTheDocument()
  })
})

describe("POS close-out", () => {
  it("moneyOrDash: blank for a missing amount, the amount otherwise (0 included)", () => {
    expect(moneyOrDash(null)).toBe("—")
    expect(moneyOrDash(undefined)).toBe("—")
    expect(moneyOrDash(0)).toMatch(ZERO)
    expect(moneyOrDash(1180.5)).toMatch(/1\s?180[.,]50/)
  })
})
