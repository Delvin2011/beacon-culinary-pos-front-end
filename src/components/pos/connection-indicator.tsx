"use client";

import { Ban, Wifi, WifiOff } from "lucide-react";
import { useConnection } from "@/contexts/connection-context";

// A small online/offline badge for the POS header. T1-3: a suspended customer shows "Service suspended", never
// "Offline" (the full-page message explains it; src/components/customer/customer-status-gate.tsx).
export function ConnectionIndicator() {
  const { isOnline, reason, suspended, checkNow } = useConnection();

  if (suspended) {
    return (
      <span
        role="status"
        aria-label="Connection: Service suspended"
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-200"
      >
        <Ban className="h-3.5 w-3.5" />
        Service suspended
      </span>
    );
  }

  if (isOnline) {
    return (
      <span
        role="status"
        aria-label="Connection: online"
        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300"
      >
        <Wifi className="h-3.5 w-3.5" />
        Online
      </span>
    );
  }

  const label = reason === "server-down" ? "Server unavailable" : "Offline";
  return (
    <button
      type="button"
      role="status"
      aria-label={`Connection: ${label}. Check again`}
      onClick={checkNow}
      title="Sales wait until the connection is back. Tap to check again."
      className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/40 bg-rose-500/15 px-3 py-1 text-xs font-semibold text-rose-200 hover:bg-rose-500/25"
    >
      <WifiOff className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
