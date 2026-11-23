// T0-8 part 4: the formatted output of every money, date and time formatter the locale refactor touches, recorded
// BEFORE the refactor (part 4a) so that the refactor (part 4b) provably changes no byte of it. The snapshots live in
// __snapshots__/locale-output.snapshot.test.ts.snap; a change there is a visible change.
import { describe, expect, it } from "vitest"
import { formatAmountInput } from "@/lib/amount-input"
import { moneyOrDash as grvMoneyOrDash } from "@/lib/money"
import { formatJhbClock, formatJhbLongDate, formatRand, formatRandShort, formatShortDay, jhbHourOf } from "@/lib/dashboard"
import { formatCalendarDate as mealPeriodCalendarDate, siteTimeAt } from "@/lib/meal-periods"
import { moneyOrDash } from "@/lib/money"
import { accountCapMessage } from "@/lib/offline/offline-sale"
import { tradingDayAt } from "@/lib/offline/server-time"
import { formatJhbDateTime, formatJhbTime, formatMoney } from "@/lib/pos-activity"
import { VAT_LINE_TEMPLATE, formatReceiptAmount, formatReceiptDateTime, receiptTime, vatLine, type ReceiptOrder } from "@/lib/receipt"
import { formatCalendarDate, formatDecimal, formatInt, formatPercent } from "@/lib/reports"
import { formatZarCurrency } from "@/lib/utils"

const AMOUNTS = [0, 0.5, 7.83, 12, 1234.5, -56.789, 1000000, 123456789.994]
// Around midnight in Johannesburg (UTC+2), the hour that DST elsewhere would move, and a plain afternoon.
const INSTANTS = ["2026-11-21T21:59:59Z", "2026-11-21T22:00:00Z", "2026-03-29T01:30:00Z", "2026-11-22T12:05:09Z"]

const lines = (values: unknown[], format: (value: never) => unknown) => values.map((value) => `${JSON.stringify(value)} -> ${JSON.stringify(format(value as never))}`).join("\n")

describe("locale output (recorded before the T0-8 locale refactor)", () => {
  it("money", () => {
    expect(
      [
        "formatZarCurrency\n" + lines(AMOUNTS, formatZarCurrency),
        "moneyOrDash (lib/money)\n" + lines([...AMOUNTS, null, undefined], moneyOrDash),
        "moneyOrDash (grv-vat-controls)\n" + lines([...AMOUNTS, null, undefined], grvMoneyOrDash),
        "formatAmountInput\n" + lines(["", "0", "12", "12.", "12.5", "1234.56", "1000000"], formatAmountInput),
        "formatReceiptAmount\n" + lines([...AMOUNTS, null, undefined], formatReceiptAmount),
        "dashboard formatRand\n" + lines([...AMOUNTS, null, undefined], formatRand),
        "dashboard formatRandShort\n" + lines([...AMOUNTS, 999, 1000, 15400], formatRandShort),
        "pos-activity formatMoney\n" + lines([...AMOUNTS, null, undefined], formatMoney),
        "offline accountCapMessage\n" + lines([[50000, 49000, 2000], [123456, 100000, 30000], [null, 0, 100]], (args: [number | null, number, number]) => accountCapMessage(...args)),
      ].join("\n\n"),
    ).toMatchSnapshot()
  })

  it("numbers in reports", () => {
    expect(
      [
        "formatInt\n" + lines([0, 7, 1234, 1234567, -9876], formatInt),
        "formatDecimal\n" + lines([0, 7.5, 1234.567, -0.004], formatDecimal),
        "formatPercent\n" + lines([0, 12.5, 99.999, 100], formatPercent),
      ].join("\n\n"),
    ).toMatchSnapshot()
  })

  it("dates and times", () => {
    expect(
      [
        "dashboard formatJhbClock\n" + lines(INSTANTS, formatJhbClock),
        "dashboard jhbHourOf\n" + lines(INSTANTS, jhbHourOf),
        "dashboard formatJhbLongDate\n" + lines(INSTANTS, formatJhbLongDate),
        "dashboard formatShortDay\n" + lines(["2026-11-21", "2026-01-01", "2026-12-31"], formatShortDay),
        "pos-activity formatJhbDateTime\n" + lines([...INSTANTS, null, undefined], formatJhbDateTime),
        "pos-activity formatJhbTime\n" + lines([...INSTANTS, null, undefined], formatJhbTime),
        "reports formatCalendarDate\n" + lines(["2026-11-21", "2026-01-01", "2026-12-31"], formatCalendarDate),
        "meal-periods formatCalendarDate\n" + lines(["2026-11-21", "2026-01-01", null], mealPeriodCalendarDate),
        "meal-periods siteTimeAt\n" + lines(INSTANTS.map((iso) => Date.parse(iso)), siteTimeAt),
        "offline tradingDayAt\n" + lines(INSTANTS.map((iso) => Date.parse(iso)), tradingDayAt),
        "receipt formatReceiptDateTime\n" + lines([...INSTANTS, "2026-11-22T12:05:09", null], formatReceiptDateTime),
      ].join("\n\n"),
    ).toMatchSnapshot()
  })

  it("receipt lines", () => {
    const order = (overrides: Partial<ReceiptOrder>) => ({ vatRate: 0.15, vatIncludedAmount: 7.83, createdAt: "2026-11-22T12:05:09Z", ...overrides }) as ReceiptOrder
    expect(
      [
        `VAT_LINE_TEMPLATE ${JSON.stringify(VAT_LINE_TEMPLATE)}`,
        "vatLine\n" +
          lines(
            [order({}), order({ vatRate: 0.155, vatIncludedAmount: 1234.5 }), order({ vatRate: 0, vatIncludedAmount: 0 }), order({ vatRate: null, vatIncludedAmount: null })],
            (o: ReceiptOrder) => vatLine(o, true),
          ),
        "receiptTime\n" + lines([order({})], receiptTime),
      ].join("\n\n"),
    ).toMatchSnapshot()
  })
})
