// O4 section 8: the exceptions API: queries, parsing, errors by code, the note rules and the badge count.
import { describe, expect, it, vi } from "vitest"
import {
  DEFAULT_FILTERS,
  ERROR_MESSAGES,
  SaleExceptionError,
  approveAccountCharge,
  exceptionsQuery,
  fetchOpenExceptionCount,
  fetchSaleException,
  fetchSaleExceptions,
  noteProblem,
  resolveSaleException,
} from "@/lib/sale-exceptions"

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const item = {
  id: 311,
  code: "OVERSOLD",
  severity: "REVIEW",
  status: "OPEN",
  tradingDay: "2026-11-18",
  tillCode: "T1",
  deviceId: "6f1c",
  order: { id: 9302, receiptNumber: "T1-20261118-0008", collectionNumber: "T1-8", soldAt: "2026-11-18T10:51:40Z", total: 85, cashierName: "Thandi Mokoena" },
  detail: { optionId: 801, requested: 2, shortfall: 1 },
  createdAt: "2026-11-18T13:05:01Z",
}

describe("exceptionsQuery", () => {
  it("defaults to open REVIEW exceptions, first page", () => {
    expect(exceptionsQuery(DEFAULT_FILTERS)).toBe("/admin/sale-exceptions?status=OPEN&severity=REVIEW&page=0&size=50")
  })

  it("adds every filter and caps the size at 200", () => {
    expect(
      exceptionsQuery({ status: "RESOLVED", severity: "INFO", code: "OVERSOLD", tradingDay: "2026-11-18", deviceId: "6f1c", page: 2, size: 500 }),
    ).toBe("/admin/sale-exceptions?status=RESOLVED&severity=INFO&code=OVERSOLD&tradingDay=2026-11-18&deviceId=6f1c&page=2&size=200")
  })
})

describe("reading", () => {
  it("parses a page of exceptions", async () => {
    const authFetch = vi.fn(async () => json({ items: [item], page: 0, size: 50, totalItems: 1 }))
    const page = await fetchSaleExceptions(authFetch, DEFAULT_FILTERS)
    expect(page).toEqual({ items: [item], page: 0, size: 50, totalItems: 1 })
  })

  it("parses one exception with its resolution and full order", async () => {
    const authFetch = vi.fn(async () =>
      json({
        ...item,
        status: "RESOLVED",
        resolution: "RESOLVED",
        resolutionNote: "Counted; spare tray.",
        resolvedBy: { id: 3, name: "Ayanda" },
        resolvedAt: "2026-11-18T14:00:00Z",
        order: { id: 9302, recordedOffline: true, collectionNumber: "T1-8", lines: [], payments: [] },
      }),
    )
    const detail = await fetchSaleException(authFetch, 311)
    expect(detail).toMatchObject({ id: 311, resolutionNote: "Counted; spare tray.", resolvedBy: { id: 3, name: "Ayanda" }, order: { recordedOffline: true } })
    expect(authFetch).toHaveBeenCalledWith("/admin/sale-exceptions/311")
  })
})

describe("actions", () => {
  it("resolve sends the trimmed note", async () => {
    const authFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(async () => json({ ...item, status: "RESOLVED" }))
    await resolveSaleException(authFetch, 311, "  Counted.  ")
    const [path, init] = authFetch.mock.calls[0]
    expect(path).toBe("/admin/sale-exceptions/311/resolve")
    expect(init).toMatchObject({ method: "POST" })
    expect(JSON.parse(String(init?.body))).toEqual({ note: "Counted." })
  })

  it("approve-account sends the note only when there is one", async () => {
    const authFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(async () => json({ ...item, code: "ACCOUNT_APPROVAL_PENDING", status: "RESOLVED" }))
    await approveAccountCharge(authFetch, 312, "   ")
    await approveAccountCharge(authFetch, 312, "Finance agreed.")
    expect(authFetch.mock.calls[0][0]).toBe("/admin/sale-exceptions/312/approve-account")
    expect(JSON.parse(String(authFetch.mock.calls[0][1]?.body))).toEqual({})
    expect(JSON.parse(String(authFetch.mock.calls[1][1]?.body))).toEqual({ note: "Finance agreed." })
  })

  it.each([
    [json({ error: "x", code: "USE_APPROVE_ACCOUNT" }, 409), ERROR_MESSAGES.USE_APPROVE_ACCOUNT, "USE_APPROVE_ACCOUNT"],
    [json({ error: "x", code: "NOT_AN_ACCOUNT_APPROVAL" }, 409), ERROR_MESSAGES.NOT_AN_ACCOUNT_APPROVAL, "NOT_AN_ACCOUNT_APPROVAL"],
    [json({ error: "x", code: "EXCEPTION_ALREADY_RESOLVED" }, 409), ERROR_MESSAGES.EXCEPTION_ALREADY_RESOLVED, "EXCEPTION_ALREADY_RESOLVED"],
    [new Response(null, { status: 404 }), ERROR_MESSAGES.NOT_FOUND, null],
    [new Response(null, { status: 403 }), ERROR_MESSAGES.FORBIDDEN, null],
  ])("an error answer %# is read by its code", async (response, message, code) => {
    const authFetch = vi.fn(async () => response as Response)
    const error = await resolveSaleException(authFetch, 311, "x").catch((err: unknown) => err)
    expect(error).toBeInstanceOf(SaleExceptionError)
    expect(error).toMatchObject({ message, code })
  })

  it("a 400 {note} is the note's own message", async () => {
    const authFetch = vi.fn(async () => json({ note: "The note can be at most 500 characters." }, 400))
    const error = (await resolveSaleException(authFetch, 311, "x").catch((err: unknown) => err)) as SaleExceptionError
    expect(error.noteError).toBe("The note can be at most 500 characters.")
  })
})

describe("noteProblem", () => {
  it("requires a note to resolve; at most 500 characters", () => {
    expect(noteProblem("  ", true)).toBe("Enter a note.")
    expect(noteProblem("", false)).toBeNull()
    expect(noteProblem("x".repeat(500), true)).toBeNull()
    expect(noteProblem("x".repeat(501), false)).toBe("A note can be at most 500 characters.")
  })
})

describe("fetchOpenExceptionCount", () => {
  it("reads totalItems of open REVIEW exceptions, one item per page", async () => {
    const authFetch = vi.fn<(path: string) => Promise<Response>>(async () => json({ items: [item], page: 0, size: 1, totalItems: 7 }))
    expect(await fetchOpenExceptionCount(authFetch)).toBe(7)
    expect(authFetch.mock.calls[0][0]).toBe("/admin/sale-exceptions?status=OPEN&severity=REVIEW&size=1")
  })

  it("is null when it can't be read", async () => {
    expect(await fetchOpenExceptionCount(vi.fn(async () => new Response(null, { status: 403 })))).toBeNull()
    expect(await fetchOpenExceptionCount(vi.fn(async () => Promise.reject(new TypeError("offline"))))).toBeNull()
  })
})
