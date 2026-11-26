// T1-8: 401 TENANT_MISMATCH (a credential that belongs to another customer) ends the session exactly as
// SESSION_ENDED does: back to sign-in with the notice, no refresh, no retry, no error page. Nothing else is cleared:
// the outbox, the grant, the unlock value and the snapshot are kept.
import "fake-indexeddb/auto"
import { useContext, type ContextType } from "react"
import { act, render } from "@testing-library/react"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import KitchenPage from "@/app/kitchen/page"
import { AuthContext, AuthProvider } from "@/contexts/auth-context"
import { onSessionEnding } from "@/lib/session-events"
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
import { buildOfflineSale } from "@/lib/offline/offline-sale"
import { listOutbox, recordOfflineSale, type NewOutboxEntry } from "@/lib/offline/outbox"
import { grantBody, snapshotBody } from "@/lib/offline/test-fixtures"
import { sessionEndedMessage } from "@/lib/till"

const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace }), usePathname: () => "/kitchen" }))

type Auth = NonNullable<ContextType<typeof AuthContext>>
const fetchMock = vi.fn<typeof fetch>()
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const MISMATCH = () => json(401, { error: "This sign-in belongs to another site.", code: "TENANT_MISMATCH" })
const callsTo = (pathEnd: string) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(pathEnd))
const ending = vi.fn()
let unsubscribe: () => void

function newEntry(seq: number): NewOutboxEntry {
  const soldAt = `2026-11-18T10:0${seq}:00.000Z`
  const result = buildOfflineSale({
    clientOrderId: `sale-${seq}`,
    grant: { grantId: "g1", shiftId: 412, cashierId: 17 },
    tillCode: "T1",
    tradingDay: "2026-11-18",
    offlineSeq: seq,
    soldAt,
    unlockedOffline: false,
    snapshotVersion: "v1",
    vatRate: 0.15,
    lines: [{ dailyMealOptionId: 912, name: "Water", station: "NONE", unitPriceCents: 2000, quantity: 1, extras: [] }],
    payments: [{ method: "CASH", amountCents: 2000, tenderedCents: 2000 }],
    rules: { accountsEnabled: false },
  })
  if (!result.ok) throw new Error(result.message)
  return {
    clientOrderId: result.sale.clientOrderId,
    payload: result.sale,
    grant: "signed.g1",
    grantId: "g1",
    shiftId: 412,
    tradingDay: "2026-11-18",
    soldAt,
    recordedAt: soldAt,
    wasPendingOnline: false,
    print: { tillCode: "T1", tillName: null, cashierName: "Thandi", accountNames: {} },
  }
}

function signIn(role = "CASHIER") {
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "t@x.co", name: "Thandi", role, cashierId: 17 } }))
}

function renderAuth(): () => Auth {
  let current: Auth | undefined
  function Probe() {
    current = useContext(AuthContext)
    return null
  }
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )
  return () => current as Auth
}

async function expectOfflineDataKept() {
  expect((await getGrant())?.grant.grant).toBe("opaque.grant.string")
  expect(await getUnlockVerifier()).not.toBeNull()
  expect((await getSnapshot())?.snapshot.accounts).toHaveLength(1)
  expect((await listOutbox()).map((entry) => [entry.clientOrderId, entry.status])).toEqual([["sale-1", "PENDING"]])
}

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
  await putGrant(grantBody)
  await putUnlockVerifier({ userId: 17, shiftId: 412, salt: "c2FsdA==", iterations: 1, hash: "aGFzaA==", createdAt: "2026-11-18T06:00:00Z" })
  await putSnapshot(snapshotBody(), '"v1"')
  await recordOfflineSale(newEntry(1), null)
  localStorage.clear()
  sessionStorage.clear()
  replace.mockReset()
  ending.mockReset()
  unsubscribe = onSessionEnding(ending)
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(async () => {
  unsubscribe()
  vi.unstubAllGlobals()
  await resetOfflineDbForTests()
})

describe("401 TENANT_MISMATCH", () => {
  it("from a call: the session ends as SESSION_ENDED does, with no refresh; offline data and the outbox kept", async () => {
    signIn()
    const auth = renderAuth()
    fetchMock.mockImplementation(async (input) => (String(input).endsWith("/orders") ? MISMATCH() : new Response(null, { status: 204 })))

    let res: Response | undefined
    await act(async () => {
      res = await auth().authFetch("/orders", { method: "POST", body: "{}" })
    })

    expect(res?.status).toBe(401)
    expect(callsTo("/auth/refresh")).toHaveLength(0)
    expect(callsTo("/orders")).toHaveLength(1)
    expect(auth().isAuthenticated).toBe(false)
    expect(localStorage.getItem("bar-talk.auth")).toBeNull()
    expect(ending).toHaveBeenCalledWith("SESSION_ENDED")
    expect(auth().sessionEndedNotice).toBe(sessionEndedMessage(null))
    await expectOfflineDataKept()
  })

  it("from refresh: the session ends the same way", async () => {
    signIn()
    const auth = renderAuth()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith("/auth/refresh")) return MISMATCH()
      if (url.endsWith("/auth/logout")) return new Response(null, { status: 204 })
      return new Response(null, { status: 401 }) // an expired access token
    })

    await act(async () => {
      await auth().authFetch("/menu/today")
    })

    expect(callsTo("/auth/refresh")).toHaveLength(1)
    expect(callsTo("/menu/today")).toHaveLength(1)
    expect(auth().isAuthenticated).toBe(false)
    expect(auth().sessionEndedNotice).toBe(sessionEndedMessage(null))
    expect(ending).toHaveBeenCalledWith("SESSION_ENDED")
    await expectOfflineDataKept()
  })

  it("a screen goes back to its sign-in (the kitchen display), with no error page", async () => {
    signIn("KITCHEN")
    fetchMock.mockImplementation(async (input) => (String(input).includes("/kitchen/") ? MISMATCH() : new Response(null, { status: 204 })))

    const { container } = render(
      <AuthProvider>
        <KitchenPage />
      </AuthProvider>,
    )

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/kitchen/login"))
    expect(container.textContent).not.toMatch(/error|went wrong/i)
    await expectOfflineDataKept()
  })
})
