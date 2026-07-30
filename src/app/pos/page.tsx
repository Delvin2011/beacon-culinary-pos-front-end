"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useShift } from "@/hooks/use-shift";
import { LogOut, Clock } from "lucide-react";
import { PosOrderBuilder } from "@/components/pos/order-builder";

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
  const { isAuthenticated, isLoading: authLoading, user, logout } = useAuth();
  const { shift, isLoading: shiftLoading, closeShift } = useShift();

  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

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

  const handleCloseShift = async () => {
    setClosing(true);
    setCloseError(null);
    try {
      await closeShift();
      logout();
      router.replace("/pos/login");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to close shift.";
      if (msg.toLowerCase().includes("unauthorized") || msg.toLowerCase().includes("session expired")) {
        logout();
        router.replace("/pos/login");
        return;
      }
      setCloseError(msg);
      setClosing(false);
      setConfirmClose(false);
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
              Since {formatTime(shift.openedAt)} · {formatDate(shift.openedAt)} · Float ${shift.openingFloat}
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          {user?.name && (
            <span className="text-sm text-slate-400">{user.name}</span>
          )}
          <button
            type="button"
            onClick={() => {
              setConfirmClose(true);
              setCloseError(null);
            }}
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
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-8 flex flex-col gap-6">
            <div className="text-center">
              <h2 className="text-xl font-bold text-white">Close Shift?</h2>
              <p className="mt-2 text-sm text-slate-400">
                This will end your current shift and return you to the login screen.
                You will not be able to reopen this shift.
              </p>
            </div>

            {closeError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300 text-center">
                {closeError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                disabled={closing}
                onClick={() => setConfirmClose(false)}
                className="flex-1 rounded-xl border border-slate-700 py-3 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={closing}
                onClick={handleCloseShift}
                className="flex-1 rounded-xl bg-rose-500 py-3 text-sm font-semibold text-white transition-colors hover:bg-rose-400 active:bg-rose-600 disabled:opacity-50"
              >
                {closing ? "Closing…" : "Close Shift"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
