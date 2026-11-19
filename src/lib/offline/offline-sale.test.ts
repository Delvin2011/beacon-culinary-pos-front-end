import { describe, expect, it } from "vitest"
import {
  accountCapMessage,
  buildOfflineSale,
  changeDueCents,
  chooseOfflineSeq,
  offlineCollectionNumber,
  offlineReceiptNumber,
  paymentProblem,
  priceCart,
  type OfflineCartLine,
  type OfflineSaleInput,
} from "@/lib/offline/offline-sale"

// The contract's example sale (section 3): beef stew with extra beef, and two waters.
const stew: OfflineCartLine = {
  dailyMealOptionId: 801,
  name: "Beef stew",
  station: "KITCHEN",
  unitPriceCents: 5000,
  quantity: 1,
  extras: [{ dailyComponentStockId: 3102, name: "Extra beef", priceDeltaCents: 1500, quantity: 1 }],
}
const water: OfflineCartLine = {
  dailyMealOptionId: 912,
  name: "Still water 500 ml",
  station: "NONE",
  unitPriceCents: 2000,
  quantity: 2,
  extras: [],
}

function input(overrides: Partial<OfflineSaleInput> = {}): OfflineSaleInput {
  return {
    clientOrderId: "3b8f1c2e-4a5d-4e6f-9a0b-1c2d3e4f5a6b",
    grant: { grantId: "7c1e9a52-2f0b-4d0c-9a7e-3b1f6e2d4c10", shiftId: 412, cashierId: 17 },
    tillCode: "T1",
    tradingDay: "2026-11-18",
    offlineSeq: 7,
    soldAt: "2026-11-18T10:42:15.000Z",
    unlockedOffline: false,
    snapshotVersion: "9f2c4e1ab07d5c3e",
    vatRate: 0.15,
    lines: [stew, water],
    payments: [{ method: "CASH", amountCents: 10500, tenderedCents: 20000 }],
    rules: { accountsEnabled: false },
    ...overrides,
  }
}

describe("priceCart", () => {
  it("keeps extras out of their line's total; the subtotal adds both", () => {
    const cart = priceCart([{ ...stew, quantity: 2, extras: [{ ...stew.extras[0], quantity: 3 }] }, water])
    expect(cart.lines[0].lineTotalCents).toBe(10000)
    expect(cart.lines[0].extras[0].lineTotalCents).toBe(4500)
    expect(cart.lines[1].lineTotalCents).toBe(4000)
    expect(cart.subtotalCents).toBe(18500)
  })
})

describe("buildOfflineSale", () => {
  it("builds the contract's example payload exactly", () => {
    const result = buildOfflineSale(input())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sale).toEqual({
      clientOrderId: "3b8f1c2e-4a5d-4e6f-9a0b-1c2d3e4f5a6b",
      grantId: "7c1e9a52-2f0b-4d0c-9a7e-3b1f6e2d4c10",
      offlineSeq: 7,
      offlineReceiptNumber: "T1-20261118-0007",
      collectionNumber: "T1-7",
      soldAt: "2026-11-18T10:42:15.000Z",
      shiftId: 412,
      cashierId: 17,
      unlockedOffline: false,
      snapshotVersion: "9f2c4e1ab07d5c3e",
      lines: [
        {
          dailyMealOptionId: 801,
          name: "Beef stew",
          station: "KITCHEN",
          quantity: 1,
          unitPrice: 50,
          lineTotal: 50,
          extras: [{ dailyComponentStockId: 3102, name: "Extra beef", priceDelta: 15, quantity: 1, lineTotal: 15 }],
        },
        { dailyMealOptionId: 912, name: "Still water 500 ml", station: "NONE", quantity: 2, unitPrice: 20, lineTotal: 40, extras: [] },
      ],
      subtotal: 105,
      total: 105,
      vatRate: 0.15,
      vatIncludedAmount: 13.7,
      payments: [{ method: "CASH", amount: 105, amountTendered: 200, changeDue: 95 }],
    })
    expect(result.totalCents).toBe(10500)
    expect(result.vatCents).toBe(1370)
  })

  it("adds cents without float drift", () => {
    const line = (cents: number): OfflineCartLine => ({ ...water, unitPriceCents: cents, quantity: 1 })
    const result = buildOfflineSale(input({ lines: [line(10), line(20)], payments: [{ method: "CARD", amountCents: 30, cardReference: "1234" }] }))
    expect(result.ok && result.sale.total).toBe(0.3)
  })

  it("splits cash and card", () => {
    const result = buildOfflineSale(
      input({ payments: [{ method: "CASH", amountCents: 5000, tenderedCents: 5000 }, { method: "CARD", amountCents: 5500, cardReference: " 004512 " }] }),
    )
    expect(result.ok && result.sale.payments).toEqual([
      { method: "CASH", amount: 50, amountTendered: 50, changeDue: 0 },
      { method: "CARD", amount: 55, cardReference: "004512" },
    ])
  })

  it("leaves cardReference out when a stuck sale is allowed to go without one", () => {
    const result = buildOfflineSale(
      input({ payments: [{ method: "CARD", amountCents: 10500, cardReference: null }], rules: { accountsEnabled: false, allowMissingCardReference: true } }),
    )
    expect(result.ok && result.sale.payments).toEqual([{ method: "CARD", amount: 105 }])
  })

  it("records an account payment when accounts are enabled", () => {
    const result = buildOfflineSale(input({ payments: [{ method: "ACCOUNT", amountCents: 10500, accountId: 55 }], rules: { accountsEnabled: true } }))
    expect(result.ok && result.sale.payments).toEqual([{ method: "ACCOUNT", amount: 105, accountId: 55 }])
  })

  it("sets unlockedOffline as given", () => {
    const result = buildOfflineSale(input({ unlockedOffline: true }))
    expect(result.ok && result.sale.unlockedOffline).toBe(true)
  })

  it.each([
    [{ lines: [] }, "NO_LINES"],
    [{ lines: [{ ...water, quantity: 0 }] }, "BAD_QUANTITY"],
    [{ lines: [{ ...stew, extras: [{ ...stew.extras[0], quantity: 1.5 }] }] }, "BAD_QUANTITY"],
    [{ lines: [{ ...water, unitPriceCents: -1 }] }, "BAD_PRICE"],
    [{ vatRate: Number.NaN }, "BAD_VAT_RATE"],
    [{ tillCode: "A-VERY-LONG-TILL-CODE" }, "NUMBER_TOO_LONG"],
    [{ payments: [] }, "NO_PAYMENT"],
  ] as Array<[Partial<OfflineSaleInput>, string]>)("refuses %o with %s", (overrides, problem) => {
    const result = buildOfflineSale(input(overrides))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problem).toBe(problem)
      expect(result.message).toBeTruthy()
    }
  })
})

describe("paymentProblem", () => {
  const rules = { accountsEnabled: true }

  it("accepts exact cash and cash with change", () => {
    expect(paymentProblem(10500, [{ method: "CASH", amountCents: 10500, tenderedCents: 10500 }], rules)).toBeNull()
    expect(paymentProblem(10500, [{ method: "CASH", amountCents: 10500, tenderedCents: 20000 }], rules)).toBeNull()
  })

  it("refuses cash that doesn't cover the amount", () => {
    expect(paymentProblem(10500, [{ method: "CASH", amountCents: 10500, tenderedCents: 10499 }], rules)).toBe("CASH_SHORT")
  })

  it("requires a card slip reference of at most 50 characters", () => {
    expect(paymentProblem(100, [{ method: "CARD", amountCents: 100, cardReference: "  " }], rules)).toBe("CARD_REFERENCE_MISSING")
    expect(paymentProblem(100, [{ method: "CARD", amountCents: 100, cardReference: null }], rules)).toBe("CARD_REFERENCE_MISSING")
    expect(paymentProblem(100, [{ method: "CARD", amountCents: 100, cardReference: "x".repeat(51) }], rules)).toBe("CARD_REFERENCE_TOO_LONG")
    expect(paymentProblem(100, [{ method: "CARD", amountCents: 100, cardReference: "x".repeat(50) }], rules)).toBeNull()
  })

  it("follows the online split rules", () => {
    const cash = { method: "CASH" as const, amountCents: 50, tenderedCents: 50 }
    expect(paymentProblem(150, [cash, cash, cash], rules)).toBe("TOO_MANY_PAYMENTS")
    expect(paymentProblem(100, [cash, { method: "ACCOUNT", amountCents: 50, accountId: 1 }], rules)).toBe("ACCOUNT_COMBINED")
    expect(paymentProblem(100, [cash], rules)).toBe("PAYMENTS_DONT_ADD_UP")
    expect(paymentProblem(100, [{ ...cash, amountCents: 0, tenderedCents: 0 }, { ...cash, amountCents: 100, tenderedCents: 100 }], rules)).toBe("AMOUNT_NOT_POSITIVE")
  })

  it("refuses an account payment when accounts are off", () => {
    expect(paymentProblem(100, [{ method: "ACCOUNT", amountCents: 100, accountId: 1 }], { accountsEnabled: false })).toBe("ACCOUNTS_DISABLED")
  })
})

describe("changeDueCents", () => {
  it("is exactly tendered minus amount", () => {
    expect(changeDueCents({ amountCents: 10500, tenderedCents: 20000 })).toBe(9500)
    expect(changeDueCents({ amountCents: 3333, tenderedCents: 5000 })).toBe(1667)
  })
})

describe("accountCapMessage", () => {
  it("allows charges up to the cap, this one included, and names the cap otherwise", () => {
    expect(accountCapMessage(50000, 40000, 10000)).toBeNull()
    expect(accountCapMessage(50000, 40000, 10001)).toBe("Account limit for offline sales reached (R500.00).")
    expect(accountCapMessage(25050, 0, 30000)).toBe("Account limit for offline sales reached (R250.50).")
  })

  it("has no limit when the grant and snapshot give no cap", () => {
    expect(accountCapMessage(null, 1_000_000, 1)).toBeNull()
  })
})

describe("numbering", () => {
  const grant = { nextOfflineSeq: 5, tradingDay: "2026-11-18" }

  it("takes the larger of the till's counter and the grant's", () => {
    expect(chooseOfflineSeq({ nextOfflineSeq: 9, tradingDay: "2026-11-18" }, grant, "2026-11-18")).toBe(9)
    expect(chooseOfflineSeq({ nextOfflineSeq: 3, tradingDay: "2026-11-18" }, grant, "2026-11-18")).toBe(5)
    expect(chooseOfflineSeq(null, grant, "2026-11-18")).toBe(5)
  })

  it("ignores a counter or grant from another trading day", () => {
    expect(chooseOfflineSeq({ nextOfflineSeq: 40, tradingDay: "2026-11-17" }, grant, "2026-11-18")).toBe(5)
    expect(chooseOfflineSeq({ nextOfflineSeq: 40, tradingDay: "2026-11-17" }, { ...grant, tradingDay: "2026-11-17" }, "2026-11-18")).toBe(1)
  })

  it("formats the receipt and collection numbers", () => {
    expect(offlineReceiptNumber("T1", "2026-11-18", 7)).toBe("T1-20261118-0007")
    expect(offlineReceiptNumber("T1", "2026-11-18", 12345)).toBe("T1-20261118-12345")
    expect(offlineCollectionNumber("T1", 7)).toBe("T1-7")
  })

  it("refuses numbers longer than the contract allows", () => {
    expect(offlineReceiptNumber("ABCDEFGHIJKLMNOPQR", "2026-11-18", 1)).toBeNull() // 32 characters
    expect(offlineReceiptNumber("ABCDEFGHIJKLMNOP", "2026-11-18", 1)).toHaveLength(30)
    expect(offlineCollectionNumber("ABCDEFGHIJKLMNOPQR", 10)).toBeNull() // 21 characters
  })
})
