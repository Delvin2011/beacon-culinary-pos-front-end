// O3: today's snapshot (contract 8) in the order builder's shapes, for the read-only offline menu.
// The snapshot's menu is flat: a period tab shows the options of that period, the Beverages tab those of group
// BEVERAGES (periodId null). Only READY options are listed (out-today ones are shown as out). The snapshot has no
// categories, so always-on items fall under "Other".

import type { CatalogGroup } from "@/lib/catalog"
import { OPTION_READY, type OfflineSnapshot, type SnapshotOption } from "@/lib/offline/contract"

export interface SnapshotMealPeriod {
  id: number
  name: string
  startTime: string
  endTime: string
  plannable: boolean
}

export interface SnapshotMenuOption {
  id: number
  mealPeriodId: number | null
  optionDate: string
  name: string
  price: number
  plannedPortions: number | null
  portionsRemaining: number | null
  group: CatalogGroup
  period: { id: number; name: string } | null
  outToday: boolean
  stockStatus: null
}

export interface SnapshotMenuExtra {
  id: number
  componentName: string
  name: string
  mealPeriodId: number
  optionDate: string
  extraPrice: number
  bufferQuantity: number
  bufferRemaining: number
}

export function snapshotPeriods(snapshot: OfflineSnapshot): SnapshotMealPeriod[] {
  return snapshot.periods.map((period) => ({
    id: period.id,
    name: period.name,
    startTime: period.startTime,
    endTime: period.endTime,
    // All Day: its items are always available, not planned.
    plannable: !period.allDay,
  }))
}

function toOption(snapshot: OfflineSnapshot, option: SnapshotOption): SnapshotMenuOption {
  const period = option.periodId === null ? null : snapshot.periods.find((p) => p.id === option.periodId)
  return {
    id: option.id,
    mealPeriodId: option.periodId,
    optionDate: snapshot.tradingDay,
    name: option.name,
    price: option.price,
    plannedPortions: option.plannedPortions,
    portionsRemaining: option.portionsRemaining,
    group: option.group as CatalogGroup,
    period: period ? { id: period.id, name: period.name } : null,
    outToday: option.outToday,
    stockStatus: null,
  }
}

const listed = (option: SnapshotOption) => option.status === OPTION_READY

export function snapshotMenuForPeriod(
  snapshot: OfflineSnapshot,
  periodId: number,
): { options: SnapshotMenuOption[]; availableExtras: SnapshotMenuExtra[] } {
  return {
    options: snapshot.options.filter((o) => o.periodId === periodId && listed(o)).map((o) => toOption(snapshot, o)),
    availableExtras: snapshot.extras
      .filter((extra) => extra.periodId === periodId)
      .map((extra) => ({
        id: extra.id,
        componentName: extra.componentName,
        name: extra.componentName,
        mealPeriodId: extra.periodId,
        optionDate: snapshot.tradingDay,
        extraPrice: extra.priceDelta,
        bufferQuantity: extra.bufferRemaining ?? 0,
        bufferRemaining: extra.bufferRemaining ?? 0,
      })),
  }
}

export function snapshotBeverages(snapshot: OfflineSnapshot): SnapshotMenuOption[] {
  return snapshot.options.filter((o) => o.group === "BEVERAGES" && listed(o)).map((o) => toOption(snapshot, o))
}
