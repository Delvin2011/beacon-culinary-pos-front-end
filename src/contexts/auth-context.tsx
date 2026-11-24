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
import { PIN_FORMAT_MESSAGE, PIN_PATTERN, isPinFormatError } from "@/lib/pin";
import { loginBlockMessage, readLoginBlock, type LoginBlock } from "@/lib/login-protection";
import { detailString, errorCode, readApiError } from "@/lib/api-error";
import { TillErrorCode, readSessionEnded, sessionEndedMessage, shiftOpenOnOtherTillMessage, tillLockedMessage } from "@/lib/till";
import { notifySessionEnding } from "@/lib/session-events";
import { clearSnapshotAccounts } from "@/lib/offline/db";
import { DeviceErrorCode, TILL_NOT_REGISTERED_MESSAGE } from "@/lib/devices";
import { CONNECTION_MESSAGES, RequestTimeoutError, parseRetryAfter } from "@/lib/net";
import { reportConnectionSignal, signalForError, signalForResponse } from "@/lib/connection-signals";
import { apiFetch } from "@/lib/api-fetch";
import { customerAnswerOf } from "@/lib/customer-status";

// timeoutMs overrides the default limit (15 s; 20 s for POST /orders; 5 s for /health).
export type AuthFetchInit = RequestInit & { timeoutMs?: number };

export const INCORRECT_PIN_MESSAGE = "Incorrect PIN.";
export const PIN_LOGIN_FAILED_MESSAGE = "Couldn't sign in. Try again.";

// Thrown by pinLogin. Its message is always safe to show: it never says whether the person exists.
export class PinLoginError extends Error {}

// pinLogin on an unregistered till (403 DEVICE_NOT_REGISTERED, `required` mode). Not a wrong PIN and not a
// sign-out: the PIN wasn't checked. Each screen decides what to show.
export class DeviceNotRegisteredError extends PinLoginError {
  constructor() {
    super(TILL_NOT_REGISTERED_MESSAGE);
  }
}

// Sign-in refused by the till rules (O2 contract 5). Not a wrong PIN or password; never counts toward lockout.
export class TillLockedError extends PinLoginError {
  constructor(
    readonly ownerName: string | null,
    readonly tillCode: string | null,
  ) {
    super(tillLockedMessage(ownerName, tillCode));
  }
}

export class ShiftOpenOnOtherTillError extends PinLoginError {
  constructor(
    readonly tillCode: string | null,
    readonly tillName: string | null,
  ) {
    super(shiftOpenOnOtherTillMessage(tillCode, tillName));
  }
}

// 409 TILL_LOCKED or SHIFT_OPEN_ON_OTHER_TILL from /auth/login or /auth/pin-login, else null. Reads a copy.
async function readTillRefusal(res: Response): Promise<PinLoginError | null> {
  if (res.status !== 409) return null;
  const { code, details } = await readApiError(res);
  if (code === TillErrorCode.TILL_LOCKED) {
    return new TillLockedError(detailString(details, "ownerName"), detailString(details, "tillCode"));
  }
  if (code === TillErrorCode.SHIFT_OPEN_ON_OTHER_TILL) {
    return new ShiftOpenOnOtherTillError(detailString(details, "tillCode"), detailString(details, "tillName"));
  }
  return null;
}

// Thrown by login and pinLogin on a 429. Its message comes from the code and wait only.
export class LoginBlockedError extends Error {
  constructor(readonly block: LoginBlock) {
    super(loginBlockMessage(block.code, block.retryAfterSeconds));
  }
}

// Change password (/users/{id}/change-password) has no screen yet. A wrong old password returns 401 with an
// empty body, exactly like an expired token, so a future form must make sure the token is fresh before
// submitting and must never go through authFetch's refresh-and-resend. Use readLoginBlock for its 429.

type RefreshResult =
  | { kind: "token"; token: string }
  | { kind: "ended" }
  // A 429 from /auth/refresh: the session is kept and the 429 goes to the caller (each gets a copy).
  | { kind: "blocked"; response: Response }
  // No answer (network error, timeout) or a 5xx/unexpected status: the session is kept and the caller gets the
  // thrown error or a copy of the response, so it can show "Can't reach the server" rather than "signed out".
  | { kind: "unavailable"; error: unknown }
  | { kind: "unavailable"; response: Response };

const AUTH_STORAGE_KEY = "bar-talk.auth";
const AUTH_LOGOUT_MARKER_KEY = "bar-talk.auth.logged-out";

// Server sign-out (POST /auth/logout): deletes this browser's refreshToken cookie so the session can't come back
// through /auth/refresh, and (O2 contract 8.4) ends the session the access token names; an expired token is
// accepted. Always 204, safe to repeat; it never touches deviceToken (the till stays registered).
// Awaited for at most 2 s and never retried. keepalive: the request outlives the page, so closing the tab or
// navigating away straight after signing out still ends the server session. Safe since T1-0d: the API is on this
// origin, so the Authorization header needs no CORS preflight (a keepalive request that needs one could be refused),
// and there is no body (keepalive allows 64 KB). The 2 s timeout still applies while the page is open. If the call
// fails, the server session ends by itself later.
const LOGOUT_TIMEOUT_MS = 2_000;
// POST /pos/lock: at most 5 s, then the till is locked locally anyway.
const LOCK_TIMEOUT_MS = 5_000;

async function requestServerLogout(token: string | null): Promise<void> {
  try {
    await apiFetch("/auth/logout", {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      timeoutMs: LOGOUT_TIMEOUT_MS,
    });
  } catch {
    // Signing out never fails because of this call.
  }
}

// True when the server answered the lock (204, or any 4xx: a 401 means the session had already ended).
async function requestServerLock(token: string): Promise<boolean> {
  try {
    const res = await apiFetch("/pos/lock", {
      method: "POST",
      credentials: "include",
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: LOCK_TIMEOUT_MS,
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

export interface AuthUser {
  id?: string;
  email: string;
  name?: string;
  role?: string;
  cashierId?: number;
  // O3 (D13): unlocked offline with the check value. No token; never saved; ended when the till is back online.
  offline?: boolean;
}

export const BACK_ONLINE_NOTICE = "Back online. Sign in again.";

interface AuthState {
  token: string | null;
  user: AuthUser | null;
}

interface LoginPayload {
  email: string;
  password: string;
}

interface PinLoginPayload {
  cashierId: number;
  pin: string;
}

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (payload: LoginPayload) => Promise<void>;
  pinLogin: (payload: PinLoginPayload) => Promise<void>;
  // Signs out locally at once; the promise settles when the server call ends (at most 2 s).
  logout: () => Promise<void>;
  // Lock till (O2 contract 7.2): keeps the cart, ends this session with POST /pos/lock and drops the tokens.
  // The shift stays open. The till is locked locally even if the server can't be reached.
  lockTill: () => Promise<void>;
  // Why the server ended the last session (401 SESSION_ENDED), for the sign-in screen. Cleared by the next sign-in.
  sessionEndedNotice: string | null;
  clearSessionEndedNotice: () => void;
  // A lock the server never got is sent once more: on `online`, or when the sign-in screen reaches the server.
  retryPendingLock: () => void;
  clearError: () => void;
  // A request that gets no answer within its limit throws RequestTimeoutError (see lib/net).
  authFetch: (path: string, init?: AuthFetchInit) => Promise<Response>;
  // O3 (D13): the local offline session after an offline unlock, and its end once the till is back online.
  startOfflineSession: (user: { cashierId: number; name: string; role?: string }) => void;
  endOfflineSession: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
// Decode the payload segment of a JWT without verifying the signature.
// Used only to read non-sensitive claims (role, name) that the server already
// authorises — we never trust these for access control decisions server-side.
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Extract a normalised role string from JWT claims.
// Handles Spring Security formats: role, roles[], authorities[], authorities[{authority}]
function extractRoleFromClaims(claims: Record<string, unknown>): string | undefined {
  if (typeof claims.role === "string") return claims.role.replace(/^ROLE_/, "");

  const arr = claims.roles ?? claims.authorities ?? claims.scope;
  if (Array.isArray(arr) && arr.length > 0) {
    const first = arr[0];
    const raw =
      typeof first === "string"
        ? first
        : first && typeof first === "object" && typeof (first as Record<string, unknown>).authority === "string"
        ? (first as Record<string, unknown>).authority as string
        : null;
    if (raw) return raw.replace(/^ROLE_/, "");
  }
  return undefined;
}

function extractToken(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;

  const data = payload as Record<string, unknown>;
  const directTokenKeys = ["token", "accessToken", "access_token", "jwt"];

  for (const key of directTokenKeys) {
    const value = data[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  const nestedCandidates = [data.data, data.result, data.payload];
  for (const candidate of nestedCandidates) {
    if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      for (const key of directTokenKeys) {
        const value = nested[key];
        if (typeof value === "string" && value.trim().length > 0) {
          return value;
        }
      }
    }
  }

  return null;
}

function extractUser(payload: unknown, email: string): AuthUser {
  if (!payload || typeof payload !== "object") {
    return { email };
  }

  const data = payload as Record<string, unknown>;
  const candidates = [data.user, data.profile, data.data, data.result];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;

    const c = candidate as Record<string, unknown>;
    const candidateEmail = typeof c.email === "string" ? c.email : email;

    return {
      id: typeof c.id === "string" ? c.id : undefined,
      email: candidateEmail,
      name: typeof c.name === "string" ? c.name : undefined,
      role: typeof c.role === "string" ? c.role : undefined,
    };
  }

  return { email };
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;

  const data = payload as Record<string, unknown>;
  const directMessage = data.message;

  if (typeof directMessage === "string" && directMessage.trim().length > 0) {
    return directMessage;
  }

  const error = data.error;
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return fallback;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ token: null, user: null });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const refreshInFlightRef = useRef<Promise<RefreshResult> | null>(null);
  const logoutRequestedRef = useRef(false);
  // After a 429 from /auth/refresh: no new refresh before this time (Retry-After); callers get the same 429.
  const refreshBlockRef = useRef<{ until: number; response: Response } | null>(null);
  const [sessionEndedNotice, setSessionEndedNotice] = useState<string | null>(null);
  // The token of a lock the server never got: sent once more when the connection returns.
  const pendingLockTokenRef = useRef<string | null>(null);

  const clearAuthState = useCallback(() => {
    tokenRef.current = null;
    setState({ token: null, user: null });
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }, []);

  const persistAuthState = useCallback((nextState: AuthState) => {
    logoutRequestedRef.current = false;
    tokenRef.current = nextState.token;
    setState(nextState);
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextState));
    sessionStorage.removeItem(AUTH_LOGOUT_MARKER_KEY);
    setSessionEndedNotice(null);
  }, []);

  useEffect(() => {
    try {
      logoutRequestedRef.current = sessionStorage.getItem(AUTH_LOGOUT_MARKER_KEY) === "true";

      const rawValue = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!rawValue || logoutRequestedRef.current) {
        setIsLoading(false);
        return;
      }

      const parsed = JSON.parse(rawValue) as AuthState;
      if (parsed?.token) {
        tokenRef.current = parsed.token;
        setState({ token: parsed.token, user: parsed.user ?? null });
      }
    } catch {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const login = useCallback(async ({ email, password }: LoginPayload) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiFetch("/auth/login", {
        timeoutMs: null,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      // Before the body is read: readLoginBlock reads its own copy.
      const block = await readLoginBlock(response);
      if (block) {
        throw new LoginBlockedError(block);
      }

      // A password sign-in on a registered till is a POS session: the till rules apply.
      const refusal = await readTillRefusal(response);
      if (refusal) throw refusal;

      const responseBody = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        throw new Error(extractErrorMessage(responseBody, "Login failed. Please try again."));
      }

      const token = extractToken(responseBody);
      if (!token) {
        throw new Error("Login succeeded but no token was returned by the server.");
      }

      const baseUser = extractUser(responseBody, email);
      const claims = decodeJwtPayload(token);
      const user: AuthUser = {
        ...baseUser,
        name: baseUser.name ?? (claims && typeof claims.name === "string" ? claims.name : undefined),
        role: baseUser.role ?? (claims ? extractRoleFromClaims(claims) : undefined),
      };
      const nextState: AuthState = { token, user };

      persistAuthState(nextState);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to login right now.";
      clearAuthState();
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [clearAuthState, persistAuthState]);

  const pinLogin = useCallback(async ({ cashierId, pin }: PinLoginPayload) => {
    setIsLoading(true);
    setError(null);

    try {
      // The backend refuses anything but 6 digits; never send it.
      if (!PIN_PATTERN.test(pin)) {
        throw new PinLoginError(PIN_FORMAT_MESSAGE);
      }

      const response = await apiFetch("/auth/pin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ cashierId, pin }),
      });

      // Before the body is read: readLoginBlock reads its own copy.
      const block = await readLoginBlock(response);
      if (block) {
        throw new LoginBlockedError(block);
      }

      // Before the body is read: errorCode reads its own copy.
      if (response.status === 403 && (await errorCode(response)) === DeviceErrorCode.NOT_REGISTERED) {
        throw new DeviceNotRegisteredError();
      }

      // Checked after the PIN: a wrong PIN never reveals who holds the till.
      const refusal = await readTillRefusal(response);
      if (refusal) throw refusal;

      const responseBody = (await response.json().catch(() => null)) as unknown;

      if (response.status === 401) {
        // Generic message regardless of whether cashier ID exists or PIN is wrong
        throw new PinLoginError(INCORRECT_PIN_MESSAGE);
      }

      if (response.status === 400 && isPinFormatError(responseBody)) {
        throw new PinLoginError(PIN_FORMAT_MESSAGE);
      }

      if (response.status >= 500) {
        throw new PinLoginError(CONNECTION_MESSAGES.server);
      }

      if (!response.ok) {
        throw new PinLoginError(PIN_LOGIN_FAILED_MESSAGE);
      }

      const token = extractToken(responseBody);
      if (!token) {
        throw new PinLoginError(PIN_LOGIN_FAILED_MESSAGE);
      }

      const baseUser = extractUser(responseBody, String(cashierId));
      const claims = decodeJwtPayload(token);
      const user: AuthUser = {
        ...baseUser,
        cashierId,
        name: baseUser.name ?? (claims && typeof claims.name === "string" ? claims.name : undefined),
        role: baseUser.role ?? (claims ? extractRoleFromClaims(claims) : undefined),
      };
      const nextState: AuthState = { token, user };

      persistAuthState(nextState);
    } catch (err) {
      // No answer from the server: say so. Anything else unexpected becomes the generic message.
      const safe =
        err instanceof PinLoginError || err instanceof LoginBlockedError
          ? err
          : new PinLoginError(
              err instanceof TypeError || err instanceof RequestTimeoutError ? CONNECTION_MESSAGES.network : PIN_LOGIN_FAILED_MESSAGE,
            );
      clearAuthState();
      setError(safe.message);
      throw safe;
    } finally {
      setIsLoading(false);
    }
  }, [clearAuthState, persistAuthState]);

  // The local sign-out happens first, so signing out is instant and works offline.
  const logout = useCallback(async () => {
    const token = tokenRef.current;
    logoutRequestedRef.current = true;
    sessionStorage.setItem(AUTH_LOGOUT_MARKER_KEY, "true");
    clearAuthState();
    // O3 (contract 11): signing out of the till removes the snapshot's accounts list; the menu stays.
    void clearSnapshotAccounts();
    setError(null);
    await requestServerLogout(token);
  }, [clearAuthState]);

  // The session has ended without a sign-out button (refresh refused, or a 401 after refreshing): same as a sign-out.
  const endSession = useCallback(() => {
    const token = tokenRef.current;
    clearAuthState();
    void requestServerLogout(token);
  }, [clearAuthState]);

  // 401 SESSION_ENDED from refresh or a POS write (O2 contract 4.4): no refresh and no retry. Keep the cart, drop
  // the tokens and tell the sign-in screen why.
  const sessionEnded = useCallback(
    (reason: string | null) => {
      const token = tokenRef.current;
      // A parallel request already handled it.
      if (!token) return;
      notifySessionEnding("SESSION_ENDED");
      logoutRequestedRef.current = true;
      clearAuthState();
      setSessionEndedNotice(sessionEndedMessage(reason));
      // The session is over on the server; this only clears the refresh cookie it left behind.
      void requestServerLogout(token);
    },
    [clearAuthState],
  );

  const lockTill = useCallback(async () => {
    const token = tokenRef.current;
    notifySessionEnding("LOCK");
    logoutRequestedRef.current = true;
    sessionStorage.setItem(AUTH_LOGOUT_MARKER_KEY, "true");
    clearAuthState();
    setError(null);
    if (!token) return;
    // Locked here whatever the answer. Without one, the token is kept in memory only, for one more try.
    if (!(await requestServerLock(token))) pendingLockTokenRef.current = token;
  }, [clearAuthState]);

  const retryPendingLock = useCallback(() => {
    const token = pendingLockTokenRef.current;
    if (!token) return;
    pendingLockTokenRef.current = null;
    void requestServerLock(token);
  }, []);

  useEffect(() => {
    window.addEventListener("online", retryPendingLock);
    return () => window.removeEventListener("online", retryPendingLock);
  }, [retryPendingLock]);

  const clearSessionEndedNotice = useCallback(() => setSessionEndedNotice(null), []);

  const refreshToken = useCallback(async (): Promise<RefreshResult> => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    // Checked here, not inside the promise below: an early return there runs its `finally` before
    // refreshInFlightRef is set, which would leave a settled promise in the ref for good.
    const block = refreshBlockRef.current;
    if (block && Date.now() < block.until) {
      return { kind: "blocked", response: block.response };
    }

    const refreshPromise = (async (): Promise<RefreshResult> => {
      try {
        if (logoutRequestedRef.current) {
          clearAuthState();
          return { kind: "ended" };
        }

        const response = await apiFetch("/auth/refresh", { method: "POST", credentials: "include" });

        // Burst limit or a block: not a logout. Not retried before Retry-After; the caller decides what to show.
        if (response.status === 429) {
          const waitMs = parseRetryAfter(response.headers.get("Retry-After"));
          refreshBlockRef.current = waitMs ? { until: Date.now() + waitMs, response } : null;
          return { kind: "blocked", response };
        }
        refreshBlockRef.current = null;

        const ended = await readSessionEnded(response);
        if (ended) {
          sessionEnded(ended.reason);
          return { kind: "ended" };
        }

        // Only a refusal ends the session: 401 (no or invalid cookie, or the account is locked), or 400 from older
        // servers without a cookie. A 5xx or any other status is the server's problem, not a sign-out.
        if (!response.ok && response.status !== 401 && response.status !== 400) {
          return { kind: "unavailable", response };
        }

        const payload = (await response.json().catch(() => null)) as unknown;

        if (!response.ok) {
          endSession();
          return { kind: "ended" };
        }

        const refreshedToken = extractToken(payload);
        if (!refreshedToken) {
          endSession();
          return { kind: "ended" };
        }

        setState((prev) => {
          const nextState: AuthState = {
            token: refreshedToken,
            user: prev.user,
          };
          tokenRef.current = refreshedToken;
          localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextState));
          return nextState;
        });

        return { kind: "token", token: refreshedToken };
      } catch (error) {
        // Network error or timeout: the server never answered, so nothing says the session is over.
        return { kind: "unavailable", error };
      } finally {
        refreshInFlightRef.current = null;
      }
    })();

    refreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  }, [clearAuthState, endSession, sessionEnded]);

  const authFetch = useCallback(
    async (path: string, init?: AuthFetchInit) => {
      // Backend paths only ("/orders"): apiFetch adds /api on this origin (T1-0d). No timeoutMs: timeoutFor's.
      const url = path.startsWith("/") ? path : `/${path}`;
      const { timeoutMs, ...requestInit } = init ?? {};

      const buildHeaders = (token: string | null) => {
        const headers = new Headers(requestInit.headers);
        if (token) {
          headers.set("Authorization", `Bearer ${token}`);
        }
        return headers;
      };

      // Every outcome is also a connection signal for the till's online/offline indicator.
      const execute = async (token: string | null) => {
        try {
          const res = await apiFetch(url, { ...requestInit, headers: buildHeaders(token), credentials: "include", timeoutMs });
          const signal = signalForResponse(res.status, customerAnswerOf(res));
          if (signal) reportConnectionSignal(signal);
          return res;
        } catch (err) {
          const signal = signalForError(err);
          if (signal) reportConnectionSignal(signal);
          throw err;
        }
      };

      const initialResponse = await execute(tokenRef.current);
      const ended = await readSessionEnded(initialResponse);
      if (ended) {
        sessionEnded(ended.reason);
        return initialResponse;
      }
      const shouldAttemptRefresh =
        !logoutRequestedRef.current &&
        tokenRef.current !== null &&
        initialResponse.status === 401 &&
        !url.endsWith("/auth/login") &&
        !url.endsWith("/auth/pin-login") &&
        !url.endsWith("/auth/refresh");

      if (!shouldAttemptRefresh) {
        return initialResponse;
      }

      // A 401 with a JSON `code` or `error` is a business error, not an expired login: for example
      // {"error":"Invalid PIN."} from /admin/authorize(-session). Refreshing can't fix it, and resending would
      // count as another failed attempt. An expired access token returns 401 with an empty body.
      const errorBody = (await initialResponse.clone().json().catch(() => null)) as { code?: unknown; error?: unknown } | null;
      if (errorBody && (typeof errorBody.code === "string" || typeof errorBody.error === "string")) {
        return initialResponse;
      }

      const refreshed = await refreshToken();
      if (refreshed.kind === "blocked") {
        // Keep the session; hand back the 429 so callers don't mistake it for "session expired".
        return refreshed.response.clone();
      }
      if (refreshed.kind === "unavailable") {
        // The session is kept. Report it as the connection problem it is.
        if ("error" in refreshed) throw refreshed.error;
        return refreshed.response.clone();
      }
      if (refreshed.kind === "ended") {
        return initialResponse;
      }

      const retryResponse = await execute(refreshed.token);
      const endedAfterRefresh = await readSessionEnded(retryResponse);
      if (endedAfterRefresh) {
        sessionEnded(endedAfterRefresh.reason);
      } else if (retryResponse.status === 401) {
        endSession();
      }
      return retryResponse;
    },
    [endSession, refreshToken, sessionEnded]
  );

  // O3 (D13): an offline unlock. Kept in memory only: a reload asks for the PIN again. logoutRequestedRef stays as the
  // lock left it, so nothing tries to refresh.
  const startOfflineSession = useCallback((offlineUser: { cashierId: number; name: string; role?: string }) => {
    tokenRef.current = null;
    setState({
      token: null,
      user: { email: "", name: offlineUser.name, role: offlineUser.role ?? "CASHIER", cashierId: offlineUser.cashierId, offline: true },
    });
    setError(null);
    setSessionEndedNotice(null);
  }, []);

  // Back online: like a server-ended session (the cart is kept); the normal sign-in applies again.
  const endOfflineSession = useCallback(() => {
    notifySessionEnding("SESSION_ENDED");
    tokenRef.current = null;
    setState({ token: null, user: null });
    setSessionEndedNotice(BACK_ONLINE_NOTICE);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      token: state.token,
      user: state.user,
      isAuthenticated: Boolean(state.token) || state.user?.offline === true,
      isLoading,
      error,
      login,
      pinLogin,
      logout,
      lockTill,
      sessionEndedNotice,
      clearSessionEndedNotice,
      retryPendingLock,
      clearError,
      authFetch,
      startOfflineSession,
      endOfflineSession,
    }),
    [
      startOfflineSession,
      endOfflineSession,
      state.token,
      state.user,
      isLoading,
      error,
      login,
      pinLogin,
      logout,
      lockTill,
      sessionEndedNotice,
      clearSessionEndedNotice,
      retryPendingLock,
      clearError,
      authFetch,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export { AuthContext };
