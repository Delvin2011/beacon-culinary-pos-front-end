// O4: money for offline sales as integer cents. Amounts become cents by reading their decimal digits (never
// `× 100` on a float), all sums are integer sums, and cents turn back into numbers only when the JSON is written.
// The VAT rule is O2b's (contract section 3): vatIncluded = round(total × rate ÷ (1 + rate), 2, half up).

// "12.345" → [12, 345]-style split of a finite number's plain decimal form; null for exponent forms.
function decimalParts(value: number): { negative: boolean; whole: string; fraction: string } | null {
  if (!Number.isFinite(value)) return null
  const text = String(Math.abs(value))
  if (/e/i.test(text)) return null
  const [whole, fraction = ""] = text.split(".")
  return { negative: value < 0, whole, fraction }
}

// A decimal amount scaled to an integer with `places` decimals, rounded half up (away from zero). Null when the
// value isn't a finite number. Exponent forms (1e-7, 1e21) fall back to rounding the scaled float, which is exact
// for them in practice: they're far below a cent or far above any till amount.
function scaled(value: number, places: number): number | null {
  if (!Number.isFinite(value)) return null
  const parts = decimalParts(value)
  if (!parts) {
    const factor = 10 ** places
    return Math.round(value * factor)
  }
  const digits = (parts.fraction + "0".repeat(places + 1)).slice(0, places + 1)
  const kept = Number(parts.whole + digits.slice(0, places))
  const roundUp = Number(digits[places]) >= 5 ? 1 : 0
  const magnitude = kept + roundUp
  return parts.negative ? -magnitude : magnitude
}

// 50 → 5000, 33.33 → 3333, 0.1 + 0.2 → 30 (its decimal form is 0.30000000000000004).
export function toCents(value: number): number | null {
  return scaled(value, 2)
}

// 5000 → 50, 3333 → 33.33: integer ÷ 100 is the closest number to the decimal, so JSON prints it as written.
export function centsToAmount(cents: number): number {
  return cents / 100
}

// A VAT rate (at most 4 decimals) in ten-thousandths: 0.15 → 1500, 0.155 → 1550, 1 → 10000.
export function rateToTenThousandths(rate: number): number | null {
  return scaled(rate, 4)
}

export function tenThousandthsToRate(rate: number): number {
  return rate / 10_000
}

// O2b: the VAT included in a VAT-inclusive total, half up, in integer maths. totalCents and rate (ten-thousandths)
// are non-negative integers. round(n / d) half up = floor((2n + d) / 2d).
export function vatIncludedCents(totalCents: number, rateTenThousandths: number): number {
  if (totalCents <= 0 || rateTenThousandths <= 0) return 0
  const n = BigInt(totalCents) * BigInt(rateTenThousandths)
  const d = BigInt(10_000 + rateTenThousandths)
  const two = BigInt(2)
  return Number((two * n + d) / (two * d))
}

// "R 105.00"-free plain amount for messages: 6500 → "65.00".
export function formatCents(cents: number): string {
  const negative = cents < 0
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
  const fraction = String(abs % 100).padStart(2, "0")
  return `${negative ? "-" : ""}${whole}.${fraction}`
}
