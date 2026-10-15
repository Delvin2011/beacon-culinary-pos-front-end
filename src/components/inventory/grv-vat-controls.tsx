"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, formatZarCurrency } from "@/lib/utils";
import { VAT_CODES, vatCodeLabel, type InvoiceCheck, type VatCode } from "@/lib/grv-vat";

// Required and never pre-selected: a wrong guess silently misstates cost by the VAT rate.
export function PricesIncludeVatToggle({
  value,
  onChange,
  labelId,
}: {
  value: boolean | null;
  onChange: (value: boolean) => void;
  labelId: string;
}) {
  const options: { value: boolean; label: string }[] = [
    { value: false, label: "Exclude VAT" },
    { value: true, label: "Include VAT" },
  ];
  return (
    <div role="radiogroup" aria-labelledby={labelId} className="inline-flex rounded-md border p-0.5">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// Warns but never blocks saving.
export function InvoiceCheckChip({ check }: { check: InvoiceCheck | null | undefined }) {
  if (!check) return null;
  if (check.status === "PASS") {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
        Matches
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
      Differs by {formatZarCurrency(Math.abs(check.difference))}
    </span>
  );
}

export function InvoiceBasisChip({ pricesIncludeVat }: { pricesIncludeVat: boolean }) {
  return (
    <span className="inline-flex whitespace-nowrap rounded border px-1.5 py-0 text-[11px] font-medium text-muted-foreground">
      {pricesIncludeVat ? "Incl. VAT" : "Excl. VAT"}
    </span>
  );
}

export function VatCodeSelect({
  value,
  onChange,
  standardRate,
  className,
}: {
  value: VatCode;
  onChange: (value: VatCode) => void;
  standardRate: number | null;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as VatCode)}>
      <SelectTrigger className={cn("h-9 w-[140px]", className)} aria-label="VAT code">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {VAT_CODES.map((code) => (
          <SelectItem key={code} value={code}>
            {vatCodeLabel(code, standardRate)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Legacy GRVs have null VAT figures: show "—", never R0.00.
export function moneyOrDash(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : formatZarCurrency(value);
}
