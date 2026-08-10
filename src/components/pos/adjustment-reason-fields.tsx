"use client";

import { cn } from "@/lib/utils";

export type OrderAdjustmentReasonCode =
  | "WRONG_ORDER"
  | "CUSTOMER_COMPLAINT"
  | "KITCHEN_ERROR"
  | "DUPLICATE_ENTRY"
  | "OUT_OF_STOCK_ERROR"
  | "OTHER";

export const ADJUSTMENT_REASON_OPTIONS: Array<{ value: OrderAdjustmentReasonCode; label: string }> = [
  { value: "WRONG_ORDER", label: "Wrong Order" },
  { value: "CUSTOMER_COMPLAINT", label: "Customer Complaint" },
  { value: "KITCHEN_ERROR", label: "Kitchen Error" },
  { value: "DUPLICATE_ENTRY", label: "Duplicate Entry" },
  { value: "OUT_OF_STOCK_ERROR", label: "Out of Stock Error" },
  { value: "OTHER", label: "Other" },
];

type AdjustmentReasonFieldsProps = {
  reasonCode: OrderAdjustmentReasonCode;
  note: string;
  onReasonCodeChange: (value: OrderAdjustmentReasonCode) => void;
  onNoteChange: (value: string) => void;
  error?: string | null;
  noteId: string;
  className?: string;
};

export function AdjustmentReasonFields({
  reasonCode,
  note,
  onReasonCodeChange,
  onNoteChange,
  error,
  noteId,
  className,
}: AdjustmentReasonFieldsProps) {
  return (
    <div className={cn("mt-4 rounded-xl border border-amber-300/30 bg-slate-950/50 p-4", className)}>
      <p className="mt-1 text-xs text-slate-300">Select a reason:</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {ADJUSTMENT_REASON_OPTIONS.map((option) => {
          const active = option.value === reasonCode;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onReasonCodeChange(option.value)}
              className={cn(
                "rounded-xl border px-3 py-3 text-left text-sm font-semibold transition-colors",
                active
                  ? "border-amber-300 bg-amber-400/25 text-amber-50"
                  : "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3">
        <label htmlFor={noteId} className="text-xs font-medium text-slate-200">
          Note {reasonCode === "OTHER" ? "(required)" : "(optional)"}
        </label>
        <textarea
          id={noteId}
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-300"
          placeholder="Add context for audit history"
        />
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/15 p-2 text-xs text-rose-200">
          {error}
        </div>
      )}
    </div>
  );
}
