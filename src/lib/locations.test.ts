import { describe, expect, it, vi } from "vitest"
import { readApiError } from "@/lib/api-error"
import {
  LocationError,
  activeSecondaries,
  assignmentChanges,
  assignmentErrorMessage,
  chooseAgainMessage,
  deactivateRefusal,
  defaultIssueLocationId,
  describeHistoryEntry,
  historyPath,
  invalidFields,
  isChooseAgain,
  listAdminLocations,
  nameError,
  planMove,
  primaryOf,
  saveRefusalMessage,
  stockSummaryText,
  updateLocation,
  type LocationHistoryEntry,
} from "@/lib/locations"
import { COFFEE, PRIMARY, PRODUCTION, assignments, errorResponse, jsonResponse, pickerLocations } from "@/lib/locations.test-fixtures"

async function errorFrom(res: Response): Promise<LocationError> {
  return new LocationError(await readApiError(res), "fallback")
}

describe("pickers", () => {
  it("finds the primary by kind, not by name or id", () => {
    expect(primaryOf(pickerLocations())?.name).toBe(PRIMARY.name)
    expect(primaryOf([])).toBeNull()
  })

  it("offers active secondaries only, in the API's order", () => {
    const list = [...pickerLocations(), { id: 9, name: "Old Pantry", kind: "SECONDARY" as const, sortOrder: 40, active: false }]
    expect(activeSecondaries(list).map((l) => l.id)).toEqual([PRODUCTION.id, COFFEE.id])
  })

  it("preselects the ISSUE location only when there is exactly one active secondary", () => {
    expect(defaultIssueLocationId(pickerLocations())).toBeNull()
    expect(defaultIssueLocationId(pickerLocations().slice(0, 2))).toBe(PRODUCTION.id)
    expect(defaultIssueLocationId(pickerLocations().slice(0, 1))).toBeNull()
  })
})

describe("calls", () => {
  it("reads the admin list and turns a refusal into a LocationError", async () => {
    const authFetch = vi.fn().mockResolvedValueOnce(jsonResponse([])).mockResolvedValueOnce(errorResponse(409, "LOCATION_NAME_TAKEN", { locationId: 4, name: "Hot Line" }))
    await expect(listAdminLocations(authFetch)).resolves.toEqual([])
    const error = await updateLocation(authFetch, 7, { name: "hot line" }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LocationError)
    expect(authFetch).toHaveBeenLastCalledWith("/admin/locations/7", expect.objectContaining({ method: "PUT", body: JSON.stringify({ name: "hot line" }) }))
    expect(saveRefusalMessage(error as LocationError)).toBe("Another active location is already called Hot Line.")
  })

  it("builds the history path", () => {
    expect(historyPath({ locationId: null, page: 0, size: 50 })).toBe("/admin/locations/history?page=0&size=50")
    expect(historyPath({ locationId: 7, page: 2, size: 100 })).toBe("/admin/locations/history?locationId=7&page=2&size=100")
  })
})

describe("form checks", () => {
  it("requires a name of at most 50 characters", () => {
    expect(nameError("  ")).toBe("Enter a name.")
    expect(nameError("x".repeat(51))).toBe("At most 50 characters.")
    expect(nameError("x".repeat(50))).toBeNull()
  })

  it("reads LOCATION_INVALID details.fields", async () => {
    const error = await errorFrom(errorResponse(400, "LOCATION_INVALID", { fields: { name: "Name is required." } }))
    expect(invalidFields(error)).toEqual({ name: "Name is required." })
  })

  it("says what the maximum is", async () => {
    const error = await errorFrom(errorResponse(409, "LOCATION_LIMIT_REACHED", { maxActive: 10, active: 10 }))
    expect(saveRefusalMessage(error)).toBe("This site can have at most 10 active locations, the primary included. Deactivate one first.")
  })
})

describe("deactivate refusal", () => {
  it("lists each reason on its own", async () => {
    const one = async (details: Record<string, unknown>) => deactivateRefusal(await errorFrom(errorResponse(409, "LOCATION_DEACTIVATE_REFUSED", details)))

    expect(await one({ locationId: 3, reasons: ["PRIMARY"] })).toEqual([{ reason: "PRIMARY", text: "It's the primary location: every delivery is received here." }])

    const stock = await one({ locationId: 7, reasons: ["HAS_STOCK"], ingredientsWithStock: 1, stock: [{ ingredientId: 31, name: "Coffee beans", unit: "KG", quantity: 2.5 }] })
    expect(stock?.[0]).toMatchObject({ reason: "HAS_STOCK", text: "This location still holds stock: 1 ingredient", shown: 1, total: 1 })

    const assigned = await one({ locationId: 4, reasons: ["ASSIGNED"], assignedTo: ["PRODUCTION", "STATION_KITCHEN", "STATION_BAR", "STATION_NONE"] })
    expect(assigned?.[0]).toMatchObject({
      reason: "ASSIGNED",
      lines: ["It's the production location", "It supplies the kitchen station", "It supplies the bar station", "It supplies items handed over at the till"],
    })

    expect((await one({ locationId: 7, reasons: ["OPEN_STOCK_REQUESTS"], openStockRequestIds: [118, 119] }))?.[0]).toMatchObject({ ids: [118, 119] })
    expect((await one({ locationId: 7, reasons: ["OPEN_STOCK_TAKES"], openStockTakeIds: [5] }))?.[0]).toMatchObject({
      text: "It has stock takes waiting for review",
      ids: [5],
    })
  })

  it("keeps every reason when several hold, in the server's order", async () => {
    const error = await errorFrom(
      errorResponse(409, "LOCATION_DEACTIVATE_REFUSED", {
        locationId: 7,
        reasons: ["HAS_STOCK", "ASSIGNED", "OPEN_STOCK_REQUESTS", "OPEN_STOCK_TAKES", "SOMETHING_NEW"],
        ingredientsWithStock: 60,
        stock: [{ ingredientId: 1, name: "Flour", unit: "KG", quantity: 3 }],
        assignedTo: ["STATION_BAR"],
        openStockRequestIds: [118],
        openStockTakeIds: [5],
      }),
    )
    const items = deactivateRefusal(error)
    expect(items?.map((item) => item.reason)).toEqual(["HAS_STOCK", "ASSIGNED", "OPEN_STOCK_REQUESTS", "OPEN_STOCK_TAKES", "OTHER"])
    expect(items?.[0]).toMatchObject({ total: 60, shown: 1 })
  })

  it("is null for other codes", async () => {
    expect(deactivateRefusal(await errorFrom(errorResponse(409, "LOCATION_NAME_TAKEN")))).toBeNull()
  })
})

describe("assignments", () => {
  it("sends only what changed", () => {
    const current = assignments()
    const same = { production: PRODUCTION.id, stations: { KITCHEN: PRODUCTION.id, BAR: PRODUCTION.id, NONE: PRODUCTION.id } }
    expect(assignmentChanges(current, same)).toBeNull()
    expect(assignmentChanges(current, { ...same, stations: { ...same.stations, BAR: COFFEE.id } })).toEqual({ stations: { BAR: COFFEE.id } })
    expect(assignmentChanges(current, { ...same, production: COFFEE.id })).toEqual({ productionLocationId: COFFEE.id })
  })

  it("asks to choose again on each location code, and says nothing to save on LOCATION_INVALID", async () => {
    for (const code of ["ASSIGNMENT_NOT_SECONDARY", "LOCATION_INACTIVE", "LOCATION_NOT_FOUND", "ISSUE_LOCATION_NOT_SECONDARY"]) {
      const error = await errorFrom(errorResponse(400, code, { locationId: 3, locationName: PRIMARY.name }))
      expect(isChooseAgain(error)).toBe(true)
      expect(chooseAgainMessage(error)).toMatch(/choose again\.$/)
    }
    const invalid = await errorFrom(errorResponse(400, "LOCATION_INVALID", { fields: {} }))
    expect(isChooseAgain(invalid)).toBe(false)
    expect(assignmentErrorMessage(invalid)).toBe("Nothing to save: no assignment was changed.")
  })
})

describe("planMove", () => {
  const rows = [
    { id: 3, name: "A", sortOrder: 10 },
    { id: 4, name: "B", sortOrder: 20 },
    { id: 7, name: "C", sortOrder: 20 },
    { id: 9, name: "D", sortOrder: 0 },
  ]

  it("swaps two different sort orders, the moved row first", () => {
    expect(planMove(rows, 1, "up")).toEqual([
      { id: 4, name: "B", sortOrder: 10 },
      { id: 3, name: "A", sortOrder: 20 },
    ])
  })

  it("sends one PUT when the sort orders are equal", () => {
    expect(planMove(rows, 2, "up")).toEqual([{ id: 7, name: "C", sortOrder: 19 }])
    expect(planMove(rows, 1, "down")).toEqual([{ id: 4, name: "B", sortOrder: 21 }])
  })

  it("stays within 0–9999 and can't move past the ends", () => {
    expect(planMove([{ id: 1, name: "X", sortOrder: 0 }, { id: 2, name: "Y", sortOrder: 0 }], 1, "up")).toEqual([])
    expect(planMove(rows, 0, "up")).toEqual([])
    expect(planMove(rows, 3, "down")).toEqual([])
  })
})

describe("copy", () => {
  it("summarises stock on hand", () => {
    expect(stockSummaryText({ ingredientsWithStock: 41, ingredientsNegative: 2 })).toBe("41 ingredients in stock, 2 below zero")
    expect(stockSummaryText({ ingredientsWithStock: 1, ingredientsNegative: 0 })).toBe("1 ingredient in stock")
  })

  it("describes history rows", () => {
    const base: LocationHistoryEntry = {
      id: 1,
      locationId: 7,
      action: "UPDATE",
      role: null,
      previousLocationId: null,
      before: { name: "Coffee Bar", sortOrder: 30, active: true },
      after: { name: "Coffee Station", sortOrder: 40, active: true },
      changedAt: "2026-11-21T09:01:40Z",
      changedBy: 1,
      changedByName: "Site Admin",
    }
    const nameOf = (id: number) => (id === PRODUCTION.id ? PRODUCTION.name : null)
    expect(describeHistoryEntry(base, nameOf)).toEqual(["Renamed from Coffee Bar to Coffee Station", "Order 30 → 40"])
    expect(describeHistoryEntry({ ...base, action: "ASSIGN", role: "STATION_BAR", previousLocationId: PRODUCTION.id, before: null }, nameOf)).toEqual([
      "Now the bar station's source (was Hot Line)",
    ])
    expect(describeHistoryEntry({ ...base, action: "ASSIGN", role: "PRODUCTION", previousLocationId: 99, before: null }, nameOf)).toEqual([
      "Now the production location (was location #99)",
    ])
    expect(describeHistoryEntry({ ...base, action: "CREATE", before: null }, nameOf)).toEqual(["Created as Coffee Station"])
  })
})
