// O3: a reload while offline lands on the POS with the cashier and the shift saved online (no redirect, no "Can't
// reach the server" screen), when this till may sell offline. Reading and End shift say "Not available offline".
import "fake-indexeddb/auto"
import { act, render, screen } from "@testing-library/react"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { ShiftProvider, type Shift } from "@/contexts/shift-context"
import PosMainPage from "@/app/pos/page"
import { OFFLINE_DB_NAME, putGrant, resetOfflineDbForTests, setMeta } from "@/lib/offline/db"
import { grantBody } from "@/lib/offline/test-fixtures"
import type { TillStatus } from "@/lib/till"
import { BRANDING_STORAGE_KEY, loadCustomerBranding } from "@/lib/customer-branding"

const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace }) }))
vi.mock("@/components/pos/order-builder", () => ({ PosOrderBuilder: () => <div>order builder</div> }))
vi.mock("@/contexts/connection-context", () => ({
  useConnection: () => ({ isOnline: false, status: "offline", reason: "no-connection", checkNow: () => {} }),
}))

const shift: Shift = {
  id: 412,
  cashierId: 17,
  status: "OPEN",
  openingFloat: 500,
  openedAt: "2026-11-18T05:58:12Z",
  closedAt: null,
  owner: { id: 17, name: "Thandi Mokoena", role: "CASHIER" },
  ownedByCaller: true,
  tillCode: "T1",
  tillName: "Till 1 (front)",
}

const tillStatus: TillStatus = {
  registered: true,
  tillCode: "T1",
  tillName: "Till 1 (front)",
  shift: { shiftId: 412, ownerId: 17, ownerName: "Thandi Mokoena", openedAt: "2026-11-18T05:58:12Z", locked: false },
  idleLockMinutes: 5,
  requireRegistered: false,
  offlineEnabled: true,
  maxOfflineHours: 6,
  warnOfflineHours: 5,
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-18T10:00:00Z"))
  replace.mockReset()
  localStorage.clear()
  sessionStorage.clear()
  // The cashier stays signed in across the reload (restored without a server call).
  localStorage.setItem(
    "bar-talk.auth",
    JSON.stringify({ token: "a.b.c", user: { email: "thandi@x.co", name: "Thandi Mokoena", role: "CASHIER", cashierId: 17 } }),
  )
  // No connection at all.
  fetchMock.mockReset()
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  await resetOfflineDbForTests()
})

function renderPos() {
  render(
    <AuthProvider>
      <ShiftProvider>
        <PosMainPage />
      </ShiftProvider>
    </AuthProvider>,
  )
}

describe("reload while offline", () => {
  it("stays on the POS with the cashier and the saved shift; no redirect", async () => {
    await setMeta("tillStatus", tillStatus)
    await putGrant(grantBody)
    await setMeta("lastShift", shift)
    renderPos()

    expect(await screen.findByText("Shift Open")).toBeInTheDocument()
    expect(screen.getByText("order builder")).toBeInTheDocument()
    expect(screen.queryByText("Can't reach the server")).not.toBeInTheDocument()
    expect(screen.getByText(/Showing the last known shift/)).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()

    // Server-only actions.
    expect(screen.getByRole("button", { name: /Reading/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /End shift/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /End shift/ })).toHaveAttribute("title", "Not available offline")
    expect(screen.getByRole("button", { name: /Lock till/ })).toBeEnabled()
  })

  // T1-8: the till's header names the customer: the remembered name while offline, the neutral one if none.
  it("the header shows the remembered customer name while offline", async () => {
    localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify({ name: "Riverside Canteen", logoUrl: null }))
    await setMeta("tillStatus", tillStatus)
    await putGrant(grantBody)
    await setMeta("lastShift", shift)
    await loadCustomerBranding() // offline: the call fails
    renderPos()

    expect(await screen.findByText("Shift Open")).toBeInTheDocument()
    expect(screen.getByTestId("customer-name")).toHaveTextContent("Riverside Canteen")
  })

  it("the header shows the neutral name when nothing is remembered on this address", async () => {
    await setMeta("tillStatus", tillStatus)
    await putGrant(grantBody)
    await setMeta("lastShift", shift)
    await loadCustomerBranding()
    renderPos()

    expect(await screen.findByText("Shift Open")).toBeInTheDocument()
    expect(screen.getByTestId("customer-name")).toHaveTextContent("Canteen POS")
  })

  it("the header shows the name from the endpoint once it answers", async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input) === "/api/public/branding"
        ? new Response(JSON.stringify({ name: "Hilltop Canteen", logoUrl: null }), { status: 200 })
        : Promise.reject(new TypeError("Failed to fetch")),
    )
    await setMeta("tillStatus", tillStatus)
    await putGrant(grantBody)
    await setMeta("lastShift", shift)
    renderPos()
    expect(await screen.findByText("Shift Open")).toBeInTheDocument()

    await act(() => loadCustomerBranding())
    expect(screen.getByTestId("customer-name")).toHaveTextContent("Hilltop Canteen")
  })

  it("without a valid grant: as before O3 (Can't reach the server, no redirect)", async () => {
    await setMeta("tillStatus", tillStatus)
    await setMeta("lastShift", shift)
    renderPos()

    expect(await screen.findByText("Can't reach the server")).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it("with offline turned off: as before O3", async () => {
    await setMeta("tillStatus", { ...tillStatus, offlineEnabled: false })
    await putGrant(grantBody)
    await setMeta("lastShift", shift)
    renderPos()

    expect(await screen.findByText("Can't reach the server")).toBeInTheDocument()
  })
})
