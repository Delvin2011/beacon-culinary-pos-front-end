// O3: the shift saved online and restored after a reload while offline, only when this till may sell offline on it.
import "fake-indexeddb/auto"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Shift } from "@/contexts/shift-context"
import { OFFLINE_DB_NAME, getMeta, putGrant, resetOfflineDbForTests, setMeta } from "@/lib/offline/db"
import { restoreOfflineShift, saveLastShift } from "@/lib/offline/offline-shift"
import { setServerTimeOffset } from "@/lib/offline/server-time"
import { grantBody } from "@/lib/offline/test-fixtures"
import type { TillStatus } from "@/lib/till"

const thandisShift: Shift = {
  id: 412,
  cashierId: 17,
  status: "OPEN",
  openingFloat: 500,
  openedAt: "2026-11-18T05:58:12Z",
  closedAt: null,
  owner: { id: 17, name: "Thandi Mokoena", role: "CASHIER" },
  ownedByCaller: true,
  tillCode: "T1",
  tillName: "Till 1 (front)",
}

const tillStatus: TillStatus = {
  registered: true,
  tillCode: "T1",
  tillName: "Till 1 (front)",
  shift: { shiftId: 412, ownerId: 17, ownerName: "Thandi Mokoena", openedAt: "2026-11-18T05:58:12Z", locked: false },
  idleLockMinutes: 5,
  requireRegistered: false,
  offlineEnabled: true,
  maxOfflineHours: 6,
  warnOfflineHours: 5,
}

const thandi = { cashierId: 17 }

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
  setServerTimeOffset(null)
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-18T10:00:00Z"))
})

afterEach(async () => {
  vi.useRealTimers()
  await resetOfflineDbForTests()
})

async function savedOnline() {
  await setMeta("tillStatus", tillStatus)
  await putGrant(grantBody)
  await saveLastShift(thandisShift)
}

describe("the shift offline", () => {
  it("is restored for the owner with a valid grant", async () => {
    await savedOnline()
    expect(await restoreOfflineShift(thandi)).toEqual(thandisShift)
  })

  it("isn't saved while offline is off", async () => {
    await setMeta("tillStatus", { ...tillStatus, offlineEnabled: false })
    await saveLastShift(thandisShift)
    expect(await getMeta("lastShift")).toBeNull()
  })

  it("is forgotten when the server says there is no open shift", async () => {
    await savedOnline()
    await saveLastShift(null)
    expect(await restoreOfflineShift(thandi)).toBeNull()
  })

  it.each([
    ["someone else is signed in", async () => {}, { cashierId: 23 }],
    ["no grant", async () => { await resetOfflineDbForTests(); await deleteDB(OFFLINE_DB_NAME); await setMeta("tillStatus", tillStatus); await saveLastShift(thandisShift) }, thandi],
    ["the grant is for another shift", async () => { await putGrant({ ...grantBody, shiftId: 411 }) }, thandi],
    ["the grant has expired by server time", async () => { vi.setSystemTime(new Date("2026-11-19T00:05:00Z")) }, thandi],
    ["offline was turned off since", async () => { await setMeta("tillStatus", { ...tillStatus, offlineEnabled: false }) }, thandi],
    ["the till isn't registered", async () => { await setMeta("tillStatus", { ...tillStatus, registered: false }) }, thandi],
  ])("isn't restored when %s", async (_, change, user) => {
    await savedOnline()
    await change()
    expect(await restoreOfflineShift(user)).toBeNull()
  })
})
