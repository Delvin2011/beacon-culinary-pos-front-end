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

export interface ShiftOwner {
  id: number;
  name: string;
  role?: string;
}

// The till's open shift, whoever owns it (from GET /shifts/open).
export interface Shift {
  id: number;
  cashierId: number;
  status: "OPEN" | "CLOSED";
  openingFloat: number;
  openedAt: string;
  closedAt?: string | null;
  owner: ShiftOwner;
  ownedByCaller: boolean;
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

  if (typeof src.shiftId !== "number") return null;

  const rawOwner = (src.owner && typeof src.owner === "object" ? src.owner : {}) as Record<string, unknown>;
  const owner: ShiftOwner = {
    id: typeof rawOwner.id === "number" ? rawOwner.id : 0,
    name: typeof rawOwner.name === "string" ? rawOwner.name : "Unknown cashier",
    role: typeof rawOwner.role === "string" ? rawOwner.role : undefined,
  };

  return {
    id: src.shiftId,
    cashierId: owner.id,
    status: "OPEN",
    openingFloat: typeof src.openingFloat === "number" ? src.openingFloat : 0,
    openedAt: src.openedAt as string,
    closedAt: null,
    owner,
    ownedByCaller: src.ownedByCaller === true,
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
      // /shifts/open returns the till's shift whoever owns it; /shifts/current only the caller's own.
      const res = await authFetch("/shifts/open");
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
        throw new Error("A shift is currently open on this till. Ask the current cashier to close it first.");
      }

      if (!res.ok) {
        throw new Error(extractErrorMessage(body, "Failed to open shift."));
      }

      // The open response is a ShiftDto without the owner, so reload the till's view of it.
      await fetchCurrentShift();
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
