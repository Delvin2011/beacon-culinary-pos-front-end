"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Minus, Plus, Printer, RefreshCw, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { NumericKeypad } from "@/components/pos/numeric-keypad";
import {
  AdjustmentReasonFields,
  type OrderAdjustmentReasonCode,
} from "@/components/pos/adjustment-reason-fields";
import { Input } from "@/components/ui/input";
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

type PaymentMethod = "CASH" | "CARD" | "ACCOUNT";

type RefundMethod = "CASH" | "ACCOUNT_BALANCE";

type OrderAdjustmentScope = "WHOLE_ORDER" | "EXTRAS_ONLY";

type OrderAdjustmentAction = "VOID" | "REFUND" | "DISCOUNT";

type AdjustmentRequestAction = "CANCEL" | "DISCOUNT";

type DiscountType = "PERCENTAGE" | "FIXED_AMOUNT";

type OrderAdjustmentDto = {
  id: number;
  scope: OrderAdjustmentScope;
  action: OrderAdjustmentAction;
  reasonCode: OrderAdjustmentReasonCode;
  note?: string;
  amount: number;
  discountType?: DiscountType;
  discountValue?: number;
  refundMethod?: RefundMethod;
  accountId?: number;
  requestedById: number;
  authorizedById: number;
  createdAt: string;
};

type OrderPaymentDto = {
  id: number;
  method: PaymentMethod;
  amount: number;
  amountTendered?: number;
  changeDue?: number;
  cardReference?: string;
  accountId?: number;
};

type OrderDto = {
  id: number;
  orderNumber: number;
  status?: OrderStatus;
  orderDate?: string;
  createdAt?: string;
  subtotal: number;
  total: number;
  originalTotal?: number;
  printFailed?: boolean;
  lines?: OrderLineDto[];
  adjustments?: OrderAdjustmentDto[];
  payments?: OrderPaymentDto[];
};

type AccountDto = {
  id: number;
  name: string;
};

type DraftPaymentEntry = {
  method: PaymentMethod;
  amount: number;
  amountTendered?: number;
  cardReference?: string;
  accountId?: number;
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

type ManagementPrompt = {
  title?: string;
  description?: string;
  submitLabel?: string;
};

type PosOrderBuilderProps = {
  managementSessionToken: string | null;
  managementSessionActive: boolean;
  managementRemainingMs: number;
  requestManagementSession: (
    action: (sessionToken: string) => void | Promise<void>,
    prompt?: ManagementPrompt,
  ) => void;
  invalidateManagementSession: () => void;
};

function nowTimeHHMMSS(): string {
  return new Date().toTimeString().slice(0, 8);
}

function isWithinPeriod(startTime: string, endTime: string, now: string): boolean {
  return now >= startTime && now <= endTime;
}

function toMoney(value: number): string {
  return formatZarCurrency(value);
}

function toCents(value: number): number {
  return Math.round(value * 100);
}

function fromCentsInput(raw: string): number {
  const parsed = Number(raw || "0");
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed) / 100;
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

function formatRemainingMs(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function alreadyAdjustedMessage(order: OrderDto): string {
  if (order.status === "VOIDED") return "This order has already been voided.";
  if (order.status === "REFUNDED") return "This order has already been refunded.";
  if (!hasAnyUnadjustedExtras(order)) return "This order has already had its extras removed.";
  return "This order was already adjusted. The latest state has been loaded.";
}

export function PosOrderBuilder({
  managementSessionToken,
  managementSessionActive,
  managementRemainingMs,
  requestManagementSession,
  invalidateManagementSession,
}: PosOrderBuilderProps) {
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
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [paymentEntries, setPaymentEntries] = useState<DraftPaymentEntry[]>([]);
  const [paymentAmountInput, setPaymentAmountInput] = useState("");
  const [cashTenderedInput, setCashTenderedInput] = useState("");
  const [cardReference, setCardReference] = useState("");
  const [cardReferenceError, setCardReferenceError] = useState<string | null>(null);
  const [paymentEntryError, setPaymentEntryError] = useState<string | null>(null);
  const [checkoutAccounts, setCheckoutAccounts] = useState<AccountDto[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [accountSearch, setAccountSearch] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
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
  const [requestedAction, setRequestedAction] = useState<AdjustmentRequestAction | null>(null);
  const [adjustmentScope, setAdjustmentScope] = useState<OrderAdjustmentScope | null>(null);
  const [adjustmentReasonCode, setAdjustmentReasonCode] = useState<OrderAdjustmentReasonCode>("WRONG_ORDER");
  const [adjustmentNote, setAdjustmentNote] = useState("");
  const [showAdjustmentForm, setShowAdjustmentForm] = useState(false);
  const [adjustmentError, setAdjustmentError] = useState<string | null>(null);
  const [adjustmentFormError, setAdjustmentFormError] = useState<string | null>(null);
  const [isApplyingAdjustment, setIsApplyingAdjustment] = useState(false);
  const [adjustmentSuccess, setAdjustmentSuccess] = useState<string | null>(null);
  const [discountType, setDiscountType] = useState<DiscountType>("PERCENTAGE");
  const [discountValueInput, setDiscountValueInput] = useState("");
  const [discountValueError, setDiscountValueError] = useState<string | null>(null);

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
  const draftTotalCents = useMemo(() => toCents(draftTotal), [draftTotal]);

  const paymentAmount = useMemo(() => fromCentsInput(paymentAmountInput), [paymentAmountInput]);
  const cashTenderedAmount = useMemo(() => fromCentsInput(cashTenderedInput), [cashTenderedInput]);

  const totalPaidCents = useMemo(
    () => paymentEntries.reduce((sum, entry) => sum + toCents(entry.amount), 0),
    [paymentEntries],
  );

  const remainingToPayCents = Math.max(0, draftTotalCents - totalPaidCents);
  const remainingToPay = remainingToPayCents / 100;

  const hasAccountEntry = paymentEntries.some((entry) => entry.method === "ACCOUNT");
  const hasCashOrCardEntry = paymentEntries.some((entry) => entry.method === "CASH" || entry.method === "CARD");
  const availableMethods = useMemo(() => {
    if (hasAccountEntry) return ["ACCOUNT"] as PaymentMethod[];
    if (hasCashOrCardEntry) return ["CASH", "CARD"] as PaymentMethod[];
    return ["CASH", "CARD", "ACCOUNT"] as PaymentMethod[];
  }, [hasAccountEntry, hasCashOrCardEntry]);

  const accountSearchLower = accountSearch.trim().toLowerCase();
  const filteredAccounts = useMemo(() => {
    if (!accountSearchLower) return checkoutAccounts;
    return checkoutAccounts.filter((account) => account.name.toLowerCase().includes(accountSearchLower));
  }, [accountSearchLower, checkoutAccounts]);

  const existingMethodSet = useMemo(
    () => new Set(paymentEntries.map((entry) => entry.method)),
    [paymentEntries],
  );

  const singlePaymentDraft = useMemo<DraftPaymentEntry | null>(() => {
    if (paymentEntries.length > 0 || remainingToPayCents <= 0) return null;

    const amount = remainingToPay;
    if (paymentMethod === "ACCOUNT") {
      if (!selectedAccountId) return null;
      return { method: "ACCOUNT", amount, accountId: selectedAccountId };
    }

    if (paymentMethod === "CARD") {
      const reference = cardReference.trim();
      if (!reference) return null;
      return { method: "CARD", amount, cardReference: reference };
    }

    if (cashTenderedAmount < amount) return null;
    return { method: "CASH", amount, amountTendered: cashTenderedAmount };
  }, [
    cardReference,
    cashTenderedAmount,
    paymentEntries.length,
    paymentMethod,
    remainingToPay,
    remainingToPayCents,
    selectedAccountId,
  ]);

  const discountValue = useMemo(() => {
    const parsed = Number.parseFloat(discountValueInput);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [discountValueInput]);

  const discountPreview = useMemo(() => {
    const targetOrder = receiptOrder ?? completedOrder;
    if (!targetOrder) return { amount: 0, newTotal: 0 };

    const currentTotal = targetOrder.total ?? 0;
    if (discountType === "PERCENTAGE") {
      const amount = Math.round(((currentTotal * discountValue) / 100) * 100) / 100;
      return {
        amount,
        newTotal: Math.max(0, currentTotal - amount),
      };
    }

    return {
      amount: discountValue,
      newTotal: Math.max(0, currentTotal - discountValue),
    };
  }, [completedOrder, discountType, discountValue, receiptOrder]);

  const canConfirmPayment =
    draftLines.length > 0 &&
    !isSubmitting &&
    ((paymentEntries.length > 0 && remainingToPayCents === 0) || singlePaymentDraft !== null);

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
    setPaymentMethod("CASH");
    setPaymentEntries([]);
    setPaymentAmountInput("");
    setCashTenderedInput("");
    setCardReference("");
    setCardReferenceError(null);
    setPaymentEntryError(null);
    setAccountsError(null);
    setAccountSearch("");
    setSelectedAccountId(null);
  };

  const resetPaymentEditor = useCallback(
    (nextAmountCents?: number) => {
      const amountCents = Math.max(0, nextAmountCents ?? remainingToPayCents);
      setPaymentAmountInput(String(amountCents));
      setCashTenderedInput(String(amountCents));
      setCardReference("");
      setCardReferenceError(null);
      setPaymentEntryError(null);
    },
    [remainingToPayCents],
  );

  const loadCheckoutAccounts = useCallback(async () => {
    setAccountsLoading(true);
    setAccountsError(null);
    try {
      const res = await authFetch("/accounts?active=true");
      const body = (await res.json().catch(() => null)) as AccountDto[] | ApiErrorPayload | null;
      if (!res.ok || !Array.isArray(body)) {
        throw new Error(parseMessage(body, "Unable to load accounts for checkout."));
      }

      setCheckoutAccounts(body);
      setSelectedAccountId((current) => {
        if (current && body.some((account) => account.id === current)) return current;
        return body.length > 0 ? body[0].id : null;
      });
    } catch (err) {
      setAccountsError(err instanceof Error ? err.message : "Unable to load accounts for checkout.");
      setCheckoutAccounts([]);
      setSelectedAccountId(null);
    } finally {
      setAccountsLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (!showPayment) return;

    if (!availableMethods.includes(paymentMethod)) {
      setPaymentMethod(availableMethods[0]);
      return;
    }

    if (paymentMethod === "ACCOUNT" && checkoutAccounts.length === 0 && !accountsLoading) {
      void loadCheckoutAccounts();
    }
  }, [
    accountsLoading,
    availableMethods,
    checkoutAccounts.length,
    loadCheckoutAccounts,
    paymentMethod,
    showPayment,
  ]);

  useEffect(() => {
    if (!showPayment) return;
    if (remainingToPayCents <= 0) return;
    resetPaymentEditor(remainingToPayCents);
  }, [paymentMethod, remainingToPayCents, resetPaymentEditor, showPayment]);

  const addPaymentEntry = () => {
    if (remainingToPayCents <= 0) {
      setPaymentEntryError("Order is already fully paid.");
      return;
    }

    if (paymentEntries.length >= 2) {
      setPaymentEntryError("Only up to two payment entries are allowed.");
      return;
    }

    if (existingMethodSet.has(paymentMethod)) {
      setPaymentEntryError("This payment method has already been added.");
      return;
    }

    const amount = paymentMethod === "ACCOUNT" ? remainingToPay : paymentAmount;
    const amountCents = toCents(amount);
    if (amountCents <= 0 || amountCents > remainingToPayCents) {
      setPaymentEntryError("Amount must be greater than zero and no more than the remaining balance.");
      return;
    }

    if (paymentMethod === "CASH") {
      if (cashTenderedAmount < amount) {
        setPaymentEntryError("Tendered amount must be at least the cash amount.");
        return;
      }

      setPaymentEntries((prev) => [
        ...prev,
        {
          method: "CASH",
          amount,
          amountTendered: cashTenderedAmount,
        },
      ]);
      resetPaymentEditor(remainingToPayCents - amountCents);
      return;
    }

    if (paymentMethod === "CARD") {
      const reference = cardReference.trim();
      if (!reference) {
        setCardReferenceError("Card reference is required.");
        return;
      }

      setPaymentEntries((prev) => [
        ...prev,
        {
          method: "CARD",
          amount,
          cardReference: reference,
        },
      ]);
      resetPaymentEditor(remainingToPayCents - amountCents);
      return;
    }

    if (!selectedAccountId) {
      setPaymentEntryError("Select an account to continue.");
      return;
    }

    setPaymentEntries((prev) => [
      ...prev,
      {
        method: "ACCOUNT",
        amount,
        accountId: selectedAccountId,
      },
    ]);
    resetPaymentEditor(0);
  };

  const removePaymentEntry = (index: number) => {
    setPaymentEntries((prev) => prev.filter((_, entryIndex) => entryIndex !== index));
    setPaymentEntryError(null);
  };

  const getAccountName = useCallback(
    (accountId?: number) => {
      if (!accountId) return null;
      return checkoutAccounts.find((account) => account.id === accountId)?.name ?? `Account #${accountId}`;
    },
    [checkoutAccounts],
  );

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
    setCardReferenceError(null);

    const paymentsForSubmit = paymentEntries.length > 0 ? paymentEntries : singlePaymentDraft ? [singlePaymentDraft] : [];
    if (paymentsForSubmit.length === 0) {
      setSubmissionError("Add a valid payment before confirming.");
      setIsSubmitting(false);
      return;
    }

    const payload: Record<string, unknown> = {
      payments: paymentsForSubmit.map((entry) => ({
        method: entry.method,
        amount: entry.amount,
        amountTendered: entry.amountTendered,
        cardReference: entry.cardReference,
        accountId: entry.accountId,
      })),
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
      setPaymentMethod("CASH");
      setPaymentEntries([]);
      setPaymentAmountInput("");
      setCashTenderedInput("");
      setCardReference("");
      setPaymentEntryError(null);
      setAccountSearch("");
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
    setRequestedAction("CANCEL");
    setAdjustmentScope(scope);
    setShowAdjustmentForm(true);
    setAdjustmentFormError(null);
    setAdjustmentError(null);
    setAdjustmentSuccess(null);
    setDiscountValueError(null);
  };

  const beginDiscount = () => {
    setRequestedAction("DISCOUNT");
    setAdjustmentScope(null);
    setShowAdjustmentForm(true);
    setAdjustmentFormError(null);
    setAdjustmentError(null);
    setAdjustmentSuccess(null);
    setDiscountValueError(null);
  };

  const submitOrderAdjustment = useCallback(
    async (order: OrderDto, sessionToken: string) => {
      if (!requestedAction) return;

      setIsApplyingAdjustment(true);
      setAdjustmentError(null);
      setDiscountValueError(null);

      try {
        const payload: Record<string, unknown> = {
          requestedAction,
          reasonCode: adjustmentReasonCode,
          note: adjustmentNote.trim() || undefined,
          sessionToken,
        };

        if (requestedAction === "CANCEL") {
          payload.scope = adjustmentScope;
        } else {
          payload.discountType = discountType;
          payload.discountValue = discountValue;
        }

        const adjustmentRes = await authFetch(`/orders/${order.id}/adjustments`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const adjustmentBody = (await adjustmentRes.json().catch(() => null)) as OrderDto | ApiErrorPayload | null;

        if (!adjustmentRes.ok) {
          const parsedMessage = parseMessage(adjustmentBody, "Unable to apply management action.");

          if (adjustmentRes.status === 401) {
            invalidateManagementSession();
            requestManagementSession(
              async (freshSessionToken) => {
                await submitOrderAdjustment(order, freshSessionToken);
              },
              {
                description: "Management mode expired. Enter admin PIN to continue this action.",
                submitLabel: "Re-authorize",
              },
            );
            return;
          }

          if (adjustmentRes.status === 409) {
            const refreshed = await loadOrderReceipt(order.id);
            await loadTodayOrders();
            setShowAdjustmentForm(false);
            setAdjustmentError(alreadyAdjustedMessage(refreshed ?? order));
            return;
          }

          if (adjustmentRes.status === 400) {
            await loadOrderReceipt(order.id);
            if (requestedAction === "DISCOUNT") {
              setDiscountValueError(parsedMessage);
            } else {
              setAdjustmentError(parsedMessage);
            }
            return;
          }

          throw new Error(parsedMessage);
        }

        const updatedOrder = adjustmentBody as OrderDto;
        const recent = latestAdjustment(updatedOrder);

        setCompletedOrder(updatedOrder);
        setReceiptOrder(updatedOrder);
        await loadTodayOrders();

        if (requestedAction === "DISCOUNT") {
          const discountAmount = recent?.amount ?? discountPreview.amount;
          setAdjustmentSuccess(
            `Discount applied: ${toMoney(discountAmount)}. New total ${toMoney(updatedOrder.total)}.`,
          );
        } else {
          const amount = recent?.amount ?? Math.max(0, (order.total ?? 0) - (updatedOrder.total ?? 0));
          const action = recent?.action ?? (updatedOrder.status === "VOIDED" ? "VOID" : "REFUND");
          const scope = recent?.scope ?? adjustmentScope;
          const usesCard = (order.payments ?? []).some((payment) => payment.method === "CARD");

          const payoutInstruction =
            recent?.refundMethod === "ACCOUNT_BALANCE"
              ? `Credited to ${getAccountName(recent.accountId) ?? "linked account"} - no cash or card action needed.`
              : `Hand back ${toMoney(amount)} in cash.${usesCard ? " Originally paid by card - refund is cash." : ""}`;

          if (action === "VOID") {
            if (scope === "WHOLE_ORDER") {
              const portionsReturned = getTotalMealPortions(order);
              const extraUnitsReturned = getUnadjustedExtraUnits(order);
              const extraSuffix = extraUnitsReturned > 0 ? ` and ${extraUnitsReturned} extra units` : "";
              setAdjustmentSuccess(
                `${adjustmentActionLabel(action)} ${toMoney(amount)}. ${portionsReturned} portions${extraSuffix} returned to today's stock. ${payoutInstruction}`,
              );
            } else {
              const extraUnitsReturned = getUnadjustedExtraUnits(order);
              const detail =
                extraUnitsReturned > 0
                  ? `${extraUnitsReturned} extra units returned to today's stock.`
                  : "Extras were removed and today's stock was restored.";
              setAdjustmentSuccess(`${adjustmentActionLabel(action)} ${toMoney(amount)}. ${detail} ${payoutInstruction}`);
            }
          } else {
            setAdjustmentSuccess(`${adjustmentActionLabel(action)} ${toMoney(amount)}. No stock was restored. ${payoutInstruction}`);
          }
        }

        setShowAdjustmentForm(false);
      } catch (err) {
        setAdjustmentError(err instanceof Error ? err.message : "Unable to apply management action.");
      } finally {
        setIsApplyingAdjustment(false);
      }
    },
    [
      adjustmentNote,
      adjustmentReasonCode,
      adjustmentScope,
      authFetch,
      discountPreview.amount,
      discountType,
      discountValue,
      invalidateManagementSession,
      loadOrderReceipt,
      loadTodayOrders,
      getAccountName,
      requestManagementSession,
      requestedAction,
    ],
  );

  const submitManagementAction = useCallback(
    (order: OrderDto) => {
      const trimmedNote = adjustmentNote.trim();
      if (adjustmentReasonCode === "OTHER" && trimmedNote.length === 0) {
        setAdjustmentFormError("A note is required when reason is Other.");
        return;
      }

      if (requestedAction === "CANCEL" && !adjustmentScope) {
        setAdjustmentError("Select how this order should be adjusted.");
        return;
      }

      if (requestedAction === "DISCOUNT") {
        if (discountValue <= 0) {
          setDiscountValueError("Enter a discount value greater than zero.");
          return;
        }

        if (discountType === "PERCENTAGE" && (discountValue <= 0 || discountValue > 100)) {
          setDiscountValueError("Percentage discounts must be greater than 0 and no more than 100.");
          return;
        }

        if (discountType === "FIXED_AMOUNT" && discountValue > order.total) {
          setDiscountValueError("Discount cannot exceed the current order total.");
          return;
        }

        if (discountPreview.amount > order.total) {
          setDiscountValueError("Discount cannot exceed the current order total.");
          return;
        }
      }

      setAdjustmentFormError(null);
      setDiscountValueError(null);

      requestManagementSession(
        async (token) => {
          await submitOrderAdjustment(order, token);
        },
        {
          description: "Enter admin PIN to unlock management mode for order actions.",
          submitLabel: "Unlock Management",
        },
      );
    },
    [
      adjustmentNote,
      adjustmentReasonCode,
      adjustmentScope,
      discountPreview.amount,
      discountType,
      discountValue,
      requestManagementSession,
      requestedAction,
      submitOrderAdjustment,
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
    const shownPayments = shownOrder.payments ?? [];
    const shownChangeDue = shownPayments
      .filter((payment) => payment.method === "CASH")
      .reduce((sum, payment) => sum + (payment.changeDue ?? 0), 0);
    const recentAdjustment = latestAdjustment(shownOrder);
    const terminalOrder = isTerminalOrderStatus(shownOrder.status);
    const canRemoveExtras = hasAnyUnadjustedExtras(shownOrder);
    const managementReady = managementSessionActive && Boolean(managementSessionToken);
    const selectedActionLabel =
      requestedAction === "DISCOUNT"
        ? "Apply Discount"
        : adjustmentScope === "WHOLE_ORDER"
          ? "Cancel Order"
          : "Remove Extras";
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

          {shownChangeDue > 0 ? (
            <>
              <p className="mt-6 text-sm text-emerald-200/90">Change Due</p>
              <p className="text-6xl font-black text-white">{toMoney(shownChangeDue)}</p>
            </>
          ) : (
            <>
              <p className="mt-6 text-sm text-emerald-200/90">Order Total</p>
              <p className="text-6xl font-black text-white">{toMoney(shownOrder.total)}</p>
            </>
          )}

          <div className="mt-8 grid gap-2 text-sm text-emerald-100">
            {shownOrder.status && <p>Status: {shownOrder.status.replace("_", " ")}</p>}
            <p>Subtotal: {toMoney(shownOrder.subtotal)}</p>
            <p>Total: {toMoney(shownOrder.total)}</p>
            {typeof shownOrder.originalTotal === "number" && <p>Original Total: {toMoney(shownOrder.originalTotal)}</p>}
            {shownPayments.length > 0 && (
              <div className="rounded-lg border border-emerald-200/20 bg-emerald-500/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-200">Payments</p>
                <div className="mt-2 space-y-1">
                  {shownPayments.map((payment) => (
                    <div key={payment.id} className="text-xs text-emerald-100/95">
                      <p>
                        {payment.method}: {toMoney(payment.amount)}
                        {payment.method === "ACCOUNT" && payment.accountId ? ` to ${getAccountName(payment.accountId)}` : ""}
                      </p>
                      {payment.method === "CASH" && typeof payment.amountTendered === "number" && (
                        <p>Tendered: {toMoney(payment.amountTendered)}{payment.changeDue ? ` · Change ${toMoney(payment.changeDue)}` : ""}</p>
                      )}
                      {payment.method === "CARD" && payment.cardReference && <p>Card Ref: {payment.cardReference}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {typeof shownOrder.printFailed === "boolean" && (
              <p>Print Failed: {shownOrder.printFailed ? "Yes" : "No"}</p>
            )}
          </div>

          {recentAdjustment && (recentAdjustment.action === "REFUND" || recentAdjustment.action === "VOID" || recentAdjustment.action === "DISCOUNT") && (
            <div className="mt-4 rounded-xl border border-amber-300/30 bg-amber-500/10 p-3 text-sm text-amber-100">
              {recentAdjustment.refundMethod === "ACCOUNT_BALANCE" ? (
                <p>
                  Credited to {getAccountName(recentAdjustment.accountId) ?? "linked account"}. No cash or card action needed.
                </p>
              ) : (
                <p className="font-semibold">
                  Hand back {toMoney(recentAdjustment.amount)} in cash.
                  {(shownOrder.payments ?? []).some((payment) => payment.method === "CARD")
                    ? " Originally paid by card - refund is cash."
                    : ""}
                </p>
              )}
            </div>
          )}

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
              <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-100">Management Actions</h3>
              <p className="mt-2 text-sm text-amber-100/90">
                {managementReady
                  ? `Management mode active for ${formatRemainingMs(managementRemainingMs)}.`
                  : "Manager authorization will be requested when you submit an action."}
              </p>

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
                <button
                  type="button"
                  onClick={beginDiscount}
                  className="rounded-lg border border-blue-300/40 bg-blue-500/20 px-3 py-2 text-sm font-semibold text-blue-50 hover:bg-blue-500/30"
                >
                  Apply Discount
                </button>
              </div>

              {!canRemoveExtras && (
                <p className="mt-2 text-xs text-amber-100/80">
                  Remove Extras is unavailable because this order has no removable extras.
                </p>
              )}

              {showAdjustmentForm && (
                <div className="mt-4 rounded-xl border border-amber-300/30 bg-slate-950/50 p-4">
                  <p className="text-sm font-semibold text-white">{selectedActionLabel}</p>

                  {requestedAction === "DISCOUNT" && (
                    <div className="mt-3 space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                      <div className="flex flex-wrap gap-2">
                        {(["PERCENTAGE", "FIXED_AMOUNT"] as const).map((type) => {
                          const active = discountType === type;
                          return (
                            <button
                              key={type}
                              type="button"
                              onClick={() => {
                                setDiscountType(type);
                                setDiscountValueError(null);
                              }}
                              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                                active
                                  ? "border-blue-300 bg-blue-500/25 text-blue-50"
                                  : "border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-800"
                              }`}
                            >
                              {type === "PERCENTAGE" ? "Percentage" : "Fixed Amount"}
                            </button>
                          );
                        })}
                      </div>

                      <div>
                        <label htmlFor="discount-value" className="text-xs font-medium text-slate-200">
                          {discountType === "PERCENTAGE" ? "Discount Percentage" : "Discount Amount"}
                        </label>
                        <Input
                          id="discount-value"
                          type="number"
                          min="0"
                          step={discountType === "PERCENTAGE" ? "0.01" : "0.01"}
                          value={discountValueInput}
                          onChange={(event) => {
                            setDiscountValueInput(event.target.value);
                            setDiscountValueError(null);
                          }}
                          className="mt-1 border-slate-700 bg-slate-950 text-slate-100"
                          placeholder={discountType === "PERCENTAGE" ? "e.g. 10" : "e.g. 25.00"}
                        />
                        {discountValueError && (
                          <p className="mt-2 text-xs text-rose-200">{discountValueError}</p>
                        )}
                      </div>

                      <div className="rounded-lg border border-blue-300/20 bg-blue-500/10 p-3 text-sm text-blue-100">
                        <p>Discount Preview: {toMoney(discountPreview.amount)}</p>
                        <p className="mt-1 font-semibold">New Total: {toMoney(discountPreview.newTotal)}</p>
                      </div>
                    </div>
                  )}

                  <AdjustmentReasonFields
                    reasonCode={adjustmentReasonCode}
                    note={adjustmentNote}
                    onReasonCodeChange={(value) => {
                      setAdjustmentReasonCode(value);
                      if (value !== "OTHER") {
                        setAdjustmentFormError(null);
                      }
                    }}
                    onNoteChange={(value) => {
                      setAdjustmentNote(value);
                      if (adjustmentReasonCode === "OTHER" && value.trim().length > 0) {
                        setAdjustmentFormError(null);
                      }
                    }}
                    error={adjustmentFormError}
                    noteId="adjustment-note"
                    className="mt-3 border-0 bg-transparent p-0"
                  />

                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAdjustmentForm(false);
                        setAdjustmentFormError(null);
                        setDiscountValueError(null);
                      }}
                      className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isApplyingAdjustment}
                      onClick={() => submitManagementAction(shownOrder)}
                      className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-300"
                    >
                      {isApplyingAdjustment ? "Processing..." : managementReady ? selectedActionLabel : "Unlock & Apply"}
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
              setCardReferenceError(null);
              setPaymentEntryError(null);
              resetPaymentEditor(draftTotalCents);
            }}
            className="mt-4 w-full rounded-xl bg-emerald-500 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700"
          >
            Charge
          </button>
        ) : (
          <div className="mt-4 rounded-xl border border-emerald-500/40 bg-slate-950/60 p-3">
            <div className="mb-3 rounded-lg border border-emerald-300/25 bg-emerald-500/10 p-3 text-sm text-emerald-100">
              <p className="font-semibold">Remaining to pay: {toMoney(remainingToPay)}</p>
              <p className="text-xs text-emerald-100/80">Confirm payment is enabled only when this reaches zero.</p>
            </div>

            {paymentEntries.length > 0 && (
              <div className="mb-3 space-y-2 rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-300">Payment Entries</p>
                {paymentEntries.map((entry, index) => (
                  <div key={`${entry.method}-${index}`} className="flex items-start justify-between gap-3 rounded-md border border-slate-700 bg-slate-950/60 p-2 text-xs text-slate-200">
                    <div>
                      <p className="font-semibold">{entry.method}: {toMoney(entry.amount)}</p>
                      {entry.method === "CASH" && typeof entry.amountTendered === "number" && (
                        <p>Tendered: {toMoney(entry.amountTendered)}</p>
                      )}
                      {entry.method === "CARD" && entry.cardReference && <p>Card Ref: {entry.cardReference}</p>}
                      {entry.method === "ACCOUNT" && entry.accountId && <p>Account: {getAccountName(entry.accountId)}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => removePaymentEntry(index)}
                      className="rounded border border-rose-400/40 px-2 py-1 text-rose-200 hover:bg-rose-500/10"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs uppercase tracking-wider text-emerald-300">Payment Method</p>
            <div className="mt-3 flex gap-2">
              {(["CASH", "CARD", "ACCOUNT"] as const).map((method) => {
                const active = paymentMethod === method;
                const disabled = !availableMethods.includes(method) || existingMethodSet.has(method);
                return (
                  <button
                    key={method}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setPaymentMethod(method);
                      setCardReferenceError(null);
                      setPaymentEntryError(null);
                    }}
                    className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                      disabled
                        ? "cursor-not-allowed border-slate-800 bg-slate-900 text-slate-600"
                        : active
                        ? "border-emerald-300 bg-emerald-500/20 text-emerald-100"
                        : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    {method === "CASH" ? "Cash" : method === "CARD" ? "Card" : "Account"}
                  </button>
                );
              })}
            </div>

            {paymentEntryError && (
              <p className="mt-2 text-xs text-rose-200">{paymentEntryError}</p>
            )}

            {(paymentMethod === "CASH" || paymentMethod === "CARD") && (
              <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                <p className="text-xs uppercase tracking-wider text-slate-300">Payment Amount</p>
                <p className="mt-1 text-3xl font-black text-white">{toMoney(paymentAmount)}</p>
                <p className="text-xs text-slate-400">Set amount for this {paymentMethod.toLowerCase()} entry.</p>
                <div className="mt-3 flex justify-center">
                  <NumericKeypad value={paymentAmountInput} onChange={setPaymentAmountInput} />
                </div>
              </div>
            )}

            {paymentMethod === "CASH" ? (
              <>
                <p className="mt-4 text-xs uppercase tracking-wider text-emerald-300">Cash Tendered</p>
                <p className="mb-3 mt-1 text-3xl font-black text-white">{toMoney(cashTenderedAmount)}</p>

                <NumericKeypad value={cashTenderedInput} onChange={setCashTenderedInput} />

                <p className="mt-3 text-xs text-slate-400">
                  Tendered cash must be at least the cash amount for this entry.
                </p>
              </>
            ) : paymentMethod === "CARD" ? (
              <div className="mt-4 rounded-xl border border-blue-300/25 bg-blue-500/10 p-4">
                <p className="text-xs uppercase tracking-wider text-blue-100">Card Payment</p>
                <p className="mt-2 text-3xl font-black text-white">{toMoney(paymentAmount)}</p>
                <p className="mt-2 text-sm text-slate-300">
                  Process the payment on the physical card machine, then enter the reference shown on the device.
                </p>
                <div className="mt-3">
                  <label htmlFor="card-reference" className="text-xs font-medium text-slate-200">
                    Card Reference
                  </label>
                  <Input
                    id="card-reference"
                    value={cardReference}
                    onChange={(event) => {
                      setCardReference(event.target.value);
                      setCardReferenceError(null);
                    }}
                    className="mt-1 border-slate-700 bg-slate-950 text-slate-100"
                    placeholder="Approval code or last 4 digits"
                  />
                  {cardReferenceError && <p className="mt-2 text-xs text-rose-200">{cardReferenceError}</p>}
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-amber-300/25 bg-amber-500/10 p-4">
                <p className="text-xs uppercase tracking-wider text-amber-100">Bill to Account</p>
                <p className="mt-2 text-sm text-amber-100">
                  Account payments always cover the full remaining total and cannot be split with cash or card.
                </p>
                <p className="mt-2 text-3xl font-black text-white">{toMoney(remainingToPay)}</p>

                <div className="mt-3">
                  <label htmlFor="account-search" className="text-xs font-medium text-slate-200">
                    Search Account
                  </label>
                  <Input
                    id="account-search"
                    value={accountSearch}
                    onChange={(event) => setAccountSearch(event.target.value)}
                    className="mt-1 border-slate-700 bg-slate-950 text-slate-100"
                    placeholder="Type account name"
                  />
                </div>

                {accountsError && <p className="mt-2 text-xs text-rose-200">{accountsError}</p>}
                {accountsLoading ? (
                  <p className="mt-2 text-xs text-slate-300">Loading accounts...</p>
                ) : filteredAccounts.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-300">No active accounts found.</p>
                ) : (
                  <div className="mt-3 max-h-40 space-y-1 overflow-auto rounded-lg border border-slate-700 bg-slate-950/70 p-2">
                    {filteredAccounts.map((account) => {
                      const active = selectedAccountId === account.id;
                      return (
                        <button
                          key={account.id}
                          type="button"
                          onClick={() => setSelectedAccountId(account.id)}
                          className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                            active
                              ? "bg-amber-500/20 text-amber-100"
                              : "text-slate-200 hover:bg-slate-800"
                          }`}
                        >
                          {account.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {(paymentMethod === "CASH" || paymentMethod === "CARD" || paymentMethod === "ACCOUNT") && (
              <button
                type="button"
                disabled={remainingToPayCents === 0 || paymentEntries.length >= 2}
                onClick={addPaymentEntry}
                className="mt-3 w-full rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {paymentEntries.length === 0 && paymentMethod !== "ACCOUNT" && toCents(paymentAmount) === remainingToPayCents
                  ? `Add ${paymentMethod === "CASH" ? "Cash" : "Card"} Full Payment`
                  : paymentMethod === "ACCOUNT"
                    ? "Add Account Payment"
                    : `Add ${paymentMethod === "CASH" ? "Cash" : "Card"} Entry`}
              </button>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowPayment(false);
                  setPaymentEntries([]);
                  setPaymentAmountInput("");
                  setCashTenderedInput("");
                  setCardReference("");
                  setCardReferenceError(null);
                  setPaymentEntryError(null);
                  setAccountsError(null);
                  setAccountSearch("");
                  setSelectedAccountId(null);
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
