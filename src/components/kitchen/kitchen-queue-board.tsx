"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChefHat, Clock3, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { columnShellClass, DONE_RETENTION_MS, statusPillClass } from "@/components/orders/status-visuals";

type OrderStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "COLLECTED" | "VOIDED" | "REFUNDED";

type OrderSummaryLineExtraDto = {
  componentName: string;
  quantity: number;
};

type OrderSummaryLineDto = {
  optionName: string;
  quantity: number;
  extras?: OrderSummaryLineExtraDto[];
};

type OrderSummaryDto = {
  orderId: number;
  orderNumber: number;
  status: OrderStatus;
  createdAt: string;
  lines: OrderSummaryLineDto[];
};

type KitchenStreamPayload = {
  eventType: "ORDER_CREATED" | "STATUS_CHANGED";
  order: OrderSummaryDto;
};

type OrderStateEntry = {
  order: OrderSummaryDto;
  completedAtMs?: number;
};

type ConnectionState = "connecting" | "connected" | "reconnecting";

const RECONNECT_DELAY_MS = 2000;

function isActiveKitchenStatus(status: OrderStatus): status is "PENDING" | "IN_PROGRESS" {
  return status === "PENDING" || status === "IN_PROGRESS";
}

function parseError(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const payload = body as Record<string, unknown>;
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  return fallback;
}

function parseEventData(block: string): string | null {
  const dataLines = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) return null;
  return dataLines.join("\n");
}

async function consumeSseResponse(
  response: Response,
  onData: (raw: string) => void,
  signal: AbortSignal,
): Promise<void> {
  if (!response.body) {
    throw new Error("SSE stream body is not available.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

    let splitAt = buffer.indexOf("\n\n");
    while (splitAt >= 0) {
      const eventBlock = buffer.slice(0, splitAt);
      buffer = buffer.slice(splitAt + 2);

      const eventData = parseEventData(eventBlock);
      if (eventData) onData(eventData);

      splitAt = buffer.indexOf("\n\n");
    }
  }
}

function formatCreatedTime(value: string): string {
  try {
    return new Date(value).toLocaleTimeString("en-ZA", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

export function KitchenQueueBoard() {
  const { authFetch } = useAuth();

  const [ordersById, setOrdersById] = useState<Record<number, OrderStateEntry>>({});
  const [isSnapshotLoading, setIsSnapshotLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [updatingOrderIds, setUpdatingOrderIds] = useState<Record<number, true>>({});

  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);

  const streamControllerRef = useRef<AbortController | null>(null);

  const pruneDoneOrders = useCallback(() => {
    const cutoff = Date.now() - DONE_RETENTION_MS;
    setOrdersById((prev) => {
      let changed = false;
      const next: Record<number, OrderStateEntry> = {};

      for (const [rawKey, entry] of Object.entries(prev)) {
        const key = Number(rawKey);
        if (entry.order.status !== "DONE") {
          next[key] = entry;
          continue;
        }

        if ((entry.completedAtMs ?? 0) >= cutoff) {
          next[key] = entry;
          continue;
        }

        changed = true;
      }

      return changed ? next : prev;
    });
  }, []);

  const upsertOrder = useCallback((order: OrderSummaryDto, fallbackDoneAtMs: number) => {
    setOrdersById((prev) => {
      const next = { ...prev };
      const existing = next[order.orderId];

      if (isActiveKitchenStatus(order.status)) {
        next[order.orderId] = { order };
        return next;
      }

      if (order.status === "DONE") {
        next[order.orderId] = {
          order,
          completedAtMs: existing?.completedAtMs ?? fallbackDoneAtMs,
        };
        return next;
      }

      delete next[order.orderId];
      return next;
    });
  }, []);

  const applySnapshot = useCallback((orders: OrderSummaryDto[]) => {
    const now = Date.now();
    const cutoff = now - DONE_RETENTION_MS;

    setOrdersById((prev) => {
      const next: Record<number, OrderStateEntry> = {};

      for (const [rawKey, entry] of Object.entries(prev)) {
        const key = Number(rawKey);
        if (entry.order.status === "DONE" && (entry.completedAtMs ?? 0) >= cutoff) {
          next[key] = entry;
        }
      }

      for (const order of orders) {
        if (isActiveKitchenStatus(order.status)) {
          next[order.orderId] = { order };
          continue;
        }

        if (order.status === "DONE") {
          next[order.orderId] = {
            order,
            completedAtMs: prev[order.orderId]?.completedAtMs ?? now,
          };
        }
      }

      return next;
    });
  }, []);

  const loadSnapshot = useCallback(async (): Promise<boolean> => {
    setSnapshotError(null);

    try {
      const response = await authFetch("/kitchen/orders");
      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        throw new Error(parseError(payload, "Unable to load kitchen queue."));
      }

      if (!Array.isArray(payload)) {
        throw new Error("Unexpected kitchen queue response format.");
      }

      const orders = payload as OrderSummaryDto[];
      applySnapshot(orders);
      setLastSyncAt(new Date());
      return true;
    } catch (err) {
      setSnapshotError(err instanceof Error ? err.message : "Unable to load kitchen queue.");
      return false;
    } finally {
      setIsSnapshotLoading(false);
    }
  }, [applySnapshot, authFetch]);

  useEffect(() => {
    let cancelled = false;

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
          const response = await authFetch("/kitchen/orders/stream", {
            headers: {
              Accept: "text/event-stream",
              "Cache-Control": "no-cache",
            },
            signal: controller.signal,
          });

          if (!response.ok || !response.body) {
            throw new Error(`Stream connection failed (${response.status}).`);
          }

          setConnectionState("connected");

          await consumeSseResponse(
            response,
            (rawEvent) => {
              try {
                const eventPayload = JSON.parse(rawEvent) as KitchenStreamPayload;
                if (!eventPayload?.order) return;
                upsertOrder(eventPayload.order, Date.now());
              } catch {
                // Ignore malformed events and continue streaming.
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
    };
  }, [authFetch, loadSnapshot, upsertOrder]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      pruneDoneOrders();
    }, 15000);

    return () => window.clearInterval(timer);
  }, [pruneDoneOrders]);

  const pendingOrders = useMemo(
    () =>
      Object.values(ordersById)
        .map((entry) => entry.order)
        .filter((order) => order.status === "PENDING")
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [ordersById],
  );

  const inProgressOrders = useMemo(
    () =>
      Object.values(ordersById)
        .map((entry) => entry.order)
        .filter((order) => order.status === "IN_PROGRESS")
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [ordersById],
  );

  const doneOrders = useMemo(() => {
    const cutoff = Date.now() - DONE_RETENTION_MS;

    return Object.values(ordersById)
      .filter((entry) => entry.order.status === "DONE" && (entry.completedAtMs ?? 0) >= cutoff)
      .sort((a, b) => (b.completedAtMs ?? 0) - (a.completedAtMs ?? 0))
      .map((entry) => entry.order);
  }, [ordersById]);

  const handleAdvanceStatus = useCallback(
    async (order: OrderSummaryDto) => {
      const targetStatus =
        order.status === "PENDING" ? "IN_PROGRESS" : order.status === "IN_PROGRESS" ? "DONE" : null;

      if (!targetStatus) return;

      setActionError(null);
      setUpdatingOrderIds((prev) => ({ ...prev, [order.orderId]: true }));

      try {
        const response = await authFetch(`/kitchen/orders/${order.orderId}/status`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: targetStatus }),
        });

        const payload = (await response.json().catch(() => null)) as unknown;

        if (!response.ok) {
          throw new Error(parseError(payload, "Unable to change order status."));
        }

        upsertOrder(payload as OrderSummaryDto, Date.now());
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Unable to change order status.");
      } finally {
        setUpdatingOrderIds((prev) => {
          const next = { ...prev };
          delete next[order.orderId];
          return next;
        });
      }
    },
    [authFetch, upsertOrder],
  );

  const onManualResync = useCallback(async () => {
    await loadSnapshot();
  }, [loadSnapshot]);

  return (
    <div className="flex min-h-[calc(100vh-5rem)] flex-col gap-4 bg-slate-950 p-4 md:p-6">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Kitchen Queue</h1>
          <p className="text-sm text-slate-400">Live statuses for paid orders from the cashier terminal.</p>
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

          <Button type="button" variant="outline" size="sm" onClick={() => void onManualResync()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Resync
          </Button>
        </div>
      </div>

      {snapshotError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {snapshotError}
        </div>
      )}

      {actionError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {actionError}
        </div>
      )}

      <div className="grid flex-1 gap-4 lg:grid-cols-3">
        <StatusColumn
          title="Pending"
          status="PENDING"
          orders={pendingOrders}
          columnClassName={columnShellClass("PENDING")}
          onCardTap={handleAdvanceStatus}
          updatingOrderIds={updatingOrderIds}
          emptyLabel={isSnapshotLoading ? "Loading orders..." : "No pending orders"}
        />

        <StatusColumn
          title="In Progress"
          status="IN_PROGRESS"
          orders={inProgressOrders}
          columnClassName={columnShellClass("IN_PROGRESS")}
          onCardTap={handleAdvanceStatus}
          updatingOrderIds={updatingOrderIds}
          emptyLabel={isSnapshotLoading ? "Loading orders..." : "No active prep orders"}
        />

        <StatusColumn
          title="Done"
          status="DONE"
          orders={doneOrders}
          columnClassName={columnShellClass("DONE")}
          onCardTap={null}
          updatingOrderIds={updatingOrderIds}
          emptyLabel={isSnapshotLoading ? "Loading orders..." : "No recently completed orders"}
        />
      </div>

      <div className="text-xs text-slate-500">
        Done orders are kept here for 10 minutes. {lastSyncAt ? `Last resync: ${lastSyncAt.toLocaleTimeString("en-ZA")}` : ""}
      </div>
    </div>
  );
}

type StatusColumnProps = {
  title: string;
  status: "PENDING" | "IN_PROGRESS" | "DONE";
  orders: OrderSummaryDto[];
  columnClassName: string;
  onCardTap: ((order: OrderSummaryDto) => void) | null;
  updatingOrderIds: Record<number, true>;
  emptyLabel: string;
};

function StatusColumn({
  title,
  status,
  orders,
  columnClassName,
  onCardTap,
  updatingOrderIds,
  emptyLabel,
}: StatusColumnProps) {
  return (
    <section className={cn("flex min-h-0 flex-col rounded-2xl border p-3", columnClassName)}>
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <h2 className="text-lg font-bold text-white">{title}</h2>
        <span className={cn("rounded-full px-2 py-1 text-xs font-semibold ring-1", statusPillClass(status))}>
          {orders.length}
        </span>
      </div>

      <div className="flex min-h-[180px] flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {orders.length === 0 ? (
          <div className="flex h-full min-h-[120px] items-center justify-center rounded-xl border border-dashed border-slate-700 text-sm text-slate-400">
            {emptyLabel}
          </div>
        ) : (
          orders.map((order) => (
            <OrderCard
              key={order.orderId}
              order={order}
              canAdvance={Boolean(onCardTap)}
              isUpdating={Boolean(updatingOrderIds[order.orderId])}
              onTap={() => {
                if (!onCardTap) return;
                onCardTap(order);
              }}
            />
          ))
        )}
      </div>
    </section>
  );
}

type OrderCardProps = {
  order: OrderSummaryDto;
  canAdvance: boolean;
  isUpdating: boolean;
  onTap: () => void;
};

function OrderCard({ order, canAdvance, isUpdating, onTap }: OrderCardProps) {
  const cardShell = canAdvance
    ? "cursor-pointer hover:border-slate-500 hover:bg-slate-800 active:scale-[0.99]"
    : "cursor-default";

  return (
    <button
      type="button"
      disabled={!canAdvance || isUpdating}
      onClick={onTap}
      className={cn(
        "w-full rounded-xl border border-slate-700 bg-slate-900 p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-400/50 disabled:cursor-not-allowed disabled:opacity-80",
        cardShell,
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-400">Order Number</p>
          <p className="text-3xl font-black text-white">#{order.orderNumber}</p>
        </div>

        <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300 ring-1 ring-slate-700">
          <Clock3 className="h-3.5 w-3.5" />
          {formatCreatedTime(order.createdAt)}
        </span>
      </div>

      <div className="space-y-2">
        {order.lines.map((line, lineIndex) => (
          <div key={`${line.optionName}-${lineIndex}`} className="rounded-lg border border-slate-800 bg-slate-900/80 p-2.5">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-slate-100">{line.optionName}</p>
              <span className="text-sm font-bold text-slate-200">x{line.quantity}</span>
            </div>

            {line.extras && line.extras.length > 0 && (
              <div className="mt-2 space-y-1 border-t border-slate-800 pt-2">
                {line.extras.map((extra, extraIndex) => (
                  <p
                    key={`${extra.componentName}-${extraIndex}`}
                    className="flex items-center justify-between text-xs text-slate-300"
                  >
                    <span className="inline-flex items-center gap-1">
                      <ChefHat className="h-3 w-3" />
                      {extra.componentName}
                    </span>
                    <span>x{extra.quantity}</span>
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {canAdvance && (
        <p className="mt-3 text-xs font-medium text-slate-400">
          {isUpdating ? "Updating..." : "Tap to advance status"}
        </p>
      )}
    </button>
  );
}
