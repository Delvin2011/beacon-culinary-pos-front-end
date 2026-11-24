// O3 e2e: the backend, mocked per the contracts, for one registered till (T1) with Thandi's open shift and offline on.
// `offline` makes every API call fail as if the network were down. T1-0d: the API is /api on the app's own origin,
// so there is no CORS; the answers are keyed by the backend path (the /api prefix removed, as Front Door does).
// O4: offline account sales are on, and POST /pos/offline/sales records every sale it receives.
import type { BrowserContext } from "@playwright/test"
import { E2E_API_URL } from "./urls"

const jhbDay = (ms: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(ms),
  )

// A sale as the till sends it (O4 contract section 3), the parts the test checks.
export interface SentSale {
  clientOrderId: string
  grantId: string
  collectionNumber: string
  offlineReceiptNumber: string
  offlineSeq: number
  soldAt: string
  shiftId: number
  cashierId: number
  unlockedOffline: boolean
  total: number
  payments: Array<{ method: string; cardReference?: string; accountId?: number }>
}

export interface MockApi {
  offline: boolean
  calls: string[]
  // O4: every POST /pos/offline/sales body, and every status report.
  salesBatches: Array<{ grants: string[]; sales: SentSale[] }>
  statusReports: Array<Record<string, unknown>>
  // The sales received (once each, by clientOrderId), in the order they arrived.
  receivedSales: () => SentSale[]
  // T1-0d: API responses the service worker answered. Must stay empty: the worker never handles /api.
  answeredByWorker: string[]
}

export async function mockApi(context: BrowserContext): Promise<MockApi> {
  const recorded = new Map<string, SentSale>()
  const state: MockApi = {
    offline: false,
    calls: [],
    salesBatches: [],
    statusReports: [],
    receivedSales: () => Array.from(recorded.values()),
    answeredByWorker: [],
  }
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

  // Each answer may read the request's JSON body.
  const answers: Record<string, (body: unknown) => unknown> = {
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
      accountsEnabled: true,
      accountCap: 500,
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
      tenders: ["CASH", "CARD", "ACCOUNT"],
      accountsEnabled: true,
      accountCap: 500,
      accounts: [{ id: 5, accountNumber: "PM0005", name: "Finance Dept" }],
      limits: { maxOfflineHours: 6, warnOfflineHours: 5 },
    }),
    "POST /pos/offline/status": (body) => {
      state.statusReports.push(body as Record<string, unknown>)
      return { receivedAt: new Date().toISOString(), clockSkewMs: 0, serverTimeUtc: new Date().toISOString() }
    },
    // O4: every sale CREATED (a resent one comes back DUPLICATE), with the order the server would make.
    "POST /pos/offline/sales": (body) => {
      const batch = body as { grants: string[]; sales: SentSale[] }
      state.salesBatches.push(batch)
      return {
        results: batch.sales.map((sale) => {
          const duplicate = recorded.has(sale.clientOrderId)
          if (!duplicate) recorded.set(sale.clientOrderId, sale)
          return {
            clientOrderId: sale.clientOrderId,
            result: duplicate ? "DUPLICATE" : "CREATED",
            orderId: 9000 + sale.offlineSeq,
            orderNumber: 50 + sale.offlineSeq,
            receiptNumber: sale.offlineReceiptNumber,
            collectionNumber: sale.collectionNumber,
            exceptions: [],
          }
        }),
        serverTimeUtc: new Date().toISOString(),
      }
    },
    "GET /meal-periods": () => [{ id: 2, name: "Lunch", startTime: "00:00:00", endTime: "23:59:59", plannable: true }],
    "GET /menu/today": () => ({
      options: [{ id: 701, mealPeriodId: 2, optionDate: today, name: "Live curry", price: 45, plannedPortions: 10, portionsRemaining: 5, group: "SET_MEALS" }],
      availableExtras: [],
    }),
    // The synced offline sales, as GET /orders/today returns them (OrderDto with O4's fields).
    "GET /orders/today": () =>
      state.receivedSales().map((sale) => ({
        id: 9000 + sale.offlineSeq,
        orderNumber: 50 + sale.offlineSeq,
        receiptNumber: sale.offlineReceiptNumber,
        collectionNumber: sale.collectionNumber,
        recordedOffline: true,
        soldAt: sale.soldAt,
        createdAt: new Date().toISOString().replace("Z", ""),
        status: "COLLECTED",
        total: sale.total,
        lines: [],
        payments: sale.payments,
      })),
    "GET /pos/receipt-settings": () => ({ receiptTitle: null, businessName: null, addressLines: [], phone: null, vatNumber: null, footerText: null, showVatLine: false }),
  }

  context.on("response", (response) => {
    if (response.fromServiceWorker() && response.url().startsWith(`${E2E_API_URL}/`)) state.answeredByWorker.push(response.url())
  })

  await context.route(`${E2E_API_URL}/**`, async (route) => {
    const request = route.request()
    const backendPath = new URL(request.url()).pathname.replace(/^\/api(?=\/)/, "")
    if (state.offline) return route.abort("internetdisconnected")
    const key = `${request.method()} ${backendPath}`
    state.calls.push(key)
    const answer = answers[key]
    const headers = { "Content-Type": "application/json" }
    if (!answer) return route.fulfill({ status: 200, headers, body: "{}" })
    const extra: Record<string, string> = backendPath === "/pos/offline/snapshot" ? { ETag: '"e2e-v1"' } : {}
    const postData = request.postData()
    const requestBody = postData ? (JSON.parse(postData) as unknown) : null
    return route.fulfill({
      status: key === "POST /pos/offline/grant" ? 201 : 200,
      headers: { ...headers, ...extra },
      body: JSON.stringify(answer(requestBody)),
    })
  })
  return state
}
