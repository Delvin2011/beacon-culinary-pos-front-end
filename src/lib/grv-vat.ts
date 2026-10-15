// GRV VAT preview. Mirrors the backend rules so the live figures match what it saves;
// once a GRV is saved, the server's figures are the truth.

export type VatCode = "STANDARD" | "ZERO_RATED" | "NO_VAT";

export const VAT_CODES: VatCode[] = ["STANDARD", "ZERO_RATED", "NO_VAT"];

export function vatCodeLabel(code: VatCode | string | null | undefined, standardRate?: number | null): string {
  switch (code) {
    case "STANDARD":
      return standardRate != null ? `Standard ${formatRatePercent(standardRate)}` : "Standard";
    case "ZERO_RATED":
      return "Zero-rated";
    case "NO_VAT":
      return "No VAT";
    default:
      return "—";
  }
}

export function formatRatePercent(rate: number): string {
  return `${Math.round(rate * 10000) / 100}%`;
}

// Half-up rounding on positive amounts, done on scaled integers to dodge float drift (e.g. 1.005).
function roundHalfUp(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = Math.round(value * factor * 1e6) / 1e6; // trim float noise before rounding
  return Math.sign(scaled) * Math.floor(Math.abs(scaled) + 0.5) / factor;
}

export const round2 = (value: number) => roundHalfUp(value, 2);
export const round4 = (value: number) => roundHalfUp(value, 4);

export interface VatLineFigures {
  lineExclVat: number;
  lineVat: number;
  lineInclVat: number;
  // The stock (ledger) cost: VAT-inclusive, per unit, to 4 decimals.
  unitCostInclVat: number;
}

export function rateForCode(code: VatCode, standardRate: number): number {
  return code === "STANDARD" ? standardRate : 0;
}

export function computeVatLine(
  quantity: number,
  unitPrice: number,
  pricesIncludeVat: boolean,
  vatCode: VatCode,
  standardRate: number,
): VatLineFigures | null {
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice) || quantity <= 0 || unitPrice < 0) return null;
  const rate = rateForCode(vatCode, standardRate);
  let lineExclVat: number;
  let lineInclVat: number;
  if (pricesIncludeVat) {
    lineInclVat = round2(quantity * unitPrice);
    lineExclVat = round2(lineInclVat / (1 + rate));
  } else {
    lineExclVat = round2(quantity * unitPrice);
    lineInclVat = round2(lineExclVat + round2(lineExclVat * rate));
  }
  // Stock cost comes from the rounded line total (3 × 10.01 excl → 34.53 incl → 11.5100).
  const unitCostInclVat = round4(lineInclVat / quantity);
  return { lineExclVat, lineVat: round2(lineInclVat - lineExclVat), lineInclVat, unitCostInclVat };
}

export interface VatTotals {
  totalExclVat: number;
  totalVat: number;
  totalInclVat: number;
}

export function sumVatLines(lines: (VatLineFigures | null)[]): VatTotals {
  const totals = lines.reduce<VatTotals>(
    (acc, line) => {
      if (!line) return acc;
      acc.totalExclVat += line.lineExclVat;
      acc.totalVat += line.lineVat;
      acc.totalInclVat += line.lineInclVat;
      return acc;
    },
    { totalExclVat: 0, totalVat: 0, totalInclVat: 0 },
  );
  return { totalExclVat: round2(totals.totalExclVat), totalVat: round2(totals.totalVat), totalInclVat: round2(totals.totalInclVat) };
}

export type InvoiceCheckStatus = "PASS" | "WARN";

export interface InvoiceCheck {
  status: InvoiceCheckStatus;
  difference: number;
}

// Matches the backend: PASS within R0.05 of the computed total; difference = printed − computed.
export function previewInvoiceCheck(printedTotal: number | null, computedTotalInclVat: number): InvoiceCheck | null {
  if (printedTotal === null || !Number.isFinite(printedTotal)) return null;
  const difference = round2(printedTotal - computedTotalInclVat);
  return { status: Math.abs(difference) <= 0.05 ? "PASS" : "WARN", difference };
}

export function parseOptionalAmount(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
