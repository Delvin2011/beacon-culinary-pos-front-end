"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/hooks/use-auth";
import { CONNECTION_MESSAGES, messageForError } from "@/lib/net";
import { detailString, readApiError } from "@/lib/api-error";
import { DeviceErrorCode, TILL_NOT_REGISTERED_MESSAGE } from "@/lib/devices";
import { TillErrorCode, shiftAlreadyOpenMessage, shiftOpenOnOtherTillMessage } from "@/lib/till";
import { restoreOfflineShift, saveLastShift } from "@/lib/offline/offline-shift";

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
  // The till the shift is on; null (shown as "Unregistered till") for the NULL till or a pre-O2 server.
  tillCode: string | null;
  tillName: string | null;
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

// Today's trading day already has a Z, so no more shifts can open today.
export class DayClosedError extends Error {
  constructor(public readonly zNumber: number | null) {
    super(
      zNumber !== null
        ? `Today's trading day is already closed (Z-${String(zNumber).padStart(4, "0")}). No more shifts can open today.`
        : "Today's trading day is already closed. No more shifts can open today.",
    );
    this.name = "DayClosedError";
  }
}

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
    tillCode: typeof src.tillCode === "string" ? src.tillCode : null,
    tillName: typeof src.tillName === "string" ? src.tillName : null,
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
  const { authFetch, isAuthenticated, user } = useAuth();
  // O3: the signed-in user, for restoring the shift offline (a ref: the lookup doesn't re-run when it changes).
  const userRef = useRef(user);
  userRef.current = user;
  const [shift, setShift] = useState<Shift | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The shift on screen, for a quiet refetch: once a shift is known, reloading it doesn't show the full-screen
  // loader (which would unmount the till and its cart).
  const shiftRef = useRef<Shift | null>(null);
  useEffect(() => {
    shiftRef.current = shift;
  }, [shift]);

  const fetchCurrentShift = useCallback(async () => {
    if (!isAuthenticated) {
      // No lookup without a sign-in. Stay "loading" so no screen treats this empty shift as "no open shift"
      // (on a page load the sign-in arrives a render later, and the lookup runs then).
      setShift(null);
      setIsLoading(true);
      return;
    }

    if (!shiftRef.current) setIsLoading(true);
    setError(null);
    try {
      // /shifts/open returns the till's shift whoever owns it; /shifts/current only the caller's own.
      const res = await authFetch("/shifts/open");
      if (res.status === 404) {
        setShift(null);
        void saveLastShift(null);
        return;
      }
      if (!res.ok) {
        setError(res.status >= 500 ? CONNECTION_MESSAGES.server : "Failed to load shift status.");
        return;
      }
      const body = (await res.json().catch(() => null)) as unknown;
      const loaded = extractShift(body);
      setShift(loaded);
      // O3: only while the saved till-status says offline is on.
      void saveLastShift(loaded);
    } catch (err) {
      // No answer: keep the last known shift. Only a 404 means "no open shift".
      setError(messageForError(err, "Failed to load shift status."));
      // O3: a reload while offline. The saved shift, if this till may sell offline on it.
      if (!shiftRef.current) {
        const restored = await restoreOfflineShift(userRef.current);
        if (restored) setShift(restored);
      }
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

      // Before the body is read: readApiError reads its own copy.
      const { code, details } = await readApiError(res);
      const body = (await res.json().catch(() => null)) as unknown;

      if (res.status === 409 && code === "DAY_CLOSED") {
        const zNumber = (body as Record<string, unknown>).zNumber;
        throw new DayClosedError(typeof zNumber === "number" ? zNumber : null);
      }

      // O2: the caller already has a shift on another till (an ADMIN included).
      if (code === TillErrorCode.SHIFT_OPEN_ON_OTHER_TILL) {
        throw new Error(shiftOpenOnOtherTillMessage(detailString(details, "tillCode"), detailString(details, "tillName")));
      }

      // This till already has a shift (the caller's own included): load it. /pos/shift-open then moves on to /pos,
      // which resumes the caller's shift or shows who holds the till.
      if (code === TillErrorCode.SHIFT_ALREADY_OPEN) {
        await fetchCurrentShift();
        throw new Error(shiftAlreadyOpenMessage(detailString(details, "ownerName"), detailString(details, "tillCode")));
      }

      if (code === DeviceErrorCode.NOT_REGISTERED) {
        throw new Error(TILL_NOT_REGISTERED_MESSAGE);
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
