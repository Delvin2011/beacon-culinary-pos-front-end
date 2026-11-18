// O3 (D13): the sign-in screen while offline. Only the shift owner can unlock, with their PIN checked against the
// check value on this till; 5 wrong tries disable it until the till is online; a reload asks again.
import "fake-indexeddb/auto"
import { useContext, type ContextType } from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthContext, AuthProvider } from "@/contexts/auth-context"
import PosLoginPage from "@/app/pos/login/page"
import { OFFLINE_DB_NAME, getMeta, putGrant, putUnlockVerifier, resetOfflineDbForTests, setMeta } from "@/lib/offline/db"
import { createUnlockVerifier } from "@/lib/offline/unlock"
import { grantBody } from "@/lib/offline/test-fixtures"
import type { TillStatus } from "@/lib/till"

const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace }) }))
vi.mock("next/image", () => ({ default: () => null }))
let online = false
vi.mock("@/contexts/connection-context", () => ({
  useConnection: () => ({ isOnline: online, status: online ? "online" : "offline", reason: null, checkNow: () => {} }),
}))

const tillStatus: TillStatus = {
  registered: true,
  tillCode: "T1",
  tillName: "Till 1 (front)",
  shift: { shiftId: 412, ownerId: 17, ownerName: "Thandi Mokoena", openedAt: "2026-11-18T05:58:12Z", locked: true },
  idleLockMinutes: 5,
  requireRegistered: false,
  offlineEnabled: true,
  maxOfflineHours: 6,
  warnOfflineHours: 5,
}

type Auth = NonNullable<ContextType<typeof AuthContext>>
let auth: Auth | undefined
function Probe() {
  auth = useContext(AuthContext)
  return null
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
  online = false
  fetchMock.mockReset()
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))
  vi.stubGlobal("fetch", fetchMock)
  // Saved online earlier: the till-status, Thandi's grant and her check value (PIN 482913).
  await setMeta("tillStatus", tillStatus)
  await putGrant(grantBody)
  await putUnlockVerifier(await createUnlockVerifier("482913", { userId: 17, shiftId: 412, iterations: 1_000 }))
})

afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  await resetOfflineDbForTests()
})

function renderLogin() {
  return render(
    <AuthProvider>
      <Probe />
      <PosLoginPage />
    </AuthProvider>,
  )
}

async function typePin(pin: string) {
  for (const digit of pin) {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: digit }))
    })
  }
  // The check is async (PBKDF2, IndexedDB).
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

describe("offline unlock", () => {
  it("shows only the owner, and unlocks with the right PIN into a local session (no token)", async () => {
    renderLogin()
    expect(await screen.findByText("Offline: only Thandi Mokoena can unlock this till.")).toBeInTheDocument()
    expect(screen.queryByText(/Who's working/)).not.toBeInTheDocument()

    await typePin("482913")
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/pos"))
    expect(auth?.isAuthenticated).toBe(true)
    expect(auth?.token).toBeNull()
    expect(auth?.user).toMatchObject({ cashierId: 17, name: "Thandi Mokoena", offline: true })
    // Never saved: a reload asks for the PIN again.
    expect(localStorage.getItem("bar-talk.auth")).toBeNull()
  })

  it("a wrong PIN says how many tries are left", async () => {
    renderLogin()
    await screen.findByText(/only Thandi Mokoena/)
    await typePin("111111")
    expect(await screen.findByText("Incorrect PIN. 4 tries left.")).toBeInTheDocument()
    expect(auth?.isAuthenticated).toBe(false)
  })

  it("5 wrong tries disable it, also after a reload, and even the right PIN is refused", async () => {
    const view = renderLogin()
    await screen.findByText(/only Thandi Mokoena/)
    for (let i = 0; i < 5; i += 1) await typePin("111111")
    expect(await screen.findByText("Offline unlock is disabled until the till is back online.")).toBeInTheDocument()
    expect(await getMeta("unlockFailures")).toBe(5)

    view.unmount()
    renderLogin()
    expect(await screen.findByText("Offline unlock is disabled until the till is back online.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "4" })).toBeDisabled()
    expect(auth?.isAuthenticated).toBe(false)
  })

  it("without a check value or grant for this shift: the usual screen, saying it can't be unlocked offline", async () => {
    await resetOfflineDbForTests()
    await deleteDB(OFFLINE_DB_NAME)
    await setMeta("tillStatus", tillStatus)
    renderLogin()
    expect(await screen.findByText("Offline: this till can't be unlocked offline.")).toBeInTheDocument()
    expect(screen.queryByText(/only Thandi Mokoena/)).not.toBeInTheDocument()
  })

  it("not when the till is online: the normal sign-in", async () => {
    online = true
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith("/users/cashiers")
        ? new Response(JSON.stringify([{ id: 17, name: "Thandi Mokoena" }, { id: 23, name: "Sipho Dlamini" }]), { status: 200 })
        : new Response(JSON.stringify(tillStatus), { status: 200 }),
    )
    renderLogin()
    expect(await screen.findByText("Sipho Dlamini")).toBeInTheDocument()
    expect(screen.queryByText(/only Thandi Mokoena/)).not.toBeInTheDocument()
  })
})
