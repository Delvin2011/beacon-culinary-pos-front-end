// T1-10: two customers at two addresses never share anything on the device or on screen, proven in a real browser
// against the REAL local stack (multi mode), not the mock API. Opt-in (playwright.config.ts): it runs only with
// STACK_E2E=1 and both addresses, which must be https://<name>.pos.localhost; otherwise it is skipped, saying why.
// Settings (environment only, never written or printed): STACK_E2E_A_URL, STACK_E2E_B_URL, STACK_E2E_A_EMAIL,
// STACK_E2E_B_EMAIL (an ADMIN at each customer), STACK_E2E_PASSWORD. docs/2026-11-25-customer-responses.md, section 8.
//
// Through each customer's own admin API it sets up what the browser needs, every record named e2e-: e2e-cashier and
// e2e-kitchen (the same names at both customers), e2e-till-cashier and a till e2e-till-<run> for the offline sale.
// PINs are random for each run and never leave this process. The till is revoked and its shift closed at the end;
// staff are kept and reused (their PIN is set again). Sales stay until reset.ps1, as the smoke check's do.
// Assertions on secrets (tokens, cookies, PINs) compare inside the test and report only what failed, never the value.
import { randomInt } from "node:crypto"
import { expect, request, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test"

const env = (name: string) => (process.env[name] ?? "").trim()
const A_URL = env("STACK_E2E_A_URL").replace(/\/+$/, "")
const B_URL = env("STACK_E2E_B_URL").replace(/\/+$/, "")
const ENABLED = env("STACK_E2E") === "1" && A_URL !== "" && B_URL !== ""
const SKIP_REASON =
  "stack spec: runs only against the local stack; set STACK_E2E=1, STACK_E2E_A_URL and STACK_E2E_B_URL (docs/2026-11-25-customer-responses.md, section 8)"
// The local stack only: never a real customer's address.
const STACK_ADDRESS = /^https:\/\/[a-z0-9-]+\.pos\.localhost(:\d{1,5})?$/
const RUN = Date.now().toString(36)
const ITEM = /^Smoke check item/ // smoke.ps1 adds it at every customer (an always-on kitchen item)

test.describe.configure({ mode: "serial" })
test.skip(!ENABLED, SKIP_REASON)
// A stuck step fails on its own, with a screenshot, rather than at the test's time limit.
test.use({ actionTimeout: 30_000, navigationTimeout: 30_000, screenshot: "only-on-failure" })

interface Person {
  id: number
  name: string
  pin: string
}
interface Customer {
  label: "A" | "B"
  url: string
  email: string
  api: APIRequestContext
  name: string // GET /public/branding
  receiptName: string // the receipt settings' business name, else the customer's name (T1-8)
  cashier: Person
  kitchen: Person
}

let A: Customer
let B: Customer

// ---- Setup through each customer's own admin API ----

function refuseUnlessStack() {
  for (const url of [A_URL, B_URL]) {
    if (!STACK_ADDRESS.test(url)) throw new Error(`stack spec refuses to run: ${url} is not https://<name>.pos.localhost`)
  }
  if (A_URL === B_URL) throw new Error("stack spec refuses to run: the two addresses are the same")
  const missing = ["STACK_E2E_A_EMAIL", "STACK_E2E_B_EMAIL", "STACK_E2E_PASSWORD"].filter((name) => env(name) === "")
  if (missing.length) throw new Error(`stack spec: set ${missing.join(", ")} in the environment`)
}

// The admin API calls run in Node, which doesn't read the Windows certificate store, so it can't verify Caddy's local
// certificate authority. These calls go only to *.pos.localhost (refuseUnlessStack); the browser still verifies it.
const API_OPTIONS = { ignoreHTTPSErrors: true }

async function adminApi(url: string, email: string): Promise<APIRequestContext> {
  const anonymous = await request.newContext({ baseURL: url, ...API_OPTIONS })
  try {
    const res = await anonymous.post("/api/auth/login", { data: { email, password: env("STACK_E2E_PASSWORD") } })
    if (!res.ok()) throw new Error(`stack spec: admin sign-in at ${url} answered ${res.status()}`)
    const body = (await res.json()) as { token?: string; accessToken?: string }
    const token = body.token ?? body.accessToken
    if (!token) throw new Error(`stack spec: admin sign-in at ${url} returned no token`)
    return request.newContext({ baseURL: url, ...API_OPTIONS, extraHTTPHeaders: { Authorization: `Bearer ${token}` } })
  } finally {
    await anonymous.dispose()
  }
}

async function json<T>(api: APIRequestContext, path: string): Promise<T> {
  const res = await api.get(path)
  if (!res.ok()) throw new Error(`stack spec: GET ${path} answered ${res.status()}`)
  return (await res.json()) as T
}

// The backend's own words for a refusal ({ code, error }, or the staff API's { field: message }); never the request.
async function refusal(res: { status(): number; json(): Promise<unknown> }): Promise<string> {
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  const parts = Object.entries(body ?? {})
    .filter(([, value]) => typeof value === "string")
    .map(([key, value]) => `${key}: ${value as string}`)
  return `${res.status()}${parts.length ? ` (${parts.join("; ")})` : ""}`
}

// Six digits, never all the same digit.
function newPin(): string {
  for (;;) {
    const pin = String(randomInt(0, 1_000_000)).padStart(6, "0")
    if (!/^(\d)\1{5}$/.test(pin)) return pin
  }
}

// Finds the e2e person by name (PIN-only roles have no email), or creates it, and gives it a new PIN for this run.
async function ensurePerson(api: APIRequestContext, name: string, role: string): Promise<Person> {
  const pin = newPin()
  const staff = await json<Array<{ id: number; name: string; role: string }>>(api, "/api/admin/staff")
  const found = staff.find((person) => person.name === name && person.role === role)
  if (found) {
    const res = await api.post(`/api/admin/staff/${found.id}/pin`, { data: { pin } })
    if (!res.ok()) throw new Error(`stack spec: setting ${name}'s PIN answered ${await refusal(res)}`)
    return { id: found.id, name, pin }
  }
  const res = await api.post("/api/admin/staff", { data: { name, role, setup: "SET_NOW", pin } })
  if (!res.ok()) throw new Error(`stack spec: creating ${name} answered ${await refusal(res)}`)
  const created = (await res.json()) as { id: number }
  return { id: created.id, name, pin }
}

async function setUpCustomer(label: "A" | "B", url: string, email: string): Promise<Customer> {
  const api = await adminApi(url, email)
  const { name } = await json<{ name: string }>(api, "/api/public/branding")
  const settings = await json<{ businessName: string | null }>(api, "/api/pos/receipt-settings")
  const menu = JSON.stringify(await json<unknown>(api, "/api/menu/today"))
  if (!menu.includes("Smoke check item")) throw new Error(`stack spec: ${url} has no "Smoke check item" today; run smoke.ps1 first`)
  return {
    label,
    url,
    email,
    api,
    name,
    receiptName: settings.businessName?.trim() || name,
    cashier: await ensurePerson(api, "e2e-cashier", "CASHIER"),
    kitchen: await ensurePerson(api, "e2e-kitchen", "KITCHEN"),
  }
}

// The e2e records this spec can undo: open shifts of e2e- people are closed (uncounted: nobody counted a drawer), then e2e- tills are
// revoked. Before the tests (a failed run's leftovers) and after them. Other people's shifts and tills are never touched.
async function cleanUpE2e(customer: Customer) {
  const tills = await json<Array<{ shift: { shiftId: number; ownerName: string } | null }>>(customer.api, "/api/admin/tills")
  for (const till of tills) {
    if (!till.shift?.ownerName.startsWith("e2e-")) continue
    const res = await customer.api.post(`/api/admin/shifts/${till.shift.shiftId}/force-close`, { data: { reason: "e2e cleanup" } })
    if (!res.ok()) throw new Error(`stack spec: closing an e2e shift at ${customer.url} answered ${await refusal(res)}`)
  }
  const devices = await json<Array<{ id: string; name: string; status?: string }>>(customer.api, "/api/admin/devices")
  for (const device of devices.filter((d) => d.name.startsWith("e2e-till-") && d.status !== "REVOKED")) {
    const res = await customer.api.post(`/api/admin/devices/${device.id}/revoke`, { data: { reason: "e2e cleanup" } })
    if (!res.ok()) throw new Error(`stack spec: revoking ${device.name} at ${customer.url} answered ${await refusal(res)}`)
  }
}

test.beforeAll(async () => {
  refuseUnlessStack()
  A = await setUpCustomer("A", A_URL, env("STACK_E2E_A_EMAIL"))
  B = await setUpCustomer("B", B_URL, env("STACK_E2E_B_EMAIL"))
  expect(A.name, "the two customers have different names").not.toBe(B.name)
  await cleanUpE2e(A)
  await cleanUpE2e(B)
})

// After each test, so the next one's cashier has no shift left open on the last test's till.
test.afterEach(async () => {
  for (const customer of [A, B]) if (customer) await cleanUpE2e(customer)
})

test.afterAll(async () => {
  for (const customer of [A, B]) await customer?.api.dispose()
})

// ---- Browser helpers ----

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

async function newContext(browser: Browser, url: string) {
  const context = await browser.newContext({ baseURL: url, serviceWorkers: "allow" })
  await capturePrints(context)
  return context
}

async function typePin(page: Page, pin: string) {
  for (const digit of pin) await page.getByRole("button", { name: digit, exact: true }).click()
}

// A sign-in tile: its name follows the avatar's initials ("E e2e-kitchen").
const tile = (page: Page, person: Person) => page.getByRole("button", { name: new RegExp(`(^|\\s)${person.name}$`) }).first()

// Registers this browser as a till of its own at the customer (a fresh password sign-in, as a manager does), then
// signs out to the POS. Every till the spec sells on is its own: another person's open shift never blocks it.
async function registerTill(page: Page, customer: Customer, suffix: string) {
  await page.goto(`${customer.url}/login?reauth=1&returnTo=${encodeURIComponent("/devices/register")}`)
  await page.getByLabel("Email").fill(customer.email)
  await page.getByLabel("Password").fill(env("STACK_E2E_PASSWORD"))
  await page.getByRole("button", { name: "Login" }).click()
  await page.waitForURL(/\/devices\/register/)
  await page.getByLabel("Till name").fill(`e2e-till-${RUN}-${suffix}`)
  await page.getByLabel(/^Serial number/).fill(`e2e-${RUN}-${suffix}`)
  await page.getByRole("button", { name: "Register this till" }).click()
  await expect(page.getByText(/now registered as/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: "Sign out and return to the POS" }).click()
  // The button signs out (the till stays registered) but then lands on the managers' sign-in, not the POS: the
  // page's admin guard redirects after its own navigation (an app bug outside T1-10, reported separately). Go there.
  await page.waitForURL(/\/login/)
  await page.goto(`${customer.url}/pos/login`)
}

// PIN sign-in at the till; opens the shift (zero float) when the cashier has none.
async function signInAtTill(page: Page, customer: Customer, person: Person) {
  await page.goto(`${customer.url}/pos/login`)
  await tile(page, person).click()
  await typePin(page, person.pin)
  // /pos first (its header can show briefly), then /pos/shift-open once the till status says there is no shift: wait
  // until the screen holds, either the open-shift screen or /pos still showing its shift 1.5 s later.
  const openShift = page.getByRole("button", { name: "Open Shift" })
  const shiftOpen = page.getByText("Shift Open", { exact: true })
  const onPos = async () => new URL(page.url()).pathname === "/pos" && (await shiftOpen.isVisible())
  const screen = async () => {
    if (await openShift.isVisible()) return "open-shift"
    if (!(await onPos())) return "settling"
    await page.waitForTimeout(1_500)
    return (await onPos()) && !(await openShift.isVisible()) ? "pos" : "settling"
  }
  await expect.poll(screen, { timeout: 30_000, intervals: [250] }).not.toBe("settling")
  if (await openShift.isVisible()) {
    await page.getByRole("button", { name: "0", exact: true }).click()
    await openShift.click()
    await expect(shiftOpen).toBeVisible({ timeout: 30_000 })
  }
}

async function signInAtKitchen(page: Page, customer: Customer, person: Person) {
  await page.goto(`${customer.url}/kitchen/login`)
  await tile(page, person).click()
  await typePin(page, person.pin)
  await page.waitForURL(/\/kitchen$/, { timeout: 30_000 })
}

async function addItemToCart(page: Page) {
  // The till opens on the current meal period; the always-on item is under All Day (waited for: the menu loads first).
  await page.getByRole("button", { name: /^All\s*Day$/ }).click()
  await page.getByRole("button", { name: ITEM }).first().click()
  // An item with extras opens a dialog first; this one goes straight into the order.
  const addToOrder = page.getByRole("button", { name: "Add To Order" })
  const cartLine = page.getByText("Qty", { exact: true })
  await expect(addToOrder.or(cartLine).first()).toBeVisible()
  if (await addToOrder.isVisible()) await addToOrder.click()
  await expect(cartLine.first()).toBeVisible()
}

// One Smoke check item paid in cash, online. Returns the order number the till shows.
async function sellOnline(page: Page): Promise<string> {
  await addItemToCart(page)
  await page.getByRole("button", { name: "Charge" }).click()
  await page.getByRole("button", { name: "Confirm Payment" }).click()
  await expect(page.getByRole("button", { name: "Next Customer" })).toBeVisible({ timeout: 30_000 })
  const number = (await page.getByText(/^#\d+$/).first().textContent())?.trim() ?? ""
  expect(number, "the till shows the order number").toMatch(/^#\d+$/)
  return number
}

// The order numbers on a kitchen display.
const kitchenOrders = (page: Page) => page.getByText(/^#\d+$/).allTextContents()

// Everything the page's address keeps on this device: both storages, every IndexedDB store, the service-worker caches.
interface DeviceState {
  origin: string
  local: Record<string, string | null>
  session: Record<string, string | null>
  idb: Record<string, unknown[]>
  caches: Record<string, string[]>
}
const deviceState = (page: Page): Promise<DeviceState> =>
  page.evaluate(async () => {
    const dump = (storage: Storage) =>
      Object.fromEntries(Array.from({ length: storage.length }, (_, i) => storage.key(i) as string).map((key) => [key, storage.getItem(key)]))
    const idb: Record<string, unknown[]> = {}
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(name)
        open.onsuccess = () => resolve(open.result)
        open.onerror = () => reject(open.error)
      })
      for (const store of Array.from(db.objectStoreNames)) {
        idb[`${name}/${store}`] = await new Promise<unknown[]>((resolve, reject) => {
          const all = db.transaction(store).objectStore(store).getAll()
          all.onsuccess = () => resolve(all.result)
          all.onerror = () => reject(all.error)
        })
      }
      db.close()
    }
    const caches: Record<string, string[]> = {}
    for (const key of await window.caches.keys()) caches[key] = (await (await window.caches.open(key)).keys()).map((r) => r.url)
    return { origin: location.origin, local: dump(localStorage), session: dump(sessionStorage), idb, caches }
  })

// Which of `secrets` (named) appear in `state`: the names only, never the values.
function leaked(state: unknown, secrets: Record<string, string>): string[] {
  const text = JSON.stringify(state)
  return Object.entries(secrets)
    .filter(([, value]) => value.length >= 4 && text.includes(value))
    .map(([name]) => name)
}

// Every cookie the browser keeps for an address, whatever its path (the refresh cookie's is /api/auth/refresh, so
// context.cookies(url) for the site's root would leave it out).
const cookiesOf = async (context: BrowserContext, url: string) => {
  const host = new URL(url).hostname
  return (await context.cookies()).filter((cookie) => cookie.domain.replace(/^\./, "") === host)
}

const storedToken = (state: DeviceState) => {
  const raw = state.local["bar-talk.auth"]
  return raw ? ((JSON.parse(raw) as { token?: string }).token ?? null) : null
}

// ---- The tests ----

test("each address shows its own name on sign-in, the till and a receipt; a sale reaches only its own kitchen", async ({ browser }) => {
  const tillA = await newContext(browser, A.url)
  const tillB = await newContext(browser, B.url)
  const kitchenA = await newContext(browser, A.url)
  const kitchenB = await newContext(browser, B.url)
  try {
    const [pageA, pageB, kA, kB] = await Promise.all([tillA.newPage(), tillB.newPage(), kitchenA.newPage(), kitchenB.newPage()])

    // Sign-in screens and the tab title.
    for (const [page, own, other] of [
      [pageA, A, B],
      [pageB, B, A],
    ] as const) {
      await page.goto(`${own.url}/login`)
      await expect(page.getByText(`Login to your ${own.name} Account`)).toBeVisible()
      await expect(page).toHaveTitle(own.name)
      await page.goto(`${own.url}/pos/login`)
      await expect(page.getByTestId("customer-name").first()).toHaveText(own.name)
      await expect(page.getByText(other.name)).toHaveCount(0)
    }

    // Both kitchens open (their streams running) before any sale.
    await signInAtKitchen(kA, A, A.kitchen)
    await signInAtKitchen(kB, B, B.kitchen)
    await expect(kA.getByTestId("customer-name").first()).toHaveText(A.name)
    await expect(kB.getByTestId("customer-name").first()).toHaveText(B.name)

    for (const [page, own, other, ownKitchen, otherKitchen] of [
      [pageA, A, B, kA, kB],
      [pageB, B, A, kB, kA],
    ] as const) {
      await registerTill(page, own, `sale-${own.label}`)
      await signInAtTill(page, own, own.cashier)
      await expect(page.getByTestId("customer-name").first()).toHaveText(own.name)
      await expect(page).toHaveTitle(own.name)

      const otherBefore = await kitchenOrders(otherKitchen)
      const printsBefore = (await printed(page)).length
      const number = await sellOnline(page)

      // The receipt: this customer's name, never the other's.
      await expect.poll(async () => (await printed(page)).length, { timeout: 15_000 }).toBeGreaterThan(printsBefore)
      const receipt = (await printed(page))[printsBefore]
      expect(receipt, `${own.label}'s receipt names ${own.label}`).toContain(own.receiptName)
      expect(receipt.includes(other.name), `${own.label}'s receipt names ${other.label}`).toBe(false)
      await expect(page.getByText(other.name)).toHaveCount(0)

      // Its own kitchen gets the order through its stream; the other kitchen gets nothing.
      await expect(ownKitchen.getByText(number, { exact: true })).toBeVisible({ timeout: 15_000 })
      await page.waitForTimeout(10_000)
      expect(await kitchenOrders(otherKitchen), `${other.label}'s kitchen received ${own.label}'s order`).toEqual(otherBefore)
      await expect(otherKitchen.getByText(own.name)).toHaveCount(0)
      await page.getByRole("button", { name: "Next Customer" }).click()
    }
  } finally {
    await Promise.all([tillA.close(), tillB.close(), kitchenA.close(), kitchenB.close()])
  }
})

test("device storage: what A keeps (tokens, cookies, cart, name, offline data, caches) is not visible at B", async ({ browser }) => {
  // One browser context, as one device used at both addresses.
  const context = await newContext(browser, A.url)
  try {
    const page = await context.newPage()
    const cookiesSentToB: string[] = []
    page.on("request", (req) => {
      if (req.url().startsWith(`${B.url}/`)) cookiesSentToB.push(req.headers()["cookie"] ?? "")
    })

    // At A: a cashier signed in at the till with an item in the cart; an admin's refresh cookie too.
    await page.goto(`${A.url}/login`)
    await page.getByLabel("Email").fill(A.email)
    await page.getByLabel("Password").fill(env("STACK_E2E_PASSWORD"))
    await page.getByRole("button", { name: "Login" }).click()
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    await registerTill(page, A, "storage-A")
    await signInAtTill(page, A, A.cashier)
    await addItemToCart(page)
    const atA = await deviceState(page)
    const aToken = storedToken(atA)
    expect(aToken, "A's till session is stored at A").toBeTruthy()
    const aCookies = await cookiesOf(context, A.url)
    expect(aCookies.some((cookie) => cookie.name === "refreshToken"), "A's refresh cookie is set").toBe(true)
    const secretsOfA: Record<string, string> = {
      "A's access token": aToken ?? "",
      "A's name": A.name,
      "A's admin email": A.email,
      ...Object.fromEntries(aCookies.map((cookie) => [`A's ${cookie.name} cookie`, cookie.value])),
    }

    // At B in the same browser, before anyone signs in there: nothing of A's.
    await page.goto(`${B.url}/login`)
    await expect(page.getByText(`Login to your ${B.name} Account`)).toBeVisible()
    await expect(page).toHaveTitle(B.name)
    const atB = await deviceState(page)
    expect(atB.origin).toBe(B.url)
    expect(leaked(atB, secretsOfA), "A's values found in B's storage").toEqual([])
    expect(storedToken(atB), "a session at B before signing in there").toBeNull()
    expect(atB.local["pos.pendingCart"] ?? null, "A's cart at B").toBeNull()
    const bBranding = atB.local["pos.customer-branding"]
    if (bBranding) expect((JSON.parse(bBranding) as { name: string }).name).toBe(B.name)
    for (const store of ["outbox", "grant", "snapshot", "unlockVerifier"]) {
      expect(atB.idb[`beacon-pos-offline/${store}`] ?? [], `B's ${store} before B is used`).toEqual([])
    }
    const bCacheUrls = Object.values(atB.caches).flat()
    expect(bCacheUrls.filter((url) => !url.startsWith(`${B.url}/`)), "B's caches hold another address's files").toEqual([])
    expect(bCacheUrls.filter((url) => url.includes("/api/")), "B's caches hold API answers").toEqual([])
    const bCookies = await cookiesOf(context, B.url)
    expect(bCookies.filter((cookie) => aCookies.some((a) => a.value === cookie.value)).map((c) => c.name), "A's cookies at B").toEqual([])

    // B used: its own till and session, never A's.
    await registerTill(page, B, "storage-B")
    await signInAtTill(page, B, B.cashier)
    await expect(page.getByTestId("customer-name").first()).toHaveText(B.name)
    const bUsed = await deviceState(page)
    expect(storedToken(bUsed), "B's own session").toBeTruthy()
    expect(storedToken(bUsed) === aToken, "B's session is A's token").toBe(false)
    expect(leaked(bUsed, secretsOfA), "A's values found in B's storage after B is used").toEqual([])
    expect(
      cookiesSentToB.filter((header) => aCookies.some((cookie) => header.includes(cookie.value))).length,
      "requests to B carried A's cookies",
    ).toBe(0)

    // Back at A: A's own session, cart and name, untouched by B.
    await page.goto(`${A.url}/pos`)
    await expect(page.getByTestId("customer-name").first()).toHaveText(A.name)
    const backAtA = await deviceState(page)
    expect(storedToken(backAtA), "A's session after B was used").toBeTruthy()
    expect(leaked(backAtA, { "B's name": B.name, "B's access token": storedToken(bUsed) ?? "" }), "B's values found at A").toEqual([])
    await expect(page.getByText(B.name)).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test("sessions: signing in at A, then at B, then back at A, each session is its own", async ({ browser }) => {
  const context = await newContext(browser, A.url)
  try {
    const page = await context.newPage()
    const signIn = async (customer: Customer) => {
      await page.goto(`${customer.url}/login`)
      await page.getByLabel("Email").fill(customer.email)
      await page.getByLabel("Password").fill(env("STACK_E2E_PASSWORD"))
      await page.getByRole("button", { name: "Login" }).click()
      await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
      await expect(page.getByText(customer.email).first()).toBeVisible()
    }
    const signedInAs = async (customer: Customer, other: Customer) => {
      await page.goto(`${customer.url}/dashboard`)
      await expect(page).toHaveURL(new RegExp(`^${customer.url.replace(/[.]/g, "\\.")}/dashboard`))
      await expect(page.getByText(customer.email).first()).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText(other.email)).toHaveCount(0)
      await expect(page.getByText(customer.name).first()).toBeVisible()
    }

    await signIn(A)
    await signIn(B)
    await signedInAs(A, B)
    await signedInAs(B, A)

    // Each refresh cookie belongs to its own address.
    const [aCookies, bCookies] = [await cookiesOf(context, A.url), await cookiesOf(context, B.url)]
    const aRefresh = aCookies.find((cookie) => cookie.name === "refreshToken")
    const bRefresh = bCookies.find((cookie) => cookie.name === "refreshToken")
    expect(aRefresh && bRefresh, "both addresses have their own refresh cookie").toBeTruthy()
    expect(aRefresh?.value === bRefresh?.value, "the two addresses share a refresh cookie").toBe(false)
    expect(new URL(A.url).hostname).toBe(aRefresh?.domain)
    expect(new URL(B.url).hostname).toBe(bRefresh?.domain)

    // Signing out at B leaves A signed in.
    await page.getByRole("button", { name: new RegExp(B.email.replace(/[.+]/g, "\\$&")) }).first().click()
    await page.getByRole("menuitem", { name: "Log out" }).click()
    await page.waitForURL(/\/login/, { timeout: 30_000 })
    await signedInAs(A, B)
  } finally {
    await context.close()
  }
})

test("an offline sale at A syncs into A only", async ({ browser }) => {
  const status = await json<{ offlineEnabled?: boolean }>(A.api, "/api/pos/till-status")
  test.skip(status.offlineEnabled !== true, "offline selling is off in the stack (POS_OFFLINE_ENABLED): backend request 1 in docs/2026-11-25-customer-responses.md, section 8")

  const tillName = `e2e-till-${RUN}-offline-A`
  const context = await newContext(browser, A.url)
  try {
    const page = await context.newPage()
    await registerTill(page, A, "offline-A")

    // Online and ready, then the connection drops mid-shift.
    await signInAtTill(page, A, A.cashier)
    await expect(page.getByText("Offline ready")).toBeVisible({ timeout: 60_000 })
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 })
    await context.setOffline(true)
    // Three failed connection checks: one at once, then one every 25 s (about 50 s), with margin for a loaded machine.
    await expect(page.getByText(/Selling offline/).first()).toBeVisible({ timeout: 150_000 })
    await addItemToCart(page)
    await page.getByRole("button", { name: "Charge" }).click()
    await page.getByRole("button", { name: "Confirm offline sale" }).click()
    await expect(page.getByText("Offline sale recorded")).toBeVisible()
    const collection = (await page.getByTestId("offline-collection-number").textContent())?.trim() ?? ""
    await page.getByRole("button", { name: "Next Customer" }).click()

    // Back online: it syncs.
    await context.setOffline(false)
    const outbox = async () => (await deviceState(page)).idb["beacon-pos-offline/outbox"] as Array<{ clientOrderId: string; status: string }>
    await expect.poll(async () => (await outbox()).map((entry) => entry.status), { timeout: 150_000 }).toContain("SYNCED")
    const synced = (await outbox()).filter((entry) => entry.status === "SYNCED").map((entry) => entry.clientOrderId)

    // Into A only: A's orders have it (its own till), B's have nothing from that till.
    type Order = { recordedOffline: boolean; collectionNumber: string | null; tillName: string | null }
    const aOrders = await json<Order[]>(A.api, "/api/orders/today")
    const atA = aOrders.find((order) => order.recordedOffline && order.tillName === tillName && order.collectionNumber === collection)
    expect(atA, "A has the offline sale").toBeTruthy()
    const bOrders = await json<Order[]>(B.api, "/api/orders/today")
    expect(bOrders.filter((order) => order.tillName === tillName).length, "B has A's offline sale").toBe(0)

    // B's offline storage, in this same browser, has none of A's outbox.
    await page.goto(`${B.url}/login`)
    const atB = await deviceState(page)
    expect(leaked(atB, Object.fromEntries(synced.map((id, i) => [`A's sale ${i + 1}`, id]))), "A's outbox at B").toEqual([])
    expect(atB.idb["beacon-pos-offline/outbox"] ?? [], "B's outbox").toEqual([])
  } finally {
    await context.close() // the shift and the till: cleanUpE2e after each test
  }
})
