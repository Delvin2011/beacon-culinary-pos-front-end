// T1-0d follow-up: the main paths, online, against the mock API at /api on the app's own address (before T1-3 changes
// request routing). Password sign-in and staying signed in after the access token expires (refresh through
// /api/auth/refresh with its cookie); PIN sign-in on a registered till and a cash sale with the receipt printed; the
// kitchen display getting that order through its stream. None of the API calls may be answered by the service worker.
import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { ADMIN, KITCHEN_STAFF, REFRESH_COOKIE, createBackend, mockApi, type MockApi } from "./mock-api"
import { E2E_APP_URL } from "./urls"

// The receipt printer: print() records what the print area held, then returns as after the dialog closes.
async function capturePrints(context: BrowserContext) {
  await context.addInitScript(() => {
    const printed: string[] = []
    Object.assign(window, { __printed: printed })
    window.print = () => {
      printed.push(document.querySelector(".print-portal")?.textContent ?? "")
      window.dispatchEvent(new Event("afterprint"))
    }
  })
}
const printed = (page: Page) => page.evaluate(() => (window as unknown as { __printed: string[] }).__printed)

async function typePin(page: Page, pin: string) {
  for (const digit of pin) await page.getByRole("button", { name: digit, exact: true }).click()
}

async function signInAtTill(page: Page) {
  await page.goto("/pos/login")
  await page.getByRole("button", { name: /Thandi Mokoena/ }).click()
  await typePin(page, "482913")
  await page.waitForURL(/\/pos$/)
  await expect(page.getByText("Live curry")).toBeVisible()
}

// One Live curry, paid in cash (the tendered amount starts at the total). Returns once the till shows the order.
async function sellCurryForCash(page: Page, api: MockApi) {
  await page.getByRole("button", { name: /^Live curry/ }).first().click()
  await page.getByRole("button", { name: "Add To Order" }).click()
  await page.getByRole("button", { name: "Charge" }).click()
  await page.getByRole("button", { name: "Confirm Payment" }).click()
  await expect.poll(() => api.onlineSales.length).toBe(1)
  const { order } = api.onlineSales[0]
  await expect(page.getByText(`#${order.orderNumber}`).first()).toBeVisible()
  return order
}

const storedToken = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem("bar-talk.auth") ?? "{}") as { token?: string }).token ?? null)

test("password sign-in, then still signed in after the access token expires (refresh through /api/auth/refresh)", async ({ context, page }) => {
  const api = await mockApi(context)
  const imageRequests: string[] = []
  page.on("request", (request) => {
    if (request.resourceType() === "image") imageRequests.push(new URL(request.url()).pathname)
  })

  await page.goto("/login")
  // T1-8: no built-in picture (it showed one customer's brand), and no logo when the customer has none.
  await expect(page.getByText("Login to your Mock Canteen Account")).toBeVisible()
  await expect(page.locator("img")).toHaveCount(0)

  await page.getByLabel("Email").fill(ADMIN.email)
  await page.getByLabel("Password").fill(ADMIN.password)
  await page.getByRole("button", { name: "Login" }).click()
  await page.waitForURL(/\/dashboard/)
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()
  await expect.poll(() => api.log.some((entry) => entry.key === "GET /admin/dashboard/layout" && entry.status === 200)).toBe(true)
  expect(await storedToken(page)).toBe("e2e.admin.token-1")

  // The refresh cookie: HttpOnly, sent only to /api/auth/refresh.
  const refreshCookie = (await context.cookies()).find((cookie) => cookie.name === "refreshToken")
  expect(refreshCookie).toMatchObject({ value: REFRESH_COOKIE, path: "/api/auth/refresh", httpOnly: true })

  // The access token expires. A reload calls the API with it, gets 401, refreshes once and retries with the new token.
  api.expiredTokens.add("e2e.admin.token-1")
  const before = api.log.length
  await page.reload()
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()
  await expect
    .poll(() => api.log.slice(before).some((entry) => entry.key === "GET /admin/dashboard/layout" && entry.token === "e2e.admin.token-2" && entry.status === 200))
    .toBe(true)
  const afterReload = api.log.slice(before)
  expect(afterReload).toContainEqual({ key: "GET /admin/dashboard/layout", token: "e2e.admin.token-1", status: 401 })
  expect(api.refreshCalls).toEqual([{ refreshCookie: REFRESH_COOKIE }])
  expect(await storedToken(page)).toBe("e2e.admin.token-2")
  await expect(page.getByText(/session has expired/i)).toHaveCount(0)
  await expect(page).toHaveURL(/\/dashboard/)

  expect(imageRequests.filter((path) => path.startsWith("/_next/image"))).toEqual([])
  expect(api.answeredByWorker).toEqual([])
})

test("PIN sign-in on a registered till, a cash sale and its printed receipt", async ({ context, page }) => {
  await capturePrints(context)
  const api = await mockApi(context)

  await signInAtTill(page)
  const order = await sellCurryForCash(page, api)

  const [sale] = api.onlineSales
  expect(sale.body.lines).toEqual([expect.objectContaining({ dailyMealOptionId: 701, quantity: 1 })])
  expect(sale.body.payments).toEqual([expect.objectContaining({ method: "CASH", amount: 45, amountTendered: 45 })])
  expect(api.log).toContainEqual({ key: "POST /orders", token: "e2e.access.token", status: 201 })

  // The receipt prints first (then the kitchen ticket, as the line is a kitchen item).
  await expect.poll(async () => (await printed(page)).length).toBe(2)
  const [receipt, ticket] = await printed(page)
  expect(receipt).toContain(`Receipt ${order.receiptNumber}`)
  expect(receipt).toContain("Live curry")
  expect(receipt).toMatch(/Cash/)
  expect(ticket).toContain("1 x Live curry")

  expect(api.answeredByWorker).toEqual([])
})

test("the kitchen display gets the till's order through its stream", async ({ browser }) => {
  const backend = createBackend()
  // Contexts made here don't take the config's `use` options: the same ones, given.
  const options = { baseURL: E2E_APP_URL, serviceWorkers: "allow" as const }
  const till = await browser.newContext(options)
  const kitchen = await browser.newContext(options)
  try {
    await capturePrints(till)
    await mockApi(till, backend)
    await mockApi(kitchen, backend)
    const tillPage = await till.newPage()
    const kitchenPage = await kitchen.newPage()

    await signInAtTill(tillPage)

    await kitchenPage.goto("/kitchen/login")
    await kitchenPage.getByRole("button", { name: new RegExp(KITCHEN_STAFF.name) }).click()
    await typePin(kitchenPage, "551234")
    await kitchenPage.waitForURL(/\/kitchen$/)
    // The board is up and its stream is open, waiting.
    await expect.poll(() => backend.log.some((entry) => entry.key === "GET /kitchen/orders/stream" && entry.token === "e2e.kitchen.token")).toBe(true)
    expect(backend.kitchenSnapshots.every((ids) => ids.length === 0)).toBe(true)

    const order = await sellCurryForCash(tillPage, backend)
    const soldAt = Date.now()
    await expect(kitchenPage.getByText(`#${order.orderNumber}`)).toBeVisible({ timeout: 5_000 })
    expect(Date.now() - soldAt).toBeLessThan(5_000)
    await expect(kitchenPage.getByText("Live curry")).toBeVisible()
    // Only the stream could have brought it: every queue load so far answered no orders.
    expect(backend.kitchenStreamed).toEqual([order.id])
    expect(backend.kitchenSnapshots.every((ids) => ids.length === 0)).toBe(true)

    // The board reloads its queue after the stream (the mock's ends after each event); the order stays.
    backend.releaseKitchenSnapshots()
    await expect.poll(() => backend.kitchenSnapshots.some((ids) => ids.includes(order.id)), { timeout: 15_000 }).toBe(true)
    await expect(kitchenPage.getByText(`#${order.orderNumber}`)).toBeVisible()

    expect(backend.answeredByWorker).toEqual([])
  } finally {
    await till.close()
    await kitchen.close()
  }
})
