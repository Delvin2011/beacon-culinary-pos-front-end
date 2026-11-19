// O3: after a reload while offline, the provider uses the last till-status answer it saved.
import "fake-indexeddb/auto"
import { act, cleanup, render } from "@testing-library/react"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OfflineProvider, useOffline, type OfflineContextValue } from "@/contexts/offline-context"
import { OFFLINE_DB_NAME, getMeta, resetOfflineDbForTests } from "@/lib/offline/db"

let online = true
const fetchMock = vi.fn<typeof fetch>()

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: null, isAuthenticated: false, authFetch: (path: string) => fetchMock(path) }),
}))
vi.mock("@/hooks/use-shift", () => ({ useShift: () => ({ shift: null }) }))
vi.mock("@/contexts/connection-context", () => ({ useConnection: () => ({ isOnline: online }) }))

const answer = { registered: true, tillCode: "T1", tillName: "Till 1", shift: null, offlineEnabled: true, maxOfflineHours: 6, warnOfflineHours: 5 }

let current: OfflineContextValue
function Probe() {
  current = useOffline()
  return null
}

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
  online = true
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(answer), { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(async () => {
  cleanup()
  await new Promise((resolve) => setTimeout(resolve, 100))
  vi.unstubAllGlobals()
  await resetOfflineDbForTests()
})

describe("till-status across a reload", () => {
  it("saves each answer and restores it when the till reloads offline", async () => {
    const first = render(
      <OfflineProvider>
        <Probe />
      </OfflineProvider>,
    )
    await vi.waitFor(async () => expect(await getMeta("tillStatus")).toMatchObject({ tillCode: "T1", offlineEnabled: true }))
    first.unmount()

    // The reload, offline: no request, the saved answer.
    online = false
    fetchMock.mockClear()
    render(
      <OfflineProvider>
        <Probe />
      </OfflineProvider>,
    )
    await act(async () => {})
    await vi.waitFor(() => expect(current.tillStatus?.tillCode).toBe("T1"))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
