// O4 (H): the O1 pending sale keeps what's needed to record it offline; nothing else about O1 changes.
import { beforeEach, describe, expect, it } from "vitest"
import { createPendingSale, loadPendingSale, savePendingSale, withNewApproval, type OfflineDraft } from "@/lib/pending-sale"

const draft: OfflineDraft = {
  lines: [{ dailyMealOptionId: 801, name: "Beef stew", unitPrice: 50, quantity: 1, extras: [] }],
  payments: [{ method: "ACCOUNT", amount: 50, accountId: 5 }],
  confirmedAt: "2026-11-18T10:42:15.000Z",
}
const owner = { key: "cashier:17", name: "Thandi" }
const body = { lines: [{ dailyMealOptionId: 801, quantity: 1, extras: [] }], payments: [{ method: "ACCOUNT", amount: 50, accountId: 5, authorization: { sessionToken: "t1" } }] }

beforeEach(() => localStorage.clear())

describe("the offline draft", () => {
  it("is stored with the pending sale and survives a reload", () => {
    const sale = createPendingSale("SALE", body, { lines: [], total: 50 }, owner, draft)
    savePendingSale(sale)
    expect(loadPendingSale()).toEqual({ ...sale, offlineDraft: draft })
  })

  it("is null when none is given (complimentary, discounted, offline off)", () => {
    expect(createPendingSale("COMPLIMENTARY", {}, { lines: [], total: 0 }, owner).offlineDraft).toBeNull()
  })

  it("is kept through a new manager approval, and the body still goes to the server unchanged", () => {
    const sale = createPendingSale("SALE", body, { lines: [], total: 50 }, owner, draft)
    const approved = withNewApproval(sale, "t2")
    expect(approved.offlineDraft).toEqual(draft)
    expect(approved.body).not.toHaveProperty("offlineDraft")
  })
})
