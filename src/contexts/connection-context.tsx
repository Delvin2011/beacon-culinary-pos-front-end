"use client";

// Online/offline for the till, with hysteresis: one failed or successful result never flips the state.
// Signals come from a /health ping (every 25 s, every 10 s while offline) and from every authFetch outcome.
// Selling offline is not part of O1: while offline, Confirm waits for the connection.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  signalForError,
  signalForHealth,
  subscribeConnectionSignals,
  type ConnectionSignal,
  type OfflineReason,
} from "@/lib/connection-signals";
import { HEALTH_TIMEOUT_MS, fetchWithTimeout } from "@/lib/net";

export const OFFLINE_AFTER = 3; // consecutive failures before going offline
export const ONLINE_AFTER = 2; // consecutive successes before coming back online
export const PING_INTERVAL_MS = 25_000;
export const OFFLINE_PING_INTERVAL_MS = 10_000;
// Request signals closer together than this count once: a burst of parallel requests failing together is one blip.
export const SIGNAL_COALESCE_MS = 1_000;

export type ConnectionStatus = "online" | "offline";

export type ConnectionState = {
  status: ConnectionStatus;
  reason: OfflineReason | null; // why it is offline
  streak: number; // consecutive results pointing the other way
};

export const INITIAL_CONNECTION: ConnectionState = { status: "online", reason: null, streak: 0 };

// The hysteresis, as a pure function.
export function nextConnectionState(state: ConnectionState, signal: ConnectionSignal): ConnectionState {
  if (state.status === "online") {
    if (signal.ok) return state.streak === 0 ? state : { ...state, streak: 0 };
    const streak = state.streak + 1;
    return streak >= OFFLINE_AFTER ? { status: "offline", reason: signal.reason, streak: 0 } : { ...state, streak };
  }
  if (!signal.ok) return { status: "offline", reason: signal.reason, streak: 0 };
  const streak = state.streak + 1;
  return streak >= ONLINE_AFTER ? INITIAL_CONNECTION : { ...state, streak };
}

type ConnectionContextValue = {
  status: ConnectionStatus;
  reason: OfflineReason | null;
  isOnline: boolean;
  // Ping now (e.g. a "Check again" button).
  checkNow: () => void;
};

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

const API_BASE = process.env.NEXT_PUBLIC_AUTH_API_URL ?? "http://localhost:8080";

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConnectionState>(INITIAL_CONNECTION);
  const lastSignalAtRef = useRef<{ ok: boolean; at: number } | null>(null);

  const apply = useCallback((signal: ConnectionSignal, coalesce: boolean) => {
    const now = Date.now();
    const last = lastSignalAtRef.current;
    if (coalesce && last && last.ok === signal.ok && now - last.at < SIGNAL_COALESCE_MS) return;
    lastSignalAtRef.current = { ok: signal.ok, at: now };
    setState((prev) => nextConnectionState(prev, signal));
  }, []);

  const ping = useCallback(async () => {
    const url = `${API_BASE}/health`;
    try {
      const res = await fetchWithTimeout(url, { cache: "no-store", credentials: "omit" }, HEALTH_TIMEOUT_MS);
      const signal = signalForHealth(res.status);
      if (signal) apply(signal, false);
    } catch (err) {
      const signal = signalForError(err);
      if (signal) apply(signal, false);
    }
  }, [apply]);

  // Ordinary requests (reported by authFetch).
  useEffect(() => subscribeConnectionSignals((signal) => apply(signal, true)), [apply]);

  // The ping: at once, then on an interval that is shorter while offline.
  const isOnline = state.status === "online";
  useEffect(() => {
    void ping();
    const timer = window.setInterval(() => void ping(), isOnline ? PING_INTERVAL_MS : OFFLINE_PING_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [ping, isOnline]);

  // The browser's own hints: "offline" counts as one failure; "online" triggers a ping rather than trusting it.
  useEffect(() => {
    const onOffline = () => apply({ ok: false, reason: "no-connection" }, false);
    const onOnline = () => void ping();
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [apply, ping]);

  const value = useMemo<ConnectionContextValue>(
    () => ({ status: state.status, reason: state.reason, isOnline, checkNow: () => void ping() }),
    [state.status, state.reason, isOnline, ping],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

const ALWAYS_ONLINE: ConnectionContextValue = { status: "online", reason: null, isOnline: true, checkNow: () => {} };

// Outside a ConnectionProvider (back office, tests) the till is treated as online.
export function useConnection(): ConnectionContextValue {
  return useContext(ConnectionContext) ?? ALWAYS_ONLINE;
}
