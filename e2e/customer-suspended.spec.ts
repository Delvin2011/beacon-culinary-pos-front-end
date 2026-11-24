// T1-3: the POS receiving CUSTOMER_SUSPENDED mid-shift, in a real browser on the production build. The cashier is
// signed in, offline-ready, with a cart. The customer is then suspended (every path answers 503 CUSTOMER_SUSPENDED,
// /health included): the full-page message shows, the till does not go offline or sell offline, and nothing else
// is called. When the customer is active again, Try again brings the till back: same cashier, same cart, online.
import { expect, test, type Page } from "@playwright/test"
import { mockApi } from "./mock-api"

const SUSPENDED_MESSAGE = "This service is currently unavailable for this site. Please contact your administrator."

async function signInAtTill(page: Page) {
  await page.goto("/pos/login")
  await page.getByRole("button", { name: /Thandi Mokoena/ }).click()
  for (const digit of "482913") await page.getByRole("button", { name: digit, exact: true }).click()
  await page.waitForURL(/\/pos$/)
  await expect(page.getByText("Live curry").first()).toBeVisible()
}

// The till's own elements, found even while the screen is hidden under the message (inert, aria-hidden).
const indicator = (page: Page, label: string) => page.locator(`[aria-label="Connection: ${label}"]`)
const curryInCart = (page: Page) => page.getByText("Live curry")

test("the POS receiving CUSTOMER_SUSPENDED mid-shift shows the message and doesn't go offline", async ({ context, page }) => {
  test.setTimeout(180_000)
  const api = await mockApi(context)

  // ---- Mid-shift: signed in, offline-ready, one item in the cart ----
  await signInAtTill(page)
  await expect(page.getByText("Offline ready")).toBeVisible({ timeout: 30_000 })
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 })
  await page.getByRole("button", { name: /^Live curry/ }).first().click()
  await page.getByRole("button", { name: "Add To Order" }).click()
  const curryCount = await curryInCart(page).count()
  expect(curryCount).toBeGreaterThan(1) // the tile and the cart line

  // ---- The customer is suspended: the next call (at the latest the 25 s ping) gets 503 CUSTOMER_SUSPENDED ----
  api.customer = "suspended"
  const dialog = page.getByRole("alertdialog")
  await expect(dialog).toBeVisible({ timeout: 40_000 })
  await expect(dialog).toContainText(SUSPENDED_MESSAGE)
  await expect(dialog.getByRole("button", { name: "Try again" })).toBeVisible()
  await expect(indicator(page, "Service suspended")).toHaveCount(1)

  // Nothing else is called for the next 30 s (more than a ping interval; the recovery check comes after 45 to 75 s),
  // and the till neither goes offline nor sells offline.
  await page.waitForTimeout(1_000)
  const callsWhenSuspended = api.calls.length
  await page.waitForTimeout(30_000)
  expect(api.calls.slice(callsWhenSuspended)).toEqual([])
  await expect(indicator(page, "Service suspended")).toHaveCount(1)
  await expect(page.locator('[aria-label^="Connection: Offline"], [aria-label^="Connection: Server unavailable"]')).toHaveCount(0)
  await expect(page.getByText(/Selling offline/)).toHaveCount(0)
  expect(api.receivedSales()).toEqual([])

  // ---- Active again: Try again ends it; the same cashier, the same cart, online ----
  api.customer = "active"
  await dialog.getByRole("button", { name: "Try again" }).click()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/\/pos$/)
  await expect(curryInCart(page)).toHaveCount(curryCount)
  await expect(indicator(page, "online")).toHaveCount(1, { timeout: 30_000 })
  await expect(page.getByText(/Thandi Mokoena/).first()).toBeVisible()

  // The service worker answered no API call, the suspended answers included.
  expect(api.answeredByWorker).toEqual([])
})
