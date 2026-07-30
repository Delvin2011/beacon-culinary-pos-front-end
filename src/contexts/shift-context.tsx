"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/hooks/use-auth";

export interface Shift {
  id: number;
  cashierId: number;
  status: "OPEN" | "CLOSED";
  openingFloat: number;
  openedAt: string;
  closedAt?: string | null;
}

interface ShiftContextValue {
  shift: Shift | null;
  isLoading: boolean;
  error: string | null;
  openShift: (openingFloat: number) => Promise<void>;
  closeShift: () => Promise<void>;
  refetch: () => Promise<void>;
}

export const ShiftContext = createContext<ShiftContextValue | undefined>(undefined);

function extractShift(payload: unknown): Shift | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;
  const src =
    raw.data && typeof raw.data === "object"
      ? (raw.data as Record<string, unknown>)
      : raw;

  if (typeof src.id !== "number") return null;

  return {
    id: src.id as number,
    cashierId: src.cashierId as number,
    status: src.status as "OPEN" | "CLOSED",
    openingFloat: src.openingFloat as number,
    openedAt: src.openedAt as string,
    closedAt: typeof src.closedAt === "string" ? src.closedAt : null,
  };
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const data = payload as Record<string, unknown>;
  if (typeof data.message === "string" && data.message.trim()) return data.message;
  if (typeof data.error === "string" && data.error.trim()) return data.error;
  return fallback;
}

export function ShiftProvider({ children }: { children: ReactNode }) {
  const { authFetch, isAuthenticated } = useAuth();
  const [shift, setShift] = useState<Shift | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCurrentShift = useCallback(async () => {
    if (!isAuthenticated) {
      setShift(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const res = await authFetch("/shifts/current");
      if (res.status === 404) {
        setShift(null);
        return;
      }
      if (!res.ok) {
        setError("Failed to load shift status.");
        return;
      }
      const body = (await res.json().catch(() => null)) as unknown;
      setShift(extractShift(body));
    } catch {
      setError("Failed to load shift status.");
    } finally {
      setIsLoading(false);
    }
  }, [authFetch, isAuthenticated]);

  useEffect(() => {
    fetchCurrentShift();
  }, [fetchCurrentShift]);

  const openShift = useCallback(
    async (openingFloat: number) => {
      const res = await authFetch("/shifts/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openingFloat }),
      });

      const body = (await res.json().catch(() => null)) as unknown;

      if (res.status === 409) {
        // Already open — sync state so the UI can redirect correctly
        await fetchCurrentShift();
        throw new Error("A shift is already open for this cashier.");
      }

      if (!res.ok) {
        throw new Error(extractErrorMessage(body, "Failed to open shift."));
      }

      setShift(extractShift(body));
      setError(null);
    },
    [authFetch, fetchCurrentShift],
  );

  const closeShift = useCallback(async () => {
    if (!shift) throw new Error("No open shift to close.");

    const res = await authFetch(`/shifts/${shift.id}/close`, {
      method: "POST",
    });
    const body = (await res.json().catch(() => null)) as unknown;

    if (res.status === 401) {
      throw new Error("Session expired or unauthorized. Please log in again.");
    }

    if (!res.ok) {
      throw new Error(extractErrorMessage(body, "Failed to close shift."));
    }

    setShift(null);
    setError(null);
  }, [authFetch, shift]);

  const value = useMemo<ShiftContextValue>(
    () => ({
      shift,
      isLoading,
      error,
      openShift,
      closeShift,
      refetch: fetchCurrentShift,
    }),
    [shift, isLoading, error, openShift, closeShift, fetchCurrentShift],
  );

  return <ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>;
}
