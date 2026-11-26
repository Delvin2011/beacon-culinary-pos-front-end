"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { NumericKeypad } from "@/components/pos/numeric-keypad";
import { ChevronLeft, User } from "lucide-react";
import { DeviceNotRegisteredError, LoginBlockedError, PIN_LOGIN_FAILED_MESSAGE, PinLoginError } from "@/contexts/auth-context";
import { fetchTillStatus, formatLocalTime, tillLabel, type TillStatus } from "@/lib/till";
import { CustomerName } from "@/components/customer/customer-name";
import { errorCode } from "@/lib/api-error";
import { DeviceErrorCode, TILL_NOT_REGISTERED_MESSAGE } from "@/lib/devices";
import { reauthLoginPath } from "@/lib/return-to";
import { useLoginBlocks } from "@/hooks/use-login-blocks";
import { LoginBlockBadge } from "@/components/pos/login-block-badge";
import { PIN_FORMAT_MESSAGE, PIN_LENGTH, PIN_PATTERN } from "@/lib/pin";
import { CONNECTION_MESSAGES, classifyError, isNoAnswer, messageForError } from "@/lib/net";
import { useConnection } from "@/contexts/connection-context";
import { useOfflineUnlock } from "@/hooks/use-offline-unlock";
import { OfflineUnlockScreen } from "@/components/pos/offline-unlock-screen";
import { saveUnlockVerifierAfterSignIn } from "@/lib/offline/unlock";
import { apiFetch } from "@/lib/api-fetch";

// Shape returned by GET /users/cashiers
interface CashierSummary {
  id: number;
  name: string;
}

const CASHIERS_FAILED_MESSAGE = "Could not load the cashier list. Contact the administrator if this keeps happening.";

// A cashier-list failure whose message is already safe to show. unreachable: the server can't serve (5xx).
class CashierListError extends Error {
  constructor(message: string, readonly unreachable = false) {
    super(message);
  }
}

type View = "select-cashier" | "enter-pin";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// Deterministic tile colour from cashier id
const TILE_COLOURS = [
  "bg-blue-600",
  "bg-emerald-600",
  "bg-violet-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-cyan-600",
];
function tileColour(id: number) {
  return TILE_COLOURS[id % TILE_COLOURS.length];
}

export default function PosLoginPage() {
  const router = useRouter();
  const {
    isAuthenticated,
    isLoading: authLoading,
    pinLogin,
    error,
    clearError,
    sessionEndedNotice,
    retryPendingLock,
  } = useAuth();
  // GET /pos/till-status: this till and who holds its shift. Null until the first answer; a failed read keeps the
  // last one (the screen still works without it).
  const [tillStatus, setTillStatus] = useState<TillStatus | null>(null);

  const [view, setView] = useState<View>("select-cashier");
  const [cashiers, setCashiers] = useState<CashierSummary[]>([]);
  const [cashiersLoading, setCashiersLoading] = useState(true);
  const [cashiersError, setCashiersError] = useState<string | null>(null);
  const [selectedCashier, setSelectedCashier] = useState<CashierSummary | null>(null);
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  // One countdown per cashier: a block for one person never disables another's tile.
  const blocks = useLoginBlocks<number>();
  const selectedBlock = blocks.get(selectedCashier?.id);
  // 403 DEVICE_NOT_REGISTERED (`required` mode): this browser isn't a registered till. Not a sign-out, never
  // retried automatically; "Try again" reloads the list by hand.
  const [tillNotRegistered, setTillNotRegistered] = useState(false);

  // O3 (D13): offline here means the connection indicator says so, or the cashier list got no answer (after a
  // reload offline the indicator takes a few failed pings to turn).
  const { isOnline } = useConnection();
  const [cashiersUnreachable, setCashiersUnreachable] = useState(false);
  const offlineHere = !isOnline || cashiersUnreachable;
  const offlineUnlock = useOfflineUnlock(offlineHere);

  // Already authenticated — let /pos handle shift routing
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.replace("/pos");
    }
  }, [isAuthenticated, authLoading, router]);

  // Fetch cashier list (no sign-in needed). Credentials send the till's deviceToken cookie: in `required`
  // mode the backend refuses this list from an unregistered browser.
  const loadCashiers = useCallback(() => {
    setCashiersLoading(true);
    setCashiersError(null);
    setTillNotRegistered(false);
    setCashiersUnreachable(false);

    apiFetch("/users/cashiers", { credentials: "include" })
      .then(async (res) => {
        if (res.status === 403 && (await errorCode(res)) === DeviceErrorCode.NOT_REGISTERED) {
          setCashiers([]);
          setTillNotRegistered(true);
          return;
        }
        if (res.status >= 500) throw new CashierListError(CONNECTION_MESSAGES.server, true);
        if (!res.ok) throw new CashierListError(CASHIERS_FAILED_MESSAGE);
        const data = (await res.json()) as unknown;
        if (!Array.isArray(data)) throw new CashierListError(CASHIERS_FAILED_MESSAGE);
        setCashiers(
          (data as Record<string, unknown>[]).map((u) => ({
            id: u.id as number,
            name: u.name as string,
          })),
        );
      })
      .catch((err: unknown) => {
        setCashiersError(err instanceof CashierListError ? err.message : messageForError(err, CASHIERS_FAILED_MESSAGE));
        setCashiersUnreachable(err instanceof CashierListError ? err.unreachable : isNoAnswer(classifyError(err)));
      })
      .finally(() => setCashiersLoading(false));
  }, []);

  useEffect(() => {
    loadCashiers();
  }, [loadCashiers]);

  // On load (which covers arriving here after a lock or a sign-out) and after a refused sign-in.
  const loadTillStatus = useCallback(() => {
    fetchTillStatus()
      .then((status) => {
        setTillStatus(status);
        // The server is reachable: send a lock that didn't get through.
        retryPendingLock();
      })
      .catch(() => {});
  }, [retryPendingLock]);

  useEffect(() => {
    loadTillStatus();
  }, [loadTillStatus]);

  const tillShift = tillStatus?.shift ?? null;
  // requireRegistered on a browser that isn't a registered till: no POS sign-in here.
  const blockedUnregistered = tillStatus !== null && tillStatus.requireRegistered && !tillStatus.registered;

  const handleCashierSelect = (cashier: CashierSummary) => {
    setSelectedCashier(cashier);
    setPin("");
    setPinError(null);
    if (error) clearError();
    setView("enter-pin");
  };

  const handleBackToSelect = () => {
    setView("select-cashier");
    setSelectedCashier(null);
    setPin("");
    setPinError(null);
    if (error) clearError();
  };

  const handlePinChange = (newPin: string) => {
    setPin(newPin);
    // Clear error on any keypad interaction
    if (pinError) setPinError(null);
    if (error) clearError();
  };

  const handleSubmitPin = async () => {
    if (!selectedCashier || submitting || selectedBlock?.active) return;
    if (!PIN_PATTERN.test(pin)) {
      setPinError(PIN_FORMAT_MESSAGE);
      return;
    }

    setSubmitting(true);
    setPinError(null);
    blocks.clear(selectedCashier.id);
    try {
      await pinLogin({ cashierId: selectedCashier.id, pin });
      // O3 (D13): the check value for offline unlock, in the background; the PIN stays in memory only.
      void saveUnlockVerifierAfterSignIn({ pin, cashierId: selectedCashier.id, tillStatus });
      router.replace("/pos");
    } catch (err) {
      if (err instanceof DeviceNotRegisteredError) {
        setTillNotRegistered(true);
        clearError();
      } else if (err instanceof LoginBlockedError) {
        // The countdown shows the message; no automatic retry.
        blocks.block(selectedCashier.id, err.block);
        clearError();
      } else {
        // pinLogin's messages never reveal whether the cashier exists. TillLockedError and
        // ShiftOpenOnOtherTillError carry the O2 messages.
        setPinError(err instanceof Error ? err.message : PIN_LOGIN_FAILED_MESSAGE);
      }
      // A refusal may mean the till's state changed (someone locked it, a shift opened): read it again.
      if (err instanceof PinLoginError) loadTillStatus();
      setPin("");
    } finally {
      setSubmitting(false);
    }
  };

  // Auto-submit once all 6 digits are entered
  useEffect(() => {
    if (pin.length === PIN_LENGTH && !submitting) {
      handleSubmitPin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <span className="text-slate-400 text-lg animate-pulse">Loading…</span>
      </div>
    );
  }

  // ── TILL NOT REGISTERED ─────────────────────────────────────────────────────
  if (tillNotRegistered || blockedUnregistered) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-950 p-8 text-center">
        <h1 className="text-2xl font-bold text-white">{TILL_NOT_REGISTERED_MESSAGE}</h1>
        <p className="max-w-md text-sm text-slate-400">A manager signs in with their password on this till to register it.</p>
        <div className="flex gap-3">
          <a
            href={reauthLoginPath("/devices/register")}
            className="rounded-xl bg-white px-5 py-3 font-semibold text-slate-950 hover:bg-slate-200"
          >
            Manager sign-in
          </a>
          <button
            type="button"
            onClick={() => {
              setView("select-cashier");
              setSelectedCashier(null);
              setPin("");
              loadCashiers();
              loadTillStatus();
            }}
            className="rounded-xl border border-slate-700 px-5 py-3 font-medium text-slate-200 hover:bg-slate-800"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // ── OFFLINE UNLOCK (O3, D13) ────────────────────────────────────────────────
  if (offlineHere && view === "select-cashier" && (offlineUnlock.state === "available" || offlineUnlock.state === "disabled")) {
    return (
      <OfflineUnlockScreen
        owner={offlineUnlock.owner}
        disabled={offlineUnlock.state === "disabled"}
        triesLeft={offlineUnlock.state === "available" ? offlineUnlock.triesLeft : null}
        notice={sessionEndedNotice}
        unlock={offlineUnlock.unlock}
        onUnlocked={() => router.replace("/pos")}
      />
    );
  }

  // ── SELECT CASHIER ──────────────────────────────────────────────────────────
  if (view === "select-cashier") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-10 bg-slate-950 p-8">
        <div className="text-center">
          <CustomerName className="mb-2 text-sm font-semibold uppercase tracking-[0.2em] text-slate-400" />
          <h1 className="text-3xl font-bold text-white">Who&apos;s working?</h1>
          <p className="mt-1 text-slate-400">Tap your name to continue</p>
          {tillStatus?.registered && (
            <p className="mt-3 text-sm font-medium text-slate-300">{tillLabel(tillStatus.tillCode, tillStatus.tillName)}</p>
          )}
          {tillShift && (
            <p className="mt-1 text-sm text-amber-200">
              {tillShift.locked
                ? `${tillStatus?.tillCode ?? "This till"} is locked. Shift of ${tillShift.ownerName} since ${formatLocalTime(tillShift.openedAt)}.`
                : `In use by ${tillShift.ownerName}.`}{" "}
              Only {tillShift.ownerName} or a manager can sign in.
            </p>
          )}
        </div>

        {sessionEndedNotice && (
          <div role="status" className="max-w-md rounded-xl border border-sky-400/30 bg-sky-500/10 px-5 py-3 text-center text-sm text-sky-100">
            {sessionEndedNotice}
          </div>
        )}

        {cashiersLoading && (
          <p className="text-slate-400 animate-pulse">Loading cashiers…</p>
        )}

        {cashiersError && (
          <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-6 py-4 text-center text-rose-300">
            <p>{cashiersError}</p>
            {offlineHere && offlineUnlock.state === "unavailable" && (
              <p className="text-sm text-rose-200">Offline: this till can&apos;t be unlocked offline.</p>
            )}
            <button
              type="button"
              onClick={() => loadCashiers()}
              className="rounded-lg border border-rose-400/40 px-4 py-2 text-sm font-medium text-rose-100 hover:bg-rose-500/20"
            >
              Try again
            </button>
          </div>
        )}

        {!cashiersLoading && !cashiersError && cashiers.length === 0 && (
          <div className="rounded-xl border border-slate-700 bg-slate-800 px-6 py-4 text-center text-slate-400 max-w-sm">
            No active cashiers found.
          </div>
        )}

        {!cashiersLoading && cashiers.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 w-full max-w-xl">
            {cashiers.map((cashier) => (
              <button
                key={cashier.id}
                type="button"
                onClick={() => handleCashierSelect(cashier)}
                className={`flex flex-col items-center gap-3 rounded-2xl p-6 transition-colors hover:bg-slate-700 active:scale-95 active:bg-slate-600 select-none ${
                  tillShift?.ownerId === cashier.id ? "bg-slate-700 ring-2 ring-amber-300" : "bg-slate-800"
                }`}
              >
                <div
                  className={`flex h-16 w-16 items-center justify-center rounded-full text-xl font-bold text-white ${tileColour(cashier.id)}`}
                >
                  {getInitials(cashier.name)}
                </div>
                <span className="text-sm font-medium text-white text-center leading-tight">
                  {cashier.name}
                </span>
                {tillShift?.ownerId === cashier.id && (
                  <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-semibold text-amber-200">
                    {tillShift.locked ? "Shift open · tap to resume" : "Signed in"}
                  </span>
                )}
                <LoginBlockBadge state={blocks.get(cashier.id)} />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── ENTER PIN ───────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-slate-950 p-8">
      {/* Back button */}
      <div className="w-full max-w-xs">
        <button
          type="button"
          onClick={handleBackToSelect}
          className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors text-sm"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
      </div>

      {/* Selected cashier identity */}
      <div className="flex flex-col items-center gap-3">
        <div
          className={`flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold text-white ${tileColour(selectedCashier!.id)}`}
        >
          {selectedCashier ? getInitials(selectedCashier.name) : <User />}
        </div>
        <p className="text-xl font-semibold text-white">{selectedCashier?.name}</p>
        <p className="text-sm text-slate-400">Enter your PIN</p>
        {tillStatus?.registered && (
          <p className="text-xs text-slate-500">{tillLabel(tillStatus.tillCode, tillStatus.tillName)}</p>
        )}
      </div>

      {/* PIN dots */}
      <div className="flex gap-4">
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <div
            key={i}
            className={`h-4 w-4 rounded-full border-2 transition-colors ${
              i < pin.length
                ? "bg-white border-white"
                : "bg-transparent border-slate-600"
            }`}
          />
        ))}
      </div>

      {/* Error */}
      {(selectedBlock?.message ?? pinError) && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-3 text-sm text-rose-300 text-center max-w-xs">
          {selectedBlock?.message ?? pinError}
        </div>
      )}

      {/* Keypad */}
      <NumericKeypad
        value={pin}
        onChange={handlePinChange}
        maxLength={PIN_LENGTH}
        disabled={submitting || selectedBlock?.active}
      />
    </div>
  );
}
