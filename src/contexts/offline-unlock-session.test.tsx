// O3 (D13): the offline context binds a check value made before the shift opened, deletes one for another person's
// shift (keeping the grant), resets the wrong-try count once online, and ends an offline session when back online.
import "fake-indexeddb/auto"
import { useContext, type ContextType } from "react"
import { act, cleanup, render } from "@testing-library/react"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthContext, AuthProvider, BACK_ONLINE_NOTICE } from "@/contexts/auth-context"
import { OfflineProvider } from "@/contexts/offline-context"
import {
  OFFLINE_DB_NAME,
  getGrant,
  getMeta,
  getUnlockVerifier,
  putGrant,
  putUnlockVerifier,
  resetOfflineDbForTests,
  setMeta,
} from "@/lib/offline/db"
import { grantBody } from "@/lib/offline/test-fixtures"

let online = true
vi.mock("@/hooks/use-shift", () => ({ useShift: () => ({ shift: null }) }))
vi.mock("@/contexts/connection-context", () => ({ useConnection: () => ({ isOnline: online }) }))

type Auth = NonNullable<ContextType<typeof AuthContext>>
let auth: Auth | undefined
function Probe() {
  auth = useContext(AuthContext)
  return null
}
const tree = () => (
  <AuthProvider>
    <OfflineProvider>
      <Probe />
    </OfflineProvider>
  </AuthProvider>
)

const fetchMock = vi.fn<typeof fetch>()
let shiftOwner = 17
const verifier = (userId: number, shiftId: number | null) => ({
  userId,
  shiftId,
  salt: "c2FsdA==",
  iterations: 1,
  hash: "aGFzaA==",
  createdAt: "2026-11-18T06:00:00Z",
})

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-18T10:00:00Z"))
  localStorage.clear()
  sessionStorage.clear()
  online = true
  shiftOwner = 17
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    if (String(input).endsWith("/pos/till-status")) {
      return new Response(
        JSON.stringify({
          registered: true,
          tillCode: "T1",
          tillName: "Till 1",
          shift: { shiftId: 412, ownerId: shiftOwner, ownerName: "Owner", openedAt: "2026-11-18T05:58:12Z", locked: true },
          offlineEnabled: true,
          maxOfflineHours: 6,
          warnOfflineHours: 5,
        }),
        { status: 200 },
      )
    }
    throw new TypeError("Failed to fetch")
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

describe("the check value and the offline session", () => {
  it("a check value made before the shift opened is bound to the shift its owner opens", async () => {
    await putUnlockVerifier(verifier(17, null))
    render(tree())
    await vi.waitFor(async () => expect((await getUnlockVerifier())?.shiftId).toBe(412))
  })

  it("one for someone else is deleted when another person's shift is open; that shift's grant is kept", async () => {
    await putGrant(grantBody)
    await putUnlockVerifier(verifier(23, null))
    render(tree())
    await vi.waitFor(async () => expect(await getUnlockVerifier()).toBeNull())
    expect(await getGrant()).not.toBeNull()
  })

  it("once online, offline unlock may be tried again (the wrong-try count is reset)", async () => {
    await setMeta("unlockFailures", 5)
    render(tree())
    await vi.waitFor(async () => expect(await getMeta("unlockFailures")).toBeNull())
  })

  it("back online during an offline session: it ends and the sign-in screen says why", async () => {
    online = false
    const view = render(tree())
    await act(async () => {
      auth?.startOfflineSession({ cashierId: 17, name: "Thandi Mokoena" })
    })
    expect(auth?.isAuthenticated).toBe(true)

    online = true
    view.rerender(tree())
    await vi.waitFor(() => expect(auth?.isAuthenticated).toBe(false))
    expect(auth?.user).toBeNull()
    expect(auth?.sessionEndedNotice).toBe(BACK_ONLINE_NOTICE)
  })

  it("an offline session stays while the till is offline", async () => {
    online = false
    render(tree())
    await act(async () => {
      auth?.startOfflineSession({ cashierId: 17, name: "Thandi Mokoena" })
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    expect(auth?.user).toMatchObject({ offline: true })
  })
})
