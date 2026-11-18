// O3: the status heartbeat (contract 9): every 60 s and on reconnect, signed out or not, offlineEnabled or not.
import "fake-indexeddb/auto"
import { act, render } from "@testing-library/react"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OfflineHeartbeat } from "@/components/pos/offline-heartbeat"
import { registerDevice } from "@/lib/devices"
import { OFFLINE_DB_NAME, getMeta, resetOfflineDbForTests, setMeta } from "@/lib/offline/db"
import { serverTimeOffsetMs, setServerTimeOffset } from "@/lib/offline/server-time"

let online = true
vi.mock("@/contexts/connection-context", () => ({
  useConnection: () => ({ isOnline: online, status: online ? "online" : "offline", reason: null, checkNow: () => {} }),
}))

const fetchMock = vi.fn<typeof fetch>()
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

let statusAnswer: () => Response
let tillStatusAnswer: () => Response

const reports = () =>
  fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith("/pos/offline/status"))
    .map(([, init]) => ({ init: init as RequestInit, body: JSON.parse(String(init?.body)) as Record<string, unknown> }))

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
  setServerTimeOffset(null)
  online = true
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] })
  vi.setSystemTime(new Date("2026-11-18T09:15:00Z"))
  statusAnswer = () =>
    json(200, { receivedAt: "2026-11-18T09:14:58.500Z", clockSkewMs: 1500, serverTimeUtc: "2026-11-18T09:14:58.500Z" })
  tillStatusAnswer = () => json(200, { registered: false })
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url.endsWith("/pos/offline/status")) return statusAnswer()
    if (url.endsWith("/pos/till-status")) return tillStatusAnswer()
    return json(404, {})
  })
  vi.stubGlobal("fetch", fetchMock)
  // Nothing signed in: the heartbeat needs no session.
  localStorage.clear()
})

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setServerTimeOffset(null)
  await resetOfflineDbForTests()
})

// Lets the previous report finish (its IndexedDB writes use real timers), then moves the clock on.
async function minutes(n: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    vi.advanceTimersByTime(n * 60_000)
  })
}

describe("status heartbeat", () => {
  it("reports at once and every 60 s, with no bearer token, as the contract's body", async () => {
    render(<OfflineHeartbeat />)
    await vi.waitFor(() => expect(reports()).toHaveLength(1))
    await minutes(1)
    await vi.waitFor(() => expect(reports()).toHaveLength(2))
    await minutes(1)
    await vi.waitFor(() => expect(reports()).toHaveLength(3))

    const { init, body } = reports()[0]
    expect(init.method).toBe("POST")
    expect(init.credentials).toBe("include")
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json")
    expect(new Headers(init.headers).has("Authorization")).toBe(false)
    expect(body).toEqual({ pendingCount: 0, pending: [], tillClockUtc: expect.stringMatching(/^2026-11-18T09:15:00\.\d{3}Z$/), appVersion: expect.any(String) })
    expect((body.appVersion as string).length).toBeLessThanOrEqual(50)
  })

  it("records the server time, the clock difference and when it last reported", async () => {
    render(<OfflineHeartbeat />)
    await vi.waitFor(async () => expect(await getMeta("clockSkewMs")).toBe(1500))
    expect(await getMeta("lastStatusAt")).toBe("2026-11-18T09:14:58.500Z")
    // About 1.5 s behind (vi.waitFor moves the fake clock a little between checks).
    expect(serverTimeOffsetMs()).toBeLessThan(-1400)
    expect(serverTimeOffsetMs()).toBeGreaterThan(-2000)
  })

  it("sends nothing while offline, and reports at once on reconnect with offlineSince, then clears it", async () => {
    const view = render(<OfflineHeartbeat />)
    await vi.waitFor(() => expect(reports()).toHaveLength(1))

    online = false
    view.rerender(<OfflineHeartbeat />)
    await vi.waitFor(async () => expect(await getMeta("offlineSince")).not.toBeNull())
    const since = await getMeta("offlineSince")
    await minutes(5)
    expect(reports()).toHaveLength(1)

    online = true
    view.rerender(<OfflineHeartbeat />)
    await vi.waitFor(() => expect(reports()).toHaveLength(2))
    expect(reports()[1].body.offlineSince).toBe(since)
    await vi.waitFor(async () => expect(await getMeta("offlineSince")).toBeNull())
  })

  it("keeps offlineSince when the report after reconnecting fails, and sends it again", async () => {
    await setMeta("offlineSince", "2026-11-18T08:00:00.000Z")
    statusAnswer = () => json(503, {})
    render(<OfflineHeartbeat />)
    await vi.waitFor(() => expect(reports()).toHaveLength(1))
    expect(await getMeta("offlineSince")).toBe("2026-11-18T08:00:00.000Z")

    statusAnswer = () => json(200, { receivedAt: null, clockSkewMs: 0, serverTimeUtc: "2026-11-18T09:16:00Z" })
    await minutes(1)
    await vi.waitFor(() => expect(reports()).toHaveLength(2))
    expect(reports()[1].body.offlineSince).toBe("2026-11-18T08:00:00.000Z")
    await vi.waitFor(async () => expect(await getMeta("offlineSince")).toBeNull())
  })

  it("keeps the first offlineSince when the till reloads while offline", async () => {
    await setMeta("offlineSince", "2026-11-18T08:00:00.000Z")
    online = false
    render(<OfflineHeartbeat />)
    await act(async () => {})
    await vi.waitFor(async () => expect(await getMeta("offlineSince")).toBe("2026-11-18T08:00:00.000Z"))
    expect(reports()).toHaveLength(0)
  })

  it("stops on DEVICE_NOT_REGISTERED, across reloads, until till-status says registered", async () => {
    statusAnswer = () => json(403, { error: "Not registered", code: "DEVICE_NOT_REGISTERED" })
    const first = render(<OfflineHeartbeat />)
    await vi.waitFor(async () => expect(await getMeta("heartbeatStopped")).toBe(true))
    await minutes(3)
    expect(reports()).toHaveLength(1)
    first.unmount()

    // Reloaded, still unregistered: no report.
    const second = render(<OfflineHeartbeat />)
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/pos/till-status"))).toBe(true))
    await minutes(1)
    expect(reports()).toHaveLength(1)
    second.unmount()

    // Registered since: reports again.
    tillStatusAnswer = () => json(200, { registered: true, tillCode: "T1" })
    statusAnswer = () => json(200, { receivedAt: null, clockSkewMs: 0, serverTimeUtc: null })
    render(<OfflineHeartbeat />)
    await vi.waitFor(() => expect(reports()).toHaveLength(2))
    expect(await getMeta("heartbeatStopped")).toBeNull()
  })

  it("starts again after this browser registers on the devices page", async () => {
    await setMeta("heartbeatStopped", true)
    const authFetch = async () => json(201, { id: "d1", name: "Till 1", status: "ACTIVE" })
    await registerDevice(authFetch, { name: "Till 1", serialNumber: "", assetTag: "" })
    await vi.waitFor(async () => expect(await getMeta("heartbeatStopped")).toBeNull())

    render(<OfflineHeartbeat />)
    await vi.waitFor(() => expect(reports()).toHaveLength(1))
  })

  it("keeps trying when the server has no status endpoint yet (404), without stopping", async () => {
    statusAnswer = () => json(404, {})
    render(<OfflineHeartbeat />)
    await vi.waitFor(() => expect(reports()).toHaveLength(1))
    await minutes(1)
    await vi.waitFor(() => expect(reports()).toHaveLength(2))
    expect(await getMeta("heartbeatStopped")).toBeNull()
  })
})
