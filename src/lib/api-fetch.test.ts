// T1-3: every API call goes through apiFetch, which reads what each response says about the customer, sends nothing
// while the customer is suspended, and confirms an empty 404 with /health before calling the address unknown.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { apiFetch, CustomerSuspendedError, resetApiFetch } from "@/lib/api-fetch"
import { getCustomerStatus, noteCustomerAnswer, resetCustomerStatus } from "@/lib/customer-status"

const fetchMock = vi.fn<typeof fetch>()
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const empty404 = () => new Response(null, { status: 404 })
const paths = () => fetchMock.mock.calls.map(([url]) => String(url))

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  resetCustomerStatus()
  resetApiFetch()
})

describe("apiFetch", () => {
  it("calls /api + the path with the caller's options and a time limit", async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true }))
    const res = await apiFetch("/orders", { method: "POST", credentials: "include", body: "{}" })
    expect(await res.json()).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/orders")
    expect(init).toMatchObject({ method: "POST", credentials: "include", body: "{}" })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it("timeoutMs: null is a plain fetch, with the options exactly as given", async () => {
    fetchMock.mockResolvedValue(json(200, {}))
    await apiFetch("/auth/login", { method: "POST", credentials: "include", timeoutMs: null })
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", { method: "POST", credentials: "include" })
  })

  it("marks the customer suspended, and the response still reaches the caller", async () => {
    fetchMock.mockResolvedValue(json(503, { error: "Suspended.", code: "CUSTOMER_SUSPENDED" }))
    const res = await apiFetch("/orders/today")
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: "CUSTOMER_SUSPENDED" })
    expect(getCustomerStatus().suspended).toBe(true)
  })

  it("sends nothing while the customer is suspended, except a whileSuspended call", async () => {
    await noteCustomerAnswer(json(503, { code: "CUSTOMER_SUSPENDED" }))
    await expect(apiFetch("/orders/today")).rejects.toBeInstanceOf(CustomerSuspendedError)
    await expect(apiFetch("/health")).rejects.toBeInstanceOf(CustomerSuspendedError)
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValue(json(200, { status: "UP" }))
    await apiFetch("/health", { whileSuspended: true })
    expect(paths()).toEqual(["/api/health"])
    expect(getCustomerStatus().suspended).toBe(false)
  })

  it("a CustomerSuspendedError is neither a network error nor a timeout", () => {
    const err = new CustomerSuspendedError()
    expect(err).not.toBeInstanceOf(TypeError)
    expect(err.name).toBe("CustomerSuspendedError")
  })
})

describe("an empty 404", () => {
  it("is confirmed with /health; an empty 404 there too means the address is unknown", async () => {
    fetchMock.mockResolvedValue(empty404())
    const res = await apiFetch("/orders/55")
    expect(res.status).toBe(404)
    await vi.waitFor(() => expect(getCustomerStatus().unknownAddress).toBe(true))
    expect(paths()).toEqual(["/api/orders/55", "/api/health"])
  })

  it("is a missing record when /health answers (the address is known)", async () => {
    fetchMock.mockImplementation(async (url) => (String(url) === "/api/health" ? json(200, { status: "UP" }) : empty404()))
    await apiFetch("/orders/55")
    await vi.waitFor(() => expect(paths()).toContain("/api/health"))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getCustomerStatus().unknownAddress).toBe(false)
  })

  it("from /health itself means an unknown address, with no second check", async () => {
    fetchMock.mockResolvedValue(empty404())
    await apiFetch("/health")
    expect(getCustomerStatus().unknownAddress).toBe(true)
    expect(paths()).toEqual(["/api/health"])
  })

  it("is confirmed once for a burst of 404s, and not again within 5 s", async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async (url) => (String(url) === "/api/health" ? json(200, {}) : empty404()))
    await Promise.all([apiFetch("/a/1"), apiFetch("/a/2"), apiFetch("/a/3")])
    await vi.waitFor(() => expect(paths().filter((path) => path === "/api/health")).toHaveLength(1))
    await apiFetch("/a/4")
    await vi.advanceTimersByTimeAsync(4_000)
    expect(paths().filter((path) => path === "/api/health")).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_500)
    await apiFetch("/a/5")
    await vi.waitFor(() => expect(paths().filter((path) => path === "/api/health")).toHaveLength(2))
  })

  it("a 404 with a body is never checked", async () => {
    fetchMock.mockResolvedValue(json(404, { error: "Not found." }))
    await apiFetch("/orders/55")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(paths()).toEqual(["/api/orders/55"])
  })
})
