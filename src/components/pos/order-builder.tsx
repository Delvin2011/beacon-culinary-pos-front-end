"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Gift, Info, Minus, Plus, Printer, RefreshCw, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useShift } from "@/hooks/use-shift";
import { NumericKeypad } from "@/components/pos/numeric-keypad";
import {
  AdjustmentReasonFields,
  type OrderAdjustmentReasonCode,
} from "@/components/pos/adjustment-reason-fields";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatZarCurrency } from "@/lib/utils";
import type { CatalogGroup, CategoryRef, Station } from "@/lib/catalog";
import { type OrderStation, orderStatusLabel, stationLabel, stationStatusLabel } from "@/lib/stations";
import { centsToAmountInput, formatAmountInput, parseAmountInput } from "@/lib/amount-input";
import {
  COMPLIMENTARY_REASONS,
  complimentaryReasonLabel,
  isComplimentary,
  type ComplimentaryReasonCode,
  type OrderComplimentary,
  type OrderKind,
} from "@/lib/complimentary";

type MealPeriod = {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  // false for All Day: its items are always available, not planned.
  plannable?: boolean;
};

type DailyMealOption = {
  id: number;
  // null for beverages, which have no period.
  mealPeriodId: number | null;
  optionDate: string;
  name: string;
  description?: string;
  price: number;
  // null means unlimited (always-available items): no counter, never capped.
  plannedPortions: number | null;
  portionsRemaining: number | null;
  mealCatalogId?: number;
  group?: CatalogGroup;
  category?: CategoryRef | null;
  period?: { id: number; name: string } | null;
  outToday?: boolean;
  // Always-on options only (null on planned ones). A warning: a LOW or OUT light meal can still be sold.
  stockStatus?: "OK" | "LOW" | "OUT" | "NOT_TRACKED" | null;
  unitsAvailable?: number | null;
};

// Light meals and beverages: unlimited, no extras, one tap adds one.
function isAlwaysOnOption(option: DailyMealOption): boolean {
  return option.group ? option.group !== "SET_MEALS" : option.portionsRemaining === null;
}

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
  // Set for always-on lines (light meals, beverages), which take no extras.
  alwaysOn?: boolean;
};

type OrderStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "COLLECTED" | "VOIDED" | "REFUNDED";

type PaymentMethod = "CASH" | "CARD" | "ACCOUNT";

type RefundMethod = "CASH" | "ACCOUNT_BALANCE";

type OrderAdjustmentScope = "WHOLE_ORDER" | "EXTRAS_ONLY";

type OrderAdjustmentAction = "VOID" | "REFUND" | "DISCOUNT";

// Discounts are given at checkout now; the after-payment DISCOUNT request is retired.
type AdjustmentRequestAction = "CANCEL";

type DiscountType = "PERCENTAGE" | "FIXED_AMOUNT";

type SaleDiscountReasonCode = "STAFF" | "PROMOTION" | "MANAGER_GOODWILL" | "PRICING_CORRECTION" | "OTHER";

const SALE_DISCOUNT_REASONS: Array<{ value: SaleDiscountReasonCode; label: string }> = [
  { value: "STAFF", label: "Staff" },
  { value: "PROMOTION", label: "Promotion" },
  { value: "MANAGER_GOODWILL", label: "Manager goodwill" },
  { value: "PRICING_CORRECTION", label: "Pricing correction" },
  { value: "OTHER", label: "Other" },
];

type SaleDiscount = {
  type: DiscountType;
  value: number;
  reasonCode: SaleDiscountReasonCode;
  note: string;
};

// Discount given at checkout, as returned on the order.
type OrderSaleDiscountDto = {
  type: DiscountType;
  value: number;
  amount: number;
  reasonCode: string;
  note?: string | null;
  authorizedBy?: { id: number; name: string } | null;
};

// Matches the server: percentages round half-up to the cent (R33.33 at 15% = R5.00).
function saleDiscountCents(type: DiscountType, value: number, totalCents: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (type === "FIXED_AMOUNT") return Math.round(value * 100);
  const basisPoints = Math.round(value * 100);
  return Math.floor((totalCents * basisPoints + 5000) / 10000);
}

function saleDiscountReasonLabel(code: string): string {
  return SALE_DISCOUNT_REASONS.find((reason) => reason.value === code)?.label ?? code.replaceAll("_", " ").toLowerCase();
}

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
  accountId?: number;
  // ACCOUNT payments only; absent on account orders placed before approval was required.
  authorizedBy?: { id: number; name: string } | null;
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
  preDiscountTotal?: number;
  saleDiscount?: number;
  discount?: OrderSaleDiscountDto | null;
  // COMPLIMENTARY orders take no payment: total is 0 and preDiscountTotal is the list value.
  orderKind?: OrderKind;
  complimentary?: OrderComplimentary | null;
  printFailed?: boolean;
  rungBy?: { id: number; name: string; role?: string };
  lines?: OrderLineDto[];
  adjustments?: OrderAdjustmentDto[];
  payments?: OrderPaymentDto[];
  // Kitchen first, then Bar; [] for a cold-drinks-only order.
  stations?: OrderStation[];
};

type AccountDto = {
  id: number;
  accountNumber?: string | null;
  name: string;
  department?: string | null;
  contactNumber?: string | null;
  contactEmail?: string | null;
};

type DraftPaymentEntry = {
  method: PaymentMethod;
  amount: number;
  amountTendered?: number;
  accountId?: number;
};

type OrderLineDto = {
  id: number;
  dailyMealOptionId: number;
  // NONE: a cold drink, handed over at the till.
  station?: Station;
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
  code?: string;
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

// Holds the cart across the open-new-shift detour after NO_OPEN_SHIFT. Tab-scoped on purpose.
const PENDING_CART_KEY = "pos.pendingCart";

type PaymentKeypadField = "amount" | "tendered";

const QUICK_TENDER_NOTES = [20, 50, 100, 200];

const MAX_PAYMENT_WHOLE_DIGITS = 7; // up to R9,999,999.99

// Next banknote totals a customer is likely to hand over for the given amount, e.g. R30 -> R40, R50, R100.
function getQuickTenderOptions(amountCents: number): number[] {
  if (amountCents <= 0) return [];
  const options = new Set<number>();
  for (const note of QUICK_TENDER_NOTES) {
    const noteCents = note * 100;
    const rounded = Math.ceil(amountCents / noteCents) * noteCents;
    if (rounded > amountCents) options.add(rounded);
  }
  return Array.from(options).sort((a, b) => a - b).slice(0, 3);
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
  const { shift, refetch: refetchShift } = useShift();
  const [shiftClosedWhileSelling, setShiftClosedWhileSelling] = useState(false);

  const [periods, setPeriods] = useState<MealPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<number | null>(null);

  const [menu, setMenu] = useState<MenuTodayResponse>({ options: [], availableExtras: [] });
  const [isLoadingMenu, setIsLoadingMenu] = useState(false);
  const [menuError, setMenuError] = useState<string | null>(null);
  // The Beverages tab isn't a meal period: its items come from the full till menu (no period).
  const [beveragesTab, setBeveragesTab] = useState(false);
  const [beverageOptions, setBeverageOptions] = useState<DailyMealOption[]>([]);

  const [selectedOption, setSelectedOption] = useState<DailyMealOption | null>(null);
  const [lineQty, setLineQty] = useState(1);
  const [selectedExtraQty, setSelectedExtraQty] = useState<Record<number, number>>({});

  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  // Restore a cart saved when the shift closed mid-order.
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(PENDING_CART_KEY);
      if (!saved) return;
      window.sessionStorage.removeItem(PENDING_CART_KEY);
      const lines = JSON.parse(saved) as DraftLine[];
      if (Array.isArray(lines) && lines.length > 0) setDraftLines(lines);
    } catch {
      // Storage unavailable or corrupt: start with an empty cart.
    }
  }, []);

  // "Admin" marks a sale rung up by someone other than the shift owner.
  const renderAdminChip = (order: OrderDto) =>
    order.rungBy && shift && order.rungBy.id !== shift.owner.id ? (
      <span className="ml-1.5 rounded border border-sky-400/40 bg-sky-500/15 px-1 text-[10px] font-semibold uppercase text-sky-200">
        Admin
      </span>
    ) : null;

  const renderComplimentaryBadge = () => (
    <span className="ml-1.5 inline-flex items-center gap-1 rounded border border-violet-300/40 bg-violet-500/15 px-1.5 text-[10px] font-semibold uppercase text-violet-200">
      <Gift className="h-3 w-3" aria-hidden />
      Complimentary
    </span>
  );

  // A complimentary row shows its list value, never R0.00 alone.
  const renderOrderListItem = (order: OrderDto) => {
    const complimentary = isComplimentary(order);
    return (
      <>
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-slate-100">
            #{order.orderNumber}
            {complimentary && renderComplimentaryBadge()}
          </p>
          {complimentary ? (
            <p className="text-right text-sm font-medium text-slate-200">
              {toMoney(order.preDiscountTotal ?? 0)} <span className="text-xs font-normal text-slate-400">at list price</span>
            </p>
          ) : (
            <p className="text-sm font-medium text-slate-200">{toMoney(order.total)}</p>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-400">
          {complimentary ? `${toMoney(0)} paid · ` : ""}
          {order.createdAt ? new Date(order.createdAt).toLocaleTimeString() : "Time unavailable"}
          {typeof order.printFailed === "boolean" ? ` · Print failed: ${order.printFailed ? "Yes" : "No"}` : ""}
          {renderRungBy(order)}
        </p>
        {(order.status || (order.stations ?? []).length > 0) && (
          <p className="mt-1 text-xs text-slate-400">
            {order.status ? orderStatusLabel(order.status) : ""}
            {(order.stations ?? []).map((entry) => ` · ${stationLabel(entry.station)}: ${stationStatusLabel(entry.status)}`).join("")}
          </p>
        )}
      </>
    );
  };

  const renderRungBy = (order: OrderDto) =>
    order.rungBy ? (
      <>
        {` · Rung by ${order.rungBy.name}`}
        {renderAdminChip(order)}
      </>
    ) : null;

  const openNewShiftKeepingCart = async () => {
    try {
      window.sessionStorage.setItem(PENDING_CART_KEY, JSON.stringify(draftLines));
    } catch {
      // Without storage the cart is lost, but the new shift can still open.
    }
    // Reloading the shift finds none, and the POS page redirects to the open-shift screen.
    await refetchShift();
  };

  const [showPayment, setShowPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [paymentEntries, setPaymentEntries] = useState<DraftPaymentEntry[]>([]);
  const [paymentAmountInput, setPaymentAmountInput] = useState("");
  const [cashTenderedInput, setCashTenderedInput] = useState("");
  const [isSplitAmount, setIsSplitAmount] = useState(false);
  const [activePaymentField, setActivePaymentField] = useState<PaymentKeypadField>("tendered");
  // When true, the next keypad digit replaces the prefilled value instead of appending to it.
  const [replaceOnNextKey, setReplaceOnNextKey] = useState(true);
  const [paymentEntryError, setPaymentEntryError] = useState<string | null>(null);
  const [checkoutAccounts, setCheckoutAccounts] = useState<AccountDto[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [accountSearch, setAccountSearch] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [showAccountDetails, setShowAccountDetails] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Discount at checkout: the draft being edited, and the one a manager approved.
  const [saleDiscount, setSaleDiscount] = useState<SaleDiscount | null>(null);
  const [showSaleDiscountForm, setShowSaleDiscountForm] = useState(false);
  const [saleDiscountDraftType, setSaleDiscountDraftType] = useState<DiscountType>("PERCENTAGE");
  const [saleDiscountDraftValue, setSaleDiscountDraftValue] = useState("");
  const [saleDiscountDraftReason, setSaleDiscountDraftReason] = useState<SaleDiscountReasonCode>("PROMOTION");
  const [saleDiscountDraftNote, setSaleDiscountDraftNote] = useState("");
  const [saleDiscountError, setSaleDiscountError] = useState<string | null>(null);
  // Complimentary at checkout: no payment step; a manager approves it the same way as a discount.
  const [showComplimentaryForm, setShowComplimentaryForm] = useState(false);
  const [complimentaryReason, setComplimentaryReason] = useState<ComplimentaryReasonCode | null>(null);
  const [complimentaryNote, setComplimentaryNote] = useState("");
  const [complimentaryError, setComplimentaryError] = useState<string | null>(null);
  // Kept after a 400 or a stock conflict: the order rolled back, so the approval is reused on retry.
  const [complimentaryToken, setComplimentaryToken] = useState<string | null>(null);

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

  // silent: refresh in the background (tab refocus, after an order error) without the loading placeholder.
  const loadMenuForPeriod = useCallback(
    async (periodName: string, silent = false) => {
      if (!silent) setIsLoadingMenu(true);
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

  // GET /menu/today with no period: every open period, light meals and beverages. Beverages have no period.
  const loadBeverages = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoadingMenu(true);
      setMenuError(null);
      try {
        const res = await authFetch("/menu/today");
        const payload = (await res.json().catch(() => null)) as MenuTodayResponse | null;
        if (!res.ok || !payload) {
          throw new Error(parseMessage(payload, "Unable to load beverages."));
        }
        const options = Array.isArray(payload.options) ? payload.options : [];
        setBeverageOptions(options.filter((option) => option.group === "BEVERAGES"));
      } catch (err) {
        setBeverageOptions([]);
        setMenuError(err instanceof Error ? err.message : "Unable to load beverages.");
      } finally {
        setIsLoadingMenu(false);
      }
    },
    [authFetch],
  );

  // Reloads whichever tab is showing.
  const refreshShownMenu = useCallback(
    (silent = false) => {
      if (beveragesTab) void loadBeverages(silent);
      else if (selectedPeriod) void loadMenuForPeriod(selectedPeriod.name, silent);
    },
    [beveragesTab, loadBeverages, loadMenuForPeriod, selectedPeriod],
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

  // The tiles on screen: the Beverages tab, or the selected period's menu.
  const periodOptions = useMemo(() => {
    if (beveragesTab) return beverageOptions;
    if (!selectedPeriod) return [];
    return menu.options.filter((o) => o.mealPeriodId === selectedPeriod.id || o.period?.id === selectedPeriod.id);
  }, [beveragesTab, beverageOptions, menu.options, selectedPeriod]);

  // Planned set meals keep today's tiles; always-on items are grouped into sections by category
  // (sections by category sortOrder, tiles by name). The server returns them in id order.
  const plannedPeriodOptions = useMemo(() => periodOptions.filter((o) => !isAlwaysOnOption(o)), [periodOptions]);
  const alwaysOnSections = useMemo(() => {
    const sections = new Map<string, { name: string; sortOrder: number; options: DailyMealOption[] }>();
    for (const option of periodOptions.filter(isAlwaysOnOption)) {
      const name = option.category?.name ?? "Other";
      const section = sections.get(name) ?? { name, sortOrder: option.category?.sortOrder ?? Number.MAX_SAFE_INTEGER, options: [] };
      section.options.push(option);
      sections.set(name, section);
    }
    return Array.from(sections.values())
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((section) => ({ ...section, options: [...section.options].sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [periodOptions]);

  // The till isn't pushed Out today changes: refetch when the window regains focus.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") refreshShownMenu(true);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refreshShownMenu]);

  // Light meal stock chips change with every sale: refresh about every minute while the till is visible.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshShownMenu(true);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [refreshShownMenu]);

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

  const paymentAmount = useMemo(() => parseAmountInput(paymentAmountInput), [paymentAmountInput]);
  const cashTenderedAmount = useMemo(() => parseAmountInput(cashTenderedInput), [cashTenderedInput]);

  const totalPaidCents = useMemo(
    () => paymentEntries.reduce((sum, entry) => sum + toCents(entry.amount), 0),
    [paymentEntries],
  );

  const appliedDiscountCents = saleDiscount
    ? saleDiscountCents(saleDiscount.type, saleDiscount.value, draftTotalCents)
    : 0;
  // Payments must add up to the discounted total.
  const payableCents = Math.max(0, draftTotalCents - appliedDiscountCents);
  const draftDiscountValue = Number.parseFloat(saleDiscountDraftValue);
  const draftDiscountCents = saleDiscountCents(saleDiscountDraftType, draftDiscountValue, draftTotalCents);

  const remainingToPayCents = Math.max(0, payableCents - totalPaidCents);
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
    return checkoutAccounts.filter(
      (account) =>
        account.name.toLowerCase().includes(accountSearchLower) ||
        (account.accountNumber ?? "").toLowerCase().includes(accountSearchLower),
    );
  }, [accountSearchLower, checkoutAccounts]);
  const selectedAccount = useMemo(
    () => checkoutAccounts.find((account) => account.id === selectedAccountId) ?? null,
    [checkoutAccounts, selectedAccountId],
  );

  const existingMethodSet = useMemo(
    () => new Set(paymentEntries.map((entry) => entry.method)),
    [paymentEntries],
  );

  const singlePaymentDraft = useMemo<DraftPaymentEntry | null>(() => {
    if (paymentEntries.length > 0 || remainingToPayCents <= 0) return null;

    const amount = remainingToPay;
    // A partial split amount must be added as an entry first.
    if (paymentMethod !== "ACCOUNT" && toCents(paymentAmount) !== remainingToPayCents) return null;
    if (paymentMethod === "ACCOUNT") {
      if (!selectedAccountId) return null;
      return { method: "ACCOUNT", amount, accountId: selectedAccountId };
    }

    if (paymentMethod === "CARD") {
      return { method: "CARD", amount };
    }

    if (cashTenderedAmount < amount) return null;
    return { method: "CASH", amount, amountTendered: cashTenderedAmount };
  }, [
    cashTenderedAmount,
    paymentAmount,
    paymentEntries.length,
    paymentMethod,
    remainingToPay,
    remainingToPayCents,
    selectedAccountId,
  ]);

  const canConfirmPayment =
    draftLines.length > 0 &&
    !isSubmitting &&
    ((paymentEntries.length > 0 && remainingToPayCents === 0) || singlePaymentDraft !== null);

  // One tap adds one. Always-on lines never carry extras, so repeat taps just raise the quantity.
  const addAlwaysOnOption = (option: DailyMealOption) => {
    if (option.outToday) return;
    setDraftLines((prev) => {
      const existing = prev.find((line) => line.alwaysOn && line.dailyMealOptionId === option.id);
      if (existing) {
        return prev.map((line) => (line.id === existing.id ? { ...line, quantity: line.quantity + 1, invalid: false } : line));
      }
      return [
        ...prev,
        {
          id: `${option.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          dailyMealOptionId: option.id,
          name: option.name,
          unitPrice: option.price,
          quantity: 1,
          extras: [],
          alwaysOn: true,
        },
      ];
    });
    setSubmissionError(null);
  };

  const openBuilderForOption = (option: DailyMealOption) => {
    if (isAlwaysOnOption(option)) {
      addAlwaysOnOption(option);
      return;
    }
    if ((option.portionsRemaining ?? 0) <= 0) return;
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

  const resetSaleDiscount = () => {
    setSaleDiscount(null);
    setShowSaleDiscountForm(false);
    setSaleDiscountDraftType("PERCENTAGE");
    setSaleDiscountDraftValue("");
    setSaleDiscountDraftReason("PROMOTION");
    setSaleDiscountDraftNote("");
    setSaleDiscountError(null);
  };

  // Client-side checks mirror the server rules; the server still decides.
  const validateSaleDiscountDraft = (): string | null => {
    if (!Number.isFinite(draftDiscountValue) || draftDiscountValue <= 0) return "Enter a discount greater than zero.";
    if (saleDiscountDraftType === "PERCENTAGE" && draftDiscountValue >= 100) return "A percentage discount must be below 100%.";
    if (draftDiscountCents <= 0) return "This discount works out to R0,00. Increase it.";
    if (draftDiscountCents >= draftTotalCents) return "A discount can't make the order free. It must be less than the order total.";
    if (saleDiscountDraftReason === "OTHER" && !saleDiscountDraftNote.trim()) return "A note is required when the reason is Other.";
    return null;
  };

  const applySaleDiscount = () => {
    const error = validateSaleDiscountDraft();
    if (error) {
      setSaleDiscountError(error);
      return;
    }
    const approved: SaleDiscount = {
      type: saleDiscountDraftType,
      value: draftDiscountValue,
      reasonCode: saleDiscountDraftReason,
      note: saleDiscountDraftNote.trim(),
    };
    // Every discount needs a manager PIN, even for an admin at the till.
    requestManagementSession(
      () => {
        setSaleDiscount(approved);
        setShowSaleDiscountForm(false);
        setSaleDiscountError(null);
      },
      {
        title: "Manager PIN Required",
        description: "Enter a manager PIN to approve this discount.",
        submitLabel: "Approve Discount",
      },
    );
  };

  const resetComplimentary = () => {
    setShowComplimentaryForm(false);
    setComplimentaryReason(null);
    setComplimentaryNote("");
    setComplimentaryError(null);
    setComplimentaryToken(null);
  };

  const closePaymentStep = () => {
    resetSaleDiscount();
    setShowPayment(false);
    setPaymentEntries([]);
    setPaymentAmountInput("");
    setCashTenderedInput("");
    setPaymentEntryError(null);
    setAccountsError(null);
    setAccountSearch("");
    setSelectedAccountId(null);
  };

  // Complimentary and discount are exclusive, and a complimentary order has no payment step.
  const openComplimentaryForm = () => {
    if (draftLines.length === 0 || saleDiscount) return;
    closePaymentStep();
    setSubmissionError(null);
    setComplimentaryError(null);
    setShowComplimentaryForm(true);
  };

  const clearDraft = () => {
    resetSaleDiscount();
    resetComplimentary();
    setDraftLines([]);
    setSubmissionError(null);
    setShowPayment(false);
    setPaymentMethod("CASH");
    setPaymentEntries([]);
    setPaymentAmountInput("");
    setCashTenderedInput("");
    setPaymentEntryError(null);
    setAccountsError(null);
    setAccountSearch("");
    setSelectedAccountId(null);
  };

  const resetPaymentEditor = useCallback(
    (nextAmountCents?: number) => {
      const amountCents = Math.max(0, nextAmountCents ?? remainingToPayCents);
      setPaymentAmountInput(centsToAmountInput(amountCents));
      setCashTenderedInput(centsToAmountInput(amountCents));
      setIsSplitAmount(false);
      setActivePaymentField("tendered");
      setReplaceOnNextKey(true);
      setPaymentEntryError(null);
    },
    [remainingToPayCents],
  );

  // Cash edits tendered unless splitting; card only has an amount to edit.
  const keypadField: PaymentKeypadField =
    paymentMethod === "CARD" ? "amount" : isSplitAmount ? activePaymentField : "tendered";
  const keypadValue = keypadField === "amount" ? paymentAmountInput : cashTenderedInput;
  const showPaymentKeypad = paymentMethod === "CASH" || (paymentMethod === "CARD" && isSplitAmount);
  const changeDueCents = toCents(cashTenderedAmount) - toCents(paymentAmount);
  const quickTenderOptions = useMemo(() => getQuickTenderOptions(toCents(paymentAmount)), [paymentAmount]);

  // The keypad edits an empty value while the prefill is pending, so the first key starts a fresh
  // amount (backspace clears it).
  const handleKeypadChange = (next: string) => {
    if (replaceOnNextKey) setReplaceOnNextKey(false);
    if (keypadField === "amount") {
      setPaymentAmountInput(next);
    } else {
      setCashTenderedInput(next);
    }
    setPaymentEntryError(null);
  };

  const selectPaymentField = (field: PaymentKeypadField) => {
    setActivePaymentField(field);
    setReplaceOnNextKey(true);
  };

  const toggleSplitAmount = () => {
    if (isSplitAmount) {
      setPaymentAmountInput(centsToAmountInput(remainingToPayCents));
      setActivePaymentField("tendered");
    } else {
      setActivePaymentField("amount");
    }
    setIsSplitAmount(!isSplitAmount);
    setReplaceOnNextKey(true);
    setPaymentEntryError(null);
  };

  const setTenderedCents = (cents: number) => {
    setCashTenderedInput(centsToAmountInput(cents));
    setActivePaymentField("tendered");
    setReplaceOnNextKey(true);
    setPaymentEntryError(null);
  };

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
      // No default: the cashier must pick the account. Keep a pick only if it is still active.
      setSelectedAccountId((current) => (current && body.some((account) => account.id === current) ? current : null));
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
      setPaymentEntries((prev) => [
        ...prev,
        {
          method: "CARD",
          amount,
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

  const buildLinesPayload = () =>
    draftLines.map((line) => ({
      dailyMealOptionId: line.dailyMealOptionId,
      quantity: line.quantity,
      extras: line.extras.map((ex) => ({
        dailyComponentStockId: ex.dailyComponentStockId,
        quantity: ex.quantity,
      })),
    }));

  // After POST /orders succeeds, sale or complimentary: clear checkout and show the receipt.
  const finishOrder = async (order: OrderDto) => {
    setCompletedOrderId(order.id);
    setCompletedOrder(order);
    setReceiptOrder(null);
    setReceiptError(null);
    resetSaleDiscount();
    resetComplimentary();
    setDraftLines([]);
    setShowPayment(false);
    setPaymentMethod("CASH");
    setPaymentEntries([]);
    setPaymentAmountInput("");
    setCashTenderedInput("");
    setPaymentEntryError(null);
    setAccountSearch("");
    await loadOrderReceipt(order.id);
    await loadTodayOrders();
    await loadMenuForPeriod(selectedPeriod?.name ?? "");
  };

  // 400 ITEM_UNAVAILABLE ("'Beef Burger' is not available right now."): the message names the item but not its id.
  // Drop the named line, and any always-on line that is now out today or off the menu; keep the rest of the cart.
  const handleItemUnavailable = async (serverMessage: string) => {
    const namedItem = /'([^']+)'/.exec(serverMessage)?.[1]?.toLowerCase();

    // The full till menu (no period) covers lines from every tab.
    let onSale: Map<number, DailyMealOption> | null = null;
    try {
      const res = await authFetch("/menu/today");
      const body = (await res.json().catch(() => null)) as MenuTodayResponse | null;
      if (res.ok && body && Array.isArray(body.options)) onSale = new Map(body.options.map((option) => [option.id, option]));
    } catch {
      // Fall back to the name in the message.
    }

    const removedNames: string[] = [];
    const keptLines = draftLines.filter((line) => {
      const option = onSale?.get(line.dailyMealOptionId);
      // Set-meal lines are only dropped by name: the full menu may leave out a period that isn't open right now.
      const unavailable =
        line.name.toLowerCase() === namedItem || (line.alwaysOn === true && onSale !== null && (!option || option.outToday === true));
      if (unavailable) removedNames.push(line.name);
      return !unavailable;
    });

    setDraftLines(keptLines);
    // The total changed, so payment starts again; the discount stays.
    setShowPayment(false);
    setPaymentEntries([]);
    setPaymentAmountInput("");
    setCashTenderedInput("");
    setPaymentEntryError(null);
    refreshShownMenu(true);

    const names = Array.from(new Set(removedNames));
    setSubmissionError(
      names.length > 0
        ? `${names.join(", ")} ${names.length === 1 ? "is" : "are"} out today and ${names.length === 1 ? "was" : "were"} removed. ${keptLines.length > 0 ? "The rest of the order is kept: check it and charge again." : ""}`.trim()
        : serverMessage,
    );
  };

  // approvalSessionToken: the manager session approving a discount and/or an account charge.
  // It is a session token, so one PIN covers both and a rejected order doesn't use it up.
  const submitOrder = async (approvalSessionToken?: string) => {
    if (!canConfirmPayment) return;

    const paymentsForSubmit = paymentEntries.length > 0 ? paymentEntries : singlePaymentDraft ? [singlePaymentDraft] : [];
    if (paymentsForSubmit.length === 0) {
      setSubmissionError("Add a valid payment before confirming.");
      return;
    }

    const chargesAccount = paymentsForSubmit.some((entry) => entry.method === "ACCOUNT");
    const approvalPrompt = {
      title: "Manager PIN Required",
      description:
        saleDiscount && chargesAccount
          ? "Enter an admin PIN to approve this discount and the account charge."
          : chargesAccount
            ? `Enter an admin PIN to approve charging ${toMoney(remainingToPay)} to ${getAccountName(paymentsForSubmit.find((entry) => entry.method === "ACCOUNT")?.accountId) ?? "this account"}.`
            : "Enter an admin PIN to approve this discount.",
      submitLabel: "Approve & Charge",
    };

    if ((saleDiscount || chargesAccount) && !approvalSessionToken) {
      if (saleDiscount && (appliedDiscountCents <= 0 || appliedDiscountCents >= draftTotalCents)) {
        setSaleDiscountError("A discount can't make the order free. It must be less than the order total.");
        return;
      }
      // Reuses an active management session, or asks for the PIN if it has expired.
      requestManagementSession((token) => void submitOrder(token), approvalPrompt);
      return;
    }

    setIsSubmitting(true);
    setSubmissionError(null);

    const payload: Record<string, unknown> = {
      payments: paymentsForSubmit.map((entry) => ({
        method: entry.method,
        amount: entry.amount,
        amountTendered: entry.amountTendered,
        accountId: entry.accountId,
        ...(entry.method === "ACCOUNT" && approvalSessionToken
          ? { authorization: { sessionToken: approvalSessionToken } }
          : {}),
      })),
      lines: buildLinesPayload(),
    };

    if (saleDiscount && approvalSessionToken) {
      payload.discount = {
        type: saleDiscount.type,
        value: saleDiscount.value,
        reasonCode: saleDiscount.reasonCode,
        note: saleDiscount.note || null,
        authorization: { sessionToken: approvalSessionToken },
      };
    }

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
        // Shift errors share 409 with stock conflicts, so branch on code first.
        const errorCode = (body as ApiErrorPayload | null)?.code;
        if (errorCode === "NO_OPEN_SHIFT") {
          // Keep the cart so the order can be completed on a new shift.
          setShiftClosedWhileSelling(true);
          return;
        }
        if (errorCode === "TILL_IN_USE") {
          // Reloading the shift shows the "Till in use" screen.
          await refetchShift();
          return;
        }
        if (errorCode === "AUTHORIZATION_INVALID") {
          // No order was created. Ask for the PIN again and resubmit the same cart.
          invalidateManagementSession();
          setSubmissionError("The manager approval was rejected or has expired. Enter an admin PIN again to charge.");
          requestManagementSession((token) => void submitOrder(token), approvalPrompt);
          return;
        }
        if (errorCode === "ACCOUNT_PAYMENT_INVALID") {
          throw new Error(parseMessage(body, "The account payment was refused. Check the account and try again."));
        }
        if (errorCode === "ITEM_UNAVAILABLE") {
          await handleItemUnavailable(parseMessage(body, "An item is not available right now."));
          return;
        }
        if (errorCode === "EXTRAS_NOT_ALLOWED") {
          throw new Error(parseMessage(body, "Extras can't be added to light meals or beverages. Remove them and try again."));
        }
        if (errorCode === "DISCOUNT_INVALID" || errorCode === "DISCOUNT_TOO_LARGE") {
          setSaleDiscountError(parseMessage(body, "This discount isn't allowed. Change or remove it."));
          throw new Error("The discount was refused. Change or remove it, then charge again.");
        }

        if (res.status === 409) {
          applyConflictFeedback(body);
          await loadMenuForPeriod(selectedPeriod?.name ?? "");
          throw new Error(parseMessage(body, "Stock changed while creating the order. Adjust and retry."));
        }

        throw new Error(parseMessage(body, "Order submission failed."));
      }

      await finishOrder(body as OrderDto);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Order submission failed.";
      setSubmissionError(msg);
      // Out today changes aren't pushed to the till: refresh the menu after any order error.
      refreshShownMenu(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  // A complimentary order: lines and the manager's approval, never payments or a discount.
  const submitComplimentary = async (sessionToken: string) => {
    if (draftLines.length === 0 || !complimentaryReason) return;

    setIsSubmitting(true);
    setSubmissionError(null);
    setComplimentaryError(null);

    const payload = {
      lines: buildLinesPayload(),
      complimentary: {
        reasonCode: complimentaryReason,
        note: complimentaryNote.trim() || undefined,
        authorization: { sessionToken },
      },
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
        const errorCode = (body as ApiErrorPayload | null)?.code;
        if (errorCode === "NO_OPEN_SHIFT") {
          setShiftClosedWhileSelling(true);
          return;
        }
        if (errorCode === "TILL_IN_USE") {
          await refetchShift();
          return;
        }
        if (errorCode === "AUTHORIZATION_INVALID" || res.status === 401) {
          // Bad, expired or already used: drop it and ask for a new PIN.
          invalidateManagementSession();
          setComplimentaryToken(null);
          setComplimentaryError("Manager approval failed. Enter the PIN again.");
          requestManagementSession((token) => void submitComplimentary(token), {
            title: "Manager PIN Required",
            description: "Manager approval failed. Enter the PIN again.",
            submitLabel: "Approve Complimentary",
          });
          return;
        }
        if (errorCode === "ITEM_UNAVAILABLE") {
          // The order rolled back, so the approval is still valid for the trimmed cart.
          setComplimentaryToken(sessionToken);
          await handleItemUnavailable(parseMessage(body, "An item is not available right now."));
          return;
        }
        if (errorCode === "COMPLIMENTARY_INVALID") {
          // The approval wasn't used: keep it while the cashier fixes the form.
          setComplimentaryToken(sessionToken);
          setComplimentaryError(parseMessage(body, "This complimentary order isn't allowed. Check the reason and note."));
          return;
        }
        if (res.status === 409) {
          // The order rolled back, so the approval is still valid: retry after fixing the cart, no new PIN.
          setComplimentaryToken(sessionToken);
          applyConflictFeedback(body);
          await loadMenuForPeriod(selectedPeriod?.name ?? "");
          setComplimentaryError(parseMessage(body, "Stock changed while creating the order. Adjust and retry."));
          return;
        }
        throw new Error(parseMessage(body, "Order submission failed."));
      }

      await finishOrder(body as OrderDto);
    } catch (err) {
      setComplimentaryError(err instanceof Error ? err.message : "Order submission failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const complimentaryFormError = (): string | null => {
    if (!complimentaryReason) return "Choose a reason.";
    if (complimentaryReason === "OTHER" && !complimentaryNote.trim()) return "A note is required when the reason is Other.";
    return null;
  };

  const confirmComplimentary = () => {
    if (draftLines.length === 0 || saleDiscount || isSubmitting) return;
    const error = complimentaryFormError();
    if (error) {
      setComplimentaryError(error);
      return;
    }
    if (complimentaryToken) {
      void submitComplimentary(complimentaryToken);
      return;
    }
    // Reuses an open management session, or asks for a manager PIN.
    requestManagementSession((token) => void submitComplimentary(token), {
      title: "Manager PIN Required",
      description: `Enter a manager PIN to give away ${toMoney(draftTotal)}. No payment is taken.`,
      submitLabel: "Approve Complimentary",
    });
  };

  const beginAdjustment = (scope: OrderAdjustmentScope) => {
    setRequestedAction("CANCEL");
    setAdjustmentScope(scope);
    setShowAdjustmentForm(true);
    setAdjustmentFormError(null);
    setAdjustmentError(null);
    setAdjustmentSuccess(null);
  };

  const submitOrderAdjustment = useCallback(
    async (order: OrderDto, sessionToken: string) => {
      if (!requestedAction) return;

      setIsApplyingAdjustment(true);
      setAdjustmentError(null);

      try {
        const payload: Record<string, unknown> = {
          requestedAction,
          reasonCode: adjustmentReasonCode,
          note: adjustmentNote.trim() || undefined,
          sessionToken,
          scope: adjustmentScope,
        };

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
          const errorCode = (adjustmentBody as ApiErrorPayload | null)?.code;

          if (errorCode === "DISCOUNTED_ORDER_NOT_REFUNDABLE") {
            setShowAdjustmentForm(false);
            setAdjustmentError("This order was discounted at sale, so it can't be refunded or have extras removed.");
            return;
          }

          if (errorCode === "COMPLIMENTARY_ORDER_NOT_REFUNDABLE") {
            setShowAdjustmentForm(false);
            setAdjustmentError("This complimentary order can't be refunded or have extras removed. It can only be voided while pending.");
            return;
          }

          // AUTHORIZATION_INVALID (or an older 401): the management session is no good; ask for the PIN again.
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

          if (errorCode === "NO_OPEN_SHIFT") {
            setShowAdjustmentForm(false);
            setAdjustmentError("The shift was closed. Open a new one to continue.");
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
        const usesCard = (order.payments ?? []).some((payment) => payment.method === "CARD");

        const payoutInstruction =
          recent?.refundMethod === "ACCOUNT_BALANCE"
            ? `Credited to ${getAccountName(recent.accountId) ?? "linked account"} - no cash or card action needed.`
            : `Hand back ${toMoney(amount)} in cash.${usesCard ? " Originally paid by card - refund is cash." : ""}`;

        if (isComplimentary(order)) {
          // Nothing was paid, so nothing is paid back; only the stock returns.
          const portionsReturned = getTotalMealPortions(order);
          const extraUnitsReturned = getUnadjustedExtraUnits(order);
          const extraSuffix = extraUnitsReturned > 0 ? ` and ${extraUnitsReturned} extra units` : "";
          setAdjustmentSuccess(`Voided · no refund. ${portionsReturned} portions${extraSuffix} returned to today's stock.`);
        } else if (action === "VOID") {
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

      setAdjustmentFormError(null);

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
    const shownStations = shownOrder.stations ?? [];
    const routing = [
      shownStations.some((entry) => entry.station === "KITCHEN") ? "Meals → Kitchen" : null,
      shownStations.some((entry) => entry.station === "BAR") ? "Drinks → Bar" : null,
    ].filter((entry): entry is string => entry !== null);
    const handOverLines = (shownOrder.lines ?? []).filter((line) => line.station === "NONE");
    // Void only while every station is still Pending; after that the server takes the refund path.
    const voidable = shownOrder.status === "PENDING";
    // A discounted sale can only be voided while PENDING; refunds and removing extras are refused.
    const discountedAtSale = (shownOrder.saleDiscount ?? 0) > 0;
    // A complimentary order can only be voided, and only while PENDING. Refund and Remove extras are never offered.
    const complimentaryOrder = isComplimentary(shownOrder);
    const canCancelOrder = complimentaryOrder || discountedAtSale ? shownOrder.status === "PENDING" : true;
    const canRemoveExtras = !complimentaryOrder && !discountedAtSale && hasAnyUnadjustedExtras(shownOrder);
    const showManagementActions = !terminalOrder && (!complimentaryOrder || canCancelOrder);
    const managementReady = managementSessionActive && Boolean(managementSessionToken);
    const selectedActionLabel = complimentaryOrder
      ? "Void Order"
      : adjustmentScope === "WHOLE_ORDER"
        ? voidable ? "Void Order" : "Refund Order"
        : "Remove Extras";
    return (
      <>
      <main className="grid flex-1 grid-cols-1 gap-4 p-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-8">
          {complimentaryOrder ? (
            <div className="flex items-center gap-2 text-violet-200">
              <Gift className="h-5 w-5" />
              <p className="text-sm font-semibold uppercase tracking-wider">Complimentary</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-emerald-300">
              <CheckCircle2 className="h-5 w-5" />
              <p className="text-sm font-semibold uppercase tracking-wider">Payment Confirmed</p>
            </div>
          )}

          <p className="mt-6 text-sm text-emerald-200/90">Order Number</p>
          <p className="text-7xl font-black text-white">#{shownOrder.orderNumber}</p>

          {complimentaryOrder ? (
            <>
              <p className="mt-6 text-sm text-emerald-200/90">Amount Due</p>
              <p className="text-6xl font-black text-white">{toMoney(0)}</p>
              <p className="mt-1 text-sm text-violet-200">List value {toMoney(shownOrder.preDiscountTotal ?? 0)} · no payment</p>
            </>
          ) : shownChangeDue > 0 ? (
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

          {/* Where each part of the order goes. A cold-drinks-only order is COLLECTED at once with no stations. */}
          {shownOrder.status === "COLLECTED" && shownStations.length === 0 ? (
            <p className="mt-6 inline-flex rounded-xl bg-sky-400 px-4 py-2 text-2xl font-black text-slate-900">Ready now</p>
          ) : (routing.length > 0 || handOverLines.length > 0) && (
            <div className="mt-6 space-y-1 rounded-xl border border-emerald-200/30 bg-slate-950/30 p-3 text-base font-semibold text-white">
              {routing.length > 0 && <p>{routing.join(" · ")}</p>}
              {handOverLines.length > 0 && (
                <p className="text-sky-200">
                  Hand over now: {handOverLines.map((line) => (line.quantity > 1 ? `${line.quantity} × ${line.name}` : line.name)).join(", ")}
                </p>
              )}
            </div>
          )}

          <div className="mt-8 grid gap-2 text-sm text-emerald-100">
            {shownOrder.status && <p>Status: {orderStatusLabel(shownOrder.status)}</p>}
            {shownStations.length > 0 && (
              <p className="flex flex-wrap gap-1.5">
                {shownStations.map((entry) => (
                  <span
                    key={entry.station}
                    className="rounded-full border border-emerald-200/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold"
                    title={entry.updatedBy ? `Updated by ${entry.updatedBy.name}` : undefined}
                  >
                    {stationLabel(entry.station)}: {stationStatusLabel(entry.status)}
                  </span>
                ))}
              </p>
            )}
            {complimentaryOrder ? (
              shownOrder.complimentary && (
                <>
                  <p>Reason: {complimentaryReasonLabel(shownOrder.complimentary.reasonCode)}</p>
                  {shownOrder.complimentary.note && <p>Note: {shownOrder.complimentary.note}</p>}
                  <p>Approved by {shownOrder.complimentary.authorizedBy.name}</p>
                </>
              )
            ) : (
              <>
                <p>Subtotal: {toMoney(shownOrder.subtotal)}</p>
                {(shownOrder.saleDiscount ?? 0) > 0 ? (
                  <>
                    {typeof shownOrder.preDiscountTotal === "number" && (
                      <p>Total before discount: {toMoney(shownOrder.preDiscountTotal)}</p>
                    )}
                    <p>
                      Discount
                      {shownOrder.discount
                        ? ` (${shownOrder.discount.type === "PERCENTAGE" ? `${shownOrder.discount.value}%` : "fixed"} · ${saleDiscountReasonLabel(shownOrder.discount.reasonCode)})`
                        : ""}
                      : −{toMoney(shownOrder.saleDiscount ?? 0)}
                    </p>
                    {shownOrder.discount?.authorizedBy && <p>Discount approved by: {shownOrder.discount.authorizedBy.name}</p>}
                    {typeof shownOrder.originalTotal === "number" && (
                      <p className="font-semibold">Amount paid: {toMoney(shownOrder.originalTotal)}</p>
                    )}
                  </>
                ) : (
                  typeof shownOrder.originalTotal === "number" && <p>Amount paid: {toMoney(shownOrder.originalTotal)}</p>
                )}
                {(typeof shownOrder.originalTotal !== "number" || toCents(shownOrder.originalTotal) !== toCents(shownOrder.total)) && (
                  <p>Total after adjustments: {toMoney(shownOrder.total)}</p>
                )}
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
                          {payment.method === "ACCOUNT" && payment.authorizedBy && (
                            <p>Approved by {payment.authorizedBy.name}</p>
                          )}
                          {payment.method === "CASH" && typeof payment.amountTendered === "number" && (
                            <p>Tendered: {toMoney(payment.amountTendered)}{payment.changeDue ? ` · Change ${toMoney(payment.changeDue)}` : ""}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            {shownOrder.rungBy && <p>Rung by: {shownOrder.rungBy.name}{renderAdminChip(shownOrder)}</p>}
            {typeof shownOrder.printFailed === "boolean" && (
              <p>Print Failed: {shownOrder.printFailed ? "Yes" : "No"}</p>
            )}
          </div>

          {recentAdjustment && (recentAdjustment.action === "REFUND" || recentAdjustment.action === "VOID" || recentAdjustment.action === "DISCOUNT") && (
            <div className="mt-4 rounded-xl border border-amber-300/30 bg-amber-500/10 p-3 text-sm text-amber-100">
              {complimentaryOrder ? (
                <p className="font-semibold">Voided · no refund</p>
              ) : recentAdjustment.refundMethod === "ACCOUNT_BALANCE" ? (
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
                {complimentaryOrder && (
                  <div className="space-y-1 border-t border-emerald-200/20 pt-2">
                    <p className="text-center text-xs font-bold uppercase tracking-widest text-violet-200">Complimentary</p>
                    <div className="flex justify-between gap-2">
                      <p>List value</p>
                      <p>{toMoney(shownOrder.preDiscountTotal ?? 0)}</p>
                    </div>
                    <div className="flex justify-between gap-2 font-semibold">
                      <p>Amount due</p>
                      <p>{toMoney(0)}</p>
                    </div>
                    {shownOrder.complimentary && (
                      <p className="text-xs text-emerald-100/85">
                        {complimentaryReasonLabel(shownOrder.complimentary.reasonCode)}
                        {shownOrder.complimentary.note ? ` · ${shownOrder.complimentary.note}` : ""}
                        {` · Approved by ${shownOrder.complimentary.authorizedBy.name}`}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {showManagementActions && (
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
                  disabled={!canCancelOrder}
                  onClick={() => beginAdjustment("WHOLE_ORDER")}
                  className="rounded-lg border border-rose-300/40 bg-rose-500/20 px-3 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {complimentaryOrder || voidable ? "Void Order" : "Refund Order"}
                </button>
                {!complimentaryOrder && (
                  <button
                    type="button"
                    disabled={!canRemoveExtras}
                    onClick={() => beginAdjustment("EXTRAS_ONLY")}
                    className="rounded-lg border border-amber-200/40 bg-amber-500/20 px-3 py-2 text-sm font-semibold text-amber-50 hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Remove Extras
                  </button>
                )}
              </div>

              {complimentaryOrder ? (
                <p className="mt-2 text-xs text-amber-100/80">
                  Complimentary order: it can be voided while pending and its stock goes back. It can&apos;t be refunded or
                  have extras removed.
                </p>
              ) : discountedAtSale ? (
                <p className="mt-2 text-xs text-amber-100/80">
                  This order was discounted at sale, so it can&apos;t be refunded or have extras removed.
                  {canCancelOrder ? " It can still be cancelled while pending." : ""}
                </p>
              ) : (
                !canRemoveExtras && (
                  <p className="mt-2 text-xs text-amber-100/80">
                    Remove Extras is unavailable because this order has no removable extras.
                  </p>
                )
              )}

              {showAdjustmentForm && (
                <div className="mt-4 rounded-xl border border-amber-300/30 bg-slate-950/50 p-4">
                  <p className="text-sm font-semibold text-white">{selectedActionLabel}</p>
                  {complimentaryOrder && (
                    <p className="mt-1 text-sm text-amber-100">Void this complimentary order? No money is paid back.</p>
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
                  {renderOrderListItem(order)}
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
      <main className="grid flex-1 grid-cols-1 gap-4 p-4 xl:grid-cols-2">
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
              const isActive = !beveragesTab && period.id === selectedPeriodId;
              return (
                <button
                  key={period.id}
                  type="button"
                  onClick={() => {
                    if (beveragesTab && period.id === selectedPeriodId) void loadMenuForPeriod(period.name);
                    setBeveragesTab(false);
                    setSelectedPeriodId(period.id);
                  }}
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
              onClick={() => {
                setBeveragesTab(true);
                setSelectedOption(null);
                void loadBeverages();
              }}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                beveragesTab
                  ? "bg-emerald-500 text-white"
                  : "border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              Beverages
            </button>
            <button
              type="button"
              onClick={() => refreshShownMenu()}
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
          <p className="text-sm text-slate-400">
            {beveragesTab
              ? "No beverages are on sale right now. They're added in Catalogue Management."
              : selectedPeriod?.plannable === false
              ? "Nothing is on sale in this period right now. Items are added in Catalogue Management."
              : "No meals are ready for sale in this period yet. They appear once the kitchen records actual portions on the Daily Planning page."}
          </p>
        ) : (
          <>
          {plannedPeriodOptions.length > 0 && (
          <>
            <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400" aria-label="Stock colours">
              <li className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded border border-emerald-400/40 bg-emerald-500/30" aria-hidden />
                Available
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded border border-amber-400/60 bg-amber-500/40" aria-hidden />
                Low stock ({LOW_STOCK_THRESHOLD} or fewer left)
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded border border-slate-700 bg-slate-800/60" aria-hidden />
                Sold out
              </li>
            </ul>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {plannedPeriodOptions.map((option) => {
                const remaining = option.portionsRemaining ?? 0;
                const soldOut = remaining <= 0;
                const lowStock = remaining > 0 && remaining <= LOW_STOCK_THRESHOLD;
                // The card's colour shows its stock: green good, amber low, slate sold out.
                const stockStyle = soldOut
                  ? { card: "cursor-not-allowed border-slate-700 bg-slate-800/40 text-slate-500", remaining: "text-slate-500" }
                  : lowStock
                    ? {
                        card: "border-amber-400/60 bg-amber-500/15 text-slate-100 hover:border-amber-300 hover:bg-amber-500/25",
                        remaining: "font-semibold text-amber-300",
                      }
                    : {
                        card: "border-emerald-400/40 bg-emerald-500/10 text-slate-100 hover:border-emerald-300/70 hover:bg-emerald-500/20",
                        remaining: "text-emerald-300",
                      };
  
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={soldOut}
                    onClick={() => openBuilderForOption(option)}
                    className={`rounded-2xl border p-4 text-left transition ${stockStyle.card}`}
                  >
                    <p className="text-base font-semibold">{option.name}</p>
                    {option.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-slate-400">{option.description}</p>
                    )}
                    <div className="mt-4 flex items-end justify-between gap-2">
                      <p className="text-2xl font-black">{toMoney(option.price)}</p>
                      {/* Text as well as colour, so the state never depends on colour alone. */}
                      <p className={`text-right text-xs ${stockStyle.remaining}`}>
                        {soldOut ? "Sold out" : lowStock ? `Low · ${remaining} left` : `${remaining} left`}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
          )}

          {alwaysOnSections.map((section) => (
            <section key={section.name} className="mt-4 first:mt-0">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{section.name}</h3>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {section.options.map((option) => {
                  const out = Boolean(option.outToday);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={out}
                      onClick={() => addAlwaysOnOption(option)}
                      className={`rounded-2xl border p-4 text-left transition active:scale-[0.98] ${
                        out
                          ? "cursor-not-allowed border-slate-700 bg-slate-800/40 text-slate-500"
                          : "border-sky-400/40 bg-sky-500/10 text-slate-100 hover:border-sky-300/70 hover:bg-sky-500/20"
                      }`}
                    >
                      <p className="text-base font-semibold">{option.name}</p>
                      <div className="mt-4 flex items-end justify-between gap-2">
                        <p className="text-2xl font-black">{toMoney(option.price)}</p>
                        {out ? (
                          <span className="rounded-full border border-slate-600 px-2 py-0.5 text-xs font-semibold uppercase text-slate-400">
                            Out
                          </span>
                        ) : option.stockStatus === "LOW" ? (
                          <span className="rounded-full border border-amber-400/60 bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300">
                            Low
                          </span>
                        ) : option.stockStatus === "OUT" ? (
                          <span className="rounded-full border border-rose-400/60 bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-300">
                            No stock
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          </>
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
                <p className="text-xs text-slate-400">No extras are ready for sale in this period.</p>
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

        {shiftClosedWhileSelling && (
          <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100">
            <p className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              The shift was closed. Open a new one to continue. Your cart has been kept.
            </p>
            <button
              type="button"
              onClick={() => void openNewShiftKeepingCart()}
              className="mt-2 rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-amber-300"
            >
              Open New Shift
            </button>
          </div>
        )}

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
          {saleDiscount ? (
            <>
              <div className="flex justify-between text-slate-300">
                <span>Total before discount</span>
                <span>{toMoney(draftTotal)}</span>
              </div>
              <div className="flex justify-between text-amber-200">
                <span>
                  Discount ({saleDiscount.type === "PERCENTAGE" ? `${saleDiscount.value}%` : "fixed"} ·{" "}
                  {saleDiscountReasonLabel(saleDiscount.reasonCode)})
                </span>
                <span>−{toMoney(appliedDiscountCents / 100)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold text-white">
                <span>To pay</span>
                <span>{toMoney(payableCents / 100)}</span>
              </div>
            </>
          ) : (
            <div className="flex justify-between text-lg font-bold text-white">
              <span>Total</span>
              <span>{toMoney(draftTotal)}</span>
            </div>
          )}
        </div>

        {showComplimentaryForm ? (
          <div className="mt-4 space-y-3 rounded-xl border border-violet-300/40 bg-slate-950/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-violet-200">Complimentary (manager PIN required)</p>
            <div>
              <p className="text-xs font-medium text-slate-200">Reason (required)</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {COMPLIMENTARY_REASONS.map((reason) => (
                  <button
                    key={reason.value}
                    type="button"
                    aria-pressed={complimentaryReason === reason.value}
                    onClick={() => {
                      setComplimentaryReason(reason.value);
                      setComplimentaryError(null);
                    }}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                      complimentaryReason === reason.value
                        ? "border-violet-300 bg-violet-500/20 text-violet-50"
                        : "border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    {reason.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="complimentary-note" className="text-xs font-medium text-slate-200">
                Note {complimentaryReason === "OTHER" ? "(required)" : "(optional)"}
              </label>
              <Input
                id="complimentary-note"
                value={complimentaryNote}
                onChange={(event) => {
                  setComplimentaryNote(event.target.value);
                  setComplimentaryError(null);
                }}
                className="mt-1 border-slate-700 bg-slate-950 text-slate-100"
              />
            </div>
            <div className="rounded-md border border-violet-300/30 bg-violet-500/10 p-3">
              <p className="text-lg font-bold text-white">{toMoney(draftTotal)} given away · no payment</p>
              <p className="mt-1 text-xs text-violet-100/80">
                The kitchen gets this order as normal and it uses stock. It&apos;s recorded at list price.
              </p>
            </div>
            {complimentaryToken && (
              <p className="text-xs text-violet-100/80">Manager approval kept. Fix the order and confirm again; no new PIN is needed.</p>
            )}
            {complimentaryError && <p className="text-xs text-rose-200">{complimentaryError}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={resetComplimentary}
                className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting || draftLines.length === 0 || complimentaryFormError() !== null}
                onClick={confirmComplimentary}
                className="rounded-lg bg-violet-500 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:bg-slate-700"
              >
                {isSubmitting
                  ? "Sending..."
                  : complimentaryToken || (managementSessionActive && managementSessionToken)
                    ? `Give away ${toMoney(draftTotal)}`
                    : "Approve with PIN"}
              </button>
            </div>
          </div>
        ) : !showPayment ? (
          // Charge keeps most of the row; Complimentary is visible but smaller so it isn't hit by accident.
          <div className="mt-4 grid grid-cols-[3fr_1fr] gap-2">
            <button
              type="button"
              disabled={draftLines.length === 0}
              onClick={() => {
                setShowPayment(true);
                setSubmissionError(null);
                setPaymentEntryError(null);
                resetPaymentEditor(payableCents);
              }}
              className="rounded-xl bg-emerald-500 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              Charge
            </button>
            <button
              type="button"
              disabled={draftLines.length === 0}
              onClick={openComplimentaryForm}
              className="inline-flex flex-col items-center justify-center gap-0.5 rounded-xl bg-violet-600 px-2 py-2 text-xs font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              <Gift className="h-4 w-4" aria-hidden />
              Complimentary
            </button>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-emerald-500/40 bg-slate-950/60 p-3">
            <div className="mb-3 rounded-lg border border-emerald-300/25 bg-emerald-500/10 p-3 text-sm text-emerald-100">
              <p className="font-semibold">Remaining to pay: {toMoney(remainingToPay)}</p>
              <p className="text-xs text-emerald-100/80">Confirm payment is enabled only when this reaches zero.</p>
            </div>

            {saleDiscount ? (
              <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-amber-300/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                <div>
                  <p className="font-semibold">Discount approved: −{toMoney(appliedDiscountCents / 100)}</p>
                  <p className="text-xs text-amber-100/80">
                    {saleDiscount.type === "PERCENTAGE" ? `${saleDiscount.value}%` : "Fixed amount"} ·{" "}
                    {saleDiscountReasonLabel(saleDiscount.reasonCode)}
                    {saleDiscount.note ? ` · ${saleDiscount.note}` : ""}
                  </p>
                  {saleDiscountError && <p className="mt-1 text-xs text-rose-200">{saleDiscountError}</p>}
                </div>
                {paymentEntries.length === 0 && (
                  <button
                    type="button"
                    onClick={resetSaleDiscount}
                    className="shrink-0 rounded border border-rose-400/40 px-2 py-1 text-xs text-rose-200 hover:bg-rose-500/10"
                  >
                    Remove
                  </button>
                )}
              </div>
            ) : showSaleDiscountForm ? (
              <div className="mb-3 space-y-3 rounded-lg border border-amber-300/30 bg-slate-900/70 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-amber-200">Discount (manager PIN required)</p>
                <div className="flex gap-2">
                  {(["PERCENTAGE", "FIXED_AMOUNT"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      aria-pressed={saleDiscountDraftType === type}
                      onClick={() => {
                        setSaleDiscountDraftType(type);
                        setSaleDiscountError(null);
                      }}
                      className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
                        saleDiscountDraftType === type
                          ? "border-amber-300 bg-amber-500/20 text-amber-50"
                          : "border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800"
                      }`}
                    >
                      {type === "PERCENTAGE" ? "Percentage" : "Fixed amount"}
                    </button>
                  ))}
                </div>
                <div>
                  <label htmlFor="sale-discount-value" className="text-xs font-medium text-slate-200">
                    {saleDiscountDraftType === "PERCENTAGE" ? "Discount %" : "Discount amount (R)"}
                  </label>
                  <Input
                    id="sale-discount-value"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={saleDiscountDraftValue}
                    onChange={(event) => {
                      setSaleDiscountDraftValue(event.target.value);
                      setSaleDiscountError(null);
                    }}
                    className="mt-1 border-slate-700 bg-slate-950 text-slate-100"
                    placeholder={saleDiscountDraftType === "PERCENTAGE" ? "e.g. 10" : "e.g. 10.00"}
                  />
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-200">Reason</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {SALE_DISCOUNT_REASONS.map((reason) => (
                      <button
                        key={reason.value}
                        type="button"
                        aria-pressed={saleDiscountDraftReason === reason.value}
                        onClick={() => {
                          setSaleDiscountDraftReason(reason.value);
                          setSaleDiscountError(null);
                        }}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                          saleDiscountDraftReason === reason.value
                            ? "border-amber-300 bg-amber-500/20 text-amber-50"
                            : "border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800"
                        }`}
                      >
                        {reason.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label htmlFor="sale-discount-note" className="text-xs font-medium text-slate-200">
                    Note {saleDiscountDraftReason === "OTHER" ? "(required)" : "(optional)"}
                  </label>
                  <Input
                    id="sale-discount-note"
                    value={saleDiscountDraftNote}
                    onChange={(event) => {
                      setSaleDiscountDraftNote(event.target.value);
                      setSaleDiscountError(null);
                    }}
                    className="mt-1 border-slate-700 bg-slate-950 text-slate-100"
                  />
                </div>
                <div className="rounded-md border border-slate-700 bg-slate-950/60 p-2 text-sm text-slate-200">
                  <p>Discount: −{toMoney(draftDiscountCents / 100)}</p>
                  <p className="font-semibold text-white">
                    To pay: {toMoney(Math.max(0, draftTotalCents - draftDiscountCents) / 100)}
                  </p>
                </div>
                {saleDiscountError && <p className="text-xs text-rose-200">{saleDiscountError}</p>}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowSaleDiscountForm(false);
                      setSaleDiscountError(null);
                    }}
                    className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={applySaleDiscount}
                    className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-300"
                  >
                    Approve with PIN
                  </button>
                </div>
              </div>
            ) : (
              paymentEntries.length === 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSaleDiscountForm(true)}
                    className="rounded-lg border border-amber-300/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/20"
                  >
                    Add Discount
                  </button>
                  <button
                    type="button"
                    onClick={openComplimentaryForm}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300/30 px-3 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-500/10"
                  >
                    <Gift className="h-3.5 w-3.5" />
                    Complimentary…
                  </button>
                </div>
              )
            )}

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

            {(paymentMethod === "CASH" || paymentMethod === "CARD") && paymentEntries.length === 0 && (
              <button
                type="button"
                onClick={toggleSplitAmount}
                className={`mt-3 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                  isSplitAmount
                    ? "border-amber-300/50 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25"
                    : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                }`}
              >
                {isSplitAmount ? "Pay full amount instead" : "Split payment"}
              </button>
            )}

            {showPaymentKeypad && (
              <div className="mt-3 grid items-start gap-3 rounded-xl border border-slate-700 bg-slate-900/60 p-3 sm:grid-cols-[minmax(9rem,2fr)_3fr]">
                <div className="space-y-2">
                  {isSplitAmount && (
                    <button
                      type="button"
                      onClick={() => selectPaymentField("amount")}
                      className={`w-full rounded-lg border p-2 text-left ${
                        keypadField === "amount"
                          ? "border-emerald-300 bg-emerald-500/15"
                          : "border-slate-700 bg-slate-950/60 hover:bg-slate-800"
                      }`}
                    >
                      <p className="text-[11px] uppercase tracking-wider text-slate-300">
                        {paymentMethod === "CASH" ? "Cash" : "Card"} amount
                      </p>
                      <p className="text-2xl font-black text-white">{formatAmountInput(paymentAmountInput)}</p>
                    </button>
                  )}

                  {paymentMethod === "CASH" && (
                    <>
                      <button
                        type="button"
                        onClick={() => selectPaymentField("tendered")}
                        className={`w-full rounded-lg border p-2 text-left ${
                          keypadField === "tendered"
                            ? "border-emerald-300 bg-emerald-500/15"
                            : "border-slate-700 bg-slate-950/60 hover:bg-slate-800"
                        }`}
                      >
                        <p className="text-[11px] uppercase tracking-wider text-slate-300">Cash tendered</p>
                        <p className="text-2xl font-black text-white">{formatAmountInput(cashTenderedInput)}</p>
                      </button>

                      <p className={`text-sm font-semibold ${changeDueCents < 0 ? "text-rose-300" : "text-emerald-200"}`}>
                        {changeDueCents < 0
                          ? `Short: ${toMoney(-changeDueCents / 100)}`
                          : `Change: ${toMoney(changeDueCents / 100)}`}
                      </p>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setTenderedCents(toCents(paymentAmount))}
                          className="rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800"
                        >
                          Exact
                        </button>
                        {quickTenderOptions.map((cents) => (
                          <button
                            key={cents}
                            type="button"
                            onClick={() => setTenderedCents(cents)}
                            className="rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800"
                          >
                            {toMoney(cents / 100)}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div className="flex justify-center">
                  <NumericKeypad
                    value={replaceOnNextKey ? "" : keypadValue}
                    onChange={handleKeypadChange}
                    maxLength={MAX_PAYMENT_WHOLE_DIGITS}
                    size="compact"
                    decimal
                  />

                </div>
              </div>
            )}

            {paymentMethod === "CASH" ? null : paymentMethod === "CARD" ? (
              <div className="mt-4 rounded-xl border border-blue-300/25 bg-blue-500/10 p-4">
                <p className="text-xs uppercase tracking-wider text-blue-100">Card Payment</p>
                <p className="mt-2 text-3xl font-black text-white">{toMoney(paymentAmount)}</p>
                <p className="mt-2 text-sm text-slate-300">Process the payment on the physical card machine, then confirm here.</p>
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
                    placeholder="Type account name or number"
                  />
                </div>

                {selectedAccount && (
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-amber-300/40 bg-amber-500/15 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-wider text-amber-100/80">Selected account</p>
                      <p className="truncate text-sm font-semibold text-white">
                        {selectedAccount.name}
                        {selectedAccount.accountNumber && (
                          <span className="ml-2 font-normal text-amber-100/80">{selectedAccount.accountNumber}</span>
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAccountDetails(true)}
                      aria-label="Show account details"
                      className="shrink-0 rounded-full p-1.5 text-amber-100 hover:bg-amber-500/25"
                    >
                      <Info className="h-5 w-5" />
                    </button>
                  </div>
                )}

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
                          {account.accountNumber && (
                            <span className="ml-2 text-xs text-slate-400">{account.accountNumber}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                <Dialog open={showAccountDetails && selectedAccount !== null} onOpenChange={setShowAccountDetails}>
                  <DialogContent className="max-w-sm border-slate-700 bg-slate-900 text-slate-100">
                    <DialogHeader>
                      <DialogTitle className="text-white">Account details</DialogTitle>
                    </DialogHeader>
                    {selectedAccount && (
                      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                        <dt className="text-slate-400">Account number</dt>
                        <dd className="font-semibold">{selectedAccount.accountNumber || "—"}</dd>
                        <dt className="text-slate-400">Name</dt>
                        <dd className="font-semibold">{selectedAccount.name}</dd>
                        <dt className="text-slate-400">Department</dt>
                        <dd className="font-semibold">{selectedAccount.department || "—"}</dd>
                        <dt className="text-slate-400">Contact number</dt>
                        <dd className="font-semibold">{selectedAccount.contactNumber || "—"}</dd>
                        <dt className="text-slate-400">Email</dt>
                        <dd className="break-all font-semibold">{selectedAccount.contactEmail || "—"}</dd>
                      </dl>
                    )}
                  </DialogContent>
                </Dialog>
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
                onClick={closePaymentStep}
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
                    {renderOrderListItem(order)}
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
