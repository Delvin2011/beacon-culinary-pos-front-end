// O4: selling offline in a real browser. Online, the shift owner signs in and the till gets ready. The connection
// drops mid-shift: the till sells cash, card (slip reference) and account sales from the snapshot, keeps them through
// a reload, locks and unlocks with the PIN check value, sells again, and on reconnect sends them all with their grant,
// reports 0 waiting, and shows them as offline sales the server has.
import { expect, test, type Page } from "@playwright/test"
import { mockApi } from "./mock-api"

async function signInWithPin(page: Page, pin: string) {
  await page.goto("/pos/login")
  await page.getByRole("button", { name: /Thandi Mokoena/ }).click()
  await typePin(page, pin)
  await page.waitForURL(/\/pos$/)
}

async function typePin(page: Page, pin: string) {
  for (const digit of pin) await page.getByRole("button", { name: digit, exact: true }).click()
}

// The menu tile (the cart lists the name too).
const stewTile = (page: Page) => page.getByRole("button", { name: /^Beef stew/ }).first()

async function sellStew(page: Page, pay: (page: Page) => Promise<void>) {
  await stewTile(page).click()
  await page.getByRole("button", { name: "Add To Order" }).click()
  await page.getByRole("button", { name: "Charge" }).click()
  await pay(page)
  await page.getByRole("button", { name: "Confirm offline sale" }).click()
  await expect(page.getByText("Offline sale recorded")).toBeVisible()
  const collection = await page.getByTestId("offline-collection-number").textContent()
  await page.getByRole("button", { name: "Next Customer" }).click()
  return collection
}

const cash = async () => {}
const card = async (page: Page) => {
  await page.getByRole("button", { name: "Card", exact: true }).click()
  await page.getByLabel(/Card slip reference/).fill("004512")
}
const account = async (page: Page) => {
  await page.getByRole("button", { name: "Account", exact: true }).click()
  await page.getByRole("button", { name: /Finance Dept/ }).click()
}

// The outbox as the till holds it (IndexedDB), for checks only.
const outboxStatuses = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("beacon-pos-offline")
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const request = open.result.transaction("outbox").objectStore("outbox").getAll()
          request.onsuccess = () => resolve((request.result as Array<{ status: string }>).map((entry) => entry.status))
          request.onerror = () => reject(request.error)
        }
      }),
  )

test("offline mid-shift: sell cash, card and account, reload, lock and unlock, reconnect and sync", async ({ context, page }) => {
  // The connection indicator needs several pings (25 s apart) to change state, three times over.
  test.setTimeout(360_000)
  // The receipt printer: print() returns at once, as after the dialog closes.
  await context.addInitScript(() => {
    window.print = () => window.dispatchEvent(new Event("afterprint"))
  })
  const api = await mockApi(context)

  // ---- Online: ready ----
  await signInWithPin(page, "482913")
  await expect(page.getByText("Live curry")).toBeVisible()
  await expect(page.getByText("Offline ready")).toBeVisible({ timeout: 30_000 })
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 })

  // ---- The connection drops mid-shift (no reload): the snapshot's tiles become sellable ----
  api.offline = true
  await context.setOffline(true)
  await expect(page.getByText(/Selling offline: discounts, complimentary/)).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText("Live curry")).toHaveCount(0)

  expect(await sellStew(page, cash)).toBe("T1-1")
  expect(await sellStew(page, card)).toBe("T1-2")
  expect(await sellStew(page, account)).toBe("T1-3")
  await expect(page.getByText(/3 sales waiting to send/)).toBeVisible()
  // Online-only actions say so.
  await stewTile(page).click()
  await page.getByRole("button", { name: "Add To Order" }).click()
  await expect(page.getByRole("button", { name: /^Complimentary/ })).toBeDisabled()
  await page.getByRole("button", { name: /Clear/ }).first().click()

  // ---- Reload while offline: the sales are still there ----
  await page.reload()
  await expect(page).toHaveURL(/\/pos$/)
  expect(await outboxStatuses(page)).toEqual(["PENDING", "PENDING", "PENDING"])
  // After a reload the connection indicator starts online and needs 3 failed pings (25 s apart) to say offline.
  await expect(page.getByText(/3 sales waiting to send/)).toBeVisible({ timeout: 90_000 })

  // ---- Lock, then unlock offline with the PIN; the next sale is marked unlockedOffline ----
  await page.getByRole("button", { name: "Lock till" }).click()
  await page.waitForURL(/\/pos\/login/)
  await expect(page.getByText("Enter your PIN")).toBeVisible({ timeout: 30_000 })
  await typePin(page, "482913")
  await page.waitForURL(/\/pos$/, { timeout: 30_000 })
  await expect(page.getByText(/Selling offline/)).toBeVisible({ timeout: 30_000 })
  expect(await sellStew(page, cash)).toBe("T1-4")
  await expect(page.getByText(/4 sales waiting to send/)).toBeVisible()

  // ---- Back online: the outbox is sent and emptied ----
  api.offline = false
  await context.setOffline(false)
  await expect.poll(() => api.receivedSales().length, { timeout: 120_000 }).toBe(4)
  await expect.poll(() => outboxStatuses(page), { timeout: 30_000 }).toEqual(["SYNCED", "SYNCED", "SYNCED", "SYNCED"])

  const [batch] = api.salesBatches
  expect(batch.grants).toEqual(["opaque.e2e.grant"])
  const sales = api.receivedSales()
  expect(sales.map((sale) => sale.collectionNumber)).toEqual(["T1-1", "T1-2", "T1-3", "T1-4"])
  expect(sales.map((sale) => sale.payments[0].method)).toEqual(["CASH", "CARD", "ACCOUNT", "CASH"])
  expect(sales[1].payments[0]).toMatchObject({ cardReference: "004512" })
  expect(sales[2].payments[0]).toMatchObject({ accountId: 5 })
  expect(sales.map((sale) => sale.unlockedOffline)).toEqual([false, false, false, true])
  expect(sales.every((sale) => sale.grantId === "e2e-grant" && sale.shiftId === 412 && sale.cashierId === 17)).toBe(true)

  // A status report after the sync says nothing is waiting.
  await expect.poll(() => api.statusReports.some((report) => report.pendingCount === 0 && typeof report.lastSyncAt === "string"), { timeout: 60_000 }).toBe(true)

  // Decision B: the offline session (after the offline unlock) ends once online; the cashier signs in again. The sync
  // above didn't need it (till cookie only).
  await page.waitForURL(/\/pos\/login/, { timeout: 60_000 })
  await page.getByRole("button", { name: /Thandi Mokoena/ }).click()
  await typePin(page, "482913")
  await page.waitForURL(/\/pos$/)

  // Today's Orders (online) shows them as offline sales the server has.
  await page.getByRole("button", { name: /Today's Orders/ }).first().click()
  await expect(page.getByText("Collection T1-4").first()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText("Offline sale").first()).toBeVisible()

  // T1-0d: the service worker answered none of the API calls (sync, status reports, snapshot, sign-in).
  expect(api.answeredByWorker).toEqual([])
})
