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
    expect(await fetchTillStatus("http://api")).toMatchObject({ offlineEnabled: true, maxOfflineHours: 8, warnOfflineHours: 7 })
  })

  it("treats a pre-O3 server as offline off, with the default limits", async () => {
    answer({ registered: false, tillCode: null, tillName: null, shift: null, idleLockMinutes: 5, requireRegistered: false })
    expect(await fetchTillStatus("http://api")).toMatchObject({ offlineEnabled: false, maxOfflineHours: 6, warnOfflineHours: 5 })
  })
})
