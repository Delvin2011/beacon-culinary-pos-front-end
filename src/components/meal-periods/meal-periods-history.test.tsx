// T0-5b: meal periods change history: who, when, before and after, filter by period, paging, the URL.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MealPeriodsHistory, historyQueryFromSearch } from "@/components/meal-periods/meal-periods-history"
import { adminPeriod, jsonResponse, seededPeriods } from "@/lib/meal-periods.test-fixtures"
import type { MealPeriodHistoryEntry } from "@/lib/meal-periods"

const authFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ authFetch }) }))

const lunchState = { name: "Lunch", startTime: "12:00:00", endTime: "14:30:00", sortOrder: 20, active: true }
const entries: MealPeriodHistoryEntry[] = [
  {
    id: 13,
    periodId: 2,
    action: "UPDATE",
    before: lunchState,
    after: { ...lunchState, name: "Midday", startTime: "11:30:00" },
    changedAt: "2026-11-20T08:15:00Z",
    changedById: 1,
    changedByName: "Canteen Admin",
  },
  {
    id: 12,
    periodId: 5,
    action: "DEACTIVATE",
    before: { name: "Supper", startTime: "17:00:00", endTime: "19:00:00", sortOrder: 40, active: true },
    after: { name: "Supper", startTime: "17:00:00", endTime: "19:00:00", sortOrder: 40, active: false },
    changedAt: "2026-11-19T15:00:00Z",
    changedById: 4,
    changedByName: "Former Admin",
  },
  {
    id: 11,
    periodId: 5,
    action: "CREATE",
    before: null,
    after: { name: "Supper", startTime: "17:00:00", endTime: "19:00:00", sortOrder: 40, active: true },
    changedAt: "2026-11-19T14:00:00Z",
    changedById: 4,
    changedByName: "Former Admin",
  },
]
const periods = [
  ...seededPeriods().map((p) => (p.id === 2 ? { ...p, name: "Midday", startTime: "11:30:00" } : p)),
  adminPeriod({ id: 5, name: "Supper", startTime: "17:00:00", endTime: "19:00:00", active: false }),
]

let totalPages: number
beforeEach(() => {
  window.history.replaceState(null, "", "/meal-periods?tab=history")
  totalPages = 1
  authFetch.mockReset()
  authFetch.mockImplementation(async (path) => {
    const url = new URL(path, "http://x")
    const periodId = url.searchParams.get("periodId")
    const content = periodId ? entries.filter((e) => e.periodId === Number(periodId)) : entries
    return jsonResponse({ content, page: Number(url.searchParams.get("page")), size: Number(url.searchParams.get("size")), totalElements: content.length, totalPages })
  })
})

const rows = () => screen.getAllByTestId("history-row")

describe("MealPeriodsHistory", () => {
  it("shows when, who, the period, the action and only the fields that changed", async () => {
    render(<MealPeriodsHistory periods={periods} />)
    await waitFor(() => expect(rows()).toHaveLength(3))
    const [update, deactivate, create] = rows().map((r) => within(r).getAllByRole("cell").map((c) => c.textContent))
    expect(update).toEqual(["20 Nov 2026, 10:15", "Canteen Admin", "Midday", "Changed", "Name: LunchTimes: 12:00–14:30", "Name: MiddayTimes: 11:30–14:30"])
    expect(deactivate.slice(1)).toEqual(["Former Admin", "Supper", "Deactivated", "Status: Active", "Status: Inactive"])
    expect(create[3]).toBe("Added")
    expect(create[4]).toBe("—")
    expect(create[5]).toContain("Times: 17:00–19:00")
    expect(authFetch.mock.calls[0][0]).toBe("/admin/meal-periods/history?page=0&size=50")
  })

  it("filters by period (inactive ones too) and keeps it in the URL", async () => {
    render(<MealPeriodsHistory periods={periods} />)
    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(within(screen.getByLabelText("Period")).getByRole("option", { name: "Supper (inactive)" })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "5" } })
    await waitFor(() => expect(rows()).toHaveLength(2))
    expect(authFetch.mock.calls.at(-1)?.[0]).toBe("/admin/meal-periods/history?periodId=5&page=0&size=50")
    expect(window.location.search).toBe("?tab=history&periodId=5")
  })

  it("pages and changes the page size", async () => {
    totalPages = 3
    render(<MealPeriodsHistory periods={periods} />)
    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(screen.getByText(/page 1 of 3/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await waitFor(() => expect(authFetch.mock.calls.at(-1)?.[0]).toBe("/admin/meal-periods/history?page=1&size=50"))
    fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "200" } })
    await waitFor(() => expect(authFetch.mock.calls.at(-1)?.[0]).toBe("/admin/meal-periods/history?page=0&size=200"))
    expect(window.location.search).toBe("?tab=history&size=200")
  })

  it("starts from the URL", async () => {
    window.history.replaceState(null, "", "/meal-periods?tab=history&periodId=2&page=1&size=100")
    render(<MealPeriodsHistory periods={periods} />)
    await waitFor(() => expect(authFetch).toHaveBeenCalledWith("/admin/meal-periods/history?periodId=2&page=1&size=100", undefined))
  })

  it("ignores a bad URL", () => {
    expect(historyQueryFromSearch("?periodId=x&page=-1&size=7")).toEqual({ periodId: null, page: 0, size: 50 })
  })

  it("says when nothing has changed yet", async () => {
    authFetch.mockImplementation(async () => jsonResponse({ content: [], page: 0, size: 50, totalElements: 0, totalPages: 0 }))
    render(<MealPeriodsHistory periods={periods} />)
    expect(await screen.findByText("No meal periods have been changed yet.")).toBeInTheDocument()
  })
})
