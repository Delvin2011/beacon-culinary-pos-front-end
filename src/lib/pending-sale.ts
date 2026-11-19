// The pending sale: a POST /orders whose outcome isn't known yet, kept in localStorage so it survives a tab close,
// reload or browser restart. Contract: docs/2026-11-16-o1-resilience-api-contract.md, sections 1 and 4.
//
// - The clientOrderId is created once, when Confirm is pressed and the body is final, and stored WITH that body.
// - Retries resend the same body with the same id; only a manager re-approval swaps the authorization token,
//   which the server's fingerprint ignores.
// - Each clientOrderId completes once (completedIds), so a late 200 replay never finishes a sale twice.

import { classifyError, isNoAnswer, parseRetryAfter, readErrorCode, type Failure } from "@/lib/net";

export const PENDING_SALE_KEY = "bar-talk.pendingSale";
const COMPLETED_IDS_KEPT = 50;

export type PendingSaleKind = "SALE" | "COMPLIMENTARY";

// What the cashier sees on the "Checking the sale…" screen; the request body has ids, not names.
export type PendingSaleSummary = {
  lines: Array<{ name: string; quantity: number }>;
  total: number;
};

export type PendingSaleOwner = { key: string; name: string | null };

// O4 (H): what the till needs to record this sale offline if its outcome is still unknown when the till goes offline:
// the priced lines and payments as charged, and the server-corrected confirm time (its soldAt). Not stored for a
// complimentary or discounted sale (offline sales carry neither): those stay pending until the connection is back.
export type OfflineDraft = {
  lines: Array<{
    dailyMealOptionId: number;
    name: string;
    unitPrice: number;
    quantity: number;
    extras: Array<{ dailyComponentStockId: number; name: string; extraPrice: number; quantity: number }>;
  }>;
  payments: Array<{ method: "CASH" | "CARD" | "ACCOUNT"; amount: number; amountTendered?: number; accountId?: number }>;
  confirmedAt: string;
};

export type PendingSale = {
  clientOrderId: string;
  kind: PendingSaleKind;
  // The exact request body, clientOrderId included. Never rebuilt from the cart.
  body: Record<string, unknown>;
  summary: PendingSaleSummary;
  owner: PendingSaleOwner;
  createdAt: string;
  // A 409 IDEMPOTENCY_CONFLICT: never retried; kept for a supervisor.
  conflict: boolean;
  // O4 (H): set only for a plain sale with offline on.
  offlineDraft?: OfflineDraft | null;
};

type PendingSaleStore = {
  pending: PendingSale | null;
  completedIds: string[];
};

const EMPTY_STORE: PendingSaleStore = { pending: null, completedIds: [] };

// Who rang the sale: a cashier id from a PIN sign-in, else the account id or email.
export function ownerKey(user: { cashierId?: number; id?: string; email?: string } | null | undefined): string | null {
  if (!user) return null;
  if (typeof user.cashierId === "number") return `cashier:${user.cashierId}`;
  if (user.id) return `user:${user.id}`;
  if (user.email) return `email:${user.email.toLowerCase()}`;
  return null;
}

function readStore(): PendingSaleStore {
  try {
    const raw = localStorage.getItem(PENDING_SALE_KEY);
    if (!raw) return EMPTY_STORE;
    const parsed = JSON.parse(raw) as Partial<PendingSaleStore> | null;
    return {
      pending: parsed?.pending && typeof parsed.pending.clientOrderId === "string" ? parsed.pending : null,
      completedIds: Array.isArray(parsed?.completedIds) ? parsed!.completedIds.filter((id) => typeof id === "string") : [],
    };
  } catch {
    return EMPTY_STORE;
  }
}

function writeStore(store: PendingSaleStore): void {
  try {
    localStorage.setItem(PENDING_SALE_KEY, JSON.stringify(store));
  } catch {
    // Storage full or blocked: the sale still goes out; it just won't survive a reload.
  }
}

export function loadPendingSale(): PendingSale | null {
  return readStore().pending;
}

export function savePendingSale(sale: PendingSale): void {
  writeStore({ ...readStore(), pending: sale });
}

export function clearPendingSale(): void {
  writeStore({ ...readStore(), pending: null });
}

export function isSaleCompleted(clientOrderId: string): boolean {
  return readStore().completedIds.includes(clientOrderId);
}

// Records the sale as done and clears it. Returns false if it was already done (a second 200 for the same id).
export function markSaleCompleted(clientOrderId: string): boolean {
  const store = readStore();
  const already = store.completedIds.includes(clientOrderId);
  const pending = store.pending?.clientOrderId === clientOrderId ? null : store.pending;
  const completedIds = already ? store.completedIds : [...store.completedIds, clientOrderId].slice(-COMPLETED_IDS_KEPT);
  writeStore({ pending, completedIds });
  return !already;
}

// A v4 UUID for clientOrderId / clientRequestId.
export function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Older browsers without randomUUID: a v4 UUID from getRandomValues.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Freezes the body: a deep copy with a new clientOrderId, which is never changed afterwards.
export function createPendingSale(
  kind: PendingSaleKind,
  body: Record<string, unknown>,
  summary: PendingSaleSummary,
  owner: PendingSaleOwner,
  offlineDraft: OfflineDraft | null = null,
): PendingSale {
  const clientOrderId = newRequestId();
  const frozen = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  return {
    clientOrderId,
    kind,
    body: { clientOrderId, ...frozen },
    summary,
    owner,
    createdAt: new Date().toISOString(),
    conflict: false,
    offlineDraft,
  };
}

// A new manager approval for the same sale: only the authorization tokens change. The server's fingerprint
// ignores every `authorization` object, so the same clientOrderId stays valid.
export function withNewApproval(sale: PendingSale, sessionToken: string): PendingSale {
  const body = JSON.parse(JSON.stringify(sale.body)) as Record<string, unknown>;
  const swap = (node: unknown) => {
    if (node && typeof node === "object" && "authorization" in (node as Record<string, unknown>)) {
      (node as Record<string, unknown>).authorization = { sessionToken };
    }
  };
  if (Array.isArray(body.payments)) body.payments.forEach(swap);
  swap(body.discount);
  swap(body.complimentary);
  return { ...sale, body };
}

// The outcome of one POST /orders.
export type SaleSendOutcome =
  // 201 created, or 200 Idempotent-Replay (the sale already exists; its status may have moved on).
  | { kind: "done"; order: unknown; replay: boolean }
  // Unknown or "try again": network error, timeout, 5xx, 409 ORDER_NUMBER_CONFLICT, 429.
  | { kind: "retry"; failure: Failure | { kind: "order-number" }; retryAfterMs: number | null }
  // 409 IDEMPOTENCY_CONFLICT: a bug or a reused id. Never retried.
  | { kind: "conflict"; message: string | null }
  // 401 AUTHORIZATION_INVALID: the manager approval is bad or expired, and the sale was never created.
  | { kind: "needs-approval" }
  // A 401 without a code after authFetch's refresh: the sign-in has ended. Kept for when they sign in again.
  | { kind: "signed-out" }
  // Anything else (409 NO_OPEN_SHIFT / TILL_IN_USE / stock, 400 validation): nothing was created.
  | { kind: "rejected"; status: number; code: string | null; body: unknown };

export async function classifySaleResponse(res: Response): Promise<SaleSendOutcome> {
  if (res.status === 201 || res.status === 200) {
    const order = (await res.json().catch(() => null)) as unknown;
    const replay = res.status === 200 || res.headers.get("Idempotent-Replay") === "true";
    // A 2xx without a readable order: the sale exists but we can't show it. Retrying replays it.
    if (!order) return { kind: "retry", failure: { kind: "server", status: res.status }, retryAfterMs: null };
    return { kind: "done", order, replay };
  }
  if (res.status >= 500) return { kind: "retry", failure: { kind: "server", status: res.status }, retryAfterMs: null };
  if (res.status === 429) {
    return {
      kind: "retry",
      failure: { kind: "rate-limited", status: 429, retryAfterMs: parseRetryAfter(res.headers.get("Retry-After")) },
      retryAfterMs: parseRetryAfter(res.headers.get("Retry-After")),
    };
  }

  const code = await readErrorCode(res);
  if (res.status === 409 && code === "ORDER_NUMBER_CONFLICT") {
    return { kind: "retry", failure: { kind: "order-number" }, retryAfterMs: null };
  }
  if (res.status === 409 && code === "IDEMPOTENCY_CONFLICT") {
    const body = (await res.clone().json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
    const message = typeof body?.error === "string" ? body.error : typeof body?.message === "string" ? body.message : null;
    return { kind: "conflict", message };
  }
  if (code === "AUTHORIZATION_INVALID") return { kind: "needs-approval" };
  if (res.status === 401) return { kind: "signed-out" };

  const body = (await res.clone().json().catch(() => null)) as unknown;
  return { kind: "rejected", status: res.status, code, body };
}

export function classifySaleError(err: unknown): SaleSendOutcome {
  const failure = classifyError(err);
  // Anything thrown is "no answer": the server may or may not have the sale, so resend the same id.
  return { kind: "retry", failure: isNoAnswer(failure) ? failure : { kind: "network" }, retryAfterMs: null };
}

// Waits before retry n (1-based): 1 s, 2 s, 4 s, 8 s, 16 s.
export const SALE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];
