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
import { AdminAuthorizationOverlay } from "@/components/pos/admin-authorization-overlay";

type AuthorizationPrompt = {
  title: string;
  description: string;
  submitLabel: string;
};

type ManagementSessionContextValue = {
  sessionToken: string | null;
  expiresAt: string | null;
  remainingMs: number;
  isActive: boolean;
  adminId: number | null;
  runWithManagementSession: (
    action: (sessionToken: string) => void | Promise<void>,
    prompt?: Partial<AuthorizationPrompt>,
  ) => void;
  invalidateManagementSession: () => void;
};

type AuthorizeSessionResponse = {
  sessionToken?: string;
  adminId?: number;
  expiresAt?: string;
  message?: string;
  error?: string;
};

const DEFAULT_PROMPT: AuthorizationPrompt = {
  title: "Management PIN Required",
  description: "Enter admin PIN to unlock management mode for 5 minutes.",
  submitLabel: "Unlock Management",
};

export const ManagementSessionContext = createContext<ManagementSessionContextValue | undefined>(undefined);

function isSessionActive(sessionToken: string | null, expiresAt: string | null): boolean {
  if (!sessionToken || !expiresAt) return false;
  return new Date(expiresAt).getTime() > Date.now();
}

function parseError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const source = payload as Record<string, unknown>;
  if (typeof source.message === "string" && source.message.trim()) return source.message;
  if (typeof source.error === "string" && source.error.trim()) return source.error;
  return fallback;
}

export function ManagementSessionProvider({ children }: { children: ReactNode }) {
  const { authFetch } = useAuth();

  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [adminId, setAdminId] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);

  const [overlayOpen, setOverlayOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [prompt, setPrompt] = useState<AuthorizationPrompt>(DEFAULT_PROMPT);

  const pendingActionRef = useRef<((token: string) => void | Promise<void>) | null>(null);

  const invalidateManagementSession = useCallback(() => {
    setSessionToken(null);
    setExpiresAt(null);
    setAdminId(null);
    setRemainingMs(0);
  }, []);

  useEffect(() => {
    if (!expiresAt || !sessionToken) {
      setRemainingMs(0);
      return;
    }

    const tick = () => {
      const nextRemaining = Math.max(0, new Date(expiresAt).getTime() - Date.now());
      setRemainingMs(nextRemaining);
      if (nextRemaining === 0) {
        invalidateManagementSession();
      }
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt, invalidateManagementSession, sessionToken]);

  const runWithManagementSession = useCallback(
    (action: (token: string) => void | Promise<void>, promptOverride?: Partial<AuthorizationPrompt>) => {
      if (isSessionActive(sessionToken, expiresAt) && sessionToken) {
        void action(sessionToken);
        return;
      }

      pendingActionRef.current = action;
      setPrompt({ ...DEFAULT_PROMPT, ...promptOverride });
      setPin("");
      setError(null);
      setOverlayOpen(true);
    },
    [expiresAt, sessionToken],
  );

  const handleAuthorize = useCallback(async () => {
    if (pin.trim().length < 4) {
      setError("Enter the manager PIN to continue.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await authFetch("/admin/authorize-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pin }),
      });

      const payload = (await response.json().catch(() => null)) as AuthorizeSessionResponse | null;

      if (response.status === 401) {
        setError("Incorrect manager PIN. Try again.");
        setPin("");
        return;
      }

      if (!response.ok || !payload?.sessionToken || !payload.expiresAt) {
        throw new Error(parseError(payload, "Unable to unlock management mode."));
      }

      setSessionToken(payload.sessionToken);
      setExpiresAt(payload.expiresAt);
      setAdminId(typeof payload.adminId === "number" ? payload.adminId : null);
      setOverlayOpen(false);

      const pendingAction = pendingActionRef.current;
      pendingActionRef.current = null;
      if (pendingAction) {
        await pendingAction(payload.sessionToken);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to unlock management mode.");
    } finally {
      setSubmitting(false);
    }
  }, [authFetch, pin]);

  const value = useMemo<ManagementSessionContextValue>(
    () => ({
      sessionToken,
      expiresAt,
      remainingMs,
      isActive: isSessionActive(sessionToken, expiresAt),
      adminId,
      runWithManagementSession,
      invalidateManagementSession,
    }),
    [adminId, expiresAt, invalidateManagementSession, remainingMs, runWithManagementSession, sessionToken],
  );

  return (
    <ManagementSessionContext.Provider value={value}>
      {children}
      <AdminAuthorizationOverlay
        isOpen={overlayOpen}
        title={prompt.title}
        description={prompt.description}
        pin={pin}
        onPinChange={setPin}
        error={error}
        submitting={submitting}
        submitLabel={prompt.submitLabel}
        canSubmit={pin.trim().length >= 4}
        onBack={() => {
          setOverlayOpen(false);
          setPin("");
          setError(null);
          pendingActionRef.current = null;
        }}
        onSubmit={() => void handleAuthorize()}
      />
    </ManagementSessionContext.Provider>
  );
}
