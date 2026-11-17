"use client";

// Covers the till while a sale's outcome is unknown, so it can't be edited, rung again or replaced by a new one.
// Sits under the manager PIN dialog (z-50) and over everything else, header buttons included.

import { useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, ShieldAlert, UserRound } from "lucide-react";
import type { PendingSale } from "@/lib/pending-sale";
import type { PendingSalePhase } from "@/hooks/use-pending-sale";
import { formatZarCurrency } from "@/lib/utils";

type PendingSaleOverlayProps = {
  sale: PendingSale;
  phase: PendingSalePhase;
  isOnline: boolean;
  onCheckAgain: () => void;
  onEnterPin: () => void;
  onCancelUnapproved: () => void;
  onSupervisorClear: () => void;
  onSignOut: () => void;
  // Set for a manager (O2): send another cashier's sale as it was rung, after a confirm step.
  onManagerFinish?: () => void;
};

export function PendingSaleOverlay({
  sale,
  phase,
  isOnline,
  onCheckAgain,
  onEnterPin,
  onCancelUnapproved,
  onSupervisorClear,
  onSignOut,
  onManagerFinish,
}: PendingSaleOverlayProps) {
  const [confirmFinish, setConfirmFinish] = useState(false);
  const who = sale.owner.name ?? "another cashier";
  const label = sale.kind === "COMPLIMENTARY" ? "complimentary order" : "sale";

  let icon = <Loader2 className="h-10 w-10 animate-spin text-emerald-300" />;
  let title = `Checking the ${label}…`;
  let detail = isOnline
    ? "Making sure it was recorded once. Don't ring it again."
    : "Waiting for the connection. Nothing has been lost. Don't ring it again.";

  if (phase === "unconfirmed") {
    icon = <AlertTriangle className="h-10 w-10 text-amber-300" />;
    title = `${sale.kind === "COMPLIMENTARY" ? "Complimentary order" : "Sale"} not confirmed yet. Don't ring it again.`;
    detail = "The till keeps it and checks again when the connection is back.";
  } else if (phase === "conflict") {
    icon = <ShieldAlert className="h-10 w-10 text-rose-300" />;
    title = `This ${label} wasn't recorded`;
    detail =
      "The server matched it to a different earlier sale, so it refused it rather than record it twice. Call a supervisor.";
  } else if (phase === "needs-approval") {
    icon = <ShieldAlert className="h-10 w-10 text-amber-300" />;
    title = "Manager approval needed";
    detail = `The approval for this ${label} was refused or has expired, and it hasn't been recorded. Enter a manager PIN to finish it.`;
  } else if (phase === "other-user") {
    icon = <UserRound className="h-10 w-10 text-sky-300" />;
    title = `A ${label} by ${who} is still being checked`;
    detail = `${who} must sign in on this till to finish it, or a supervisor can clear it.`;
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="pending-sale-title"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4"
    >
      <div className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-6 text-center">
        <div className="flex justify-center">{icon}</div>
        <h2 id="pending-sale-title" className="mt-4 text-xl font-bold text-white">
          {title}
        </h2>
        <p className="mt-2 text-sm text-slate-300">{detail}</p>

        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-left text-sm text-slate-300">
          <ul className="space-y-0.5">
            {sale.summary.lines.map((line, index) => (
              <li key={index}>
                {line.quantity} × {line.name}
              </li>
            ))}
          </ul>
          <p className="mt-2 font-semibold text-white">Total {formatZarCurrency(sale.summary.total)}</p>
        </div>

        <div className="mt-6 grid gap-2">
          {phase === "unconfirmed" && (
            <button
              type="button"
              onClick={onCheckAgain}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-400"
            >
              <RefreshCw className="h-4 w-4" />
              Check again
            </button>
          )}
          {phase === "needs-approval" && (
            <>
              <button
                type="button"
                onClick={onEnterPin}
                className="rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-400"
              >
                Enter manager PIN
              </button>
              <button
                type="button"
                onClick={onCancelUnapproved}
                className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-medium text-slate-300 hover:bg-slate-800"
              >
                Back to the order (nothing was recorded)
              </button>
            </>
          )}
          {phase === "other-user" && onManagerFinish && !confirmFinish && (
            <button
              type="button"
              onClick={() => setConfirmFinish(true)}
              className="rounded-xl bg-amber-400 px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-amber-300"
            >
              Manager: finish this {label}
            </button>
          )}
          {phase === "other-user" && onManagerFinish && confirmFinish && (
            <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-left text-sm text-amber-100">
              <p>
                Send {who}&apos;s {label} exactly as it was rung? If it already went through, it comes back as it is and
                nothing is charged twice. If it never arrived, it is recorded now, with you as the cashier.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmFinish(false)}
                  className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
                >
                  Not now
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmFinish(false);
                    onManagerFinish();
                  }}
                  className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-300"
                >
                  Send it
                </button>
              </div>
            </div>
          )}
          {phase === "other-user" && (
            <button
              type="button"
              onClick={onSignOut}
              className="rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-400"
            >
              Sign out so {who} can sign in
            </button>
          )}
          {(phase === "unconfirmed" || phase === "conflict" || phase === "other-user") && (
            <button
              type="button"
              onClick={onSupervisorClear}
              className="rounded-xl border border-amber-400/40 px-4 py-3 text-sm font-medium text-amber-200 hover:bg-amber-500/10"
            >
              Supervisor: clear it
            </button>
          )}
        </div>
        {(phase === "unconfirmed" || phase === "other-user") && (
          <p className="mt-3 text-xs text-slate-500">
            Clearing doesn&apos;t cancel it. Check Today&apos;s orders before ringing it again.
          </p>
        )}
      </div>
    </div>
  );
}
