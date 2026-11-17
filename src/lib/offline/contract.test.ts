// O3: reading the grant, snapshot and status reply (contract sections 5, 8, 9).
import { describe, expect, it } from "vitest"
import { offlineSalesPendingMessage, parseGrant, parseSnapshot, parseStatusReply } from "@/lib/offline/contract"

const grantBody = {
  grantId: "7c1e9a52-2f0b-4d0c-9a7e-3b1f6e2d4c10",
  grant: "eyJraWQiOiJrMSIsImFsZyI6IkhTMjU2In0.eyJ0eXAiOiJvZmZsaW5lLWdyYW50In0.sig",
  deviceId: "6f1c2a0e-3d5b-4b8e-9a51-1f2c3d4e5f60",
  tillCode: "T1",
  shiftId: 412,
  cashierId: 17,
  cashierName: "Thandi Mokoena",
  issuedAt: "2026-11-18T06:02:11Z",
  expiresAt: "2026-11-19T00:02:11Z",
  tradingDay: "2026-11-18",
  nextOfflineSeq: 1,
  maxOfflineHours: 6,
  warnOfflineHours: 5,
  accountsEnabled: true,
  accountCap: 150.0,
  serverTimeUtc: "2026-11-18T06:02:11Z",
}

const snapshotBody = {
  snapshotVersion: "9f2c4e1ab07d5c3e",
  generatedAt: "2026-11-18T09:15:00Z",
  serverTimeUtc: "2026-11-18T09:15:00Z",
  tradingDay: "2026-11-18",
  periods: [
    { id: 1, name: "Breakfast", startTime: "07:00:00", endTime: "10:00:00", allDay: false },
    { id: 4, name: "All Day", startTime: "06:00:00", endTime: "18:00:00", allDay: true },
  ],
  options: [
    { id: 801, name: "Beef stew", station: "KITCHEN", group: "SET_MEALS", periodId: 2, price: 50.0, status: "READY",
      plannedPortions: 40, portionsRemaining: 12, outToday: false, alwaysOn: false },
    { id: 912, name: "Still water 500 ml", station: "NONE", group: "BEVERAGES", periodId: null, price: 20.0, status: "READY",
      plannedPortions: null, portionsRemaining: null, outToday: false, alwaysOn: true },
    { id: 999, name: "Broken" },
  ],
  extras: [{ id: 3102, periodId: 2, componentName: "Extra beef", priceDelta: 15.0, bufferRemaining: 9 }],
  vatRate: 0.15,
  receiptSettings: { receiptTitle: null, businessName: "Canteen at Riverside Park", addressLines: ["12 Main Road"],
    phone: null, vatNumber: "4123456789", footerText: null, showVatLine: true },
  tenders: ["CASH", "CARD", "ACCOUNT"],
  accountsEnabled: true,
  accountCap: 150.0,
  accounts: [{ id: 5, accountNumber: "PM0005", name: "Finance Dept" }],
  limits: { maxOfflineHours: 6, warnOfflineHours: 5 },
}

describe("parseGrant", () => {
  it("reads every field and keeps the grant string exactly as received", () => {
    const grant = parseGrant(grantBody)
    expect(grant).toMatchObject({ shiftId: 412, cashierId: 17, cashierName: "Thandi Mokoena", nextOfflineSeq: 1, accountCap: 150 })
    expect(grant?.grant).toBe(grantBody.grant)
  })

  it("has no account cap when accounts are off", () => {
    expect(parseGrant({ ...grantBody, accountsEnabled: false })?.accountCap).toBeNull()
  })

  it.each(["grant", "shiftId", "cashierId", "expiresAt", "tradingDay", "nextOfflineSeq"])("is null without %s", (key) => {
    const body: Record<string, unknown> = { ...grantBody }
    delete body[key]
    expect(parseGrant(body)).toBeNull()
  })
})

describe("parseSnapshot", () => {
  it("reads the menu as a flat list, beverages with no period, and drops a malformed option", () => {
    const snapshot = parseSnapshot(snapshotBody)
    expect(snapshot?.options.map((o) => o.id)).toEqual([801, 912])
    expect(snapshot?.options[1]).toMatchObject({ periodId: null, portionsRemaining: null, alwaysOn: true })
    expect(snapshot?.periods[1].allDay).toBe(true)
    expect(snapshot?.extras[0]).toMatchObject({ componentName: "Extra beef", priceDelta: 15 })
    expect(snapshot?.receiptSettings?.businessName).toBe("Canteen at Riverside Park")
    expect(snapshot?.accounts).toEqual([{ id: 5, accountNumber: "PM0005", name: "Finance Dept" }])
    expect(snapshot?.limits).toEqual({ maxOfflineHours: 6, warnOfflineHours: 5 })
  })

  it("has no accounts or cap when accounts are off", () => {
    const snapshot = parseSnapshot({ ...snapshotBody, accountsEnabled: false, tenders: ["CASH", "CARD"] })
    expect(snapshot?.accounts).toBeNull()
    expect(snapshot?.accountCap).toBeNull()
  })

  it.each(["snapshotVersion", "tradingDay", "periods", "options"])("is null without %s", (key) => {
    const body: Record<string, unknown> = { ...snapshotBody }
    delete body[key]
    expect(parseSnapshot(body)).toBeNull()
  })
})

describe("parseStatusReply", () => {
  it("reads the clock difference and the server time", () => {
    expect(
      parseStatusReply({ receivedAt: "2026-11-18T09:15:00.600Z", clockSkewMs: 1520, serverTimeUtc: "2026-11-18T09:15:00.600Z" }),
    ).toEqual({ receivedAt: "2026-11-18T09:15:00.600Z", clockSkewMs: 1520, serverTimeUtc: "2026-11-18T09:15:00.600Z" })
    expect(parseStatusReply("nope")).toBeNull()
  })
})

describe("offlineSalesPendingMessage", () => {
  it("uses the count from details, not the server's text", () => {
    expect(offlineSalesPendingMessage(3)).toBe("This till still has 3 unsynced sales for this shift. Sync them before closing.")
    expect(offlineSalesPendingMessage(1)).toContain("1 unsynced sale for")
    expect(offlineSalesPendingMessage(null)).toContain("unsynced sales")
  })
})
