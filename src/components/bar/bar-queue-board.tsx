"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Clock3, Coffee, Loader2, RefreshCw, Volume2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { columnShellClass, statusPillClass } from "@/components/orders/status-visuals";
import { type CatalogGroup, type CategoryRef, type Station, setOutToday } from "@/lib/catalog";
import { consumeSseResponse } from "@/lib/sse";
import {
  type OrderStatus,
  type OtherStation,
  type StationStatus,
  stationChipClass,
  stationStatusLabel,
} from "@/lib/stations";

type BarCardLine = {
  optionName: string;
  quantity: number;
  station?: Station;
  extras?: { componentName: string; quantity: number }[];
};

// GET /bar/orders card. status is the bar's own part; orderStatus is the whole order's. lines are bar items only.
type BarCard = {
  orderId: number;
  orderNumber: number;
  status: OrderStatus;
  orderStatus?: OrderStatus;
  createdAt: string;
  lines: BarCardLine[];
  otherStations?: OtherStation[];
};

type BarStreamPayload = {
  eventType: "ORDER_CREATED" | "STATUS_CHANGED" | "ORDER_UPDATED";
  order: BarCard;
};

type CardEntry = { order: BarCard; doneAtMs?: number };

// A beverage from GET /menu/today, for the Out today panel.
type MenuOption = {
  id: number;
  name: string;
  mealCatalogId?: number;
  group?: CatalogGroup;
  category?: CategoryRef | null;
  outToday?: boolean;
};

type ConnectionState = "connecting" | "connected" | "reconnecting";

const RECONNECT_DELAY_MS = 2000;
// The list never returns finished work; Done cards come from stream events and drop off after this.
const DONE_VISIBLE_MS = 60 * 1000;
const NEW_FLASH_MS = 2500;

function isActive(status: OrderStatus): status is "PENDING" | "IN_PROGRESS" {
  return status === "PENDING" || status === "IN_PROGRESS";
}

function parseError(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const payload = body as Record<string, unknown>;
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
  return fallback;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
}

function minutesSince(value: string, nowMs: number): number | null {
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : Math.max(0, Math.floor((nowMs - ms) / 60000));
}

export function BarQueueBoard() {
  const { authFetch } = useAuth();

  const [cardsById, setCardsById] = useState<Record<number, CardEntry>>({});
  const [isSnapshotLoading, setIsSnapshotLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [updatingIds, setUpdatingIds] = useState<Record<number, true>>({});
  const [newIds, setNewIds] = useState<Record<number, true>>({});
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [soundEnabled, setSoundEnabled] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(false);

  const [beverages, setBeverages] = useState<MenuOption[]>([]);
  const [beveragesError, setBeveragesError] = useState<string | null>(null);
  const [togglingIds, setTogglingIds] = useState<Record<number, true>>({});

  const streamControllerRef = useRef<AbortController | null>(null);
  const flashTimeoutsRef = useRef<Record<number, number>>({});

  // Browsers block audio until a user gesture, so sound starts from the "Enable sound" button.
  const enableSound = () => {
    try {
      const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      audioContextRef.current = audioContextRef.current ?? new AudioCtor();
      void audioContextRef.current.resume();
      soundEnabledRef.current = true;
      setSoundEnabled(true);
      playChime();
    } catch {
      // No audio on this device: the flash still shows new orders.
    }
  };

  // Two short rising tones.
  const playChime = () => {
    const context = audioContextRef.current;
    if (!context || !soundEnabledRef.current) return;
    const start = context.currentTime;
    [880, 1320].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const at = start + index * 0.18;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.4);
    });
  };

  const flashNew = useCallback((orderId: number) => {
    setNewIds((prev) => ({ ...prev, [orderId]: true }));
    window.clearTimeout(flashTimeoutsRef.current[orderId]);
    flashTimeoutsRef.current[orderId] = window.setTimeout(() => {
      setNewIds((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
      delete flashTimeoutsRef.current[orderId];
    }, NEW_FLASH_MS);
  }, []);

  // PENDING / IN_PROGRESS show in their columns, DONE moves to the Done column, anything else (VOIDED, REFUNDED) goes.
  const upsertCard = useCallback((card: BarCard) => {
    setCardsById((prev) => {
      const next = { ...prev };
      if (isActive(card.status)) {
        next[card.orderId] = { order: card };
      } else if (card.status === "DONE") {
        next[card.orderId] = { order: card, doneAtMs: prev[card.orderId]?.doneAtMs ?? Date.now() };
      } else {
        delete next[card.orderId];
      }
      return next;
    });
  }, []);

  // The list holds active work only; recently finished cards stay until they time out.
  const applySnapshot = useCallback((cards: BarCard[]) => {
    setCardsById((prev) => {
      const next: Record<number, CardEntry> = {};
      for (const [key, entry] of Object.entries(prev)) {
        if (entry.order.status === "DONE") next[Number(key)] = entry;
      }
      for (const card of cards) {
        if (isActive(card.status)) next[card.orderId] = { order: card };
      }
      return next;
    });
  }, []);

  const loadSnapshot = useCallback(async (): Promise<boolean> => {
    setSnapshotError(null);
    try {
      const response = await authFetch("/bar/orders");
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) throw new Error(parseError(payload, "Unable to load the bar queue."));
      if (!Array.isArray(payload)) throw new Error("Unexpected bar queue response format.");
      applySnapshot(payload as BarCard[]);
      return true;
    } catch (err) {
      setSnapshotError(err instanceof Error ? err.message : "Unable to load the bar queue.");
      return false;
    } finally {
      setIsSnapshotLoading(false);
    }
  }, [applySnapshot, authFetch]);

  const loadBeverages = useCallback(async () => {
    setBeveragesError(null);
    try {
      // A Barista can't read /admin/meal-catalog; the till menu carries mealCatalogId and outToday.
      const response = await authFetch("/menu/today");
      const payload = (await response.json().catch(() => null)) as { options?: MenuOption[] } | null;
      if (!response.ok || !payload || !Array.isArray(payload.options)) {
        throw new Error(parseError(payload, "Unable to load beverages."));
      }
      const byCatalogId = new Map<number, MenuOption>();
      for (const option of payload.options) {
        if (option.group === "BEVERAGES" && typeof option.mealCatalogId === "number") byCatalogId.set(option.mealCatalogId, option);
      }
      setBeverages(Array.from(byCatalogId.values()));
    } catch (err) {
      setBeveragesError(err instanceof Error ? err.message : "Unable to load beverages.");
    }
  }, [authFetch]);

  useEffect(() => {
    void loadBeverages();
  }, [loadBeverages]);

  // Snapshot, then stream; on any drop, wait and start again (the snapshot refetch covers missed events).
  useEffect(() => {
    let cancelled = false;
    const flashTimeouts = flashTimeoutsRef.current;

    const run = async () => {
      let attempt = 0;
      while (!cancelled) {
        setConnectionState(attempt === 0 ? "connecting" : "reconnecting");

        const synced = await loadSnapshot();
        if (!synced) {
          await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
          attempt += 1;
          continue;
        }

        const controller = new AbortController();
        streamControllerRef.current = controller;

        try {
          const response = await authFetch("/bar/orders/stream", {
            headers: { Accept: "text/event-stream", "Cache-Control": "no-cache" },
            signal: controller.signal,
          });
          if (!response.ok || !response.body) throw new Error(`Stream connection failed (${response.status}).`);

          setConnectionState("connected");

          await consumeSseResponse(
            response,
            (rawEvent) => {
              try {
                const payload = JSON.parse(rawEvent) as BarStreamPayload;
                if (!payload?.order) return;
                upsertCard(payload.order);
                // Only new orders chime: a STATUS_CHANGED can be the kitchen moving its part (the meal chip).
                if (payload.eventType === "ORDER_CREATED" && isActive(payload.order.status)) {
                  flashNew(payload.order.orderId);
                  playChime();
                }
              } catch {
                // Ignore malformed events and keep streaming.
              }
            },
            controller.signal,
          );
        } catch {
          if (cancelled || controller.signal.aborted) break;
        }

        attempt += 1;
        if (!cancelled) {
          setConnectionState("reconnecting");
          await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      streamControllerRef.current?.abort();
      for (const timeoutId of Object.values(flashTimeouts)) window.clearTimeout(timeoutId);
    };
    // playChime reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authFetch, flashNew, loadSnapshot, upsertCard]);

  // Ticks the "minutes ago" labels and drops Done cards after a minute.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      setCardsById((prev) => {
        let changed = false;
        const next: Record<number, CardEntry> = {};
        for (const [key, entry] of Object.entries(prev)) {
          if (entry.order.status === "DONE" && now - (entry.doneAtMs ?? 0) >= DONE_VISIBLE_MS) {
            changed = true;
            continue;
          }
          next[Number(key)] = entry;
        }
        return changed ? next : prev;
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const byCreated = (a: BarCard, b: BarCard) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  const entries = useMemo(() => Object.values(cardsById), [cardsById]);
  const pending = useMemo(() => entries.map((e) => e.order).filter((o) => o.status === "PENDING").sort(byCreated), [entries]);
  const inProgress = useMemo(() => entries.map((e) => e.order).filter((o) => o.status === "IN_PROGRESS").sort(byCreated), [entries]);
  const done = useMemo(
    () =>
      entries
        .filter((e) => e.order.status === "DONE")
        .sort((a, b) => (b.doneAtMs ?? 0) - (a.doneAtMs ?? 0))
        .map((e) => e.order),
    [entries],
  );

  // One step forward at a time. A 400 (skipped step, or voided/refunded) or 404 usually means another screen moved it.
  const advance = useCallback(
    async (card: BarCard) => {
      const target = card.status === "PENDING" ? "IN_PROGRESS" : card.status === "IN_PROGRESS" ? "DONE" : null;
      if (!target) return;

      setActionError(null);
      setUpdatingIds((prev) => ({ ...prev, [card.orderId]: true }));
      try {
        const response = await authFetch(`/bar/orders/${card.orderId}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: target }),
        });
        const payload = (await response.json().catch(() => null)) as unknown;
        if (!response.ok) {
          if (response.status === 400 || response.status === 404) {
            await loadSnapshot();
            throw new Error(parseError(payload, `Order #${card.orderNumber} changed on another screen. The list has been refreshed.`));
          }
          throw new Error(parseError(payload, "Unable to change the order status."));
        }
        upsertCard(payload as BarCard);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Unable to change the order status.");
      } finally {
        setUpdatingIds((prev) => {
          const next = { ...prev };
          delete next[card.orderId];
          return next;
        });
      }
    },
    [authFetch, loadSnapshot, upsertCard],
  );

  const toggleBeverage = async (option: MenuOption) => {
    if (typeof option.mealCatalogId !== "number") return;
    const catalogId = option.mealCatalogId;
    setTogglingIds((prev) => ({ ...prev, [catalogId]: true }));
    setBeveragesError(null);
    try {
      const updated = await setOutToday<{ outToday?: boolean }>(authFetch, catalogId, !option.outToday);
      const outToday = typeof updated?.outToday === "boolean" ? updated.outToday : !option.outToday;
      setBeverages((prev) => prev.map((entry) => (entry.mealCatalogId === catalogId ? { ...entry, outToday } : entry)));
    } catch (err) {
      setBeveragesError(err instanceof Error ? err.message : "Unable to change Out today.");
    } finally {
      setTogglingIds((prev) => {
        const next = { ...prev };
        delete next[catalogId];
        return next;
      });
    }
  };

  const beverageSections = useMemo(() => {
    const sections = new Map<string, { name: string; sortOrder: number; items: MenuOption[] }>();
    for (const option of beverages) {
      const name = option.category?.name ?? "Beverages";
      const section = sections.get(name) ?? { name, sortOrder: option.category?.sortOrder ?? Number.MAX_SAFE_INTEGER, items: [] };
      section.items.push(option);
      sections.set(name, section);
    }
    return Array.from(sections.values())
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((section) => ({ ...section, items: [...section.items].sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [beverages]);

  return (
    <div className="flex min-h-[calc(100vh-5rem)] flex-col gap-4 bg-slate-950 p-4 md:p-6">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Bar Queue</h1>
          <p className="text-sm text-slate-400">Drinks to make for paid orders. Meals are shown as a chip only.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ring-1",
              connectionState === "connected"
                ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                : "bg-amber-500/15 text-amber-200 ring-amber-500/30",
            )}
          >
            {connectionState === "connected" ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Live
              </>
            ) : (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Reconnecting...
              </>
            )}
          </span>

          {soundEnabled ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300 ring-1 ring-slate-700">
              <Volume2 className="h-3.5 w-3.5" />
              Sound on
            </span>
          ) : (
            <Button type="button" size="sm" onClick={enableSound} className="bg-amber-400 text-slate-900 hover:bg-amber-300">
              <Volume2 className="h-3.5 w-3.5" />
              Enable sound
            </Button>
          )}

          <Button type="button" variant="outline" size="sm" onClick={() => void loadSnapshot()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Resync
          </Button>
        </div>
      </div>

      {snapshotError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{snapshotError}</div>
      )}
      {actionError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{actionError}</div>
      )}

      <div className="grid flex-1 gap-4 lg:grid-cols-3">
        {(
          [
            ["Pending", "PENDING", pending, isSnapshotLoading ? "Loading orders..." : "No drinks waiting"],
            ["In Progress", "IN_PROGRESS", inProgress, isSnapshotLoading ? "Loading orders..." : "Nothing being made"],
            ["Done", "DONE", done, "Finished drinks show here for a minute"],
          ] as const
        ).map(([title, status, cards, emptyLabel]) => (
          <section key={status} className={cn("flex min-h-0 flex-col rounded-2xl border p-3", columnShellClass(status))}>
            <div className="mb-3 flex items-center justify-between gap-3 px-1">
              <h2 className="text-lg font-bold text-white">{title}</h2>
              <span className={cn("rounded-full px-2 py-1 text-xs font-semibold ring-1", statusPillClass(status))}>{cards.length}</span>
            </div>
            <div className="flex min-h-[180px] flex-1 flex-col gap-3 overflow-y-auto pr-1">
              {cards.length === 0 ? (
                <div className="flex h-full min-h-[120px] items-center justify-center rounded-xl border border-dashed border-slate-700 text-sm text-slate-400">
                  {emptyLabel}
                </div>
              ) : (
                cards.map((card) => (
                  <BarCardView
                    key={card.orderId}
                    card={card}
                    nowMs={nowMs}
                    isNew={Boolean(newIds[card.orderId])}
                    isUpdating={Boolean(updatingIds[card.orderId])}
                    onAdvance={() => void advance(card)}
                  />
                ))
              )}
            </div>
          </section>
        ))}
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-white">Out today</h2>
            <p className="text-sm text-slate-400">Switch a drink off when it runs out. It comes back automatically tomorrow.</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadBeverages()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
        {beveragesError && <p className="mb-2 text-sm text-rose-300">{beveragesError}</p>}
        {beverageSections.length === 0 ? (
          <p className="text-sm text-slate-400">No beverages on the menu.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {beverageSections.map((section) => (
              <div key={section.name}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">{section.name}</p>
                <ul className="divide-y divide-slate-800">
                  {section.items.map((option) => {
                    const out = Boolean(option.outToday);
                    const busy = typeof option.mealCatalogId === "number" && Boolean(togglingIds[option.mealCatalogId]);
                    return (
                      <li key={option.mealCatalogId ?? option.id} className="flex items-center justify-between gap-3 py-2">
                        <span className={cn("text-sm", out ? "text-slate-500 line-through" : "text-slate-100")}>{option.name}</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={out}
                          aria-label={`${option.name} out today`}
                          disabled={busy}
                          onClick={() => void toggleBeverage(option)}
                          className={cn(
                            "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 transition disabled:opacity-50",
                            out ? "bg-rose-500/20 text-rose-200 ring-rose-400/40" : "bg-emerald-500/15 text-emerald-200 ring-emerald-400/30",
                          )}
                        >
                          {busy ? "Saving…" : out ? "Out · Back tomorrow" : "On sale"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

type BarCardViewProps = {
  card: BarCard;
  nowMs: number;
  isNew: boolean;
  isUpdating: boolean;
  onAdvance: () => void;
};

function BarCardView({ card, nowMs, isNew, isUpdating, onAdvance }: BarCardViewProps) {
  const kitchen = card.otherStations?.find((entry) => entry.station === "KITCHEN");
  const minutes = minutesSince(card.createdAt, nowMs);
  const action = card.status === "PENDING" ? "Start" : card.status === "IN_PROGRESS" ? "Done" : null;

  return (
    <article
      className={cn(
        "rounded-xl border border-slate-700 bg-slate-900 p-4 transition",
        isNew && "animate-pulse border-amber-300 bg-amber-200/10 ring-2 ring-amber-300/60",
        card.status === "DONE" && "opacity-70",
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-400">Order Number</p>
          <p className="text-3xl font-black text-white">#{card.orderNumber}</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300 ring-1 ring-slate-700">
          <Clock3 className="h-3.5 w-3.5" />
          {formatTime(card.createdAt)}
          {minutes !== null && ` · ${minutes} min`}
        </span>
      </div>

      <ul className="space-y-1.5">
        {card.lines.map((line, index) => (
          <li key={`${line.optionName}-${index}`} className="flex items-center gap-2 text-lg font-semibold text-slate-100">
            <Coffee className="h-4 w-4 shrink-0 text-amber-300" aria-hidden />
            {line.quantity} × {line.optionName}
          </li>
        ))}
      </ul>

      {kitchen && (
        <span className={cn("mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1", stationChipClass(kitchen.status as StationStatus))}>
          Meal: {stationStatusLabel(kitchen.status as StationStatus)}
        </span>
      )}

      {action && (
        <button
          type="button"
          disabled={isUpdating}
          onClick={onAdvance}
          className={cn(
            "mt-3 w-full rounded-lg py-3 text-base font-bold transition disabled:opacity-60",
            action === "Start" ? "bg-blue-500 text-white hover:bg-blue-400" : "bg-emerald-500 text-white hover:bg-emerald-400",
          )}
        >
          {isUpdating ? "Updating..." : action}
        </button>
      )}
    </article>
  );
}
