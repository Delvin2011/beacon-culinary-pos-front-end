"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { NumericKeypad } from "@/components/pos/numeric-keypad";
import { ChevronLeft, User } from "lucide-react";

// Shape returned by GET /users/cashiers
interface CashierSummary {
  id: number;
  name: string;
}

const API_BASE = process.env.NEXT_PUBLIC_AUTH_API_URL ?? "http://localhost:8080";

type View = "select-cashier" | "enter-pin";

const PIN_MAX_LENGTH = 6;

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// Deterministic tile colour from cashier id
const TILE_COLOURS = [
  "bg-blue-600",
  "bg-emerald-600",
  "bg-violet-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-cyan-600",
];
function tileColour(id: number) {
  return TILE_COLOURS[id % TILE_COLOURS.length];
}

export default function PosLoginPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, pinLogin, error, clearError } = useAuth();

  const [view, setView] = useState<View>("select-cashier");
  const [cashiers, setCashiers] = useState<CashierSummary[]>([]);
  const [cashiersLoading, setCashiersLoading] = useState(true);
  const [cashiersError, setCashiersError] = useState<string | null>(null);
  const [selectedCashier, setSelectedCashier] = useState<CashierSummary | null>(null);
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  // Already authenticated — let /pos handle shift routing
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.replace("/pos");
    }
  }, [isAuthenticated, authLoading, router]);

  // Fetch cashier list (unauthenticated — no token needed)
  useEffect(() => {
    setCashiersLoading(true);
    setCashiersError(null);

    fetch(`${API_BASE}/users/cashiers`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data = (await res.json()) as unknown;
        if (!Array.isArray(data)) throw new Error("Unexpected response format");
        setCashiers(
          (data as Record<string, unknown>[]).map((u) => ({
            id: u.id as number,
            name: u.name as string,
          })),
        );
      })
      .catch(() => {
        setCashiersError(
          "Could not load cashier list. Please check your connection or contact the administrator.",
        );
      })
      .finally(() => setCashiersLoading(false));
  }, []);

  const handleCashierSelect = (cashier: CashierSummary) => {
    setSelectedCashier(cashier);
    setPin("");
    setPinError(null);
    if (error) clearError();
    setView("enter-pin");
  };

  const handleBackToSelect = () => {
    setView("select-cashier");
    setSelectedCashier(null);
    setPin("");
    setPinError(null);
    if (error) clearError();
  };

  const handlePinChange = (newPin: string) => {
    setPin(newPin);
    // Clear error on any keypad interaction
    if (pinError) setPinError(null);
    if (error) clearError();
  };

  const handleSubmitPin = async () => {
    if (!selectedCashier || pin.length === 0 || submitting) return;

    setSubmitting(true);
    setPinError(null);
    try {
      await pinLogin({ cashierId: selectedCashier.id, pin });
      router.replace("/pos");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Incorrect PIN.";
      // Always surface as generic PIN error — never reveal cashier existence
      setPinError(msg === "Incorrect PIN." ? msg : "Incorrect PIN.");
      setPin("");
    } finally {
      setSubmitting(false);
    }
  };

  // Auto-submit once PIN reaches max length
  useEffect(() => {
    if (pin.length === PIN_MAX_LENGTH && !submitting) {
      handleSubmitPin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <span className="text-slate-400 text-lg animate-pulse">Loading…</span>
      </div>
    );
  }

  // ── SELECT CASHIER ──────────────────────────────────────────────────────────
  if (view === "select-cashier") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-10 bg-slate-950 p-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white">Who&apos;s working?</h1>
          <p className="mt-1 text-slate-400">Tap your name to continue</p>
        </div>

        {cashiersLoading && (
          <p className="text-slate-400 animate-pulse">Loading cashiers…</p>
        )}

        {cashiersError && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-6 py-4 text-center text-rose-300 max-w-sm">
            {cashiersError}
          </div>
        )}

        {!cashiersLoading && !cashiersError && cashiers.length === 0 && (
          <div className="rounded-xl border border-slate-700 bg-slate-800 px-6 py-4 text-center text-slate-400 max-w-sm">
            No active cashiers found.
          </div>
        )}

        {!cashiersLoading && cashiers.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 w-full max-w-xl">
            {cashiers.map((cashier) => (
              <button
                key={cashier.id}
                type="button"
                onClick={() => handleCashierSelect(cashier)}
                className="flex flex-col items-center gap-3 rounded-2xl bg-slate-800 p-6 transition-colors hover:bg-slate-700 active:scale-95 active:bg-slate-600 select-none"
              >
                <div
                  className={`flex h-16 w-16 items-center justify-center rounded-full text-xl font-bold text-white ${tileColour(cashier.id)}`}
                >
                  {getInitials(cashier.name)}
                </div>
                <span className="text-sm font-medium text-white text-center leading-tight">
                  {cashier.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── ENTER PIN ───────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-slate-950 p-8">
      {/* Back button */}
      <div className="w-full max-w-xs">
        <button
          type="button"
          onClick={handleBackToSelect}
          className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors text-sm"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
      </div>

      {/* Selected cashier identity */}
      <div className="flex flex-col items-center gap-3">
        <div
          className={`flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold text-white ${tileColour(selectedCashier!.id)}`}
        >
          {selectedCashier ? getInitials(selectedCashier.name) : <User />}
        </div>
        <p className="text-xl font-semibold text-white">{selectedCashier?.name}</p>
        <p className="text-sm text-slate-400">Enter your PIN</p>
      </div>

      {/* PIN dots */}
      <div className="flex gap-4">
        {Array.from({ length: PIN_MAX_LENGTH }).map((_, i) => (
          <div
            key={i}
            className={`h-4 w-4 rounded-full border-2 transition-colors ${
              i < pin.length
                ? "bg-white border-white"
                : "bg-transparent border-slate-600"
            }`}
          />
        ))}
      </div>

      {/* Error */}
      {pinError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-3 text-sm text-rose-300 text-center max-w-xs">
          {pinError}
        </div>
      )}

      {/* Keypad */}
      <NumericKeypad
        value={pin}
        onChange={handlePinChange}
        maxLength={PIN_MAX_LENGTH}
        disabled={submitting}
      />

      {/* Explicit submit for short PINs (< max length) */}
      {pin.length > 0 && pin.length < PIN_MAX_LENGTH && (
        <button
          type="button"
          onClick={handleSubmitPin}
          disabled={submitting}
          className="w-full max-w-xs rounded-2xl bg-white py-4 text-lg font-semibold text-slate-950 transition-colors hover:bg-slate-200 active:bg-slate-300 disabled:opacity-50"
        >
          {submitting ? "Checking…" : "Login"}
        </button>
      )}
    </div>
  );
}
