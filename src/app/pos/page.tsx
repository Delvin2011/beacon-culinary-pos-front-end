"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useShift } from "@/hooks/use-shift";
import { LogOut, Clock } from "lucide-react";
import { PosOrderBuilder } from "@/components/pos/order-builder";
import { NumericKeypad } from "@/components/pos/numeric-keypad";
import { AdminAuthorizationOverlay } from "@/components/pos/admin-authorization-overlay";
import { formatZarCurrency } from "@/lib/utils";

type VarianceReasonCode = "CASH_COUNTING_ERROR" | "THEFT_SUSPECTED" | "UNRECORDED_TRANSACTION" | "OTHER";

type ShiftSummaryDto = {
  shiftId: number;
  openingFloat: number;
  cashSalesTotal: number;
  adjustmentsTotal: number;
  expectedCash: number;
  orderCount: number;
};

type ShiftCloseAuthorization = {
  reasonCode: VarianceReasonCode;
  note?: string;
  authorizationToken: string;
};

type ShiftCloseRequest = {
  countedCash: number;
  varianceAuthorization?: ShiftCloseAuthorization;
};

type ShiftCloseResponse = {
  id: number;
  cashierId: number;
  status: "OPEN" | "CLOSED";
  openingFloat: number;
  openedAt: string;
  closedAt?: string | null;
  closingCash?: number;
  expectedCash?: number;
  variance?: number;
  varianceReasonCode?: VarianceReasonCode;
  varianceNote?: string;
  varianceAuthorizedById?: number;
};

type VarianceDecision = {
  variance: number;
  isZero: boolean;
  direction: "OVER" | "SHORT" | "EVEN";
};

const MAX_CASH_DIGITS = 7;

const VARIANCE_REASON_OPTIONS: Array<{ value: VarianceReasonCode; label: string }> = [
  { value: "CASH_COUNTING_ERROR", label: "Cash Counting Error" },
  { value: "THEFT_SUSPECTED", label: "Theft Suspected" },
  { value: "UNRECORDED_TRANSACTION", label: "Unrecorded Transaction" },
  { value: "OTHER", label: "Other" },
];

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function PosMainPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user, logout, authFetch } = useAuth();
  const { shift, isLoading: shiftLoading, refetch } = useShift();

  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeSummary, setCloseSummary] = useState<ShiftSummaryDto | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [countedCashInput, setCountedCashInput] = useState("");
  const [showVarianceReview, setShowVarianceReview] = useState(false);
  const [showPinOverlay, setShowPinOverlay] = useState(false);
  const [managerPinInput, setManagerPinInput] = useState("");
  const [managerPinError, setManagerPinError] = useState<string | null>(null);
  const [varianceReasonCode, setVarianceReasonCode] = useState<VarianceReasonCode>("CASH_COUNTING_ERROR");
  const [varianceNote, setVarianceNote] = useState("");
  const [varianceFormError, setVarianceFormError] = useState<string | null>(null);
  const [closeoutRecord, setCloseoutRecord] = useState<ShiftCloseResponse | null>(null);

  // Auth guard
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/pos/login");
    }
  }, [isAuthenticated, authLoading, router]);

  // Shift guard — must have an open shift to be here
  useEffect(() => {
    if (!shiftLoading && !shift) {
      router.replace("/pos/shift-open");
    }
  }, [shift, shiftLoading, router]);

  const parseMessage = (payload: unknown, fallback: string): string => {
    if (!payload || typeof payload !== "object") return fallback;
    const source = payload as Record<string, unknown>;
    if (typeof source.message === "string" && source.message.trim()) return source.message;
    if (typeof source.error === "string" && source.error.trim()) return source.error;
    return fallback;
  };

  const toUnits = (raw: string): number => {
    if (!raw) return 0;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, parsed);
  };

  const evaluateVariance = (expectedCash: number, countedCash: number): VarianceDecision => {
    const variance = countedCash - expectedCash;
    if (Math.abs(variance) < 0.000001) {
      return { variance: 0, isZero: true, direction: "EVEN" };
    }
    return {
      variance,
      isZero: false,
      direction: variance > 0 ? "OVER" : "SHORT",
    };
  };

  const resetCloseFlow = () => {
    setConfirmClose(false);
    setClosing(false);
    setCloseError(null);
    setCloseSummary(null);
    setCountedCashInput("");
    setShowVarianceReview(false);
    setShowPinOverlay(false);
    setManagerPinInput("");
    setManagerPinError(null);
    setVarianceReasonCode("CASH_COUNTING_ERROR");
    setVarianceNote("");
    setVarianceFormError(null);
  };

  const loadShiftSummary = async () => {
    if (!shift) return;

    setSummaryLoading(true);
    setCloseError(null);

    try {
      const res = await authFetch(`/shifts/${shift.id}/summary`);
      const body = (await res.json().catch(() => null)) as ShiftSummaryDto | Record<string, unknown> | null;

      if (res.status === 404) {
        throw new Error(
          "Shift summary endpoint is not available on the current backend. Deploy/restart the Stage 2.5 backend and try again.",
        );
      }

      if (!res.ok || !body) {
        throw new Error(parseMessage(body, "Unable to load shift summary."));
      }

      setCloseSummary(body as ShiftSummaryDto);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load shift summary.";
      setCloseError(message);
    } finally {
      setSummaryLoading(false);
    }
  };

  const closeShiftRequest = async (payload: ShiftCloseRequest): Promise<ShiftCloseResponse> => {
    if (!shift) {
      throw new Error("No open shift to close.");
    }

    const res = await authFetch(`/shifts/${shift.id}/close`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = (await res.json().catch(() => null)) as ShiftCloseResponse | Record<string, unknown> | null;

    if (res.status === 401) {
      throw new Error("Session expired or unauthorized. Please log in again.");
    }

    if (!res.ok || !body) {
      const message = parseMessage(body, "Failed to close shift.");
      const error = new Error(message);
      (error as Error & { status?: number }).status = res.status;
      throw error;
    }

    return body as ShiftCloseResponse;
  };

  const runZeroVarianceClose = async (countedCash: number) => {
    setClosing(true);
    setCloseError(null);

    try {
      const closed = await closeShiftRequest({ countedCash });
      setCloseoutRecord(closed);
      setConfirmClose(false);
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      const message = err instanceof Error ? err.message : "Failed to close shift.";

      if (message.toLowerCase().includes("session expired") || message.toLowerCase().includes("unauthorized")) {
        logout();
        router.replace("/pos/login");
        return;
      }

      if (status === 409) {
        await refetch();
        setCloseError("This shift is already closed. The latest status has been loaded.");
      } else {
        setCloseError(message);
      }
    } finally {
      setClosing(false);
    }
  };

  const openCloseFlow = () => {
    setConfirmClose(true);
    setShowVarianceReview(false);
    setShowPinOverlay(false);
    setCloseError(null);
    setManagerPinError(null);
    setVarianceFormError(null);
    void loadShiftSummary();
  };

  const submitCountedCash = () => {
    if (!closeSummary) return;

    const countedCash = toUnits(countedCashInput);
    const review = evaluateVariance(closeSummary.expectedCash, countedCash);

    if (review.isZero) {
      void runZeroVarianceClose(countedCash);
      return;
    }

    setShowVarianceReview(true);
    setVarianceFormError(null);
    setManagerPinError(null);
    setShowPinOverlay(false);
  };

  const openVarianceAuthorization = () => {
    if (varianceReasonCode === "OTHER" && varianceNote.trim().length === 0) {
      setVarianceFormError("A note is required when reason is Other.");
      return;
    }

    setVarianceFormError(null);
    setManagerPinError(null);
    setShowPinOverlay(true);
  };

  const submitVarianceClose = async () => {
    if (!closeSummary) return;
    if (managerPinInput.trim().length < 4) {
      setManagerPinError("Enter the manager PIN to continue.");
      return;
    }

    const countedCash = toUnits(countedCashInput);
    setClosing(true);
    setManagerPinError(null);
    setCloseError(null);

    try {
      const authRes = await authFetch("/admin/authorize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pin: managerPinInput }),
      });

      const authBody = (await authRes.json().catch(() => null)) as
        | { authorizationToken?: string }
        | Record<string, unknown>
        | null;

      if (authRes.status === 401) {
        setManagerPinError("Incorrect manager PIN. Try again.");
        setManagerPinInput("");
        return;
      }

      if (!authRes.ok || !authBody) {
        throw new Error(parseMessage(authBody, "Authorization failed."));
      }

      const authorizationToken =
        typeof authBody === "object" && authBody && "authorizationToken" in authBody
          ? (authBody as { authorizationToken?: string }).authorizationToken
          : undefined;

      if (!authorizationToken) {
        throw new Error("Authorization token was not returned.");
      }

      const closePayload: ShiftCloseRequest = {
        countedCash,
        varianceAuthorization: {
          reasonCode: varianceReasonCode,
          note: varianceNote.trim() || undefined,
          authorizationToken,
        },
      };

      const closed = await closeShiftRequest(closePayload);
      setCloseoutRecord(closed);
      setShowPinOverlay(false);
      setConfirmClose(false);
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      const message = err instanceof Error ? err.message : "Failed to close shift.";

      if (message.toLowerCase().includes("session expired") || message.toLowerCase().includes("unauthorized")) {
        logout();
        router.replace("/pos/login");
        return;
      }

      if (status === 409) {
        await refetch();
        setShowPinOverlay(false);
        setCloseError("This shift is already closed. The latest status has been loaded.");
        return;
      }

      setManagerPinError(message);
    } finally {
      setClosing(false);
    }
  };

  if (authLoading || shiftLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <span className="text-slate-400 text-lg animate-pulse">Loading…</span>
      </div>
    );
  }

  if (closeoutRecord) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
        <div className="w-full max-w-xl rounded-3xl border border-emerald-500/35 bg-slate-900 p-6">
          <div className="mb-4">
            <p className="text-xs uppercase tracking-[0.15em] text-emerald-300">Shift Closed</p>
            <h1 className="mt-1 text-2xl font-bold text-white">Close-Out Summary</h1>
          </div>

          <div className="grid gap-2 text-sm text-slate-200">
            <p>Opening Float: {formatZarCurrency(closeoutRecord.openingFloat ?? 0)}</p>
            <p>Expected Cash: {formatZarCurrency(closeoutRecord.expectedCash ?? 0)}</p>
            <p>Counted Cash: {formatZarCurrency(closeoutRecord.closingCash ?? 0)}</p>
            <p>Variance: {formatZarCurrency(closeoutRecord.variance ?? 0)}</p>
            {closeoutRecord.varianceReasonCode && <p>Reason: {closeoutRecord.varianceReasonCode.replaceAll("_", " ")}</p>}
            {closeoutRecord.varianceNote && <p>Note: {closeoutRecord.varianceNote}</p>}
          </div>

          <button
            type="button"
            onClick={() => {
              resetCloseFlow();
              setCloseoutRecord(null);
              logout();
              router.replace("/pos/login");
            }}
            className="mt-6 w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-400"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  const countedCashUnits = toUnits(countedCashInput);
  const currentVariance = closeSummary ? evaluateVariance(closeSummary.expectedCash, countedCashUnits) : null;

  return (
    <div className="flex min-h-screen flex-col bg-slate-950">
      {/* ── Shift chrome header ───────────────────────────────────────────── */}
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-6 py-3">
        <div className="flex items-center gap-3">
          {/* Shift open indicator */}
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-400 ring-1 ring-emerald-500/30">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Shift Open
          </span>
          {shift && (
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <Clock className="h-3 w-3" />
              Since {formatTime(shift.openedAt)} · {formatDate(shift.openedAt)} · Float {formatZarCurrency(shift.openingFloat)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          {user?.name && (
            <span className="text-sm text-slate-400">{user.name}</span>
          )}
          <button
            type="button"
            onClick={openCloseFlow}
            className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-400 transition-colors hover:bg-rose-500/20 active:bg-rose-500/30"
          >
            <LogOut className="h-3.5 w-3.5" />
            Close Shift
          </button>
        </div>
      </header>

      <PosOrderBuilder />

      {/* ── Close-shift confirmation overlay ─────────────────────────────── */}
      {confirmClose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-800 p-6 flex flex-col gap-5">
            <div>
              <h2 className="text-xl font-bold text-white">Cash Reconciliation</h2>
              <p className="mt-1 text-sm text-slate-400">
                Count cash in drawer and reconcile against expected cash before closing.
              </p>
            </div>

            {closeError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                {closeError}
              </div>
            )}

            {summaryLoading ? (
              <p className="text-sm text-slate-300">Loading shift summary...</p>
            ) : closeSummary ? (
              <>
                <div className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-sm text-slate-200 sm:grid-cols-2">
                  <p>Opening Float: {formatZarCurrency(closeSummary.openingFloat)}</p>
                  <p>Cash Sales: {formatZarCurrency(closeSummary.cashSalesTotal)}</p>
                  <p>Adjustments: {formatZarCurrency(closeSummary.adjustmentsTotal)}</p>
                  <p className="text-base font-semibold text-emerald-200">Expected Cash: {formatZarCurrency(closeSummary.expectedCash)}</p>
                </div>

                <div>
                  <p className="mb-2 text-sm text-slate-300">Enter Counted Cash</p>
                  <div className="mb-3 rounded-xl border border-slate-700 bg-slate-950 p-3 text-center text-4xl font-black text-white">
                    {formatZarCurrency(countedCashUnits)}
                  </div>

                  <div className="flex justify-center">
                    <NumericKeypad
                      value={countedCashInput}
                      onChange={setCountedCashInput}
                      maxLength={MAX_CASH_DIGITS}
                      disabled={closing}
                    />
                  </div>
                </div>

                {showVarianceReview && currentVariance && (
                  <div className="rounded-xl border border-amber-300/30 bg-amber-400/10 p-4 text-sm text-amber-100">
                    <p className="font-semibold">
                      {currentVariance.direction === "OVER"
                        ? "Overage detected"
                        : currentVariance.direction === "SHORT"
                        ? "Shortage detected"
                        : "Counted matches expected"}
                    </p>
                    <p className="mt-1">
                      Variance: {formatZarCurrency(Math.abs(currentVariance.variance))}
                    </p>

                    {!currentVariance.isZero && (
                      <>
                        <p className="mt-3 text-xs uppercase tracking-wide">Variance Reason</p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {VARIANCE_REASON_OPTIONS.map((option) => {
                            const active = option.value === varianceReasonCode;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => {
                                  setVarianceReasonCode(option.value);
                                  if (option.value !== "OTHER") setVarianceFormError(null);
                                }}
                                className={`rounded-lg border px-3 py-2 text-left text-sm font-semibold ${
                                  active
                                    ? "border-amber-200 bg-amber-300/30 text-amber-50"
                                    : "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                                }`}
                              >
                                {option.label}
                              </button>
                            );
                          })}
                        </div>

                        <div className="mt-3">
                          <label htmlFor="variance-note" className="text-xs text-slate-200">
                            Note {varianceReasonCode === "OTHER" ? "(required)" : "(optional)"}
                          </label>
                          <textarea
                            id="variance-note"
                            rows={3}
                            value={varianceNote}
                            onChange={(event) => {
                              setVarianceNote(event.target.value);
                              if (varianceReasonCode === "OTHER" && event.target.value.trim().length > 0) {
                                setVarianceFormError(null);
                              }
                            }}
                            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-200"
                            placeholder="Add context for this variance"
                          />
                        </div>

                        {varianceFormError && (
                          <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/15 p-2 text-xs text-rose-200">
                            {varianceFormError}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </>
            ) : null}

            <div className="flex gap-3">
              <button
                type="button"
                disabled={closing}
                onClick={resetCloseFlow}
                className="flex-1 rounded-xl border border-slate-700 py-3 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
              >
                Cancel
              </button>
              {!showVarianceReview ? (
                <button
                  type="button"
                  disabled={closing || summaryLoading || !closeSummary}
                  onClick={submitCountedCash}
                  className="flex-1 rounded-xl bg-rose-500 py-3 text-sm font-semibold text-white transition-colors hover:bg-rose-400 active:bg-rose-600 disabled:opacity-50"
                >
                  {closing ? "Closing..." : "Review Variance"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={closing || !currentVariance}
                  onClick={() => {
                    if (!currentVariance) return;
                    if (currentVariance.isZero) {
                      void runZeroVarianceClose(countedCashUnits);
                      return;
                    }
                    openVarianceAuthorization();
                  }}
                  className="flex-1 rounded-xl bg-amber-400 py-3 text-sm font-semibold text-slate-900 transition-colors hover:bg-amber-300 disabled:opacity-50"
                >
                  {currentVariance?.isZero ? "Close Shift" : "Authorize & Close"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <AdminAuthorizationOverlay
        isOpen={showPinOverlay}
        title="Manager PIN Required"
        description="Enter admin PIN to authorize this shift variance."
        pin={managerPinInput}
        onPinChange={setManagerPinInput}
        error={managerPinError}
        submitting={closing}
        submitLabel="Authorize & Close"
        canSubmit={managerPinInput.trim().length >= 4}
        onBack={() => {
          setShowPinOverlay(false);
          setManagerPinInput("");
          setManagerPinError(null);
        }}
        onSubmit={() => void submitVarianceClose()}
      />
    </div>
  );
}
