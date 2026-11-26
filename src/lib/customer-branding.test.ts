// T1-8: the customer's name from GET /public/branding, remembered per address, with a neutral fallback.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  BRANDING_STORAGE_KEY,
  getCustomerBranding,
  loadCustomerBranding,
  NEUTRAL_NAME,
  resetCustomerBranding,
  subscribeCustomerBranding,
} from "@/lib/customer-branding"
import { getCustomerStatus } from "@/lib/customer-status"

const fetchMock = vi.fn<typeof fetch>()
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

beforeEach(() => {
  localStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe("customer branding", () => {
  it("fetches /api/public/branding once, without credentials, and remembers the answer", async () => {
    fetchMock.mockResolvedValue(json(200, { name: "Riverside Canteen", logoUrl: null }))
    const listener = vi.fn()
    subscribeCustomerBranding(listener)

    await Promise.all([loadCustomerBranding(), loadCustomerBranding()])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe("/api/public/branding")
    expect(init?.credentials).toBe("omit")
    expect(getCustomerBranding()).toEqual({ name: "Riverside Canteen", logoUrl: null })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem(BRANDING_STORAGE_KEY)!)).toEqual({ name: "Riverside Canteen", logoUrl: null })
  })

  it("a fresh address with nothing remembered shows the neutral name until the answer arrives", () => {
    expect(getCustomerBranding()).toEqual({ name: NEUTRAL_NAME, logoUrl: null })
    expect(NEUTRAL_NAME).toBe("Canteen POS")
  })

  it("the next page load shows the remembered name before (and without) the call", async () => {
    localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify({ name: "Riverside Canteen", logoUrl: "https://cdn.example/l.png" }))
    expect(getCustomerBranding()).toEqual({ name: "Riverside Canteen", logoUrl: "https://cdn.example/l.png" })

    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))
    await loadCustomerBranding()
    expect(getCustomerBranding().name).toBe("Riverside Canteen")
  })

  it.each([
    ["offline", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["unavailable", () => Promise.resolve(json(503, { error: "x", code: "CUSTOMER_UNAVAILABLE" }))],
    ["an unknown address", () => Promise.resolve(new Response(null, { status: 404 }))],
    ["no name", () => Promise.resolve(json(200, { name: "  ", logoUrl: null }))],
    ["a bad logoUrl", () => Promise.resolve(json(200, { name: "X", logoUrl: 5 }))],
    ["not JSON", () => Promise.resolve(new Response("<html>", { status: 200 }))],
  ])("%s: keeps the remembered name, or the neutral one", async (_label, answer) => {
    fetchMock.mockImplementation(answer)
    await loadCustomerBranding()
    expect(getCustomerBranding().name).toBe(NEUTRAL_NAME)
    expect(localStorage.getItem(BRANDING_STORAGE_KEY)).toBeNull()

    resetCustomerBranding()
    localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify({ name: "Riverside Canteen", logoUrl: null }))
    fetchMock.mockImplementation(answer)
    await loadCustomerBranding()
    expect(getCustomerBranding().name).toBe("Riverside Canteen")
  })

  it("suspended: the answer is seen as a suspension and the remembered name stays", async () => {
    localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify({ name: "Riverside Canteen", logoUrl: null }))
    fetchMock.mockResolvedValue(json(503, { error: "x", code: "CUSTOMER_SUSPENDED" }))
    await loadCustomerBranding()
    expect(getCustomerStatus().suspended).toBe(true)
    expect(getCustomerBranding().name).toBe("Riverside Canteen")
  })

  it("a remembered value that isn't valid is ignored", () => {
    localStorage.setItem(BRANDING_STORAGE_KEY, "{not json")
    expect(getCustomerBranding().name).toBe(NEUTRAL_NAME)
  })
})
