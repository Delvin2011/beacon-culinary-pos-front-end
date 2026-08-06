"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Minus, Plus, Printer, RefreshCw, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { NumericKeypad } from "@/components/pos/numeric-keypad";
import { AdminAuthorizationOverlay } from "@/components/pos/admin-authorization-overlay";
import { formatZarCurrency } from "@/lib/utils";

type MealPeriod = {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
};

type DailyMealOption = {
  id: number;
  mealPeriodId: number;
  optionDate: string;
  name: string;
  description?: string;
  price: number;
  plannedPortions: number;
  portionsRemaining: number;
};

type DailyComponentStock = {
  id: number;
  componentCatalogId?: number;
  componentName?: string;
  name?: string;
  mealPeriodId: number;
  optionDate: string;
  extraPrice: number;
  bufferQuantity: number;
  bufferRemaining: number;
};

type MenuTodayResponse = {
  options: DailyMealOption[];
  availableExtras: DailyComponentStock[];
};

type DraftExtra = {
  dailyComponentStockId: number;
  name: string;
  extraPrice: number;
  quantity: number;
  invalid?: boolean;
};

type DraftLine = {
  id: string;
  dailyMealOptionId: number;
  name: string;
  unitPrice: number;
  quantity: number;
  extras: DraftExtra[];
  invalid?: boolean;
};

type OrderStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "COLLECTED" | "VOIDED" | "REFUNDED";

type OrderAdjustmentScope = "WHOLE_ORDER" | "EXTRAS_ONLY";

type OrderAdjustmentAction = "VOID" | "REFUND";

type OrderAdjustmentReasonCode =
  | "WRONG_ORDER"
  | "CUSTOMER_COMPLAINT"
  | "KITCHEN_ERROR"
  | "DUPLICATE_ENTRY"
  | "OUT_OF_STOCK_ERROR"
  | "OTHER";

type OrderAdjustmentDto = {
  id: number;
  scope: OrderAdjustmentScope;
  action: OrderAdjustmentAction;
  reasonCode: OrderAdjustmentReasonCode;
  note?: string;
  amount: number;
  requestedById: number;
  authorizedById: number;
  createdAt: string;
};

type OrderDto = {
  id: number;
  orderNumber: number;
  status?: OrderStatus;
  orderDate?: string;
  createdAt?: string;
  paymentMethod?: "CASH";
  changeDue: number;
  subtotal: number;
  total: number;
  originalTotal?: number;
  amountTendered: number;
  printFailed?: boolean;
  lines?: OrderLineDto[];
  adjustments?: OrderAdjustmentDto[];
};

type OrderLineDto = {
  id: number;
  dailyMealOptionId: number;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  extras?: OrderLineExtraDto[];
};

type OrderLineExtraDto = {
  id: number;
  dailyComponentStockId: number;
  componentName: string;
  priceDelta: number;
  quantity: number;
  lineTotal: number;
  adjusted?: boolean;
};

type ApiErrorPayload = {
  message?: string;
  error?: string;
  dailyMealOptionId?: number;
  dailyComponentStockId?: number;
  details?: Array<Record<string, unknown>>;
  violations?: Array<Record<string, unknown>>;
};

const LOW_STOCK_THRESHOLD = 10;

const ADJUSTMENT_REASON_OPTIONS: Array<{ value: OrderAdjustmentReasonCode; label: string }> = [
  { value: "WRONG_ORDER", label: "Wrong Order" },
  { value: "CUSTOMER_COMPLAINT", label: "Customer Complaint" },
  { value: "KITCHEN_ERROR", label: "Kitchen Error" },
  { value: "DUPLICATE_ENTRY", label: "Duplicate Entry" },
  { value: "OUT_OF_STOCK_ERROR", label: "Out of Stock Error" },
  { value: "OTHER", label: "Other" },
];

function nowTimeHHMMSS(): string {
  return new Date().toTimeString().slice(0, 8);
}

function isWithinPeriod(startTime: string, endTime: string, now: string): boolean {
  return now >= startTime && now <= endTime;
}

function toMoney(value: number): string {
  return formatZarCurrency(value);
}

function parseMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const p = payload as ApiErrorPayload;
  if (typeof p.message === "string" && p.message.trim()) return p.message;
  if (typeof p.error === "string" && p.error.trim()) return p.error;
  return fallback;
}

function getNumericField(obj: Record<string, unknown>, candidates: string[]): number | null {
  for (const key of candidates) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function extractConflictIds(payload: unknown): { optionIds: number[]; extraIds: number[] } {
  if (!payload || typeof payload !== "object") {
    return { optionIds: [], extraIds: [] };
  }

  const p = payload as ApiErrorPayload;
  const optionIds = new Set<number>();
  const extraIds = new Set<number>();

  const addFromRecord = (record: Record<string, unknown>) => {
    const optionId = getNumericField(record, [
      "dailyMealOptionId",
      "mealOptionId",
      "optionId",
      "lineDailyMealOptionId",
    ]);
    const extraId = getNumericField(record, [
      "dailyComponentStockId",
      "componentStockId",
      "extraId",
      "lineExtraDailyComponentStockId",
    ]);

    if (optionId !== null) optionIds.add(optionId);
    if (extraId !== null) extraIds.add(extraId);
  };

  addFromRecord(p as unknown as Record<string, unknown>);

  for (const container of [p.details, p.violations]) {
    if (!Array.isArray(container)) continue;
    for (const entry of container) {
      if (entry && typeof entry === "object") {
        addFromRecord(entry as Record<string, unknown>);
      }
    }
  }

  return {
    optionIds: Array.from(optionIds),
    extraIds: Array.from(extraIds),
  };
}

function isTerminalOrderStatus(status?: OrderStatus): boolean {
  return status === "VOIDED" || status === "REFUNDED";
}

function hasAnyUnadjustedExtras(order: OrderDto): boolean {
  return (order.lines ?? []).some((line) =>
    (line.extras ?? []).some((extra) => extra.adjusted !== true),
  );
}

function getTotalMealPortions(order: OrderDto): number {
  return (order.lines ?? []).reduce((sum, line) => sum + line.quantity, 0);
}

function getUnadjustedExtraUnits(order: OrderDto): number {
  return (order.lines ?? []).reduce(
    (sum, line) =>
      sum +
      (line.extras ?? []).reduce(
        (lineSum, extra) => lineSum + (extra.adjusted ? 0 : extra.quantity),
        0,
      ),
    0,
  );
}

function latestAdjustment(order: OrderDto): OrderAdjustmentDto | null {
  const adjustments = Array.isArray(order.adjustments) ? order.adjustments : [];
  if (adjustments.length === 0) return null;
  return adjustments.reduce((latest, current) => {
    const latestTime = new Date(latest.createdAt).getTime();
    const currentTime = new Date(current.createdAt).getTime();
    return currentTime > latestTime ? current : latest;
  });
}

function adjustmentActionLabel(action: OrderAdjustmentAction): string {
  return action === "VOID" ? "Voided" : "Refunded";
}

function alreadyAdjustedMessage(order: OrderDto): string {
  if (order.status === "VOIDED") return "This order has already been voided.";
  if (order.status === "REFUNDED") return "This order has already been refunded.";
  if (!hasAnyUnadjustedExtras(order)) return "This order has already had its extras removed.";
  return "This order was already adjusted. The latest state has been loaded.";
}

function isTokenIssue(status: number, message: string): boolean {
  if (status === 401) return true;
  const normalized = message.toLowerCase();
  return normalized.includes("token") || normalized.includes("expired") || normalized.includes("used");
}

export function PosOrderBuilder() {
  const { authFetch } = useAuth();

  const [periods, setPeriods] = useState<MealPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<number | null>(null);

  const [menu, setMenu] = useState<MenuTodayResponse>({ options: [], availableExtras: [] });
  const [isLoadingMenu, setIsLoadingMenu] = useState(false);
  const [menuError, setMenuError] = useState<string | null>(null);

  const [selectedOption, setSelectedOption] = useState<DailyMealOption | null>(null);
  const [lineQty, setLineQty] = useState(1);
  const [selectedExtraQty, setSelectedExtraQty] = useState<Record<number, number>>({});

  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  const [showPayment, setShowPayment] = useState(false);
  const [cashInput, setCashInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [completedOrder, setCompletedOrder] = useState<OrderDto | null>(null);
  const [completedOrderId, setCompletedOrderId] = useState<number | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<OrderDto | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [todayOrders, setTodayOrders] = useState<OrderDto[]>([]);
  const [todayOrdersLoading, setTodayOrdersLoading] = useState(false);
  const [todayOrdersError, setTodayOrdersError] = useState<string | null>(null);
  const [showTodayOrdersPanel, setShowTodayOrdersPanel] = useState(false);
  const [adjustmentScope, setAdjustmentScope] = useState<OrderAdjustmentScope | null>(null);
  const [adjustmentReasonCode, setAdjustmentReasonCode] = useState<OrderAdjustmentReasonCode>("WRONG_ORDER");
  const [adjustmentNote, setAdjustmentNote] = useState("");
  const [showAdjustmentForm, setShowAdjustmentForm] = useState(false);
  const [showManagerPinOverlay, setShowManagerPinOverlay] = useState(false);
  const [managerPinInput, setManagerPinInput] = useState("");
  const [adjustmentError, setAdjustmentError] = useState<string | null>(null);
  const [adjustmentFormError, setAdjustmentFormError] = useState<string | null>(null);
  const [managerPinError, setManagerPinError] = useState<string | null>(null);
  const [isApplyingAdjustment, setIsApplyingAdjustment] = useState(false);
  const [adjustmentSuccess, setAdjustmentSuccess] = useState<string | null>(null);

  const selectedPeriod = useMemo(
    () => periods.find((p) => p.id === selectedPeriodId) ?? null,
    [periods, selectedPeriodId],
  );

  const loadPeriods = useCallback(async () => {
    const res = await authFetch("/meal-periods");
    const payload = (await res.json().catch(() => null)) as MealPeriod[] | null;

    if (!res.ok || !Array.isArray(payload)) {
      throw new Error("Unable to load meal periods.");
    }

    setPeriods(payload);

    if (payload.length === 0) {
      setSelectedPeriodId(null);
      return;
    }

    const now = nowTimeHHMMSS();
    const active = payload.find((p) => isWithinPeriod(p.startTime, p.endTime, now));
    setSelectedPeriodId(active?.id ?? payload[0].id);
  }, [authFetch]);

  const loadMenuForPeriod = useCallback(
    async (periodName: string) => {
      setIsLoadingMenu(true);
      setMenuError(null);
      try {
        const res = await authFetch(`/menu/today?period=${periodName.toUpperCase()}`);
        const payload = (await res.json().catch(() => null)) as MenuTodayResponse | null;

        if (!res.ok || !payload) {
          throw new Error(parseMessage(payload, "Unable to load today's menu."));
        }

        setMenu({
          options: Array.isArray(payload.options) ? payload.options : [],
          availableExtras: Array.isArray(payload.availableExtras) ? payload.availableExtras : [],
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unable to load today's menu.";
        setMenu({ options: [], availableExtras: [] });
        setMenuError(msg);
      } finally {
        setIsLoadingMenu(false);
      }
    },
    [authFetch],
  );

  useEffect(() => {
    void (async () => {
      try {
        await loadPeriods();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unable to load meal periods.";
        setMenuError(msg);
      }
    })();
  }, [loadPeriods]);

  useEffect(() => {
    if (!selectedPeriod) return;
    setSelectedOption(null);
    setSelectedExtraQty({});
    setLineQty(1);
    void loadMenuForPeriod(selectedPeriod.name);
  }, [selectedPeriod, loadMenuForPeriod]);

  const periodExtras = useMemo(() => {
    if (!selectedPeriod) return [];
    return menu.availableExtras.filter((e) => e.mealPeriodId === selectedPeriod.id);
  }, [menu.availableExtras, selectedPeriod]);

  const periodOptions = useMemo(() => {
    if (!selectedPeriod) return [];
    return menu.options.filter((o) => o.mealPeriodId === selectedPeriod.id);
  }, [menu.options, selectedPeriod]);

  const draftSubtotal = useMemo(
    () => draftLines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
    [draftLines],
  );

  const draftExtrasTotal = useMemo(
    () =>
      draftLines.reduce(
        (sum, line) =>
          sum + line.extras.reduce((lineExtras, ex) => lineExtras + ex.extraPrice * ex.quantity, 0),
        0,
      ),
    [draftLines],
  );

  const draftTotal = draftSubtotal + draftExtrasTotal;

  const tenderedAmount = useMemo(() => {
    const parsed = Number(cashInput || "0");
    return Number.isFinite(parsed) ? parsed / 100 : 0;
  }, [cashInput]);

  const canConfirmPayment = draftLines.length > 0 && tenderedAmount >= draftTotal && !isSubmitting;

  const openBuilderForOption = (option: DailyMealOption) => {
    if (option.portionsRemaining <= 0) return;
    setSelectedOption(option);
    setLineQty(1);
    setSelectedExtraQty({});
  };

  const incrementExtra = (extraId: number) => {
    setSelectedExtraQty((prev) => ({ ...prev, [extraId]: (prev[extraId] ?? 0) + 1 }));
  };

  const decrementExtra = (extraId: number) => {
    setSelectedExtraQty((prev) => {
      const current = prev[extraId] ?? 0;
      const next = Math.max(0, current - 1);
      if (next === 0) {
        const nextState = { ...prev };
        delete nextState[extraId];
        return nextState;
      }
      return { ...prev, [extraId]: next };
    });
  };

  const addLineToOrder = () => {
    if (!selectedOption) return;
    const safeQty = Math.max(1, lineQty);

    const chosenExtras: DraftExtra[] = periodExtras
      .filter((extra) => (selectedExtraQty[extra.id] ?? 0) > 0)
      .map((extra) => ({
        dailyComponentStockId: extra.id,
        name: extra.componentName ?? extra.name ?? `Extra #${extra.id}`,
        extraPrice: extra.extraPrice,
        quantity: selectedExtraQty[extra.id],
      }));

    const newLine: DraftLine = {
      id: `${selectedOption.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      dailyMealOptionId: selectedOption.id,
      name: selectedOption.name,
      unitPrice: selectedOption.price,
      quantity: safeQty,
      extras: chosenExtras,
    };

    setDraftLines((prev) => [...prev, newLine]);
    setSubmissionError(null);
    setSelectedOption(null);
    setSelectedExtraQty({});
    setLineQty(1);
  };

  const removeLine = (lineId: string) => {
    setDraftLines((prev) => prev.filter((line) => line.id !== lineId));
  };

  const removeExtra = (lineId: string, extraId: number) => {
    setDraftLines((prev) =>
      prev.map((line) =>
        line.id === lineId
          ? { ...line, extras: line.extras.filter((ex) => ex.dailyComponentStockId !== extraId) }
          : line,
      ),
    );
  };

  const updateLineQuantity = (lineId: string, quantity: number) => {
    setDraftLines((prev) =>
      prev.map((line) =>
        line.id === lineId
          ? {
              ...line,
              quantity: Math.max(1, quantity),
              invalid: false,
            }
          : line,
      ),
    );
  };

  const clearDraft = () => {
    setDraftLines([]);
    setSubmissionError(null);
    setShowPayment(false);
    setCashInput("");
  };

  const applyConflictFeedback = (payload: unknown) => {
    const { optionIds, extraIds } = extractConflictIds(payload);

    if (optionIds.length === 0 && extraIds.length === 0) {
      return;
    }

    setDraftLines((prev) =>
      prev
        .map((line) => {
          if (optionIds.includes(line.dailyMealOptionId)) {
            return { ...line, invalid: true };
          }

          const nextExtras = line.extras.map((ex) =>
            extraIds.includes(ex.dailyComponentStockId)
              ? { ...ex, invalid: true }
              : ex,
          );

          return { ...line, extras: nextExtras };
        })
        .filter((line) => !line.invalid),
    );
  };

  const loadOrderReceipt = useCallback(
    async (orderId: number): Promise<OrderDto | null> => {
      setReceiptLoading(true);
      setReceiptError(null);
      try {
        const res = await authFetch(`/orders/${orderId}`);
        const body = (await res.json().catch(() => null)) as OrderDto | ApiErrorPayload | null;
        if (!res.ok || !body) {
          throw new Error(parseMessage(body, "Unable to load receipt."));
        }
        const nextOrder = body as OrderDto;
        setReceiptOrder(nextOrder);
        setCompletedOrder(nextOrder);
        return nextOrder;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unable to load receipt.";
        setReceiptError(msg);
        return null;
      } finally {
        setReceiptLoading(false);
      }
    },
    [authFetch],
  );

  const loadTodayOrders = useCallback(async () => {
    setTodayOrdersLoading(true);
    setTodayOrdersError(null);
    try {
      const res = await authFetch("/orders/today");
      const body = (await res.json().catch(() => null)) as OrderDto[] | ApiErrorPayload | null;
      if (!res.ok || !Array.isArray(body)) {
        throw new Error(parseMessage(body, "Unable to load today's orders."));
      }
      setTodayOrders(body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to load today's orders.";
      setTodayOrdersError(msg);
    } finally {
      setTodayOrdersLoading(false);
    }
  }, [authFetch]);

  const markPrintFailed = useCallback(
    async (orderId: number) => {
      const res = await authFetch(`/orders/${orderId}/mark-print-failed`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => null)) as OrderDto | ApiErrorPayload | null;
      if (!res.ok || !body) {
        throw new Error(parseMessage(body, "Unable to mark print as failed."));
      }
      setReceiptOrder(body as OrderDto);
      setCompletedOrder(body as OrderDto);
    },
    [authFetch],
  );

  const submitOrder = async () => {
    if (!canConfirmPayment) return;

    setIsSubmitting(true);
    setSubmissionError(null);

    const payload = {
      amountTendered: tenderedAmount,
      lines: draftLines.map((line) => ({
        dailyMealOptionId: line.dailyMealOptionId,
        quantity: line.quantity,
        extras: line.extras.map((ex) => ({
          dailyComponentStockId: ex.dailyComponentStockId,
          quantity: ex.quantity,
        })),
      })),
    };

    try {
      const res = await authFetch("/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = (await res.json().catch(() => null)) as OrderDto | ApiErrorPayload | null;

      if (!res.ok) {
        if (res.status === 409) {
          applyConflictFeedback(body);
          await loadMenuForPeriod(selectedPeriod?.name ?? "");
          throw new Error(parseMessage(body, "Stock changed while creating the order. Adjust and retry."));
        }

        throw new Error(parseMessage(body, "Order submission failed."));
      }

      const order = body as OrderDto;
      setCompletedOrderId(order.id);
      setCompletedOrder(order);
      setReceiptOrder(null);
      setReceiptError(null);
      setDraftLines([]);
      setShowPayment(false);
      setCashInput("");
      await loadOrderReceipt(order.id);
      await loadTodayOrders();
      await loadMenuForPeriod(selectedPeriod?.name ?? "");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Order submission failed.";
      setSubmissionError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const beginAdjustment = (scope: OrderAdjustmentScope) => {
    setAdjustmentScope(scope);
    setShowAdjustmentForm(true);
    setShowManagerPinOverlay(false);
    setManagerPinInput("");
    setAdjustmentFormError(null);
    setManagerPinError(null);
    setAdjustmentError(null);
    setAdjustmentSuccess(null);
  };

  const continueToPin = () => {
    if (!adjustmentScope) return;

    const trimmedNote = adjustmentNote.trim();
    if (adjustmentReasonCode === "OTHER" && trimmedNote.length === 0) {
      setAdjustmentFormError("A note is required when reason is Other.");
      return;
    }

    setAdjustmentFormError(null);
    setManagerPinError(null);
    setShowManagerPinOverlay(true);
  };

  const submitAdjustment = useCallback(
    async (order: OrderDto) => {
      if (!adjustmentScope || managerPinInput.trim().length < 4) {
        setManagerPinError("Enter the manager PIN to continue.");
        return;
      }

      setIsApplyingAdjustment(true);
      setManagerPinError(null);
      setAdjustmentError(null);

      try {
        const authorizeRes = await authFetch("/admin/authorize", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ pin: managerPinInput }),
        });

        const authorizeBody = (await authorizeRes.json().catch(() => null)) as
          | { authorizationToken?: string }
          | ApiErrorPayload
          | null;

        if (authorizeRes.status === 401) {
          setManagerPinError("Incorrect manager PIN. Try again.");
          setManagerPinInput("");
          return;
        }

        if (!authorizeRes.ok) {
          throw new Error(parseMessage(authorizeBody, "Authorization failed."));
        }

        const authorizationToken =
          authorizeBody && typeof authorizeBody === "object" && "authorizationToken" in authorizeBody
            ? (authorizeBody as { authorizationToken?: string }).authorizationToken
            : undefined;

        if (!authorizationToken) {
          throw new Error("Authorization token was not returned.");
        }

        const adjustmentRes = await authFetch(`/orders/${order.id}/adjustments`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            scope: adjustmentScope,
            reasonCode: adjustmentReasonCode,
            note: adjustmentNote.trim() || undefined,
            authorizationToken,
          }),
        });

        const adjustmentBody = (await adjustmentRes.json().catch(() => null)) as OrderDto | ApiErrorPayload | null;

        if (!adjustmentRes.ok) {
          const parsedMessage = parseMessage(adjustmentBody, "Unable to apply adjustment.");

          if (adjustmentRes.status === 409) {
            const refreshed = await loadOrderReceipt(order.id);
            await loadTodayOrders();
            setShowManagerPinOverlay(false);
            setShowAdjustmentForm(false);
            setAdjustmentError(alreadyAdjustedMessage(refreshed ?? order));
            return;
          }

          if (isTokenIssue(adjustmentRes.status, parsedMessage)) {
            await loadOrderReceipt(order.id);
            await loadTodayOrders();
            setShowManagerPinOverlay(false);
            setShowAdjustmentForm(false);
            setManagerPinInput("");
            setAdjustmentError("Authorization expired or was already used. Start again with a fresh manager PIN.");
            return;
          }

          if (adjustmentRes.status === 400) {
            await loadOrderReceipt(order.id);
            setShowManagerPinOverlay(false);
            setShowAdjustmentForm(false);
            setManagerPinInput("");
            setAdjustmentError(parsedMessage);
            return;
          }

          throw new Error(parsedMessage);
        }

        const updatedOrder = adjustmentBody as OrderDto;
        const recent = latestAdjustment(updatedOrder);

        setCompletedOrder(updatedOrder);
        setReceiptOrder(updatedOrder);
        await loadTodayOrders();

        const amount = recent?.amount ?? Math.max(0, (order.total ?? 0) - (updatedOrder.total ?? 0));
        const action = recent?.action ?? (updatedOrder.status === "VOIDED" ? "VOID" : "REFUND");
        const scope = recent?.scope ?? adjustmentScope;

        if (action === "VOID") {
          if (scope === "WHOLE_ORDER") {
            const portionsReturned = getTotalMealPortions(order);
            const extraUnitsReturned = getUnadjustedExtraUnits(order);
            const extraSuffix = extraUnitsReturned > 0 ? ` and ${extraUnitsReturned} extra units` : "";
            setAdjustmentSuccess(
              `${adjustmentActionLabel(action)} ${toMoney(amount)}. ${portionsReturned} portions${extraSuffix} returned to today's stock.`,
            );
          } else {
            const extraUnitsReturned = getUnadjustedExtraUnits(order);
            const detail =
              extraUnitsReturned > 0
                ? `${extraUnitsReturned} extra units returned to today's stock.`
                : "Extras were removed and today's stock was restored.";
            setAdjustmentSuccess(`${adjustmentActionLabel(action)} ${toMoney(amount)}. ${detail}`);
          }
        } else {
          setAdjustmentSuccess(`${adjustmentActionLabel(action)} ${toMoney(amount)}. No stock was restored.`);
        }

        setShowManagerPinOverlay(false);
        setShowAdjustmentForm(false);
        setManagerPinInput("");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unable to apply adjustment.";
        setManagerPinError(msg);
      } finally {
        setIsApplyingAdjustment(false);
      }
    },
    [
      adjustmentNote,
      adjustmentReasonCode,
      adjustmentScope,
      authFetch,
      loadOrderReceipt,
      loadTodayOrders,
      managerPinInput,
    ],
  );

  const selectedOptionPreviewTotal = useMemo(() => {
    if (!selectedOption) return 0;
    const extrasTotal = periodExtras.reduce((sum, ex) => {
      const qty = selectedExtraQty[ex.id] ?? 0;
      return sum + ex.extraPrice * qty;
    }, 0);
    return selectedOption.price * lineQty + extrasTotal;
  }, [selectedOption, lineQty, periodExtras, selectedExtraQty]);

  if (completedOrderId !== null && completedOrder) {
    const shownOrder = receiptOrder ?? completedOrder;
    const terminalOrder = isTerminalOrderStatus(shownOrder.status);
    const canRemoveExtras = hasAnyUnadjustedExtras(shownOrder);
    const selectedScopeLabel = adjustmentScope === "WHOLE_ORDER" ? "Cancel Order" : "Remove Extras";
    return (
      <>
      <main className="grid flex-1 grid-cols-1 gap-4 p-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-8">
          <div className="flex items-center gap-2 text-emerald-300">
            <CheckCircle2 className="h-5 w-5" />
            <p className="text-sm font-semibold uppercase tracking-wider">Payment Confirmed</p>
          </div>

          <p className="mt-6 text-sm text-emerald-200/90">Order Number</p>
          <p className="text-7xl font-black text-white">#{shownOrder.orderNumber}</p>

          <p className="mt-6 text-sm text-emerald-200/90">Change Due</p>
          <p className="text-6xl font-black text-white">{toMoney(shownOrder.changeDue)}</p>

          <div className="mt-8 grid gap-2 text-sm text-emerald-100">
            {shownOrder.status && <p>Status: {shownOrder.status.replace("_", " ")}</p>}
            <p>Subtotal: {toMoney(shownOrder.subtotal)}</p>
            <p>Total: {toMoney(shownOrder.total)}</p>
            {typeof shownOrder.originalTotal === "number" && <p>Original Total: {toMoney(shownOrder.originalTotal)}</p>}
            <p>Tendered: {toMoney(shownOrder.amountTendered)}</p>
            {typeof shownOrder.printFailed === "boolean" && (
              <p>Print Failed: {shownOrder.printFailed ? "Yes" : "No"}</p>
            )}
          </div>

          {receiptError && (
            <div className="mt-6 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">
              {receiptError}
            </div>
          )}

          {adjustmentError && (
            <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
              {adjustmentError}
            </div>
          )}

          {adjustmentSuccess && (
            <div className="mt-4 rounded-xl border border-emerald-300/40 bg-emerald-500/15 p-3 text-sm text-emerald-100">
              {adjustmentSuccess}
            </div>
          )}

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void loadOrderReceipt(completedOrderId)}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/50 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-300/10"
            >
              <RefreshCw className="h-4 w-4" />
              {receiptLoading ? "Loading Receipt..." : "Reload Receipt"}
            </button>
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  try {
                    await markPrintFailed(completedOrderId);
                    await loadTodayOrders();
                  } catch (err) {
                    setReceiptError(err instanceof Error ? err.message : "Unable to mark print as failed.");
                  }
                })();
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-amber-300/50 px-4 py-2 text-sm font-medium text-amber-100 hover:bg-amber-300/10"
            >
              <Printer className="h-4 w-4" />
              Mark Print Failed
            </button>
            <button
              type="button"
              onClick={() => {
                setCompletedOrder(null);
                setCompletedOrderId(null);
                setReceiptOrder(null);
                setReceiptError(null);
              }}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900"
            >
              Next Customer
            </button>
          </div>

          <div className="mt-8 rounded-2xl border border-emerald-300/30 bg-emerald-500/5 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-emerald-200">On-Screen Receipt</h3>
            {receiptLoading && !receiptOrder ? (
              <p className="mt-2 text-sm text-emerald-100/80">Loading receipt details...</p>
            ) : (
              <div className="mt-3 space-y-3 text-sm text-emerald-100">
                {(shownOrder.lines ?? []).length === 0 ? (
                  <p>No line details available.</p>
                ) : (
                  (shownOrder.lines ?? []).map((line) => (
                    <div key={line.id} className="rounded-lg border border-emerald-200/20 p-3">
                      <div className="flex justify-between gap-2">
                        <p className="font-semibold">{line.name} x{line.quantity}</p>
                        <p>{toMoney(line.lineTotal)}</p>
                      </div>
                      {(line.extras ?? []).map((extra) => (
                        <div key={extra.id} className="mt-1 flex justify-between gap-2 text-xs text-emerald-100/85">
                          <p>+ {extra.componentName} x{extra.quantity}</p>
                          <p>{toMoney(extra.lineTotal)}</p>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {!terminalOrder && (
            <div className="mt-8 rounded-2xl border border-amber-300/30 bg-amber-500/10 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-100">Order Adjustment</h3>
              <p className="mt-2 text-sm text-amber-100/90">Manager authorization is required.</p>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => beginAdjustment("WHOLE_ORDER")}
                  className="rounded-lg border border-rose-300/40 bg-rose-500/20 px-3 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-500/30"
                >
                  Cancel Order
                </button>
                <button
                  type="button"
                  disabled={!canRemoveExtras}
                  onClick={() => beginAdjustment("EXTRAS_ONLY")}
                  className="rounded-lg border border-amber-200/40 bg-amber-500/20 px-3 py-2 text-sm font-semibold text-amber-50 hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Remove Extras
                </button>
              </div>

              {!canRemoveExtras && (
                <p className="mt-2 text-xs text-amber-100/80">
                  Remove Extras is unavailable because this order has no removable extras.
                </p>
              )}

              {showAdjustmentForm && (
                <div className="mt-4 rounded-xl border border-amber-300/30 bg-slate-950/50 p-4">
                  <p className="text-sm font-semibold text-white">{selectedScopeLabel}</p>
                  <p className="mt-1 text-xs text-slate-300">Select a reason:</p>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {ADJUSTMENT_REASON_OPTIONS.map((option) => {
                      const active = option.value === adjustmentReasonCode;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            setAdjustmentReasonCode(option.value);
                            if (option.value !== "OTHER") {
                              setAdjustmentFormError(null);
                            }
                          }}
                          className={`rounded-xl border px-3 py-3 text-left text-sm font-semibold transition-colors ${
                            active
                              ? "border-amber-300 bg-amber-400/25 text-amber-50"
                              : "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-3">
                    <label htmlFor="adjustment-note" className="text-xs font-medium text-slate-200">
                      Note {adjustmentReasonCode === "OTHER" ? "(required)" : "(optional)"}
                    </label>
                    <textarea
                      id="adjustment-note"
                      value={adjustmentNote}
                      onChange={(event) => {
                        setAdjustmentNote(event.target.value);
                        if (adjustmentReasonCode === "OTHER" && event.target.value.trim().length > 0) {
                          setAdjustmentFormError(null);
                        }
                      }}
                      rows={3}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-300"
                      placeholder="Add context for audit history"
                    />
                  </div>

                  {adjustmentFormError && (
                    <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/15 p-2 text-xs text-rose-200">
                      {adjustmentFormError}
                    </div>
                  )}

                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAdjustmentForm(false);
                        setShowManagerPinOverlay(false);
                        setManagerPinInput("");
                        setManagerPinError(null);
                        setAdjustmentFormError(null);
                      }}
                      className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={continueToPin}
                      className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-300"
                    >
                      Request Manager PIN
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-100">Today&apos;s Orders</h3>
            <button
              type="button"
              onClick={() => void loadTodayOrders()}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>

          {todayOrdersError && (
            <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-300">
              {todayOrdersError}
            </div>
          )}

          {todayOrdersLoading ? (
            <p className="text-sm text-slate-400">Loading today&apos;s orders...</p>
          ) : todayOrders.length === 0 ? (
            <p className="text-sm text-slate-400">No completed orders for today yet.</p>
          ) : (
            <div className="max-h-[68vh] space-y-2 overflow-auto pr-1">
              {todayOrders.map((order) => (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => {
                    setCompletedOrder(order);
                    setCompletedOrderId(order.id);
                    void loadOrderReceipt(order.id);
                  }}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/70 p-3 text-left hover:bg-slate-800"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-slate-100">#{order.orderNumber}</p>
                    <p className="text-sm font-medium text-slate-200">{toMoney(order.total)}</p>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {order.createdAt ? new Date(order.createdAt).toLocaleTimeString() : "Time unavailable"}
                    {typeof order.printFailed === "boolean" ? ` · Print failed: ${order.printFailed ? "Yes" : "No"}` : ""}
                  </p>
                </button>
              ))}
            </div>
          )}
        </aside>
      </main>
      <AdminAuthorizationOverlay
        isOpen={showManagerPinOverlay}
        title="Manager PIN Required"
        description={`Enter admin PIN to approve ${selectedScopeLabel.toLowerCase()}.`}
        pin={managerPinInput}
        onPinChange={setManagerPinInput}
        error={managerPinError}
        submitting={isApplyingAdjustment}
        submitLabel="Authorize & Apply"
        canSubmit={managerPinInput.trim().length >= 4}
        onBack={() => {
          setShowManagerPinOverlay(false);
          setManagerPinInput("");
          setManagerPinError(null);
        }}
        onSubmit={() => void submitAdjustment(shownOrder)}
      />
      </>
    );
  }

  return (
    <>
      <main className="grid flex-1 grid-cols-1 gap-4 p-4 xl:grid-cols-[1.25fr_0.95fr]">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-100">Today&apos;s Menu</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setShowTodayOrdersPanel(true);
                void loadTodayOrders();
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700"
            >
              Today&apos;s Orders
            </button>
            {periods.map((period) => {
              const isActive = period.id === selectedPeriodId;
              return (
                <button
                  key={period.id}
                  type="button"
                  onClick={() => setSelectedPeriodId(period.id)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-emerald-500 text-white"
                      : "border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {period.name}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => selectedPeriod && void loadMenuForPeriod(selectedPeriod.name)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
        </div>

        {menuError && (
          <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">
            {menuError}
          </div>
        )}

        {isLoadingMenu ? (
          <p className="text-sm text-slate-400">Loading menu...</p>
        ) : periodOptions.length === 0 ? (
          <p className="text-sm text-slate-400">No options for this period yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {periodOptions.map((option) => {
              const soldOut = option.portionsRemaining <= 0;
              const lowStock = option.portionsRemaining > 0 && option.portionsRemaining <= LOW_STOCK_THRESHOLD;

              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={soldOut}
                  onClick={() => openBuilderForOption(option)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    soldOut
                      ? "cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-500"
                      : "border-slate-700 bg-slate-800/70 text-slate-100 hover:border-emerald-400/60 hover:bg-slate-800"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-base font-semibold">{option.name}</p>
                    {lowStock && (
                      <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold uppercase text-amber-300">
                        Low Stock
                      </span>
                    )}
                    {soldOut && (
                      <span className="rounded-full border border-slate-600 px-2 py-0.5 text-[11px] font-semibold uppercase">
                        Sold Out
                      </span>
                    )}
                  </div>
                  {option.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-slate-400">{option.description}</p>
                  )}
                  <div className="mt-4 flex items-end justify-between">
                    <p className="text-2xl font-black">{toMoney(option.price)}</p>
                    <p className="text-xs text-slate-400">Remaining: {option.portionsRemaining}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {selectedOption && (
          <div className="mt-4 rounded-2xl border border-emerald-500/40 bg-slate-900 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm uppercase tracking-wider text-emerald-300">Build Line</p>
                <h3 className="text-xl font-bold text-white">{selectedOption.name}</h3>
                <p className="text-sm text-slate-400">{toMoney(selectedOption.price)} each</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOption(null)}
                className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <span className="text-sm text-slate-300">Quantity</span>
              <button
                type="button"
                onClick={() => setLineQty((q) => Math.max(1, q - 1))}
                className="rounded-lg border border-slate-700 p-1.5 text-slate-200 hover:bg-slate-800"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="min-w-8 text-center text-lg font-semibold text-white">{lineQty}</span>
              <button
                type="button"
                onClick={() => setLineQty((q) => q + 1)}
                className="rounded-lg border border-slate-700 p-1.5 text-slate-200 hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-sm font-medium text-slate-200">Extras (shared for this period)</p>
              {periodExtras.length === 0 ? (
                <p className="text-xs text-slate-400">No extras planned for this period.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {periodExtras.map((extra) => {
                    const soldOut = extra.bufferRemaining <= 0;
                    const qty = selectedExtraQty[extra.id] ?? 0;
                    return (
                      <div
                        key={extra.id}
                        className={`rounded-xl border p-2 ${
                          soldOut ? "border-slate-800 bg-slate-900/50" : "border-slate-700 bg-slate-800/70"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className={`text-sm font-medium ${soldOut ? "text-slate-500" : "text-slate-100"}`}>
                              {extra.componentName ?? extra.name ?? `Extra #${extra.id}`}
                            </p>
                            <p className="text-xs text-slate-400">{toMoney(extra.extraPrice)} · Remaining {extra.bufferRemaining}</p>
                          </div>
                          {soldOut ? (
                            <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase text-slate-500">Sold out</span>
                          ) : (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => decrementExtra(extra.id)}
                                className="rounded-md border border-slate-700 p-1 text-slate-200 hover:bg-slate-700"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                              <span className="min-w-6 text-center text-sm text-slate-100">{qty}</span>
                              <button
                                type="button"
                                onClick={() => incrementExtra(extra.id)}
                                className="rounded-md border border-slate-700 p-1 text-slate-200 hover:bg-slate-700"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-slate-300">Line preview: <span className="font-semibold text-white">{toMoney(selectedOptionPreviewTotal)}</span></p>
              <button
                type="button"
                onClick={addLineToOrder}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400"
              >
                Add To Order
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100">Current Order</h2>
          {draftLines.length > 0 && (
            <button
              type="button"
              onClick={clearDraft}
              className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-500/20"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>

        {submissionError && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
            <AlertCircle className="mt-0.5 h-4 w-4" />
            <p>{submissionError}</p>
          </div>
        )}

        {draftLines.length === 0 ? (
          <p className="text-sm text-slate-400">No lines yet. Tap a menu option to start.</p>
        ) : (
          <div className="max-h-[44vh] space-y-3 overflow-auto pr-1">
            {draftLines.map((line) => (
              <div key={line.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-white">{line.name}</p>
                    <p className="text-xs text-slate-400">{toMoney(line.unitPrice)} each</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(line.id)}
                    className="rounded-md border border-slate-700 p-1 text-slate-300 hover:bg-slate-800"
                    aria-label="Remove line"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-slate-400">Qty</span>
                  <button
                    type="button"
                    onClick={() => updateLineQuantity(line.id, line.quantity - 1)}
                    className="rounded border border-slate-700 p-1 text-slate-300 hover:bg-slate-800"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="min-w-7 text-center text-sm text-white">{line.quantity}</span>
                  <button
                    type="button"
                    onClick={() => updateLineQuantity(line.id, line.quantity + 1)}
                    className="rounded border border-slate-700 p-1 text-slate-300 hover:bg-slate-800"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <p className="ml-auto text-sm font-semibold text-slate-100">{toMoney(line.unitPrice * line.quantity)}</p>
                </div>

                {line.extras.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {line.extras.map((ex) => (
                      <div key={`${line.id}-${ex.dailyComponentStockId}`} className="flex items-center gap-2 text-xs">
                        <span className={`rounded px-1.5 py-0.5 ${ex.invalid ? "bg-rose-500/30 text-rose-200" : "bg-slate-800 text-slate-300"}`}>
                          + {ex.name} x{ex.quantity}
                        </span>
                        <span className="text-slate-400">{toMoney(ex.extraPrice * ex.quantity)}</span>
                        <button
                          type="button"
                          onClick={() => removeExtra(line.id, ex.dailyComponentStockId)}
                          className="ml-auto text-rose-300 hover:text-rose-200"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 space-y-2 border-t border-slate-800 pt-4 text-sm">
          <div className="flex justify-between text-slate-300">
            <span>Subtotal (meal lines)</span>
            <span>{toMoney(draftSubtotal)}</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span>Extras</span>
            <span>{toMoney(draftExtrasTotal)}</span>
          </div>
          <div className="flex justify-between text-lg font-bold text-white">
            <span>Total</span>
            <span>{toMoney(draftTotal)}</span>
          </div>
        </div>

        {!showPayment ? (
          <button
            type="button"
            disabled={draftLines.length === 0}
            onClick={() => {
              setShowPayment(true);
              setSubmissionError(null);
            }}
            className="mt-4 w-full rounded-xl bg-emerald-500 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700"
          >
            Charge (Cash)
          </button>
        ) : (
          <div className="mt-4 rounded-xl border border-emerald-500/40 bg-slate-950/60 p-3">
            <p className="text-xs uppercase tracking-wider text-emerald-300">Cash Tendered</p>
            <p className="mb-3 mt-1 text-3xl font-black text-white">{toMoney(tenderedAmount)}</p>

            <NumericKeypad value={cashInput} onChange={setCashInput} />

            <p className="mt-3 text-xs text-slate-400">
              Confirm is enabled only when tendered amount is at least the total.
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowPayment(false);
                  setCashInput("");
                }}
                className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canConfirmPayment}
                onClick={() => void submitOrder()}
                className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700"
              >
                {isSubmitting ? "Processing..." : "Confirm Payment"}
              </button>
            </div>
          </div>
        )}
      </section>
      </main>

      {showTodayOrdersPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-100">Today&apos;s Orders</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadTodayOrders()}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => setShowTodayOrdersPanel(false)}
                  className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                >
                  Close
                </button>
              </div>
            </div>

            {todayOrdersError && (
              <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-300">
                {todayOrdersError}
              </div>
            )}

            {todayOrdersLoading ? (
              <p className="text-sm text-slate-400">Loading today&apos;s orders...</p>
            ) : todayOrders.length === 0 ? (
              <p className="text-sm text-slate-400">No completed orders for today yet.</p>
            ) : (
              <div className="max-h-[60vh] space-y-2 overflow-auto pr-1">
                {todayOrders.map((order) => (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => {
                      setCompletedOrder(order);
                      setCompletedOrderId(order.id);
                      setShowTodayOrdersPanel(false);
                      void loadOrderReceipt(order.id);
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/70 p-3 text-left hover:bg-slate-800"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-slate-100">#{order.orderNumber}</p>
                      <p className="text-sm font-medium text-slate-200">{toMoney(order.total)}</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      {order.createdAt ? new Date(order.createdAt).toLocaleTimeString() : "Time unavailable"}
                      {typeof order.printFailed === "boolean" ? ` · Print failed: ${order.printFailed ? "Yes" : "No"}` : ""}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
