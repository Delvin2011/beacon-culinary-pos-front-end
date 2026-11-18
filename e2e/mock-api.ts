// O3 e2e: the backend, mocked per the contracts, for one registered till (T1) with Thandi's open shift and offline on.
// `offline` makes every API call fail as if the network were down. Answers carry CORS headers for the app's origin.
import type { BrowserContext, Route } from "@playwright/test"
import { E2E_API_URL, E2E_APP_URL } from "./urls"

const jhbDay = (ms: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(ms),
  )

export interface MockApi {
  offline: boolean
  calls: string[]
}

export async function mockApi(context: BrowserContext): Promise<MockApi> {
  const state: MockApi = { offline: false, calls: [] }
  const now = () => Date.now()
  const today = jhbDay(now())

  const shift = {
    shiftId: 412,
    owner: { id: 17, name: "Thandi Mokoena", role: "CASHIER" },
    ownedByCaller: true,
    openedAt: new Date(now() - 2 * 3_600_000).toISOString(),
    openingFloat: 500,
    tillCode: "T1",
    tillName: "Till 1 (front)",
  }

  const answers: Record<string, () => unknown> = {
    "GET /health": () => ({ status: "UP", serverTimeUtc: new Date().toISOString() }),
    "GET /pos/till-status": () => ({
      registered: true,
      tillCode: "T1",
      tillName: "Till 1 (front)",
      shift: { shiftId: 412, ownerId: 17, ownerName: "Thandi Mokoena", openedAt: shift.openedAt, locked: true },
      idleLockMinutes: 30,
      requireRegistered: false,
      offlineEnabled: true,
      maxOfflineHours: 6,
      warnOfflineHours: 5,
    }),
    "GET /users/cashiers": () => [{ id: 17, name: "Thandi Mokoena" }],
    "POST /auth/pin-login": () => ({ token: "e2e.access.token", user: { name: "Thandi Mokoena", role: "CASHIER" } }),
    "GET /shifts/open": () => shift,
    "POST /pos/offline/grant": () => ({
      grantId: "e2e-grant",
      grant: "opaque.e2e.grant",
      deviceId: "e2e-device",
      tillCode: "T1",
      shiftId: 412,
      cashierId: 17,
      cashierName: "Thandi Mokoena",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(now() + 18 * 3_600_000).toISOString(),
      tradingDay: today,
      nextOfflineSeq: 1,
      maxOfflineHours: 6,
      warnOfflineHours: 5,
      accountsEnabled: false,
      serverTimeUtc: new Date().toISOString(),
    }),
    "GET /pos/offline/snapshot": () => ({
      snapshotVersion: "e2e-v1",
      generatedAt: new Date().toISOString(),
      serverTimeUtc: new Date().toISOString(),
      tradingDay: today,
      periods: [{ id: 2, name: "Lunch", startTime: "00:00:00", endTime: "23:59:59", allDay: false }],
      options: [
        { id: 801, name: "Beef stew", station: "KITCHEN", group: "SET_MEALS", periodId: 2, price: 50, status: "READY",
          plannedPortions: 40, portionsRemaining: 12, outToday: false, alwaysOn: false },
      ],
      extras: [],
      vatRate: 0.15,
      receiptSettings: { receiptTitle: null, businessName: "Canteen", addressLines: [], phone: null, vatNumber: null, footerText: null, showVatLine: false },
      tenders: ["CASH", "CARD"],
      accountsEnabled: false,
      limits: { maxOfflineHours: 6, warnOfflineHours: 5 },
    }),
    "POST /pos/offline/status": () => ({ receivedAt: new Date().toISOString(), clockSkewMs: 0, serverTimeUtc: new Date().toISOString() }),
    "GET /meal-periods": () => [{ id: 2, name: "Lunch", startTime: "00:00:00", endTime: "23:59:59", plannable: true }],
    "GET /menu/today": () => ({
      options: [{ id: 701, mealPeriodId: 2, optionDate: today, name: "Live curry", price: 45, plannedPortions: 10, portionsRemaining: 5, group: "SET_MEALS" }],
      availableExtras: [],
    }),
    "GET /orders/today": () => [],
    "GET /pos/receipt-settings": () => ({ receiptTitle: null, businessName: null, addressLines: [], phone: null, vatNumber: null, footerText: null, showVatLine: false }),
  }

  const cors = (route: Route) => ({
    "Access-Control-Allow-Origin": E2E_APP_URL,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": route.request().headers()["access-control-request-headers"] ?? "Authorization, Content-Type, If-None-Match",
    "Access-Control-Expose-Headers": "ETag",
  })

  await context.route(`${E2E_API_URL}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (state.offline) return route.abort("internetdisconnected")
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors(route) })
    const key = `${request.method()} ${url.pathname}`
    state.calls.push(key)
    const answer = answers[key]
    const headers = { ...cors(route), "Content-Type": "application/json" }
    if (!answer) return route.fulfill({ status: 200, headers, body: "{}" })
    const extra: Record<string, string> = url.pathname === "/pos/offline/snapshot" ? { ETag: '"e2e-v1"' } : {}
    return route.fulfill({
      status: key === "POST /pos/offline/grant" ? 201 : 200,
      headers: { ...headers, ...extra },
      body: JSON.stringify(answer()),
    })
  })
  return state
}
