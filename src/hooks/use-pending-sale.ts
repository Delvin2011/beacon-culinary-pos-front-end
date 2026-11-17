"use client";

// Sends the pending sale and keeps resending it, with the same body and the same clientOrderId, until the server
// gives a definite answer. While a sale is pending the till must not edit it or start another one.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SALE_RETRY_DELAYS_MS,
  classifySaleError,
  classifySaleResponse,
  clearPendingSale,
  createPendingSale,
  loadPendingSale,
  markSaleCompleted,
  ownerKey,
  savePendingSale,
  withNewApproval,
  type PendingSale,
  type PendingSaleKind,
  type PendingSaleSummary,
  type SaleSendOutcome,
} from "@/lib/pending-sale";

export type PendingSalePhase =
  | "idle" // nothing pending
  | "sending" // sending or waiting to resend: "Checking the sale…"
  | "unconfirmed" // retries ran out: "Sale not confirmed yet. Don't ring it again."
  | "conflict" // 409 IDEMPOTENCY_CONFLICT: kept for a supervisor, never retried
  | "needs-approval" // 401 AUTHORIZATION_INVALID: a manager PIN, then the same id again
  | "other-user" // rung by someone else: they must sign in, or a supervisor clears it
  | "signed-out"; // the sign-in ended mid-send: resumes when the same person signs in

type RejectedOutcome = Extract<SaleSendOutcome, { kind: "rejected" }>;

export type UsePendingSaleOptions = {
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  user: { cashierId?: number; id?: string; email?: string; name?: string } | null;
  isOnline: boolean;
  // Runs once per clientOrderId, after the sale is recorded as done. The place for printing, when it comes.
  onCompleted: (order: unknown, sale: PendingSale, replay: boolean) => void | Promise<void>;
  // Nothing was created (no open shift, till in use, stock, validation): the caller shows why.
  onRejected: (sale: PendingSale, outcome: RejectedOutcome) => void | Promise<void>;
  // The manager approval was refused: ask for a PIN, then call resendWithApproval.
  onNeedsApproval: (sale: PendingSale) => void;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function usePendingSale(options: UsePendingSaleOptions) {
  const { authFetch, user, isOnline } = options;
  const [pending, setPending] = useState<PendingSale | null>(() => (typeof window === "undefined" ? null : loadPendingSale()));
  const [phase, setPhase] = useState<PendingSalePhase>("idle");

  // The latest callbacks, so a running send loop never calls a stale one.
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  // Each send loop has an id; starting another loop (or unmounting) stops the old one.
  const runRef = useRef(0);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const userKey = ownerKey(user);

  const send = useCallback(
    async (sale: PendingSale) => {
      const runId = ++runRef.current;
      setPhase("sending");

      let waitMs = 0;
      for (let attempt = 0; attempt <= SALE_RETRY_DELAYS_MS.length; attempt += 1) {
        if (attempt > 0) {
          await sleep(Math.max(SALE_RETRY_DELAYS_MS[attempt - 1], waitMs));
        }
        if (runRef.current !== runId) return;

        let outcome: SaleSendOutcome;
        try {
          const res = await authFetch("/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sale.body),
          });
          outcome = await classifySaleResponse(res);
        } catch (err) {
          outcome = classifySaleError(err);
        }
        if (runRef.current !== runId) return;

        switch (outcome.kind) {
          case "done": {
            const first = markSaleCompleted(sale.clientOrderId);
            setPending(null);
            setPhase("idle");
            if (first) await callbacksRef.current.onCompleted(outcome.order, sale, outcome.replay);
            return;
          }
          case "retry":
            waitMs = outcome.retryAfterMs ?? 0;
            continue;
          case "conflict": {
            const kept = { ...sale, conflict: true };
            savePendingSale(kept);
            setPending(kept);
            setPhase("conflict");
            return;
          }
          case "needs-approval":
            setPhase("needs-approval");
            callbacksRef.current.onNeedsApproval(sale);
            return;
          case "signed-out":
            setPhase("signed-out");
            return;
          case "rejected":
            clearPendingSale();
            setPending(null);
            setPhase("idle");
            await callbacksRef.current.onRejected(sale, outcome);
            return;
        }
      }
      setPhase("unconfirmed");
    },
    [authFetch],
  );

  // Confirm: freeze the body with a new id, store it, then send. Refused while another sale is pending.
  const start = useCallback(
    (kind: PendingSaleKind, body: Record<string, unknown>, summary: PendingSaleSummary): PendingSale | null => {
      if (pendingRef.current || !userKey) return null;
      const sale = createPendingSale(kind, body, summary, { key: userKey, name: user?.name ?? null });
      savePendingSale(sale);
      pendingRef.current = sale;
      setPending(sale);
      void send(sale);
      return sale;
    },
    [send, user?.name, userKey],
  );

  // After a new manager PIN: same id, same sale, new token.
  const resendWithApproval = useCallback(
    (sessionToken: string) => {
      const current = pendingRef.current;
      if (!current) return;
      const next = withNewApproval(current, sessionToken);
      savePendingSale(next);
      pendingRef.current = next;
      setPending(next);
      void send(next);
    },
    [send],
  );

  // "Check again": resend now.
  const checkNow = useCallback(() => {
    const current = pendingRef.current;
    if (current && !current.conflict) void send(current);
  }, [send]);

  // Drop the pending sale. Only for a supervisor (conflict, someone else's sale, or one that can't be confirmed),
  // or when a refused approval means nothing was created.
  const discard = useCallback(() => {
    runRef.current += 1;
    clearPendingSale();
    pendingRef.current = null;
    setPending(null);
    setPhase("idle");
  }, []);

  // On start and on every sign-in: resume a pending sale, or block the till if someone else rang it.
  useEffect(() => {
    const stored = loadPendingSale();
    pendingRef.current = stored;
    setPending(stored);
    if (!stored || !userKey) {
      setPhase("idle");
      return;
    }
    if (stored.owner.key !== userKey) setPhase("other-user");
    else if (stored.conflict) setPhase("conflict");
    else void send(stored);
  }, [send, userKey]);

  // Retries ran out: try again as soon as the connection comes back.
  const wasOnlineRef = useRef(isOnline);
  useEffect(() => {
    const cameBack = isOnline && !wasOnlineRef.current;
    wasOnlineRef.current = isOnline;
    if (cameBack && phase === "unconfirmed" && pendingRef.current) void send(pendingRef.current);
  }, [isOnline, phase, send]);

  // Stop any running loop when the till unmounts.
  useEffect(
    () => () => {
      runRef.current += 1;
    },
    [],
  );

  return { pending, phase, start, resendWithApproval, checkNow, discard };
}
