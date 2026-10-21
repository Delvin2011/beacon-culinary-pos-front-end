import { formatZarCurrency } from "@/lib/utils"

// Keypad amounts are held as typed, in rands with "." as the separator: "", "12", "12.", "12.5".
// The keypad shows "," to the cashier; "." is only the stored form.

const zarWholeFormatter = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  currencyDisplay: "symbol",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

export function parseAmountInput(raw: string): number {
  const parsed = Number(raw || "0")
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

export function centsToAmountInput(cents: number): string {
  return (Math.max(0, cents) / 100).toFixed(2)
}

// Shows the amount exactly as typed ("R 12", "R 12,", "R 12,5"); nothing typed yet shows R 0,00.
export function formatAmountInput(raw: string): string {
  if (!raw) return formatZarCurrency(0)
  const [whole, fraction] = raw.split(".")
  const base = zarWholeFormatter.format(Number(whole || "0"))
  return fraction === undefined ? base : `${base},${fraction}`
}
