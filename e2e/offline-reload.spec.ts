// O3: the POS survives a reload with no connection. Online, the owner of the till's shift signs in with a PIN; the
// till gets its grant and snapshot and the service worker caches the POS shell (and only that). Offline, a reload
// lands on the POS with the cashier, the restored shift and the snapshot menu (read-only), with no redirect.
import { expect, test, type Page } from "@playwright/test"
import { mockApi } from "./mock-api"

async function signInWithPin(page: Page, pin: string) {
  await page.goto("/pos/login")
  await page.getByRole("button", { name: /Thandi Mokoena/ }).click()
  for (const digit of pin) await page.getByRole("button", { name: digit, exact: true }).click()
  await page.waitForURL(/\/pos$/)
}

test("a reload while offline opens the POS with the cashier and the snapshot menu", async ({ context, page }) => {
  const api = await mockApi(context)

  // ---- Online ----
  await signInWithPin(page, "482913")
  await expect(page.getByText("Live curry")).toBeVisible()
  await expect(page.getByText("Offline ready")).toBeVisible({ timeout: 30_000 })

  // The service worker is installed and controls the page (activate claims the open pages).
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 })

  // Only the POS shell is cached: POS pages, their route data and /_next/static files. No API response.
  const cached = await page.evaluate(async () => {
    const names = await caches.keys()
    const urls: string[] = []
    for (const name of names) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url)
    }
    return { names, urls }
  })
  expect(cached.names).toHaveLength(1)
  expect(cached.names[0]).toMatch(/^pos-shell-/)
  const paths = cached.urls.map((url) => new URL(url))
  expect(paths.every((url) => url.origin === "http://127.0.0.1:3200")).toBe(true)
  expect(paths.every((url) => url.pathname.startsWith("/pos") || url.pathname.startsWith("/_next/static/"))).toBe(true)
  expect(paths.some((url) => url.pathname.startsWith("/pos-activity"))).toBe(false)
  expect(paths.map((url) => url.pathname)).toEqual(expect.arrayContaining(["/pos", "/pos/login", "/pos/shift-open"]))

  // ---- Offline: reload ----
  api.offline = true
  await context.setOffline(true)
  await page.reload()

  await expect(page).toHaveURL(/\/pos$/)
  await expect(page.getByText(/Thandi Mokoena/).first()).toBeVisible()
  await expect(page.getByText("Shift Open")).toBeVisible()
  await expect(page.getByText(/Offline copy of today's menu/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("button", { name: /Beef stew/ })).toBeDisabled()
  // Not the full-screen error (O1's amber "Showing the last known shift" line is expected).
  await expect(page.getByRole("heading", { name: "Can't reach the server" })).toHaveCount(0)
  await expect(page.getByText(/Showing the last known shift/)).toBeVisible()
  expect(page.url()).not.toContain("/pos/login")
  expect(page.url()).not.toContain("/pos/shift-open")

  // ---- Back online: the live menu again ----
  api.offline = false
  await context.setOffline(false)
  await page.reload()
  await expect(page.getByText("Live curry")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Offline copy/)).toHaveCount(0)
})
