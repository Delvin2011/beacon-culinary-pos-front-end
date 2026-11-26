// T1-8: two customers, each at its own address, each see their own name (GET /api/public/branding): /login, the tab
// title, the till's sign-in and header, and the printed receipt (the mock's receipt settings have no business name).
// A fresh address never shows another customer's name: the neutral "Canteen POS" until its own answer arrives.
// 127.0.0.1:3200 and localhost:3200 are the same server but two origins, so each has its own storage, as two
// customer addresses do.
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { createBackend, mockApi, type MockApi } from "./mock-api"

const RIVERSIDE = { url: "http://127.0.0.1:3200", name: "Riverside Canteen" }
const HILLTOP = { url: "http://localhost:3200", name: "Hilltop Canteen" }

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

async function customerContext(browser: Browser, url: string, name: string | null) {
  const context = await browser.newContext({ baseURL: url, serviceWorkers: "allow" })
  const backend = createBackend()
  backend.branding = name ? { name, logoUrl: null } : null
  await capturePrints(context)
  await mockApi(context, backend, url)
  return { context, backend, page: await context.newPage() }
}

async function sellCurryAtTill(page: Page, api: MockApi) {
  await page.goto("/pos/login")
  await page.getByRole("button", { name: /Thandi Mokoena/ }).click()
  for (const digit of "482913") await page.getByRole("button", { name: digit, exact: true }).click()
  await page.waitForURL(/\/pos$/)
  await page.getByRole("button", { name: /^Live curry/ }).first().click()
  await page.getByRole("button", { name: "Add To Order" }).click()
  await page.getByRole("button", { name: "Charge" }).click()
  await page.getByRole("button", { name: "Confirm Payment" }).click()
  await expect.poll(() => api.onlineSales.length).toBe(1)
}

test("two customers, each at its own address, each see their own name", async ({ browser }) => {
  const riverside = await customerContext(browser, RIVERSIDE.url, RIVERSIDE.name)
  const hilltop = await customerContext(browser, HILLTOP.url, HILLTOP.name)
  try {
    for (const [customer, other] of [
      [{ ...RIVERSIDE, ...riverside }, HILLTOP],
      [{ ...HILLTOP, ...hilltop }, RIVERSIDE],
    ] as const) {
      const { page, backend, name } = customer
      await page.goto("/login")
      await expect(page.getByText(`Login to your ${name} Account`)).toBeVisible()
      await expect(page).toHaveTitle(name)

      await page.goto("/pos/login")
      await expect(page.getByTestId("customer-name")).toHaveText(name)
      await expect(page).toHaveTitle(name)

      await sellCurryAtTill(page, backend)
      await expect(page.getByTestId("customer-name").first()).toHaveText(name)
      await expect.poll(async () => (await printed(page)).length).toBeGreaterThan(0)
      const [receipt] = await printed(page)
      expect(receipt).toContain(name)
      expect(receipt).not.toContain(other.name)
      await expect(page.getByText(other.name)).toHaveCount(0)

      expect(backend.calls.filter((call) => call === "GET /public/branding").length).toBeGreaterThan(0)
      expect(backend.answeredByWorker).toEqual([])
    }
  } finally {
    await riverside.context.close()
    await hilltop.context.close()
  }
})

test("a fresh address shows the neutral name, never another customer's; a known one remembers its own", async ({ browser }) => {
  // One browser: Riverside's name is remembered at its address.
  const { context, page } = await customerContext(browser, RIVERSIDE.url, RIVERSIDE.name)
  try {
    await page.goto("/login")
    await expect(page.getByText(`Login to your ${RIVERSIDE.name} Account`)).toBeVisible()

    // Another address in the same browser, whose branding doesn't answer: the neutral name, not Riverside's.
    const elsewhere = createBackend()
    elsewhere.branding = null
    await mockApi(context, elsewhere, HILLTOP.url)
    await page.goto(`${HILLTOP.url}/login`)
    await expect(page.getByText("Login to your Canteen POS Account")).toBeVisible()
    await expect(page).toHaveTitle("Canteen POS")
    await expect(page.getByText(RIVERSIDE.name)).toHaveCount(0)

    // Back at Riverside with the server out of reach: its own remembered name.
    const pageAtRiverside = await context.newPage()
    const riversideBackend = createBackend()
    riversideBackend.offline = true
    await context.unrouteAll({ behavior: "ignoreErrors" })
    await mockApi(context, riversideBackend, RIVERSIDE.url)
    await pageAtRiverside.goto(`${RIVERSIDE.url}/login`)
    await expect(pageAtRiverside.getByText(`Login to your ${RIVERSIDE.name} Account`)).toBeVisible()
    await expect(pageAtRiverside).toHaveTitle(RIVERSIDE.name)
  } finally {
    await context.close()
  }
})
