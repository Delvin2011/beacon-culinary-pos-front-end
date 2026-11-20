// T0-5b: the Meal periods page: list, add, edit, field errors, overlap, the warnings before a time change or a
// rename, deactivate refused and allowed, activate, the All Day period protected, ADMIN only.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import MealPeriodsPage from "@/app/meal-periods/page"
import { adminPeriod, codeResponse, jsonResponse, seededPeriods } from "@/lib/meal-periods.test-fixtures"
import { setServerTimeOffset } from "@/lib/offline/server-time"
import type { AdminMealPeriod } from "@/lib/meal-periods"

const replace = vi.fn()
const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), usePathname: () => "/meal-periods" }))
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }))
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarTrigger: () => null,
}))
const toast = vi.fn()
vi.mock("@/hooks/use-toast", () => ({ toast: (...args: unknown[]) => toast(...args) }))

let role: string
const authFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, user: { name: "Ayanda", role }, authFetch }),
}))

let periods: AdminMealPeriod[]
let answer: (path: string, method: string, body: Record<string, unknown> | null) => Response | null

const calls = (method: string) => authFetch.mock.calls.filter(([, init]) => (init?.method ?? "GET") === method)
const sentBody = (method: string, index = 0) => JSON.parse(String(calls(method)[index][1]?.body)) as Record<string, unknown>
const row = (id: number) => screen.getByTestId(`meal-period-${id}`)
const dialog = () => screen.getByRole("dialog")
const type = (label: string, value: string) => fireEvent.change(within(dialog()).getByLabelText(label), { target: { value } })
const submit = (name: RegExp | string) => fireEvent.click(within(dialog()).getByRole("button", { name }))

beforeEach(() => {
  // 13:00 in the site time zone (SAST, UTC+2): Lunch (12:00–14:30) is being sold.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-20T11:00:00Z"))
  setServerTimeOffset(null)
  replace.mockReset()
  push.mockReset()
  toast.mockReset()
  role = "ADMIN"
  periods = seededPeriods()
  answer = () => null
  authFetch.mockReset()
  authFetch.mockImplementation(async (path, init) => {
    const method = init?.method ?? "GET"
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    const custom = answer(path, method, body)
    if (custom) return custom
    if (path === "/admin/meal-periods" && method === "GET") return jsonResponse(periods)
    if (path === "/admin/meal-periods" && method === "POST") {
      return jsonResponse(adminPeriod({ id: 9, name: String(body?.name), startTime: `${body?.startTime}:00`, endTime: `${body?.endTime}:00`, sortOrder: 40 }), 201)
    }
    const put = path.match(/^\/admin\/meal-periods\/(\d+)$/)
    if (put && method === "PUT") {
      const existing = periods.find((p) => p.id === Number(put[1]))!
      return jsonResponse({
        ...existing,
        name: body?.name,
        ...(body?.startTime ? { startTime: `${body.startTime}:00`, endTime: `${body.endTime}:00` } : {}),
        ...(body?.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      })
    }
    const status = path.match(/^\/admin\/meal-periods\/(\d+)\/(deactivate|activate)$/)
    if (status && method === "POST") {
      const existing = periods.find((p) => p.id === Number(status[1]))!
      return jsonResponse({ ...existing, active: status[2] === "activate" })
    }
    if (path.startsWith("/admin/meal-periods/history")) return jsonResponse({ content: [], page: 0, size: 50, totalElements: 0, totalPages: 0 })
    return jsonResponse({}, 404)
  })
  window.history.replaceState(null, "", "/meal-periods")
})

afterEach(() => {
  vi.useRealTimers()
})

const renderPage = async () => {
  render(<MealPeriodsPage />)
  await screen.findByTestId("meal-period-1")
}

describe("the list", () => {
  it("shows the periods in sort order with times, status and the All Day period marked", async () => {
    periods = [...seededPeriods(), adminPeriod({ id: 5, name: "Supper", startTime: "17:00:00", endTime: "19:00:00", sortOrder: 5, active: false })]
    await renderPage()
    const rows = screen.getAllByTestId(/^meal-period-\d+$/).map((r) => r.getAttribute("data-testid"))
    expect(rows).toEqual(["meal-period-5", "meal-period-1", "meal-period-2", "meal-period-3"])
    expect(within(row(2)).getByText("12:00–14:30")).toBeInTheDocument()
    expect(within(row(3)).getByText("Always open")).toBeInTheDocument()
    expect(within(row(3)).getByText("All-day period")).toBeInTheDocument()
    expect(within(row(1)).queryByText("All-day period")).not.toBeInTheDocument()
  })

  it("greys an inactive period and offers Activate", async () => {
    periods = [...seededPeriods(), adminPeriod({ id: 5, name: "Supper", startTime: "17:00:00", endTime: "19:00:00", sortOrder: 40, active: false })]
    await renderPage()
    expect(row(5)).toHaveAttribute("data-inactive", "true")
    expect(within(row(5)).getByText("Inactive")).toBeInTheDocument()
    expect(within(row(5)).getByRole("button", { name: "Activate Supper" })).toBeInTheDocument()
    expect(row(2)).not.toHaveAttribute("data-inactive")
  })

  it("never offers Deactivate for the All Day period", async () => {
    await renderPage()
    expect(within(row(3)).queryByRole("button", { name: /Deactivate/ })).not.toBeInTheDocument()
    expect(within(row(2)).getByRole("button", { name: "Deactivate Lunch" })).toBeInTheDocument()
  })

  it("says that changes apply immediately to the menu and selling", async () => {
    await renderPage()
    expect(screen.getByRole("note")).toHaveTextContent(/Changes apply immediately/)
    expect(screen.getByRole("note")).toHaveTextContent(/on the menu and can be sold/)
  })

  it("shows the last change", async () => {
    periods = seededPeriods().map((p) => (p.id === 2 ? { ...p, lastChange: { action: "UPDATE" as const, byName: "Canteen Admin", at: "2026-11-20T08:15:00Z" } } : p))
    await renderPage()
    expect(within(row(2)).getByText(/Changed by Canteen Admin/)).toBeInTheDocument()
  })
})

describe("add", () => {
  it("sends the new period and shows it in the list", async () => {
    await renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Add period" }))
    type("Name", " Supper ")
    type("Start", "17:00")
    type("End", "19:00")
    submit("Add period")
    await screen.findByTestId("meal-period-9")
    expect(sentBody("POST")).toEqual({ name: "Supper", startTime: "17:00", endTime: "19:00" })
    expect(toast).toHaveBeenCalledWith({ title: "Supper added" })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("sends the sort order when given", async () => {
    await renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Add period" }))
    type("Name", "Supper")
    type("Start", "17:00")
    type("End", "19:00")
    type("Sort order", "15")
    submit("Add period")
    await screen.findByTestId("meal-period-9")
    expect(sentBody("POST")).toEqual({ name: "Supper", startTime: "17:00", endTime: "19:00", sortOrder: 15 })
  })

  it("checks the fields before sending", async () => {
    await renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Add period" }))
    type("Name", "lunch")
    type("Start", "19:00")
    type("End", "17:00")
    type("Sort order", "10000")
    submit("Add period")
    expect(within(dialog()).getByText("Another active period is already called Lunch.")).toBeInTheDocument()
    expect(within(dialog()).getByText("Overnight periods are not supported; the end must be after the start.")).toBeInTheDocument()
    expect(within(dialog()).getByText("Must be between 0 and 9999.")).toBeInTheDocument()
    expect(within(dialog()).getByLabelText("Name")).toHaveAttribute("aria-invalid", "true")
    expect(calls("POST")).toHaveLength(0)
  })

  it("refuses an overlap before sending, naming the other period under both times", async () => {
    await renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Add period" }))
    type("Name", "Brunch")
    type("Start", "09:00")
    type("End", "11:00")
    submit("Add period")
    expect(within(dialog()).getAllByText("Overlaps Breakfast (07:00–10:00).")).toHaveLength(2)
    expect(calls("POST")).toHaveLength(0)
  })

  it("shows the server's PERIOD_OVERLAP under both times", async () => {
    answer = (path, method) =>
      path === "/admin/meal-periods" && method === "POST"
        ? codeResponse(409, "PERIOD_OVERLAP", "Overlaps Tea (15:00–16:00).", { periodId: 7, name: "Tea", startTime: "15:00:00", endTime: "16:00:00" })
        : null
    await renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Add period" }))
    type("Name", "Supper")
    type("Start", "15:30")
    type("End", "19:00")
    submit("Add period")
    expect(await within(dialog()).findAllByText("Overlaps Tea (15:00–16:00). Active periods can touch but not overlap.")).toHaveLength(2)
  })

  it("shows the server's 400 messages under their fields, and others at the top", async () => {
    answer = (path, method) =>
      path === "/admin/meal-periods" && method === "POST"
        ? jsonResponse({ name: "Another active period is already called Supper.", endTime: "Seconds must be 00.", body: "Must be a JSON object." }, 400)
        : null
    await renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Add period" }))
    type("Name", "Supper")
    type("Start", "17:00")
    type("End", "19:00")
    submit("Add period")
    expect(await within(dialog()).findByText("Another active period is already called Supper.")).toBeInTheDocument()
    expect(within(dialog()).getByText("Seconds must be 00.")).toBeInTheDocument()
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("Must be a JSON object.")
    expect(screen.queryByTestId("meal-period-9")).not.toBeInTheDocument()
  })
})

describe("edit", () => {
  it("warns before shortening a period that is being sold now, then saves on Save anyway", async () => {
    await renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Edit Lunch" }))
    type("End", "13:30")
    submit("Save")
    expect(within(dialog()).getByTestId("meal-period-warnings")).toHaveTextContent(
      "Lunch is being sold now. Changing its times takes effect immediately: items will stop selling at 13:30.",
    )
    expect(calls("PUT")).toHaveLength(0)
    submit("Save anyway")
    await waitFor(() => expect(calls("PUT")).toHaveLength(1))
    expect(sentBody("PUT")).toEqual({ name: "Lunch", startTime: "12:00", endTime: "13:30", sortOrder: 20 })
    await waitFor(() => expect(within(row(2)).getByText("12:00–13:30")).toBeInTheDocument())
  })

  it("warns that a time change outside the period still applies at once", async () => {
    await renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Edit Breakfast" }))
    type("End", "09:30")
    submit("Save")
    expect(within(dialog()).getByTestId("meal-period-warnings")).toHaveTextContent(/take effect immediately/)
    expect(within(dialog()).getByTestId("meal-period-warnings")).not.toHaveTextContent(/being sold now/)
  })

  it("warns on rename that past reports show the new name", async () => {
    await renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Edit Lunch" }))
    type("Name", "Midday")
    submit("Save")
    expect(within(dialog()).getByTestId("meal-period-warnings")).toHaveTextContent(/Past reports and the dashboard will show the new name/)
    submit("Save anyway")
    await waitFor(() => expect(within(row(2)).getByText("Midday")).toBeInTheDocument())
  })

  it("saves a sort order change without a warning", async () => {
    await renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Edit Lunch" }))
    type("Sort order", "5")
    submit("Save")
    await waitFor(() => expect(calls("PUT")).toHaveLength(1))
    await waitFor(() => expect(screen.getAllByTestId(/^meal-period-\d+$/)[0]).toHaveAttribute("data-testid", "meal-period-2"))
  })

  it("edits only the name and sort order of the All Day period, and never sends times", async () => {
    await renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Edit All Day" }))
    expect(within(dialog()).queryByLabelText("Start")).not.toBeInTheDocument()
    expect(within(dialog()).queryByLabelText("End")).not.toBeInTheDocument()
    type("Sort order", "1")
    submit("Save")
    await waitFor(() => expect(calls("PUT")).toHaveLength(1))
    expect(sentBody("PUT")).toEqual({ name: "All Day", sortOrder: 1 })
  })

  it("shows ALL_DAY_PROTECTED in plain words", async () => {
    answer = (path, method) => (path === "/admin/meal-periods/3" && method === "PUT" ? codeResponse(409, "ALL_DAY_PROTECTED", "x") : null)
    await renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Edit All Day" }))
    type("Sort order", "1")
    submit("Save")
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      "All Day is always open: it can't be given times or deactivated, because light meals depend on it.",
    )
  })

  it("reloads the list when the period no longer exists", async () => {
    answer = (path, method) => (path === "/admin/meal-periods/1" && method === "PUT" ? codeResponse(404, "MEAL_PERIOD_NOT_FOUND", "x") : null)
    await renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Edit Breakfast" }))
    type("Sort order", "11")
    submit("Save")
    expect(await screen.findByRole("status")).toHaveTextContent("This meal period no longer exists. The list has been reloaded.")
    expect(calls("GET").filter(([path]) => path === "/admin/meal-periods")).toHaveLength(2)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})

describe("deactivate and activate", () => {
  it("explains the effect, and shows PERIOD_IN_USE with the counts and the first date", async () => {
    answer = (path) =>
      path === "/admin/meal-periods/2/deactivate"
        ? codeResponse(409, "PERIOD_IN_USE", "Lunch has 3 planned items from 21 Nov 2026.", { options: 2, extras: 1, fromDate: "2026-11-21" })
        : null
    await renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Deactivate Lunch" }))
    expect(dialog()).toHaveTextContent(/its items leave the menu and can't be sold/)
    expect(dialog()).toHaveTextContent(/Past orders and reports keep it/)
    submit("Deactivate")
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      "Lunch can't be deactivated: it has 2 meal options and 1 extra planned from 21 Nov 2026. Move them to another period or remove them on Daily planning first.",
    )
    expect(within(row(2)).getByText("Active")).toBeInTheDocument()
  })

  it("deactivates when nothing is planned", async () => {
    await renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Deactivate Lunch" }))
    submit("Deactivate")
    await waitFor(() => expect(row(2)).toHaveAttribute("data-inactive", "true"))
    expect(calls("POST").map(([path]) => path)).toEqual(["/admin/meal-periods/2/deactivate"])
    expect(toast).toHaveBeenCalledWith({ title: "Lunch deactivated" })
  })

  it("activates, and shows a name clash or an overlap in plain words", async () => {
    periods = [...seededPeriods(), adminPeriod({ id: 5, name: "Supper", startTime: "17:00:00", endTime: "19:00:00", sortOrder: 40, active: false })]
    let refusal: Response | null = jsonResponse({ name: "Another active period is already called Supper." }, 400)
    answer = (path) => (path === "/admin/meal-periods/5/activate" ? refusal : null)
    await renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Activate Supper" }))
    expect(dialog()).toHaveTextContent(/sold from 17:00–19:00 again/)
    submit("Activate")
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("Another active period is already called Supper. Rename one of them first.")

    refusal = codeResponse(409, "PERIOD_OVERLAP", "x", { periodId: 8, name: "Tea", startTime: "16:00:00", endTime: "17:30:00" })
    submit("Activate")
    await waitFor(() => expect(within(dialog()).getByRole("alert")).toHaveTextContent("Overlaps Tea (16:00–17:30)."))

    refusal = null
    submit("Activate")
    await waitFor(() => expect(row(5)).not.toHaveAttribute("data-inactive"))
  })

  it("shows ALL_DAY_PROTECTED if the server refuses a deactivate", async () => {
    // The screen offers no Deactivate for All Day; this is a period the server treats as All Day.
    answer = (path) => (path === "/admin/meal-periods/1/deactivate" ? codeResponse(409, "ALL_DAY_PROTECTED", "x") : null)
    await renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Deactivate Breakfast" }))
    submit("Deactivate")
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(/^Breakfast is always open/)
  })
})

describe("tabs", () => {
  it("shows the change history with every period in its filter, and keeps the tab in the URL", async () => {
    await renderPage()
    fireEvent.click(screen.getByRole("tab", { name: "Change history" }))
    expect(await screen.findByText("No meal periods have been changed yet.")).toBeInTheDocument()
    expect(within(screen.getByLabelText("Period")).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All periods",
      "Breakfast",
      "Lunch",
      "All Day",
    ])
    expect(window.location.search).toBe("?tab=history")
    fireEvent.click(screen.getByRole("tab", { name: "Periods" }))
    expect(window.location.search).toBe("")
    expect(row(2)).toBeVisible()
  })

  it("opens on the history when the URL says so", async () => {
    window.history.replaceState(null, "", "/meal-periods?tab=history")
    render(<MealPeriodsPage />)
    expect(await screen.findByText("No meal periods have been changed yet.")).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Change history" })).toHaveAttribute("aria-selected", "true")
  })
})

describe("access", () => {
  it.each(["CASHIER", "HEAD_CHEF", "STOCK_ADMIN"])("sends %s to their own page and loads nothing", (other) => {
    role = other
    render(<MealPeriodsPage />)
    expect(replace).toHaveBeenCalled()
    expect(replace.mock.calls[0][0]).not.toBe("/meal-periods")
    expect(authFetch).not.toHaveBeenCalled()
    expect(screen.queryByText("Meal periods")).not.toBeInTheDocument()
  })

  it("says so when the server refuses (403, empty body)", async () => {
    answer = (path) => (path === "/admin/meal-periods" ? new Response(null, { status: 403 }) : null)
    render(<MealPeriodsPage />)
    expect(await screen.findByRole("alert")).toHaveTextContent("Only an admin can.")
  })
})
