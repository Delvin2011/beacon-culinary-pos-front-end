// O4: the outbox context reads the outbox at mount and again on every change.
import "fake-indexeddb/auto"
import { act, render, screen, waitFor } from "@testing-library/react"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { OutboxProvider, notifyOutboxChanged, useOutbox } from "@/contexts/outbox-context"
import { OFFLINE_DB_NAME, resetOfflineDbForTests } from "@/lib/offline/db"
import { buildOfflineSale } from "@/lib/offline/offline-sale"
import { recordOfflineSale, type NewOutboxEntry } from "@/lib/offline/outbox"

function entry(seq: number): NewOutboxEntry {
  const result = buildOfflineSale({
    clientOrderId: `sale-${seq}`,
    grant: { grantId: "g1", shiftId: 412, cashierId: 17 },
    tillCode: "T1",
    tradingDay: "2026-11-18",
    offlineSeq: seq,
    soldAt: `2026-11-18T10:0${seq}:00.000Z`,
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
    soldAt: result.sale.soldAt,
    recordedAt: result.sale.soldAt,
    wasPendingOnline: false,
    print: { tillCode: "T1", tillName: null, cashierName: "Thandi", accountNames: {} },
  }
}

function Probe() {
  const { loaded, summary, entries } = useOutbox()
  return (
    <p>
      {loaded ? "loaded" : "loading"} · {summary.pendingCount} waiting · {entries.length} entries
    </p>
  )
}

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
})

afterEach(async () => {
  await resetOfflineDbForTests()
})

describe("OutboxProvider", () => {
  it("reads the outbox at mount and after a change", async () => {
    await recordOfflineSale(entry(1), null)
    render(
      <OutboxProvider>
        <Probe />
      </OutboxProvider>,
    )
    expect(await screen.findByText("loaded · 1 waiting · 1 entries")).toBeInTheDocument()

    await recordOfflineSale(entry(2), null)
    act(() => notifyOutboxChanged())
    await waitFor(() => expect(screen.getByText("loaded · 2 waiting · 2 entries")).toBeInTheDocument())
  })

  it("without the provider: an empty outbox", () => {
    render(<Probe />)
    expect(screen.getByText("loading · 0 waiting · 0 entries")).toBeInTheDocument()
  })
})
