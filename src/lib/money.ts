import { formatZarCurrency } from "@/lib/utils"

// Blank ("—"), never R 0,00, for an amount the server didn't send: e.g. counted cash and variance of a shift that
// wasn't counted (O2).
export function moneyOrDash(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : formatZarCurrency(value)
}
