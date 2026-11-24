// O3 e2e: the backend, mocked per the contracts, for one registered till (T1) with Thandi's open shift and offline on.
// `offline` makes every API call fail as if the network were down. T1-0d: the API is /api on the app's own origin,
// so there is no CORS; the answers are keyed by the backend path (the /api prefix removed, as Front Door does).
// O4: offline account sales are on, and POST /pos/offline/sales records every sale it receives.
// Main path (T1-0d follow-up): password sign-in with the refresh cookie, refresh, online sales (POST /orders) and the
// kitchen's queue and stream. One backend can serve several browser contexts (the till and the kitchen each keep
// their own sign-in): createBackend() once, then mockApi(context, backend) for each.
import type { BrowserContext, Request, Route } from "@playwright/test"
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

// An online sale: the body POST /orders received and the order it answered.
export interface OnlineSale {
  body: { lines: Array<{ dailyMealOptionId: number; quantity: number }>; payments: Array<{ method: string; amount: number; amountTendered?: number }> }
  order: { id: number; orderNumber: number; receiptNumber: string; total: number }
}

// One API request as the mock answered it: the access token it carried and the status it got.
export interface LoggedRequest {
  key: string
  token: string | null
  status: number
}

export interface MockApi {
  offline: boolean
  calls: string[]
  log: LoggedRequest[]
  // O4: every POST /pos/offline/sales body, and every status report.
  salesBatches: Array<{ grants: string[]; sales: SentSale[] }>
  statusReports: Array<Record<string, unknown>>
  // The sales received (once each, by clientOrderId), in the order they arrived.
  receivedSales: () => SentSale[]
  // T1-0d: API responses the service worker answered. Must stay empty: the worker never handles /api.
  answeredByWorker: string[]
  // Access tokens the server now treats as expired: any call with one gets 401 with an empty body.
  expiredTokens: Set<string>
  // Every POST /auth/refresh, with the refresh cookie it carried (null: none).
  refreshCalls: Array<{ refreshCookie: string | null }>
  onlineSales: OnlineSale[]
  // Order ids the kitchen stream sent, and the order ids each GET /kitchen/orders answered.
  kitchenStreamed: number[]
  kitchenSnapshots: number[][]
  // GET /kitchen/orders waits, once the stream has sent an order, until this is called: until then an order on the
  // kitchen display can only have come through the stream.
  releaseKitchenSnapshots: () => void
}

export const ADMIN = { email: "admin@e2e.test", password: "e2e-password", name: "Naledi Admin" }
export const KITCHEN_STAFF = { id: 30, name: "Sipho Dlamini" }
export const REFRESH_COOKIE = "e2e-refresh-1"

// An answer with its own status or headers; any other value is a 200 JSON body.
class Reply {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly headers: Record<string, string> = {},
  ) {}
}

type Answer = (body: unknown, request: Request) => unknown

// The kitchen's view of an order (OrderSummaryDto): kitchen lines only.
interface KitchenOrder {
  orderId: number
  orderNumber: number
  status: "PENDING"
  orderStatus: "PENDING"
  createdAt: string
  lines: Array<{ optionName: string; quantity: number; station: "KITCHEN"; extras: [] }>
  otherStations: []
}

interface Backend {
  api: MockApi
  answers: Record<string, Answer>
  orderById: (id: number) => unknown
  streamKitchen: (route: Route) => Promise<void>
  kitchenSnapshot: () => Promise<KitchenOrder[]>
}

const backends = new WeakMap<MockApi, Backend>()

export function createBackend(): MockApi {
  const recorded = new Map<string, SentSale>()
  let releaseSnapshots: () => void = () => {}
  const snapshotsReleased = new Promise<void>((resolve) => {
    releaseSnapshots = resolve
  })
  const api: MockApi = {
    offline: false,
    calls: [],
    log: [],
    salesBatches: [],
    statusReports: [],
    receivedSales: () => Array.from(recorded.values()),
    answeredByWorker: [],
    expiredTokens: new Set(),
    refreshCalls: [],
    onlineSales: [],
    kitchenStreamed: [],
    kitchenSnapshots: [],
    releaseKitchenSnapshots: () => releaseSnapshots(),
  }
  const now = () => Date.now()
  const today = jhbDay(now())
  let adminTokens = 0
  const adminToken = () => `e2e.admin.token-${++adminTokens}`

  const shift = {
    shiftId: 412,
    owner: { id: 17, name: "Thandi Mokoena", role: "CASHIER" },
    ownedByCaller: true,
    openedAt: new Date(now() - 2 * 3_600_000).toISOString(),
    openingFloat: 500,
    tillCode: "T1",
    tillName: "Till 1 (front)",
  }

  const liveMenu = [{ id: 701, mealPeriodId: 2, optionDate: today, name: "Live curry", price: 45, plannedPortions: 10, portionsRemaining: 5, group: "SET_MEALS" }]

  // Online sales (OrderDto) and the kitchen's queue. The stream sends each kitchen order once.
  const orders = new Map<number, Record<string, unknown>>()
  const kitchenQueue: KitchenOrder[] = []
  const waitingStreams: Route[] = []

  function sendWaitingStreams() {
    const unsent = kitchenQueue.filter((order) => !api.kitchenStreamed.includes(order.orderId))
    if (unsent.length === 0) return
    for (const route of waitingStreams.splice(0)) {
      const body = unsent.map((order) => `data: ${JSON.stringify({ eventType: "ORDER_CREATED", order })}\n\n`).join("")
      // A stream the browser already gave up on (its 15 s wait for headers) can't be answered; the next one is.
      route
        .fulfill({ status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }, body })
        .then(() => {
          for (const order of unsent) if (!api.kitchenStreamed.includes(order.orderId)) api.kitchenStreamed.push(order.orderId)
        })
        .catch(() => {})
    }
  }

  // Each answer may read the request's JSON body.
  const answers: Record<string, Answer> = {
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
    "GET /users/login-tiles": () => [{ id: KITCHEN_STAFF.id, name: KITCHEN_STAFF.name }],
    "POST /auth/pin-login": (body) =>
      (body as { cashierId?: number } | null)?.cashierId === KITCHEN_STAFF.id
        ? { token: "e2e.kitchen.token", user: { name: KITCHEN_STAFF.name, role: "KITCHEN" } }
        : { token: "e2e.access.token", user: { name: "Thandi Mokoena", role: "CASHIER" } },
    // Password sign-in: the refresh cookie is scoped to /api/auth/refresh, as the backend sets it with
    // cookie.path-prefix=/api (T1-0d).
    "POST /auth/login": (body) => {
      const { email, password } = (body ?? {}) as { email?: string; password?: string }
      if (email !== ADMIN.email || password !== ADMIN.password) return new Reply(401, { error: "Invalid email or password." })
      return new Reply(
        200,
        { token: adminToken(), user: { email: ADMIN.email, name: ADMIN.name, role: "ADMIN" } },
        { "Set-Cookie": `refreshToken=${REFRESH_COOKIE}; Path=/api/auth/refresh; HttpOnly; SameSite=Strict` },
      )
    },
    "POST /auth/refresh": async (_body, request) => {
      const cookies = (await request.headerValue("cookie")) ?? ""
      const refreshCookie = /(?:^|;\s*)refreshToken=([^;]*)/.exec(cookies)?.[1] ?? null
      api.refreshCalls.push({ refreshCookie })
      if (refreshCookie !== REFRESH_COOKIE) return new Reply(401, null)
      return { token: adminToken() }
    },
    "POST /auth/logout": () => new Reply(204, null),
    "GET /admin/dashboard/layout": () => ({ asOf: new Date().toISOString(), sections: [] }),
    "GET /shifts/open": () => shift,
    "POST /pos/offline/grant": () =>
      new Reply(201, {
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
    "GET /pos/offline/snapshot": () =>
      new Reply(
        200,
        {
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
        },
        { ETag: '"e2e-v1"' },
      ),
    "POST /pos/offline/status": (body) => {
      api.statusReports.push(body as Record<string, unknown>)
      return { receivedAt: new Date().toISOString(), clockSkewMs: 0, serverTimeUtc: new Date().toISOString() }
    },
    // O4: every sale CREATED (a resent one comes back DUPLICATE), with the order the server would make.
    "POST /pos/offline/sales": (body) => {
      const batch = body as { grants: string[]; sales: SentSale[] }
      api.salesBatches.push(batch)
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
    // An online sale: the order (OrderDto with O2b's receipt data), priced from today's menu, all kitchen lines.
    "POST /orders": (body) => {
      const sale = body as OnlineSale["body"]
      const seq = api.onlineSales.length + 1
      const id = 7700 + seq
      const orderNumber = 40 + seq
      const lines = sale.lines.map((line, index) => {
        const option = liveMenu.find((item) => item.id === line.dailyMealOptionId)
        const unitPrice = option?.price ?? 0
        return { id: index + 1, dailyMealOptionId: line.dailyMealOptionId, station: "KITCHEN", name: option?.name ?? "Unknown",
          unitPrice, quantity: line.quantity, lineTotal: unitPrice * line.quantity, extras: [] }
      })
      const total = lines.reduce((sum, line) => sum + line.lineTotal, 0)
      const createdAt = new Date().toISOString().replace("Z", "")
      const order = {
        id,
        orderNumber,
        receiptNumber: `${today.replaceAll("-", "")}-${String(orderNumber).padStart(4, "0")}`,
        createdAt,
        status: "PENDING",
        orderKind: "SALE",
        tillCode: "T1",
        tillName: "Till 1 (front)",
        cashierName: "Thandi Mokoena",
        subtotal: total,
        total,
        originalTotal: total,
        vatRate: 0.15,
        vatIncludedAmount: Math.round((total * 15) / 115 * 100) / 100,
        lines,
        payments: sale.payments.map((payment, index) => ({ id: 900 + index, ...payment })),
        stations: [{ station: "KITCHEN", status: "PENDING" }],
      }
      orders.set(id, order)
      api.onlineSales.push({ body: sale, order })
      kitchenQueue.push({
        orderId: id,
        orderNumber,
        status: "PENDING",
        orderStatus: "PENDING",
        createdAt,
        lines: lines.map((line) => ({ optionName: line.name, quantity: line.quantity, station: "KITCHEN", extras: [] })),
        otherStations: [],
      })
      sendWaitingStreams()
      return new Reply(201, order)
    },
    "GET /meal-periods": () => [{ id: 2, name: "Lunch", startTime: "00:00:00", endTime: "23:59:59", plannable: true }],
    "GET /menu/today": () => ({ options: liveMenu, availableExtras: [] }),
    // The synced offline sales, as GET /orders/today returns them (OrderDto with O4's fields).
    "GET /orders/today": () =>
      api.receivedSales().map((sale) => ({
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

  backends.set(api, {
    api,
    answers,
    orderById: (id) => orders.get(id),
    // The kitchen stream: held open (no answer) until there is an order it hasn't sent, then sent as one event each.
    streamKitchen: async (route) => {
      waitingStreams.push(route)
      sendWaitingStreams()
    },
    // The kitchen queue: only orders the stream has sent, and only once the test releases it (see MockApi).
    kitchenSnapshot: async () => {
      if (api.kitchenStreamed.length > 0) await snapshotsReleased
      const sent = kitchenQueue.filter((order) => api.kitchenStreamed.includes(order.orderId))
      api.kitchenSnapshots.push(sent.map((order) => order.orderId))
      return sent
    },
  })
  return api
}

// Serves `backend` (a new one if none is given) to this browser context.
export async function mockApi(context: BrowserContext, backend: MockApi = createBackend()): Promise<MockApi> {
  const { api, answers, orderById, streamKitchen, kitchenSnapshot } = backends.get(backend)!

  context.on("response", (response) => {
    if (response.fromServiceWorker() && response.url().startsWith(`${E2E_API_URL}/`)) api.answeredByWorker.push(response.url())
  })

  await context.route(`${E2E_API_URL}/**`, async (route) => {
    const request = route.request()
    const backendPath = new URL(request.url()).pathname.replace(/^\/api(?=\/)/, "")
    if (api.offline) return route.abort("internetdisconnected")
    const key = `${request.method()} ${backendPath}`
    api.calls.push(key)
    const token = /^Bearer (.+)$/.exec(request.headers()["authorization"] ?? "")?.[1] ?? null
    const answerWith = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      api.log.push({ key, token, status })
      return route.fulfill({
        status,
        headers: { "Content-Type": "application/json", ...headers },
        body: body === null ? "" : JSON.stringify(body),
      })
    }

    // An expired access token: 401 with an empty body, which is what makes the app refresh.
    if (token && api.expiredTokens.has(token) && !backendPath.startsWith("/auth/")) return answerWith(401, null)

    if (key === "GET /kitchen/orders/stream") {
      api.log.push({ key, token, status: 200 })
      return streamKitchen(route)
    }
    if (key === "GET /kitchen/orders") return answerWith(200, await kitchenSnapshot())
    const orderId = /^GET \/orders\/(\d+)$/.exec(key)?.[1]
    if (orderId && orderById(Number(orderId))) return answerWith(200, orderById(Number(orderId)))

    const answer = answers[key]
    if (!answer) return answerWith(200, {})
    const postData = request.postData()
    const requestBody = postData ? (JSON.parse(postData) as unknown) : null
    const result = await answer(requestBody, request)
    if (result instanceof Reply) return answerWith(result.status, result.body, result.headers)
    return answerWith(200, result)
  })
  return api
}
