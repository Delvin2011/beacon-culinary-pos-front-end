// O3 (contract 10.1): the offline switch and limits on GET /pos/till-status.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fetchTillStatus } from "@/lib/till"

const fetchMock = vi.fn<typeof fetch>()
const answer = (body: unknown) => fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("till-status offline fields", () => {
  it("reads offlineEnabled and the limits", async () => {
    answer({ registered: true, tillCode: "T1", tillName: "Till 1 (front)", shift: null, idleLockMinutes: 5,
      requireRegistered: false, offlineEnabled: true, maxOfflineHours: 8, warnOfflineHours: 7 })
    expect(await fetchTillStatus()).toMatchObject({ offlineEnabled: true, maxOfflineHours: 8, warnOfflineHours: 7 })
    // T1-0d: on the page's own address, with the deviceToken cookie.
    expect(fetchMock.mock.calls[0][0]).toBe("/api/pos/till-status")
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include", cache: "no-store" })
  })

  it("treats a pre-O3 server as offline off, with the default limits", async () => {
    answer({ registered: false, tillCode: null, tillName: null, shift: null, idleLockMinutes: 5, requireRegistered: false })
    expect(await fetchTillStatus()).toMatchObject({ offlineEnabled: false, maxOfflineHours: 6, warnOfflineHours: 5 })
  })
})
