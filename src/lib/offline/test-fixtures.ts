// O3 test fixtures: a grant and a snapshot as the contract shows them (sections 5 and 8). Tests only.

export const grantBody = {
  grantId: "g1",
  grant: "opaque.grant.string",
  deviceId: "d1",
  tillCode: "T1",
  shiftId: 412,
  cashierId: 17,
  cashierName: "Thandi Mokoena",
  issuedAt: "2026-11-18T06:02:11Z",
  expiresAt: "2026-11-19T00:02:11Z",
  tradingDay: "2026-11-18",
  nextOfflineSeq: 3,
  maxOfflineHours: 6,
  warnOfflineHours: 5,
  accountsEnabled: true,
  accountCap: 150,
  serverTimeUtc: "2026-11-18T06:02:11Z",
}

export const snapshotBody = (version = "v1") => ({
  snapshotVersion: version,
  serverTimeUtc: "2026-11-18T09:15:00Z",
  tradingDay: "2026-11-18",
  periods: [],
  options: [{ id: 912, name: "Still water", price: 20, status: "READY", periodId: null }],
  accountsEnabled: true,
  accountCap: 150,
  accounts: [{ id: 5, accountNumber: "PM0005", name: "Finance Dept" }],
})
