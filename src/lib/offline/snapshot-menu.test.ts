// O3: today's snapshot as the order builder's periods, menu and beverages.
import { describe, expect, it } from "vitest"
import { parseSnapshot } from "@/lib/offline/contract"
import { snapshotBeverages, snapshotMenuForPeriod, snapshotPeriods } from "@/lib/offline/snapshot-menu"

const snapshot = parseSnapshot({
  snapshotVersion: "v1",
  tradingDay: "2026-11-18",
  periods: [
    { id: 2, name: "Lunch", startTime: "11:30:00", endTime: "14:30:00", allDay: false },
    { id: 4, name: "All Day", startTime: "06:00:00", endTime: "18:00:00", allDay: true },
  ],
  options: [
    { id: 801, name: "Beef stew", station: "KITCHEN", group: "SET_MEALS", periodId: 2, price: 50, status: "READY",
      plannedPortions: 40, portionsRemaining: 12, outToday: false, alwaysOn: false },
    { id: 802, name: "Fish (not cooked yet)", station: "KITCHEN", group: "SET_MEALS", periodId: 2, price: 55, status: "PLANNED",
      plannedPortions: 20, portionsRemaining: 20, outToday: false, alwaysOn: false },
    { id: 905, name: "Toasted sandwich", station: "KITCHEN", group: "LIGHT_MEALS", periodId: 4, price: 35, status: "READY",
      plannedPortions: null, portionsRemaining: null, outToday: true, alwaysOn: true },
    { id: 912, name: "Still water 500 ml", station: "NONE", group: "BEVERAGES", periodId: null, price: 20, status: "READY",
      plannedPortions: null, portionsRemaining: null, outToday: false, alwaysOn: true },
  ],
  extras: [
    { id: 3102, periodId: 2, componentName: "Extra beef", priceDelta: 15, bufferRemaining: 9 },
    { id: 3103, periodId: 1, componentName: "Extra egg", priceDelta: 8, bufferRemaining: 4 },
  ],
})!

describe("snapshot menu", () => {
  it("periods: All Day isn't planned", () => {
    expect(snapshotPeriods(snapshot)).toEqual([
      { id: 2, name: "Lunch", startTime: "11:30:00", endTime: "14:30:00", plannable: true },
      { id: 4, name: "All Day", startTime: "06:00:00", endTime: "18:00:00", plannable: false },
    ])
  })

  it("a period's READY options and its extras", () => {
    const lunch = snapshotMenuForPeriod(snapshot, 2)
    expect(lunch.options.map((o) => o.name)).toEqual(["Beef stew"])
    expect(lunch.options[0]).toMatchObject({ mealPeriodId: 2, portionsRemaining: 12, group: "SET_MEALS", period: { id: 2, name: "Lunch" } })
    expect(lunch.availableExtras).toEqual([
      { id: 3102, componentName: "Extra beef", name: "Extra beef", mealPeriodId: 2, optionDate: "2026-11-18", extraPrice: 15, bufferQuantity: 9, bufferRemaining: 9 },
    ])
  })

  it("keeps out-today items (shown as out)", () => {
    expect(snapshotMenuForPeriod(snapshot, 4).options[0]).toMatchObject({ name: "Toasted sandwich", outToday: true })
  })

  it("beverages: group BEVERAGES, no period", () => {
    expect(snapshotBeverages(snapshot).map((o) => [o.name, o.mealPeriodId])).toEqual([["Still water 500 ml", null]])
  })
})
