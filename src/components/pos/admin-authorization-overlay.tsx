"use client";

import { type ReactNode } from "react";
import { NumericKeypad } from "@/components/pos/numeric-keypad";

type AdminAuthorizationOverlayProps = {
  isOpen: boolean;
  title: string;
  description: string;
  pin: string;
  onPinChange: (value: string) => void;
  error?: string | null;
  submitting?: boolean;
  submitLabel?: string;
  onSubmit: () => void;
  onBack: () => void;
  canSubmit?: boolean;
  maxPinLength?: number;
  children?: ReactNode;
};

export function AdminAuthorizationOverlay({
  isOpen,
  title,
  description,
  pin,
  onPinChange,
  error,
  submitting = false,
  submitLabel = "Authorize",
  onSubmit,
  onBack,
  canSubmit,
  maxPinLength = 6,
  children,
}: AdminAuthorizationOverlayProps) {
  if (!isOpen) return null;

  const submitAllowed = canSubmit ?? pin.trim().length >= 4;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-md rounded-2xl border border-amber-300/30 bg-slate-900 p-5">
        <h3 className="text-lg font-bold text-white">{title}</h3>
        <p className="mt-1 text-sm text-slate-300">{description}</p>

        {children}

        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950 p-3 text-center">
          <p className="text-xs uppercase tracking-wide text-slate-400">PIN</p>
          <p className="mt-1 text-3xl font-black text-white">
            {pin.length === 0 ? "----" : "*".repeat(pin.length)}
          </p>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/15 p-2 text-sm text-rose-200">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-center">
          <NumericKeypad value={pin} onChange={onPinChange} maxLength={maxPinLength} disabled={submitting} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={onBack}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            Back
          </button>
          <button
            type="button"
            disabled={submitting || !submitAllowed}
            onClick={onSubmit}
            className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Authorizing..." : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
