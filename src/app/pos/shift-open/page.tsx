"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useShift } from "@/hooks/use-shift";
import { NumericKeypad } from "@/components/pos/numeric-keypad";
import { formatAmountInput, parseAmountInput } from "@/lib/amount-input";
import { DayClosedError } from "@/contexts/shift-context";

// Opening float is entered as typed, with "," for cents (e.g. "50,5" = R 50.50)
const MAX_FLOAT_WHOLE_DIGITS = 6; // up to R999,999.99

export default function ShiftOpenPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const { shift, isLoading: shiftLoading, openShift } = useShift();

  const [rawAmount, setRawAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when today already has a Z: opening is refused for the rest of the day, so no retry is offered.
  const [dayClosed, setDayClosed] = useState(false);

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
    if (!dayClosed) setError(null);
    setRawAmount(value);
  };

  const handleOpenShift = async () => {
    const amount = parseAmountInput(rawAmount);

    setSubmitting(true);
    setError(null);
    try {
      await openShift(amount);
      router.replace("/pos");
    } catch (err) {
      if (err instanceof DayClosedError) {
        setDayClosed(true);
        setError(err.message);
        return;
      }
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
        <div className="text-6xl font-bold tabular-nums text-white leading-none">
          {formatAmountInput(rawAmount)}
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
        value={rawAmount}
        onChange={handleAmountChange}
        maxLength={MAX_FLOAT_WHOLE_DIGITS}
        disabled={submitting || dayClosed}
        decimal
      />

      {/* Open shift button */}
      <button
        type="button"
        onClick={handleOpenShift}
        disabled={submitting || dayClosed}
        className="w-full max-w-xs rounded-2xl bg-emerald-500 py-4 text-lg font-semibold text-white transition-colors hover:bg-emerald-400 active:bg-emerald-600 disabled:opacity-50 disabled:pointer-events-none"
      >
        {submitting ? "Opening shift…" : "Open Shift"}
      </button>

      <p className="text-xs text-slate-600 text-center max-w-xs">
        A float of R 0.00 is allowed if no cash is being placed in the drawer.
      </p>
    </div>
  );
}
