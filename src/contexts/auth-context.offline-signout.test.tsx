// O3 (contract 11): signing out of the till removes the snapshot's accounts list; a lock doesn't.
import "fake-indexeddb/auto"
import { useContext, type ContextType } from "react"
import { act, render } from "@testing-library/react"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthContext, AuthProvider } from "@/contexts/auth-context"
import { OFFLINE_DB_NAME, getSnapshot, putSnapshot, resetOfflineDbForTests } from "@/lib/offline/db"
import { snapshotBody } from "@/lib/offline/test-fixtures"

type Auth = NonNullable<ContextType<typeof AuthContext>>

const fetchMock = vi.fn<typeof fetch>()

function renderSignedIn(): () => Auth {
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "thandi@x.co", cashierId: 17, role: "CASHIER" } }))
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

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
  await putSnapshot(snapshotBody(), '"v1"')
  localStorage.clear()
  sessionStorage.clear()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => new Response(null, { status: 204 }))
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await resetOfflineDbForTests()
})

describe("sign-out and the snapshot's accounts", () => {
  it("a sign-out clears the accounts list and keeps the menu", async () => {
    const auth = renderSignedIn()
    await act(async () => auth().logout())
    await vi.waitFor(async () => expect((await getSnapshot())?.snapshot.accounts).toBeNull())
    expect((await getSnapshot())?.snapshot.options).toHaveLength(1)
  })

  it("Lock till keeps it (the grant and snapshot outlive the session)", async () => {
    const auth = renderSignedIn()
    await act(async () => auth().lockTill())
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect((await getSnapshot())?.snapshot.accounts).toHaveLength(1)
  })
})
