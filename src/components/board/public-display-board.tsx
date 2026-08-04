"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { columnShellClass, DONE_RETENTION_MS, statusPillClass } from "@/components/orders/status-visuals";

type BoardStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "COLLECTED" | "VOIDED" | "REFUNDED";

type PublicOrderDto = {
  orderNumber: number;
  status: BoardStatus;
};

type PublicBoardDto = {
  orders: PublicOrderDto[];
};

type PublicBoardStreamPayload = {
  eventType: "ORDER_CREATED" | "STATUS_CHANGED";
  order: PublicOrderDto;
};

type BoardEntry = {
  order: PublicOrderDto;
  completedAtMs?: number;
};

const API_BASE = process.env.NEXT_PUBLIC_AUTH_API_URL ?? "http://localhost:8080";
const RECONNECT_DELAY_MS = 2000;
const KIOSK_RELOAD_MS = Number.parseInt(process.env.NEXT_PUBLIC_BOARD_RELOAD_MS ?? "14400000", 10);

function isDisplayStatus(status: BoardStatus): status is "PENDING" | "IN_PROGRESS" | "DONE" {
  return status === "PENDING" || status === "IN_PROGRESS" || status === "DONE";
}

function parseEventData(block: string): string | null {
  const dataLines = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) return null;
  return dataLines.join("\n");
}

function isBoardOrder(candidate: unknown): candidate is PublicOrderDto {
  if (!candidate || typeof candidate !== "object") return false;
  const c = candidate as Record<string, unknown>;
  return typeof c.orderNumber === "number" && typeof c.status === "string";
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

export function PublicDisplayBoard() {
  const [ordersByNumber, setOrdersByNumber] = useState<Record<number, BoardEntry>>({});
  const streamControllerRef = useRef<AbortController | null>(null);

  const upsertOrder = useCallback((order: PublicOrderDto, fallbackDoneAtMs: number) => {
    setOrdersByNumber((prev) => {
      const next = { ...prev };
      const existing = next[order.orderNumber];

      if (order.status === "PENDING" || order.status === "IN_PROGRESS") {
        next[order.orderNumber] = { order };
        return next;
      }

      if (order.status === "DONE") {
        next[order.orderNumber] = {
          order,
          completedAtMs: existing?.completedAtMs ?? fallbackDoneAtMs,
        };
        return next;
      }

      delete next[order.orderNumber];
      return next;
    });
  }, []);

  const applySnapshot = useCallback((payload: PublicBoardDto) => {
    const now = Date.now();
    const cutoff = now - DONE_RETENTION_MS;
    const snapshotOrders = Array.isArray(payload.orders) ? payload.orders : [];

    setOrdersByNumber((prev) => {
      const next: Record<number, BoardEntry> = {};

      for (const [rawKey, entry] of Object.entries(prev)) {
        const key = Number(rawKey);
        if (entry.order.status === "DONE" && (entry.completedAtMs ?? 0) >= cutoff) {
          next[key] = entry;
        }
      }

      for (const order of snapshotOrders) {
        if (!isBoardOrder(order) || !isDisplayStatus(order.status)) continue;

        if (order.status === "DONE") {
          next[order.orderNumber] = {
            order,
            completedAtMs: prev[order.orderNumber]?.completedAtMs ?? now,
          };
          continue;
        }

        next[order.orderNumber] = { order };
      }

      return next;
    });
  }, []);

  const fetchSnapshot = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE}/public/board/today`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache",
        },
      });

      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok || !payload || typeof payload !== "object") {
        return false;
      }

      applySnapshot(payload as PublicBoardDto);
      return true;
    } catch {
      return false;
    }
  }, [applySnapshot]);

  const pruneDoneOrders = useCallback(() => {
    const cutoff = Date.now() - DONE_RETENTION_MS;

    setOrdersByNumber((prev) => {
      let changed = false;
      const next: Record<number, BoardEntry> = {};

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

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      while (!cancelled) {
        const synced = await fetchSnapshot();
        if (!synced) {
          await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
          continue;
        }

        const controller = new AbortController();
        streamControllerRef.current = controller;

        try {
          const response = await fetch(`${API_BASE}/public/board/stream`, {
            method: "GET",
            headers: {
              Accept: "text/event-stream",
              "Cache-Control": "no-cache",
            },
            signal: controller.signal,
          });

          if (!response.ok || !response.body) {
            throw new Error("Unable to connect board stream");
          }

          await consumeSseResponse(
            response,
            (rawEvent) => {
              try {
                const eventPayload = JSON.parse(rawEvent) as PublicBoardStreamPayload;
                const order = eventPayload?.order;
                if (!order || !isBoardOrder(order)) return;
                if (!isDisplayStatus(order.status)) {
                  setOrdersByNumber((prev) => {
                    const next = { ...prev };
                    delete next[order.orderNumber];
                    return next;
                  });
                  return;
                }

                upsertOrder(order, Date.now());
              } catch {
                // Ignore malformed events and continue.
              }
            },
            controller.signal,
          );
        } catch {
          if (cancelled || controller.signal.aborted) break;
        }

        if (!cancelled) {
          await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      streamControllerRef.current?.abort();
    };
  }, [fetchSnapshot, upsertOrder]);

  useEffect(() => {
    const pruneTimer = window.setInterval(() => {
      pruneDoneOrders();
    }, 15000);

    return () => window.clearInterval(pruneTimer);
  }, [pruneDoneOrders]);

  useEffect(() => {
    if (!Number.isFinite(KIOSK_RELOAD_MS) || KIOSK_RELOAD_MS <= 0) return;

    const reloadTimer = window.setInterval(() => {
      window.location.reload();
    }, KIOSK_RELOAD_MS);

    return () => window.clearInterval(reloadTimer);
  }, []);

  const pending = useMemo(
    () =>
      Object.values(ordersByNumber)
        .map((entry) => entry.order)
        .filter((order) => order.status === "PENDING")
        .sort((a, b) => a.orderNumber - b.orderNumber),
    [ordersByNumber],
  );

  const inProgress = useMemo(
    () =>
      Object.values(ordersByNumber)
        .map((entry) => entry.order)
        .filter((order) => order.status === "IN_PROGRESS")
        .sort((a, b) => a.orderNumber - b.orderNumber),
    [ordersByNumber],
  );

  const done = useMemo(() => {
    const cutoff = Date.now() - DONE_RETENTION_MS;

    return Object.values(ordersByNumber)
      .filter((entry) => entry.order.status === "DONE" && (entry.completedAtMs ?? 0) >= cutoff)
      .sort((a, b) => (b.completedAtMs ?? 0) - (a.completedAtMs ?? 0))
      .map((entry) => entry.order);
  }, [ordersByNumber]);

  return (
    <main className="min-h-screen bg-slate-950 p-5 lg:p-8">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Live Order Board</p>
          <h1 className="mt-1 text-4xl font-black text-white lg:text-5xl">Now Serving</h1>
        </div>
        <p className="text-xs text-slate-600">Updates automatically</p>
      </div>

      <section className="grid min-h-[calc(100vh-9rem)] grid-cols-1 gap-4 lg:grid-cols-3">
        <BoardColumn title="Pending" status="PENDING" orders={pending} />
        <BoardColumn title="In Progress" status="IN_PROGRESS" orders={inProgress} />
        <BoardColumn title="Done" status="DONE" orders={done} />
      </section>
    </main>
  );
}

type BoardColumnProps = {
  title: string;
  status: "PENDING" | "IN_PROGRESS" | "DONE";
  orders: PublicOrderDto[];
};

function BoardColumn({ title, status, orders }: BoardColumnProps) {
  return (
    <section className={cn("flex min-h-0 flex-col rounded-3xl border p-4 lg:p-5", columnShellClass(status))}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-bold uppercase tracking-wide text-white lg:text-3xl">{title}</h2>
        <span className={cn("rounded-full px-3 py-1 text-sm font-semibold ring-1", statusPillClass(status))}>
          {orders.length}
        </span>
      </div>

      <div className="grid auto-rows-min grid-cols-2 gap-3 overflow-y-auto pr-1 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
        {orders.map((order) => (
          <article
            key={order.orderNumber}
            className="rounded-2xl border border-slate-700 bg-slate-900 px-2 py-4 text-center lg:py-5"
          >
            <p className="text-[2.25rem] font-black leading-none tracking-tight text-white md:text-5xl lg:text-6xl">
              {order.orderNumber}
            </p>
          </article>
        ))}

        {orders.length === 0 && (
          <div className="col-span-full flex min-h-[120px] items-center justify-center rounded-2xl border border-dashed border-slate-700 text-base text-slate-500">
            Waiting for orders...
          </div>
        )}
      </div>
    </section>
  );
}
