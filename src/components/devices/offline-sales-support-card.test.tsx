// O4 (decision 3): INVALID and REFUSED offline sales on the devices page: listed with the server's error, details to
// copy (without the grant), and an ADMIN's "Handed to support" with a required reason (kept, no longer counted).
import "fake-indexeddb/auto"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OfflineSalesSupportCard } from "@/components/devices/offline-sales-support-card"
import { OFFLINE_DB_NAME, resetOfflineDbForTests } from "@/lib/offline/db"
import { buildOfflineSale } from "@/lib/offline/offline-sale"
import { getOutboxEntry, isWaiting, markRejected, recordOfflineSale, type NewOutboxEntry } from "@/lib/offline/outbox"

let user: { name: string; email: string; role: string }
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user }) }))

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
    grant: "SECRET.signed.grant",
    grantId: "g1",
    shiftId: 412,
    tradingDay: "2026-11-18",
    soldAt,
    recordedAt: soldAt,
    wasPendingOnline: false,
    print: { tillCode: "T1", tillName: null, cashierName: "Thandi", accountNames: {} },
  }
}

const writeText = vi.fn<(text: string) => Promise<void>>(async () => {})

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
  user = { name: "Ayanda Admin", email: "a@x.co", role: "ADMIN" }
  writeText.mockClear()
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
  for (const seq of [1, 2, 3]) await recordOfflineSale(newEntry(seq), null)
  await markRejected("sale-1", "INVALID", "clientOrderId is required.", null)
  await markRejected("sale-2", "REFUSED", "The grant for this sale isn't valid.", "GRANT_INVALID")
})

afterEach(async () => {
  await resetOfflineDbForTests()
})

describe("OfflineSalesSupportCard", () => {
  it("lists INVALID and REFUSED sales with the server's error; pending ones aren't listed", async () => {
    render(<OfflineSalesSupportCard />)
    const rows = await screen.findAllByTestId("support-sale")
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent("T1-1")
    expect(rows[0]).toHaveTextContent("Not readable (INVALID)")
    expect(rows[0]).toHaveTextContent("Server: clientOrderId is required.")
    expect(rows[1]).toHaveTextContent("Refused (GRANT_INVALID)")
    expect(screen.getByText(/2 still count as waiting to send/)).toBeInTheDocument()
  })

  it("copies the details for support, without the grant string", async () => {
    render(<OfflineSalesSupportCard />)
    const [copy] = await screen.findAllByRole("button", { name: "Copy details for support" })
    await act(async () => {
      fireEvent.click(copy)
    })
    const copied = JSON.parse(writeText.mock.calls[0][0] as string)
    expect(copied).toMatchObject({ clientOrderId: "sale-1", status: "INVALID", error: "clientOrderId is required.", sale: { offlineSeq: 1 } })
    expect(writeText.mock.calls[0][0]).not.toContain("SECRET")
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument()
  })

  it("an ADMIN hands a sale to support with a reason: kept, no longer counted", async () => {
    render(<OfflineSalesSupportCard />)
    const [handOver] = await screen.findAllByRole("button", { name: "Handed to support" })
    await act(async () => {
      fireEvent.click(handOver)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }))
    })
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a reason.")

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Emailed to support, ticket 4411" } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }))
    })
    await waitFor(async () => expect((await getOutboxEntry("sale-1"))?.handedToSupport).toMatchObject({ by: "Ayanda Admin", reason: "Emailed to support, ticket 4411" }))
    const kept = (await getOutboxEntry("sale-1"))!
    expect(kept.status).toBe("INVALID")
    expect(isWaiting(kept)).toBe(false)
    expect(await screen.findByText(/Handed to support by Ayanda Admin/)).toBeInTheDocument()
    expect(screen.getByText(/1 still count as waiting to send/)).toBeInTheDocument()
  })

  it("a cashier can copy the details but not hand a sale over", async () => {
    user = { name: "Thandi", email: "t@x.co", role: "CASHIER" }
    render(<OfflineSalesSupportCard />)
    await screen.findAllByTestId("support-sale")
    expect(screen.queryByRole("button", { name: "Handed to support" })).not.toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Copy details for support" })).toHaveLength(2)
  })

  it("shows nothing when there are none", async () => {
    await resetOfflineDbForTests()
    await deleteDB(OFFLINE_DB_NAME)
    const { container } = render(<OfflineSalesSupportCard />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(container).toBeEmptyDOMElement()
  })
})
