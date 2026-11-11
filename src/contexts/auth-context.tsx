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

export const INCORRECT_PIN_MESSAGE = "Incorrect PIN.";
export const PIN_LOGIN_FAILED_MESSAGE = "Couldn't sign in. Try again.";

// Thrown by pinLogin. Its message is always safe to show: it never says whether the person exists.
export class PinLoginError extends Error {}

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
  | { kind: "blocked"; response: Response };

const AUTH_STORAGE_KEY = "bar-talk.auth";
const AUTH_LOGOUT_MARKER_KEY = "bar-talk.auth.logged-out";
const AUTH_API_BASE_URL = process.env.NEXT_PUBLIC_AUTH_API_URL ?? "http://localhost:8080";

export interface AuthUser {
  id?: string;
  email: string;
  name?: string;
  role?: string;
  cashierId?: number;
}

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
  apiBaseUrl: string;
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (payload: LoginPayload) => Promise<void>;
  pinLogin: (payload: PinLoginPayload) => Promise<void>;
  logout: () => void;
  clearError: () => void;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
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
      const response = await fetch(`${AUTH_API_BASE_URL}/auth/login`, {
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

      const response = await fetch(`${AUTH_API_BASE_URL}/auth/pin-login`, {
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

      const responseBody = (await response.json().catch(() => null)) as unknown;

      if (response.status === 401) {
        // Generic message regardless of whether cashier ID exists or PIN is wrong
        throw new PinLoginError(INCORRECT_PIN_MESSAGE);
      }

      if (response.status === 400 && isPinFormatError(responseBody)) {
        throw new PinLoginError(PIN_FORMAT_MESSAGE);
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
      // Network errors and anything unexpected become the generic message.
      const safe =
        err instanceof PinLoginError || err instanceof LoginBlockedError ? err : new PinLoginError(PIN_LOGIN_FAILED_MESSAGE);
      clearAuthState();
      setError(safe.message);
      throw safe;
    } finally {
      setIsLoading(false);
    }
  }, [clearAuthState, persistAuthState]);

  const logout = useCallback(() => {
    logoutRequestedRef.current = true;
    sessionStorage.setItem(AUTH_LOGOUT_MARKER_KEY, "true");
    clearAuthState();
    setError(null);
  }, [clearAuthState]);

  const refreshToken = useCallback(async (): Promise<RefreshResult> => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const refreshPromise = (async (): Promise<RefreshResult> => {
      try {
        if (logoutRequestedRef.current) {
          clearAuthState();
          return { kind: "ended" };
        }

        const response = await fetch(`${AUTH_API_BASE_URL}/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });

        // Burst limit or a block: not a logout, and never retried here. The caller decides what to show.
        if (response.status === 429) {
          return { kind: "blocked", response };
        }

        const payload = (await response.json().catch(() => null)) as unknown;

        if (!response.ok) {
          // 401 (including while the account is locked): the session has ended, as before.
          clearAuthState();
          return { kind: "ended" };
        }

        const refreshedToken = extractToken(payload);
        if (!refreshedToken) {
          clearAuthState();
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
      } catch {
        clearAuthState();
        return { kind: "ended" };
      } finally {
        refreshInFlightRef.current = null;
      }
    })();

    refreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  }, [clearAuthState]);

  const authFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const isAbsoluteUrl = path.startsWith("http://") || path.startsWith("https://");
      const url = isAbsoluteUrl ? path : `${AUTH_API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;

      const buildHeaders = (token: string | null) => {
        const headers = new Headers(init?.headers);
        if (token) {
          headers.set("Authorization", `Bearer ${token}`);
        }
        return headers;
      };

      const execute = (token: string | null) => {
        return fetch(url, {
          ...init,
          headers: buildHeaders(token),
          credentials: "include",
        });
      };

      const initialResponse = await execute(tokenRef.current);
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
      if (refreshed.kind === "ended") {
        return initialResponse;
      }

      const retryResponse = await execute(refreshed.token);
      if (retryResponse.status === 401) {
        clearAuthState();
      }
      return retryResponse;
    },
    [clearAuthState, refreshToken]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      apiBaseUrl: AUTH_API_BASE_URL,
      token: state.token,
      user: state.user,
      isAuthenticated: Boolean(state.token),
      isLoading,
      error,
      login,
      pinLogin,
      logout,
      clearError,
      authFetch,
    }),
    [state.token, state.user, isLoading, error, login, pinLogin, logout, clearError, authFetch]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export { AuthContext };
