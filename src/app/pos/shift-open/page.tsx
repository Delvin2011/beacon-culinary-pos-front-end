"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useShift } from "@/hooks/use-shift";
import { NumericKeypad } from "@/components/pos/numeric-keypad";

// Opening float is entered as whole currency units (e.g. 50 = $50.00)
const MAX_FLOAT_DIGITS = 6; // up to 999999

function formatFloat(raw: string): string {
  if (!raw || raw === "0") return "0";
  // Strip leading zeros
  return String(parseInt(raw, 10));
}

export default function ShiftOpenPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const { shift, isLoading: shiftLoading, openShift } = useShift();

  const [rawAmount, setRawAmount] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auth guard
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/pos/login");
    }
  }, [isAuthenticated, authLoading, router]);

  // If a shift is already open, skip this screen
  useEffect(() => {
    if (!shiftLoading && shift) {
      router.replace("/pos");
    }
  }, [shift, shiftLoading, router]);

  const handleAmountChange = (value: string) => {
    setError(null);
    // Prevent leading zeros (except plain "0")
    const cleaned = value.replace(/^0+(\d)/, "$1") || "0";
    setRawAmount(cleaned);
  };

  const handleOpenShift = async () => {
    const amount = parseInt(rawAmount, 10);
    if (isNaN(amount) || amount < 0) {
      setError("Please enter a valid opening float amount.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await openShift(amount);
      router.replace("/pos");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to open shift.";
      if (msg.includes("already open")) {
        // Shift was opened in another tab / race — redirect
        router.replace("/pos");
        return;
      }
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || shiftLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <span className="text-slate-400 text-lg animate-pulse">Loading…</span>
      </div>
    );
  }

  const displayAmount = formatFloat(rawAmount);
  const numericAmount = parseInt(rawAmount, 10);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-slate-950 p-8">
      {/* Greeting */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white">
          {user?.name ? `Hi, ${user.name}` : "Welcome"}
        </h1>
        <p className="mt-1 text-slate-400">Enter your opening float to begin</p>
      </div>

      {/* Amount display */}
      <div className="flex flex-col items-center gap-1">
        <span className="text-sm font-medium uppercase tracking-widest text-slate-500">
          Opening Float
        </span>
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-light text-slate-400">$</span>
          <span className="text-7xl font-bold tabular-nums text-white leading-none">
            {displayAmount}
          </span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-3 text-sm text-rose-300 text-center max-w-xs">
          {error}
        </div>
      )}

      {/* Keypad */}
      <NumericKeypad
        value={rawAmount === "0" ? "" : rawAmount}
        onChange={(v) => handleAmountChange(v === "" ? "0" : v)}
        maxLength={MAX_FLOAT_DIGITS}
        disabled={submitting}
      />

      {/* Open shift button */}
      <button
        type="button"
        onClick={handleOpenShift}
        disabled={submitting || numericAmount < 0}
        className="w-full max-w-xs rounded-2xl bg-emerald-500 py-4 text-lg font-semibold text-white transition-colors hover:bg-emerald-400 active:bg-emerald-600 disabled:opacity-50 disabled:pointer-events-none"
      >
        {submitting ? "Opening shift…" : "Open Shift"}
      </button>

      <p className="text-xs text-slate-600 text-center max-w-xs">
        A float of $0 is allowed if no cash is being placed in the drawer.
      </p>
    </div>
  );
}
