"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { NumericKeypad } from "@/components/pos/numeric-keypad";
import { useAuth } from "@/hooks/use-auth";

const PIN_MAX_LENGTH = 6;
const PIN_MIN_LENGTH = 4;

function isKitchenAccessRole(role?: string): boolean {
  if (!role) return false;
  const normalised = role.toUpperCase();
  return normalised.includes("KITCHEN") || normalised.includes("ADMIN");
}

export default function KitchenLoginPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, user, pinLogin, error, clearError, logout } = useAuth();

  const kitchenCashierId = useMemo(() => {
    const raw = process.env.NEXT_PUBLIC_KITCHEN_CASHIER_ID ?? "4";
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 4;
  }, []);

  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) return;

    if (isKitchenAccessRole(user?.role)) {
      router.replace("/kitchen");
      return;
    }

    logout();
  }, [isAuthenticated, isLoading, logout, router, user?.role]);

  const submit = async () => {
    if (submitting) return;

    if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
      setPinError("PIN must be 4 to 6 digits.");
      return;
    }

    setSubmitting(true);
    setPinError(null);
    if (error) clearError();

    try {
      await pinLogin({ cashierId: kitchenCashierId, pin });
      router.replace("/kitchen");
    } catch {
      setPinError("Incorrect PIN.");
      setPin("");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (pin.length === PIN_MAX_LENGTH && !submitting) {
      void submit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <span className="text-lg text-slate-400 animate-pulse">Loading...</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-black/30">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/35">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-white">Kitchen Station</h1>
          <p className="mt-1 text-sm text-slate-400">Enter PIN to open the live kitchen queue.</p>
        </div>

        <div className="mb-4 flex justify-center gap-3">
          {Array.from({ length: PIN_MAX_LENGTH }).map((_, index) => (
            <div
              key={index}
              className={[
                "h-3.5 w-3.5 rounded-full border-2 transition-colors",
                index < pin.length ? "border-white bg-white" : "border-slate-600 bg-transparent",
              ].join(" ")}
            />
          ))}
        </div>

        {(pinError || error) && (
          <p className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-center text-sm text-rose-200">
            {pinError ?? error}
          </p>
        )}

        <NumericKeypad
          value={pin}
          onChange={(value) => {
            setPin(value);
            if (pinError) setPinError(null);
            if (error) clearError();
          }}
          maxLength={PIN_MAX_LENGTH}
          disabled={submitting}
        />

        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting || pin.length < PIN_MIN_LENGTH}
          className="mt-4 w-full rounded-2xl bg-blue-500 py-3.5 text-base font-semibold text-white transition hover:bg-blue-400 active:bg-blue-600 disabled:pointer-events-none disabled:opacity-50"
        >
          {submitting ? "Signing in..." : "Open Kitchen Queue"}
        </button>
      </div>
    </div>
  );
}
