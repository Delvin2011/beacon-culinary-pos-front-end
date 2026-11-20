// T0-5b: meal periods as GET /admin/meal-periods returns them (contract section 3.2). Test-only.
// The names here are test data, not names the app relies on.
import type { AdminMealPeriod } from "@/lib/meal-periods"

export function adminPeriod(overrides: Partial<AdminMealPeriod> & { id: number; name: string }): AdminMealPeriod {
  return {
    startTime: "07:00:00",
    endTime: "10:00:00",
    allDay: false,
    accepts: "SET_MEALS",
    plannable: true,
    active: true,
    sortOrder: overrides.id * 10,
    lastChange: null,
    ...overrides,
  }
}

export function seededPeriods(): AdminMealPeriod[] {
  return [
    adminPeriod({ id: 1, name: "Breakfast", startTime: "07:00:00", endTime: "10:00:00", sortOrder: 10 }),
    adminPeriod({ id: 2, name: "Lunch", startTime: "12:00:00", endTime: "14:30:00", sortOrder: 20 }),
    adminPeriod({
      id: 3,
      name: "All Day",
      startTime: null,
      endTime: null,
      allDay: true,
      accepts: "LIGHT_MEALS",
      plannable: false,
      sortOrder: 30,
    }),
  ]
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export function codeResponse(status: number, code: string, error: string, details?: Record<string, unknown>): Response {
  return jsonResponse({ error, code, ...(details ? { details } : {}) }, status)
}
