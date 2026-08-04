import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const zarCurrencyFormatter = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  currencyDisplay: "symbol",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatZarCurrency(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0
  return zarCurrencyFormatter.format(safeValue)
}
