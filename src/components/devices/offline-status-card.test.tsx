// O3: the devices page's "Offline on this till" card, read from this browser's storage. It never shows the grant
// string, the unlock check value or account names.
import "fake-indexeddb/auto"
import { render, screen } from "@testing-library/react"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OfflineStatusCard, describeClockSkew } from "@/components/devices/offline-status-card"
import { OFFLINE_DB_NAME, putGrant, putSnapshot, putUnlockVerifier, resetOfflineDbForTests, setMeta } from "@/lib/offline/db"
import { setServerTimeOffset } from "@/lib/offline/server-time"
import { grantBody, snapshotBody } from "@/lib/offline/test-fixtures"

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
  setServerTimeOffset(null)
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-18T10:00:00Z"))
})

afterEach(async () => {
  vi.useRealTimers()
  await resetOfflineDbForTests()
})

describe("Offline on this till", () => {
  it("shows storage, reports, clock, permission, today's menu and the unlock set-up", async () => {
    await setMeta("persistResult", "persisted")
    await setMeta("lastStatusAt", "2026-11-18T07:15:00Z")
    await setMeta("clockSkewMs", 1520)
    await putGrant(grantBody)
    await putSnapshot(snapshotBody(), '"v1"', "2026-11-18T07:15:00Z")
    await putUnlockVerifier({ userId: 17, shiftId: 412, salt: "c2FsdA==", iterations: 1_080_000, hash: "c2VjcmV0", createdAt: "2026-11-18T06:00:00Z" })

    const { container } = render(<OfflineStatusCard />)
    expect(await screen.findByText("Available · Persistent")).toBeInTheDocument()
    expect(screen.getByText("Last report 09:15")).toBeInTheDocument()
    expect(screen.getByText("+1.5 s (till ahead)")).toBeInTheDocument()
    expect(screen.getByText(/For shift 412 \(Thandi Mokoena\), until/)).toBeInTheDocument()
    expect(screen.getByText("Downloaded 09:15 for 2026-11-18")).toBeInTheDocument()
    expect(screen.getByText(/Set up for Thandi Mokoena \(PIN check ≈ 0.4 s, 1.080.000 rounds\)/)).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()

    // Never the secrets or personal data.
    expect(container.textContent).not.toContain("opaque.grant.string")
    expect(container.textContent).not.toContain("c2VjcmV0")
    expect(container.textContent).not.toContain("Finance Dept")
  })

  it("warns when the clock is more than 2 minutes off", async () => {
    await setMeta("clockSkewMs", -3 * 60_000)
    render(<OfflineStatusCard />)
    expect(await screen.findByRole("alert")).toHaveTextContent("The till's clock is off by 3 min. Check the Windows time settings.")
  })

  it("an empty till: nothing yet, and a stopped heartbeat explained", async () => {
    await setMeta("heartbeatStopped", true)
    render(<OfflineStatusCard />)
    expect(await screen.findByText("Stopped: this till isn't registered")).toBeInTheDocument()
    expect(screen.getByText("Not measured yet")).toBeInTheDocument()
    expect(screen.getAllByText("None")).toHaveLength(2)
    expect(screen.getByText("Not set up")).toBeInTheDocument()
  })

  it("yesterday's menu is shown as not usable", async () => {
    await putSnapshot({ ...snapshotBody(), tradingDay: "2026-11-17" }, '"v0"', "2026-11-17T15:00:00Z")
    render(<OfflineStatusCard />)
    expect(await screen.findByText("From 2026-11-17: not usable today")).toBeInTheDocument()
  })

  it("storage unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined)
    render(<OfflineStatusCard />)
    expect(await screen.findByText("Not available: offline won't work in this browser")).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it("describes the clock difference", () => {
    expect(describeClockSkew(200)).toBe("In step with the server")
    expect(describeClockSkew(-90_000)).toBe("−2 min (till behind)")
  })
})
