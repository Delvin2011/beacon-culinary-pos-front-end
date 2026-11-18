// O3: the "Offline ready" marker and the offline banner.
import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OfflineBanner, OfflineReadyMarker } from "@/components/pos/offline-status"
import type { OfflineContextValue } from "@/contexts/offline-context"
import { parseGrant, parseSnapshot } from "@/lib/offline/contract"
import { grantBody, snapshotBody } from "@/lib/offline/test-fixtures"
import type { TillStatus } from "@/lib/till"

const tillStatus: TillStatus = {
  registered: true,
  tillCode: "T1",
  tillName: "Till 1",
  shift: { shiftId: 412, ownerId: 17, ownerName: "Thandi Mokoena", openedAt: "2026-11-18T05:58:12Z", locked: false },
  idleLockMinutes: 5,
  requireRegistered: false,
  offlineEnabled: true,
  maxOfflineHours: 6,
  warnOfflineHours: 5,
}

let offline: OfflineContextValue
let online: boolean
let offlineSince: string | null
let waiting: number

vi.mock("@/contexts/outbox-context", () => ({
  useOutbox: () => ({ entries: [], loaded: true, refresh: async () => {}, summary: { pendingCount: waiting, pending: [], oldestPendingSoldAt: null } }),
}))
vi.mock("@/contexts/offline-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/offline-context")>()),
  useOffline: () => offline,
}))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { email: "thandi@x.co", cashierId: 17 } }) }))
vi.mock("@/contexts/connection-context", () => ({ useConnection: () => ({ isOnline: online }) }))
vi.mock("@/lib/offline/db", () => ({ getMeta: async () => offlineSince }))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-18T10:00:00Z"))
  online = true
  offlineSince = null
  waiting = 0
  offline = {
    tillStatus,
    storage: "available",
    grant: parseGrant(grantBody),
    snapshot: parseSnapshot(snapshotBody()),
    snapshotReceivedAt: "2026-11-18T09:15:00Z",
    grantRefused: false,
    refresh: () => {},
  }
})

afterEach(() => {
  vi.useRealTimers()
})

const both = () =>
  render(
    <>
      <OfflineReadyMarker />
      <OfflineBanner />
    </>,
  )

describe("offline marker and banner", () => {
  it("online and ready: the Offline ready marker, no banner", () => {
    both()
    expect(screen.getByText("Offline ready")).toBeInTheDocument()
    expect(screen.queryByText(/Offline mode|can't sell offline/)).not.toBeInTheDocument()
  })

  it("online and not ready: neither", () => {
    offline = { ...offline, grant: null }
    both()
    expect(screen.queryByText("Offline ready")).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("offline and ready: Offline mode with the time offline", async () => {
    online = false
    offlineSince = "2026-11-18T08:55:00Z"
    both()
    expect(await screen.findByText("Offline mode · 1 h 05 min")).toBeInTheDocument()
    expect(screen.queryByText("Offline ready")).not.toBeInTheDocument()
  })

  it("offline from warnOfflineHours: the warning", async () => {
    online = false
    offlineSince = "2026-11-18T04:45:00Z"
    both()
    expect(await screen.findByText(/Offline mode · 5 h 15 min/)).toBeInTheDocument()
    expect(screen.getByText(/selling offline stops at 6 h/)).toBeInTheDocument()
  })

  it("offline and not ready: the first reason", async () => {
    online = false
    offline = { ...offline, snapshot: null }
    both()
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Offline. This till can't sell offline: today's menu hasn't been downloaded",
    )
  })

  it("offline for longer than maxOfflineHours: selling stops, with the reason", async () => {
    online = false
    offlineSince = "2026-11-18T03:30:00Z"
    both()
    expect(await screen.findByRole("alert")).toHaveTextContent("Offline · 6 h 30 min. Offline limit reached. Reconnect to keep selling.")
  })

  it("O4: shows the sales waiting to send", async () => {
    online = false
    offlineSince = "2026-11-18T09:30:00Z"
    waiting = 3
    both()
    expect(await screen.findByText("Offline mode · 30 min · 3 sales waiting to send")).toBeInTheDocument()
  })

  it("O4: the grant's expiry stops selling, with the reason and the waiting sales", async () => {
    online = false
    offlineSince = "2026-11-18T09:30:00Z"
    waiting = 1
    offline = { ...offline, grant: parseGrant({ ...grantBody, expiresAt: "2026-11-18T09:59:00Z" }) }
    both()
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Offline · 30 min · 1 sale waiting to send. This till's offline permission has expired. Reconnect to keep selling.",
    )
  })

  it("O4: midnight (Johannesburg) stops selling: the snapshot is for the previous day", async () => {
    vi.setSystemTime(new Date("2026-11-18T22:10:00Z")) // 00:10 on the 19th in Johannesburg
    online = false
    offlineSince = "2026-11-18T21:40:00Z"
    both()
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A new trading day has started and the offline menu is for the previous day. Reconnect to keep selling.",
    )
  })

  it("offlineEnabled false: nothing, online or offline (as before O3)", () => {
    offline = { ...offline, tillStatus: { ...tillStatus, offlineEnabled: false } }
    const view = both()
    expect(view.container).toBeEmptyDOMElement()
    online = false
    view.rerender(
      <>
        <OfflineReadyMarker />
        <OfflineBanner />
      </>,
    )
    expect(view.container).toBeEmptyDOMElement()
  })
})
