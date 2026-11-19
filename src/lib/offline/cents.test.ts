import { describe, expect, it } from "vitest"
import { centsToAmount, formatCents, rateToTenThousandths, toCents, vatIncludedCents } from "@/lib/offline/cents"

describe("toCents", () => {
  it("reads the decimal digits, not a float product", () => {
    expect(toCents(50)).toBe(5000)
    expect(toCents(33.33)).toBe(3333)
    expect(toCents(1.15)).toBe(115) // 1.15 * 100 = 114.99999999999999
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(toCents(99999.99)).toBe(9999999)
    expect(toCents(0)).toBe(0)
    expect(toCents(1.005)).toBe(101) // half up on the third decimal as written
    expect(toCents(-10)).toBe(-1000)
  })

  it("is null for something that isn't a finite number", () => {
    expect(toCents(Number.NaN)).toBeNull()
    expect(toCents(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it("round-trips through centsToAmount", () => {
    for (const cents of [0, 1, 99, 105, 1370, 9999999]) expect(toCents(centsToAmount(cents))).toBe(cents)
    expect(JSON.stringify({ amount: centsToAmount(1370) })).toBe('{"amount":13.7}')
  })

  it("formats cents for messages", () => {
    expect(formatCents(50000)).toBe("500.00")
    expect(formatCents(5)).toBe("0.05")
  })
})

describe("rateToTenThousandths", () => {
  it("keeps up to 4 decimals", () => {
    expect(rateToTenThousandths(0.15)).toBe(1500)
    expect(rateToTenThousandths(0.155)).toBe(1550)
    expect(rateToTenThousandths(0.1525)).toBe(1525)
    expect(rateToTenThousandths(1)).toBe(10000)
    expect(rateToTenThousandths(0)).toBe(0)
  })
})

describe("vatIncludedCents (O2b rule)", () => {
  // O2b contract section 3, at 15%.
  it.each([
    [50.0, 6.52],
    [100.0, 13.04],
    [33.33, 4.35],
    [1.15, 0.15],
    [0.01, 0.0],
    [0.0, 0.0],
    [99999.99, 13043.48],
    [85.0, 11.09], // backend test
  ])("total %s at 15%% includes VAT %s", (total, vat) => {
    expect(vatIncludedCents(toCents(total)!, 1500)).toBe(toCents(vat))
  })

  it("rounds half up at a 100% rate", () => {
    expect(vatIncludedCents(1, 10000)).toBe(1) // 0.005 → 0.01
    expect(vatIncludedCents(3, 10000)).toBe(2) // 0.015 → 0.02
  })

  it("is zero at a 0% rate", () => {
    expect(vatIncludedCents(10500, 0)).toBe(0)
  })
})
