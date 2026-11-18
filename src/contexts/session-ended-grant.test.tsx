// O3: back online after a long outage, the server has ended the idle session (refresh: 401 SESSION_ENDED, IDLE).
// The till goes to sign-in (O2), and the grant, the unlock value and the snapshot are kept for the owner's resume.
import "fake-indexeddb/auto"
import { useContext, type ContextType } from "react"
import { act, cleanup, render } from "@testing-library/react"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthContext, AuthProvider } from "@/contexts/auth-context"
import { OfflineProvider } from "@/contexts/offline-context"
import {
  OFFLINE_DB_NAME,
  getGrant,
  getSnapshot,
  getUnlockVerifier,
  putGrant,
  putSnapshot,
  putUnlockVerifier,
  resetOfflineDbForTests,
} from "@/lib/offline/db"
import { sessionEndedMessage } from "@/lib/till"
import { grantBody, snapshotBody } from "@/lib/offline/test-fixtures"

vi.mock("@/hooks/use-shift", () => ({ useShift: () => ({ shift: { id: 412 } }) }))
vi.mock("@/contexts/connection-context", () => ({ useConnection: () => ({ isOnline: true }) }))

type Auth = NonNullable<ContextType<typeof AuthContext>>
const fetchMock = vi.fn<typeof fetch>()
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const tillStatus = {
  registered: true,
  tillCode: "T1",
  tillName: "Till 1",
  shift: { shiftId: 412, ownerId: 17, ownerName: "Thandi Mokoena", openedAt: "2026-11-18T05:58:12Z", locked: true },
  offlineEnabled: true,
  maxOfflineHours: 6,
  warnOfflineHours: 5,
}

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
  await putGrant(grantBody)
  await putUnlockVerifier({ userId: 17, shiftId: 412, salt: "c2FsdA==", iterations: 1, hash: "aGFzaA==", createdAt: "2026-11-18T06:00:00Z" })
  await putSnapshot(snapshotBody(), '"v1"')
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-18T13:00:00Z"))
  localStorage.clear()
  sessionStorage.clear()
  // Signed in before the outage; the access token has expired since.
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "old.token", user: { email: "t@x.co", cashierId: 17, role: "CASHIER" } }))
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url.endsWith("/pos/till-status")) return json(200, tillStatus)
    if (url.endsWith("/auth/refresh")) return json(401, { error: "Session ended", code: "SESSION_ENDED", details: { reason: "IDLE" } })
    if (url.endsWith("/auth/logout")) return new Response(null, { status: 204 })
    // Any POS call with the expired token.
    return new Response(null, { status: 401 })
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(async () => {
  cleanup()
  await new Promise((resolve) => setTimeout(resolve, 150))
  vi.useRealTimers()
  vi.unstubAllGlobals()
  await resetOfflineDbForTests()
})

describe("reconnecting after a long outage", () => {
  it("SESSION_ENDED (IDLE) leads to sign-in; the grant, unlock value and snapshot are kept", async () => {
    let auth: Auth | undefined
    function Probe() {
      auth = useContext(AuthContext)
      return null
    }
    render(
      <AuthProvider>
        <OfflineProvider>
          <Probe />
        </OfflineProvider>
      </AuthProvider>,
    )

    await vi.waitFor(() => expect(auth?.isAuthenticated).toBe(false))
    expect(auth?.sessionEndedNotice).toBe(sessionEndedMessage("IDLE"))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150))
    })

    expect((await getGrant())?.grant.grant).toBe("opaque.grant.string")
    expect(await getUnlockVerifier()).not.toBeNull()
    expect((await getSnapshot())?.snapshot.accounts).toHaveLength(1)
  })
})
