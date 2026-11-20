// T0-5b: meal periods library: field rules, overlap, warnings, refusals in plain words, history, calls.
import { describe, expect, it, vi } from "vitest"
import {
  MealPeriodError,
  activateMealPeriod,
  bodyFromForm,
  checkForm,
  createMealPeriod,
  deactivateMealPeriod,
  fetchMealPeriodHistory,
  formFromPeriod,
  formatCalendarDate,
  formatPeriodTimes,
  historyChanges,
  historyPath,
  isOpenAt,
  listAdminMealPeriods,
  refusalMessage,
  saveWarnings,
  siteTimeAt,
  updateMealPeriod,
  type MealPeriodForm,
} from "@/lib/meal-periods"
import { adminPeriod, codeResponse, jsonResponse, seededPeriods } from "@/lib/meal-periods.test-fixtures"
import { readApiError } from "@/lib/api-error"

const periods = seededPeriods()
const [breakfast, lunch, allDay] = periods
const form = (overrides: Partial<MealPeriodForm> = {}): MealPeriodForm => ({
  name: "Supper",
  startTime: "17:00",
  endTime: "19:00",
  sortOrder: "",
  ...overrides,
})

async function errorOf(res: Response) {
  return new MealPeriodError(await readApiError(res), "fallback")
}

describe("times", () => {
  it("shows HH:mm and 'Always open' for All Day", () => {
    expect(formatPeriodTimes(lunch)).toBe("12:00–14:30")
    expect(formatPeriodTimes(allDay)).toBe("Always open")
  })

  it("is open from start to end inclusive", () => {
    expect(isOpenAt(lunch, "12:00:00")).toBe(true)
    expect(isOpenAt(lunch, "14:30:00")).toBe(true)
    expect(isOpenAt(lunch, "14:30:01")).toBe(false)
    expect(isOpenAt(lunch, "11:59:59")).toBe(false)
    expect(isOpenAt(allDay, "03:00:00")).toBe(true)
  })

  it("reads the time of day in the site time zone (SAST, UTC+2)", () => {
    expect(siteTimeAt(Date.parse("2026-11-20T10:15:30Z"))).toBe("12:15:30")
    expect(siteTimeAt(Date.parse("2026-11-20T22:00:00Z"))).toBe("00:00:00")
  })
})

describe("checkForm", () => {
  const ctx = { editing: null, periods }

  it("accepts a valid new period", () => {
    expect(checkForm(form(), ctx)).toEqual({})
  })

  it("requires a name of at most 50 characters", () => {
    expect(checkForm(form({ name: "   " }), ctx).name).toBe("Required.")
    expect(checkForm(form({ name: "x".repeat(51) }), ctx).name).toBe("At most 50 characters.")
    expect(checkForm(form({ name: ` ${"x".repeat(50)} ` }), ctx).name).toBeUndefined()
  })

  it("refuses a name an active period has, ignoring case", () => {
    expect(checkForm(form({ name: " lunch " }), ctx).name).toBe("Another active period is already called Lunch.")
  })

  it("allows a name only an inactive period has", () => {
    const list = [...periods, adminPeriod({ id: 5, name: "Supper", startTime: "17:00:00", endTime: "19:00:00", active: false })]
    expect(checkForm(form(), { editing: null, periods: list })).toEqual({})
  })

  it("lets a period keep its own name", () => {
    expect(checkForm(formFromPeriod(lunch), { editing: lunch, periods })).toEqual({})
  })

  it("checks the times", () => {
    expect(checkForm(form({ startTime: "" }), ctx).startTime).toBe("Required.")
    expect(checkForm(form({ endTime: "7pm" }), ctx).endTime).toBe("Use HH:mm.")
    expect(checkForm(form({ endTime: "19:00:30" }), ctx).endTime).toBe("Seconds must be 00.")
    expect(checkForm(form({ endTime: "17:00" }), ctx).endTime).toBe(
      "Overnight periods are not supported; the end must be after the start.",
    )
    expect(checkForm(form({ startTime: "22:00", endTime: "02:00" }), ctx).endTime).toMatch(/Overnight/)
  })

  it("refuses an overlap with an active timed period and names it under both times", () => {
    const errors = checkForm(form({ startTime: "14:00", endTime: "16:00" }), ctx)
    expect(errors.startTime).toBe("Overlaps Lunch (12:00–14:30).")
    expect(errors.endTime).toBe("Overlaps Lunch (12:00–14:30).")
  })

  it("allows touching ends, All Day, and overlaps with inactive periods", () => {
    expect(checkForm(form({ startTime: "10:00", endTime: "12:00" }), ctx)).toEqual({})
    const list = [...periods, adminPeriod({ id: 5, name: "Supper", startTime: "17:00:00", endTime: "19:00:00", active: false })]
    expect(checkForm(form({ name: "Tea", startTime: "18:00", endTime: "20:00" }), { editing: null, periods: list })).toEqual({})
  })

  it("doesn't check an inactive period against the others (that happens on activate)", () => {
    const supper = adminPeriod({ id: 5, name: "Supper", startTime: "17:00:00", endTime: "19:00:00", active: false })
    expect(checkForm(form({ name: "Lunch", startTime: "12:00", endTime: "13:00" }), { editing: supper, periods: [...periods, supper] })).toEqual({})
  })

  it("doesn't check All Day's times, which it has none of", () => {
    expect(checkForm(formFromPeriod(allDay), { editing: allDay, periods })).toEqual({})
  })

  it("checks the sort order when given", () => {
    expect(checkForm(form({ sortOrder: "10000" }), ctx).sortOrder).toBe("Must be between 0 and 9999.")
    expect(checkForm(form({ sortOrder: "-1" }), ctx).sortOrder).toBe("Must be between 0 and 9999.")
    expect(checkForm(form({ sortOrder: "2.5" }), ctx).sortOrder).toBe("Must be between 0 and 9999.")
    expect(checkForm(form({ sortOrder: "0" }), ctx).sortOrder).toBeUndefined()
  })
})

describe("bodyFromForm", () => {
  it("trims the name and leaves an empty sort order out", () => {
    expect(bodyFromForm(form({ name: " Supper " }), null)).toEqual({ name: "Supper", startTime: "17:00", endTime: "19:00" })
    expect(bodyFromForm(form({ sortOrder: "40" }), null)).toMatchObject({ sortOrder: 40 })
  })

  it("never sends times for All Day", () => {
    expect(bodyFromForm({ ...formFromPeriod(allDay), name: "Anytime" }, allDay)).toEqual({ name: "Anytime", sortOrder: 30 })
  })
})

describe("saveWarnings", () => {
  it("warns about a time change that is open right now, naming the new end", () => {
    const w = saveWarnings(lunch, { ...formFromPeriod(lunch), endTime: "13:30" }, "13:00:00")
    expect(w.sellingNow).toBe(true)
    expect(w.times).toBe("Lunch is being sold now. Changing its times takes effect immediately: items will stop selling at 13:30.")
  })

  it("says items stop at once when the new times have already passed", () => {
    const w = saveWarnings(lunch, { ...formFromPeriod(lunch), endTime: "12:30" }, "13:00:00")
    expect(w.times).toMatch(/items will stop selling as soon as you save\.$/)
  })

  it("still warns, more mildly, about a time change outside the period", () => {
    const w = saveWarnings(lunch, { ...formFromPeriod(lunch), startTime: "11:30" }, "09:00:00")
    expect(w.sellingNow).toBe(false)
    expect(w.times).toMatch(/take effect immediately/)
  })

  it("doesn't treat an inactive period as being sold", () => {
    const inactive = { ...lunch, active: false }
    expect(saveWarnings(inactive, { ...formFromPeriod(inactive), endTime: "13:30" }, "13:00:00").sellingNow).toBe(false)
  })

  it("warns that past reports show a new name", () => {
    const w = saveWarnings(lunch, { ...formFromPeriod(lunch), name: "Midday" }, "09:00:00")
    expect(w.rename).toMatch(/Past reports and the dashboard will show the new name/)
    expect(w.rename).toMatch(/Lunch.*Midday/)
    expect(w.times).toBeNull()
  })

  it("says nothing when only the sort order changes, or when adding", () => {
    expect(saveWarnings(lunch, { ...formFromPeriod(lunch), sortOrder: "5" }, "13:00:00")).toEqual({ times: null, sellingNow: false, rename: null })
    expect(saveWarnings(null, form(), "13:00:00").times).toBeNull()
  })
})

describe("refusalMessage", () => {
  it("PERIOD_OVERLAP names the other period", async () => {
    const error = await errorOf(
      codeResponse(409, "PERIOD_OVERLAP", "Overlaps Lunch (12:00–14:30).", { periodId: 2, name: "Lunch", startTime: "12:00:00", endTime: "14:30:00" }),
    )
    expect(refusalMessage(error, "Supper")).toBe("Overlaps Lunch (12:00–14:30). Active periods can touch but not overlap.")
  })

  it("PERIOD_IN_USE gives the counts and the first date, and what to do", async () => {
    const error = await errorOf(codeResponse(409, "PERIOD_IN_USE", "x", { options: 2, extras: 1, fromDate: "2026-11-21" }))
    expect(refusalMessage(error, "Supper")).toBe(
      "Supper can't be deactivated: it has 2 meal options and 1 extra planned from 21 Nov 2026. Move them to another period or remove them on Daily planning first.",
    )
  })

  it("ALL_DAY_PROTECTED, MEAL_PERIOD_NOT_FOUND and MEAL_PERIOD_INACTIVE in plain words", async () => {
    expect(refusalMessage(await errorOf(codeResponse(409, "ALL_DAY_PROTECTED", "x")), "Anytime")).toMatch(/^Anytime is always open/)
    expect(refusalMessage(await errorOf(codeResponse(404, "MEAL_PERIOD_NOT_FOUND", "x")), "Supper")).toMatch(/no longer exists/)
    expect(refusalMessage(await errorOf(codeResponse(400, "MEAL_PERIOD_INACTIVE", "x")), "Supper")).toBe(
      "Supper has been deactivated, so nothing can be planned under it. Choose another period.",
    )
  })

  it("MEAL_PERIOD_UNKNOWN in plain words, not the server's message", async () => {
    expect(refusalMessage(await errorOf(codeResponse(400, "MEAL_PERIOD_UNKNOWN", "Unknown meal period: Supper")), "Supper")).toBe(
      "Supper has been renamed or deactivated. The meal periods have been reloaded; try again.",
    )
  })

  it("403 with an empty body is a permission message", async () => {
    const error = await errorOf(new Response(null, { status: 403 }))
    expect(error.forbidden).toBe(true)
    expect(refusalMessage(error, "Lunch")).toMatch(/permission/)
  })

  it("an unknown code shows the server's text", async () => {
    expect(refusalMessage(await errorOf(codeResponse(409, "SOMETHING_NEW", "Server says no.")), "Lunch")).toBe("Server says no.")
  })

  it("formats calendar dates without shifting them", () => {
    expect(formatCalendarDate("2026-01-01")).toBe("1 Jan 2026")
  })
})

describe("historyChanges", () => {
  const state = { name: "Lunch", startTime: "12:00:00", endTime: "14:30:00", sortOrder: 20, active: true }
  const entry = (before: typeof state | null, after: typeof state, action: "CREATE" | "UPDATE" | "DEACTIVATE" | "ACTIVATE" = "UPDATE") => ({
    id: 1,
    periodId: 2,
    action,
    before,
    after,
    changedAt: "2026-11-20T08:15:00Z",
    changedById: 1,
    changedByName: "Canteen Admin",
  })

  it("lists only the fields that changed", () => {
    expect(historyChanges(entry(state, { ...state, startTime: "11:30:00" }))).toEqual([
      { field: "times", before: "12:00–14:30", after: "11:30–14:30" },
    ])
    expect(historyChanges(entry(state, { ...state, active: false }, "DEACTIVATE"))).toEqual([
      { field: "active", before: "Active", after: "Inactive" },
    ])
  })

  it("lists every field for CREATE, with no before", () => {
    const changes = historyChanges(entry(null, state, "CREATE"))
    expect(changes.map((c) => c.field)).toEqual(["name", "times", "sortOrder", "active"])
    expect(changes.every((c) => c.before === null)).toBe(true)
  })
})

describe("calls", () => {
  const fetchOk = (body: unknown, status = 200) => vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(async () => jsonResponse(body, status))

  it("lists, creates, updates, deactivates and activates", async () => {
    let f = fetchOk(periods)
    await expect(listAdminMealPeriods(f)).resolves.toEqual(periods)
    expect(f).toHaveBeenCalledWith("/admin/meal-periods", undefined)

    f = fetchOk(breakfast, 201)
    await createMealPeriod(f, { name: "Supper", startTime: "17:00", endTime: "19:00" })
    expect(f.mock.calls[0][0]).toBe("/admin/meal-periods")
    expect(f.mock.calls[0][1]?.method).toBe("POST")
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ name: "Supper", startTime: "17:00", endTime: "19:00" })

    f = fetchOk(lunch)
    await updateMealPeriod(f, 2, { name: "Lunch", startTime: "11:30", endTime: "14:30" })
    expect(f.mock.calls[0][0]).toBe("/admin/meal-periods/2")
    expect(f.mock.calls[0][1]?.method).toBe("PUT")

    f = fetchOk(lunch)
    await deactivateMealPeriod(f, 2)
    expect(f).toHaveBeenCalledWith("/admin/meal-periods/2/deactivate", { method: "POST" })

    f = fetchOk(lunch)
    await activateMealPeriod(f, 2)
    expect(f).toHaveBeenCalledWith("/admin/meal-periods/2/activate", { method: "POST" })
  })

  it("builds the history path", async () => {
    expect(historyPath({ periodId: null, page: 0, size: 50 })).toBe("/admin/meal-periods/history?page=0&size=50")
    expect(historyPath({ periodId: 2, page: 1, size: 100 })).toBe("/admin/meal-periods/history?periodId=2&page=1&size=100")
    const f = fetchOk({ content: [], page: 0, size: 50, totalElements: 0, totalPages: 0 })
    await fetchMealPeriodHistory(f, { periodId: 2, page: 0, size: 50 })
    expect(f.mock.calls[0][0]).toBe("/admin/meal-periods/history?periodId=2&page=0&size=50")
  })

  it("throws MealPeriodError with the field map on 400", async () => {
    const f = vi.fn(async () => jsonResponse({ name: "Required.", endTime: "Use HH:mm." }, 400))
    const error = await createMealPeriod(f, { name: "" }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MealPeriodError)
    expect((error as MealPeriodError).fieldErrors).toEqual({ name: "Required.", endTime: "Use HH:mm." })
    expect((error as MealPeriodError).code).toBeNull()
  })

  it("throws with the code and details on a rule refusal", async () => {
    const f = vi.fn(async () => codeResponse(409, "PERIOD_IN_USE", "x", { options: 1, extras: 0, fromDate: "2026-11-20" }))
    const error = (await deactivateMealPeriod(f, 5).catch((e: unknown) => e)) as MealPeriodError
    expect(error.code).toBe("PERIOD_IN_USE")
    expect(error.details).toEqual({ options: 1, extras: 0, fromDate: "2026-11-20" })
  })
})
