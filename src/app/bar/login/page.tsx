"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { NumericKeypad } from "@/components/pos/numeric-keypad";
import { useAuth } from "@/hooks/use-auth";
import { isBarAccessRole } from "@/lib/roles";

// Shape returned by GET /users/login-tiles?screen=BAR: active Baristas and Admins with a PIN set.
interface LoginTile {
  id: number;
  name: string;
}

const API_BASE = process.env.NEXT_PUBLIC_AUTH_API_URL ?? "http://localhost:8080";
const PIN_LENGTH = 6;

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function BarLoginPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, user, pinLogin, error, clearError, logout } = useAuth();

  const [tiles, setTiles] = useState<LoginTile[]>([]);
  const [tilesLoading, setTilesLoading] = useState(true);
  const [tilesError, setTilesError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LoginTile | null>(null);
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);

  // PIN login doesn't check the screen: once signed in, only Baristas and Admins get through.
  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) return;

    if (isBarAccessRole(user?.role)) {
      router.replace("/bar");
      return;
    }

    logout();
    setSelected(null);
    setPin("");
    setAccessError("You don't have access to this screen.");
  }, [isAuthenticated, isLoading, logout, router, user?.role]);

  // Public, before login.
  useEffect(() => {
    setTilesLoading(true);
    setTilesError(null);
    fetch(`${API_BASE}/users/login-tiles?screen=BAR`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data = (await res.json()) as unknown;
        if (!Array.isArray(data)) throw new Error("Unexpected response format");
        setTiles(
          (data as Record<string, unknown>[])
            .filter((item) => typeof item.id === "number" && typeof item.name === "string")
            .map((item) => ({ id: item.id as number, name: item.name as string })),
        );
      })
      .catch(() => setTilesError("Could not load the bar staff list. Check the connection or contact an admin."))
      .finally(() => setTilesLoading(false));
  }, []);

  const resetPin = () => {
    setPin("");
    setPinError(null);
    if (error) clearError();
  };

  const submit = async () => {
    if (submitting || !selected) return;

    if (pin.length !== PIN_LENGTH) {
      setPinError("PIN must be 6 digits.");
      return;
    }

    setSubmitting(true);
    setPinError(null);
    if (error) clearError();

    setAccessError(null);
    try {
      // The role check above sends Baristas and Admins on to /bar and refuses anyone else.
      await pinLogin({ cashierId: selected.id, pin });
    } catch {
      setPinError("Incorrect PIN.");
      setPin("");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (pin.length === PIN_LENGTH && !submitting) {
      void submit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <span className="text-lg text-slate-400 animate-pulse">Loading...</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-black/30">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/35">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-white">Bar Station</h1>
          <p className="mt-1 text-sm text-slate-400">
            {selected ? `Hi ${selected.name}. Enter your PIN to open the bar queue.` : "Tap your name to sign in."}
          </p>
        </div>

        {accessError && (
          <p className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-center text-sm text-rose-200">
            {accessError}
          </p>
        )}

        {!selected ? (
          <>
            {tilesLoading && <p className="text-center text-sm text-slate-400 animate-pulse">Loading bar staff…</p>}
            {tilesError && (
              <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-center text-sm text-rose-200">
                {tilesError}
              </p>
            )}
            {!tilesLoading && !tilesError && tiles.length === 0 && (
              <p className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-center text-sm text-slate-400">
                No bar staff with a PIN. An admin can set one on the Staff page.
              </p>
            )}
            {tiles.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {tiles.map((tile) => (
                  <button
                    key={tile.id}
                    type="button"
                    onClick={() => {
                      setSelected(tile);
                      setAccessError(null);
                      resetPin();
                    }}
                    className="flex flex-col items-center gap-2 rounded-2xl bg-slate-800 p-4 transition-colors select-none hover:bg-slate-700 active:scale-95 active:bg-slate-600"
                  >
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-lg font-bold text-white">
                      {getInitials(tile.name)}
                    </span>
                    <span className="text-center text-sm font-medium leading-tight text-white">{tile.name}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                resetPin();
              }}
              className="mb-4 flex items-center gap-1 text-sm text-slate-400 transition-colors hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>

            <div className="mb-4 flex justify-center gap-3">
              {Array.from({ length: PIN_LENGTH }).map((_, index) => (
                <div
                  key={index}
                  className={[
                    "h-3.5 w-3.5 rounded-full border-2 transition-colors",
                    index < pin.length ? "border-white bg-white" : "border-slate-600 bg-transparent",
                  ].join(" ")}
                />
              ))}
            </div>

            {(pinError || error) && (
              <p className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-center text-sm text-rose-200">
                {pinError ?? error}
              </p>
            )}

            <div className="flex justify-center">
              <NumericKeypad
                value={pin}
                onChange={(value) => {
                  setPin(value);
                  if (pinError) setPinError(null);
                  if (error) clearError();
                }}
                maxLength={PIN_LENGTH}
                disabled={submitting}
              />
            </div>

            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || pin.length < PIN_LENGTH}
              className="mt-4 w-full rounded-2xl bg-blue-500 py-3.5 text-base font-semibold text-white transition hover:bg-blue-400 active:bg-blue-600 disabled:pointer-events-none disabled:opacity-50"
            >
              {submitting ? "Signing in..." : "Open Bar Queue"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
