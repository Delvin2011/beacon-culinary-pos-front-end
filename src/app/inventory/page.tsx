"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { canEditInventoryRecords, canManageInventory, canManageStockTakes } from "@/lib/roles";
import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { useVatRate } from "@/hooks/use-vat-rate";
import {
  InvoiceBasisChip,
  InvoiceCheckChip,
  PricesIncludeVatToggle,
  VatCodeSelect,
  moneyOrDash,
} from "@/components/inventory/grv-vat-controls";
import {
  VAT_CODES,
  computeVatLine,
  parseOptionalAmount,
  previewInvoiceCheck,
  sumVatLines,
  vatCodeLabel,
  type InvoiceCheck,
  type VatCode,
} from "@/lib/grv-vat";
import { LineItemSheet } from "@/components/inventory/line-item-sheet";
import { useLocations } from "@/hooks/use-locations";
import { useCountSheetCategories, type CountSheetCategoryDto } from "@/hooks/use-count-sheet-categories";
import type { IngredientOption, LineItemSheetSubmitPayload } from "@/components/inventory/line-item-sheet-types";

type InventoryTab = "ingredients" | "grv" | "waste" | "stockTake" | "purchaseOrders";
type IngredientUnit = "KG" | "LITRE" | "EACH";
type PurchaseOrderStatus = "DRAFT" | "SUBMITTED" | "RECEIVED";

type IngredientDto = {
  id: number;
  name: string;
  unit: IngredientUnit;
  countSheetCategoryId: number;
  countSheetCategoryName?: string;
  active: boolean;
  itemCode?: string;
  defaultVatCode?: VatCode;
};

type StockByLocationDto = {
  locationId: number;
  locationName: string;
  stock: number;
};

type IngredientStockDto = {
  totalStock: number;
  byLocation: StockByLocationDto[];
  lastMovementAt?: string;
};

type IngredientTableRow = {
  id: number;
  name: string;
  itemCode: string;
  unit: IngredientUnit;
  countSheetCategory: string;
  defaultVatCode: VatCode;
  totalStock: number;
  stockByLocation: string;
  lastMovementAt?: string;
  active: boolean;
  ingredient: IngredientDto;
};

type GrvLineDto = {
  id: number;
  ingredientId: number;
  ingredientName: string;
  purchaseOrderLineId?: number;
  quantityOrdered: number | null;
  quantityReceived: number;
  // Price exactly as written on the invoice.
  unitPrice: number | null;
  // Legacy GRVs (before VAT capture) have null VAT fields.
  vatCode: VatCode | null;
  vatRate: number | null;
  unitCostExclVat: number | null;
  unitCostInclVat: number | null;
  lineExclVat: number | null;
  lineVat: number | null;
  lineInclVat: number | null;
  // Stock (ledger) cost: always VAT-inclusive, 4 decimals.
  costPerUnit: number;
  receiptVariance: number | null;
};

type GrvDto = {
  id: number;
  invoiceNumber: string;
  purchaseOrderId?: number;
  supplierName: string;
  note?: string;
  receivedByName?: string;
  receivedAt: string;
  pricesIncludeVat: boolean;
  invoiceTotalInclVat: number | null;
  totalExclVat: number | null;
  totalVat: number | null;
  totalInclVat: number | null;
  invoiceCheck: InvoiceCheck | null;
  lines: GrvLineDto[];
};

type GrvTableRow = {
  rowId: string;
  grvId: number;
  invoiceNumber: string;
  pricesIncludeVat: boolean;
  ingredientName: string;
  quantityReceived: number;
  quantityOrdered: number | null;
  receiptVariance: number | null;
  unitPrice: number | null;
  vatCode: VatCode | null;
  lineExclVat: number | null;
  lineVat: number | null;
  lineInclVat: number | null;
  costPerUnit: number;
  supplierName: string;
  receivedAt: string;
};

type GrvEditLineState = {
  id: number;
  ingredientName: string;
  quantityReceived: string;
  unitPrice: string;
  vatCode: VatCode;
};

type GrvViewMode = "invoices" | "lines";

type WasteEntryDto = {
  id: number;
  ingredientId: number;
  ingredientName: string;
  quantity: number;
  reason: string;
  note?: string;
  createdAt: string;
  locationName?: string;
};

type WasteEntryListItemDto = {
  id: number;
  ingredientId: number;
  ingredientName: string;
  quantity: number;
  reason: string;
  note?: string;
  recordedBy: string;
  createdAt: string;
  locationName?: string;
};

type WasteListResponseDto = {
  entries: WasteEntryListItemDto[];
};

type StockTakeResponseDto = {
  id: number;
  variance: number;
};

type StockTakeListItemDto = {
  id: number;
  ingredientId: number;
  ingredientName: string;
  countedQuantity: number;
  expectedQuantity: number;
  variance: number;
  note?: string;
  recordedBy: string;
  createdAt: string;
};

type StockTakeListResponseDto = {
  entries: StockTakeListItemDto[];
};

type PurchaseOrderLineDto = {
  id: number;
  ingredientId: number;
  ingredientName: string;
  quantity: number;
  note?: string;
};

type PurchaseOrderDto = {
  id: number;
  supplierName: string;
  status: PurchaseOrderStatus;
  createdAt: string;
  lines: PurchaseOrderLineDto[];
};

type BulkIngredientImportResultDto = {
  created: number;
  updated: number;
  ingredients: IngredientDto[];
};

type BulkGrvInvoiceSummaryDto = {
  invoiceNumber: string;
  lineCount: number;
  pricesIncludeVat: boolean;
  totalExclVat: number | null;
  totalVat: number | null;
  totalInclVat: number | null;
  invoiceCheck: InvoiceCheck | null;
};

type BulkGrvImportResultDto = {
  created: number;
  grvs: GrvDto[];
  invoices?: BulkGrvInvoiceSummaryDto[];
};

type PurchaseOrderDraftLine = {
  id: string;
  ingredientId: string;
  quantity: string;
  note: string;
};

const INGREDIENT_UNITS: IngredientUnit[] = ["KG", "LITRE", "EACH"];
const PURCHASE_ORDER_STATUSES: PurchaseOrderStatus[] = ["DRAFT", "SUBMITTED", "RECEIVED"];
const BULK_INGREDIENT_HEADERS = ["NAME", "UNIT", "COUNT SHEET"] as const;
const BULK_INGREDIENT_OPTIONAL_HEADER = "DEFAULT VAT CODE";
// GRV upload: header order doesn't matter; these must be present.
const BULK_GRV_REQUIRED_HEADERS = [
  "INVOICE NUMBER",
  "SUPPLIER NAME",
  "INGREDIENT NAME",
  "QUANTITY",
  "UNIT PRICE",
  "PRICES INCLUDE VAT",
] as const;
const BULK_GRV_OPTIONAL_HEADERS = ["VAT CODE", "INVOICE TOTAL", "NOTE"] as const;

// Served as downloads; mirror metadatafiles/templates in the backend repo.
const GRV_UPLOAD_TEMPLATE = `Invoice Number,Supplier Name,Ingredient Name,Quantity,Unit Price,Prices Include VAT,VAT Code,Invoice Total,Note
INV-88231,Acme Foods,Beef Mince,10,100.00,N,STANDARD,1650.00,Exclusive invoice - VAT is added automatically
INV-88231,Acme Foods,Rice,10,50.00,N,ZERO_RATED,1650.00,
INV-88232,Fresh Farms,Chicken Portions,50,18.00,Y,,900.00,Inclusive invoice - blank VAT Code uses the ingredient default
`;

const INGREDIENT_UPLOAD_TEMPLATE = `Name,Unit,Count Sheet,Default VAT Code
Beef Mince,KG,MEAT,STANDARD
Chicken Portions,KG,POULTRY,STANDARD
Rice,KG,DRYSTOCK,ZERO_RATED
Eggs,EACH,DAIRY,ZERO_RATED
Salt,KG,DRYSTOCK,
`;

function downloadTextFile(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatStockCost(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `R ${value.toFixed(4).replace(".", ",")}`;
}

function parseError(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) return record.message;
  if (typeof record.error === "string" && record.error.trim()) return record.error;
  if (Array.isArray(record.errors)) {
    const messages = record.errors
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    if (messages.length > 0) return messages.join(" ");
  }
  // Field-map errors, e.g. { "lines[0].unitPrice": "unitPrice is required" }.
  const fieldMessages = Object.values(record).filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  if (fieldMessages.length > 0) return fieldMessages.join(" ");
  return fallback;
}

const COUNT_SHEET_CATEGORY_NAME_MAX_LENGTH = 50;

// Mirrors the backend: trimmed, inner spaces collapsed, uppercased.
function normalizeCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

// Category endpoints return either { error } or field errors like { name: "..." }, { active: "..." }.
function parseCategoryError(res: Response, body: unknown, fallback: string): string {
  if (res.status === 403) return "You need the STOCK_ADMIN or ADMIN role to manage categories.";
  if (res.status === 404) return "This category no longer exists. The list has been refreshed.";
  const parsed = parseError(body, "");
  if (parsed) return parsed;
  if (body && typeof body === "object") {
    const fieldErrors = Object.values(body as Record<string, unknown>).filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    if (fieldErrors.length > 0) return fieldErrors.join(" ");
  }
  return fallback;
}

function formatDateTime(value?: string): string {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function isSameLocalDay(value: string): boolean {
  try {
    const date = new Date(value);
    const now = new Date();
    return date.toDateString() === now.toDateString();
  } catch {
    return false;
  }
}

function dateToApiBoundary(value: string, endOfDay: boolean): string | undefined {
  if (!value) return undefined;
  return `${value}T${endOfDay ? "23:59:59" : "00:00:00"}`;
}

function parseCsvHeaderLine(line: string): string[] {
  const columns: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      columns.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  columns.push(current.trim());
  return columns;
}

function normalizeCsvHeader(header: string): string {
  return header.trim().replace(/\s+/g, " ").toUpperCase();
}

export default function InventoryPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user, authFetch } = useAuth();
  // Head Chefs can view inventory, but GRVs, direct waste and ingredient edits are Admin/Stock Admin only.
  const canEditRecords = canEditInventoryRecords(user?.role);
  const { locations } = useLocations();
  // This page is admin-only, so load inactive categories too: existing ingredients may still use them.
  const {
    categories: countSheetCategories,
    error: countSheetCategoriesError,
    refetch: refetchCountSheetCategories,
  } = useCountSheetCategories({ includeInactive: true });

  const [activeTab, setActiveTab] = useState<InventoryTab>("ingredients");

  const [ingredients, setIngredients] = useState<IngredientDto[]>([]);
  const [ingredientStocks, setIngredientStocks] = useState<Record<number, IngredientStockDto>>({});
  const [ingredientsLoading, setIngredientsLoading] = useState(true);
  const [ingredientsError, setIngredientsError] = useState<string | null>(null);
  const [ingredientSearch, setIngredientSearch] = useState("");
  const [ingredientTableSorting, setIngredientTableSorting] = useState<SortingState>([]);
  const [ingredientTableColumnFilters, setIngredientTableColumnFilters] = useState<ColumnFiltersState>([]);

  const [ingredientDialogOpen, setIngredientDialogOpen] = useState(false);
  const [bulkIngredientDialogOpen, setBulkIngredientDialogOpen] = useState(false);
  const [bulkIngredientFile, setBulkIngredientFile] = useState<File | null>(null);
  const [bulkIngredientError, setBulkIngredientError] = useState<string | null>(null);
  const [bulkImportResult, setBulkImportResult] = useState<BulkIngredientImportResultDto | null>(null);
  const [bulkIngredientUploading, setBulkIngredientUploading] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState<IngredientDto | null>(null);
  const [ingredientName, setIngredientName] = useState("");
  const [ingredientUnit, setIngredientUnit] = useState<IngredientUnit>("KG");
  const [ingredientCategoryId, setIngredientCategoryId] = useState("");
  const [ingredientActive, setIngredientActive] = useState(true);
  const [ingredientItemCode, setIngredientItemCode] = useState("");
  const [ingredientDefaultVatCode, setIngredientDefaultVatCode] = useState<VatCode>("STANDARD");
  const [ingredientSaveError, setIngredientSaveError] = useState<string | null>(null);
  const [ingredientSaving, setIngredientSaving] = useState(false);

  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryNameDrafts, setCategoryNameDrafts] = useState<Record<number, string>>({});
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categorySavingId, setCategorySavingId] = useState<number | "new" | null>(null);

  const [grvs, setGrvs] = useState<GrvDto[]>([]);
  const [grvViewDialogOpen, setGrvViewDialogOpen] = useState(false);
  const [grvTableSearch, setGrvTableSearch] = useState("");
  const [grvTableSorting, setGrvTableSorting] = useState<SortingState>([]);
  const [grvTableColumnFilters, setGrvTableColumnFilters] = useState<ColumnFiltersState>([]);
  const [grvEditDialogOpen, setGrvEditDialogOpen] = useState(false);
  const [grvEditTarget, setGrvEditTarget] = useState<GrvDto | null>(null);
  const [grvEditInvoiceNumber, setGrvEditInvoiceNumber] = useState("");
  const [grvEditSupplierName, setGrvEditSupplierName] = useState("");
  const [grvEditNote, setGrvEditNote] = useState("");
  const [grvEditPricesIncludeVat, setGrvEditPricesIncludeVat] = useState<boolean | null>(null);
  const [grvEditInvoiceTotal, setGrvEditInvoiceTotal] = useState("");
  const [grvViewMode, setGrvViewMode] = useState<GrvViewMode>("invoices");
  // The server's figures for the GRV just captured: final, so shown after save.
  const [lastSavedGrv, setLastSavedGrv] = useState<GrvDto | null>(null);
  const vatRate = useVatRate();
  const [grvEditLines, setGrvEditLines] = useState<GrvEditLineState[]>([]);
  const [grvEditError, setGrvEditError] = useState<string | null>(null);
  const [grvEditSaving, setGrvEditSaving] = useState(false);
  const [grvBulkDialogOpen, setGrvBulkDialogOpen] = useState(false);
  const [grvBulkFile, setGrvBulkFile] = useState<File | null>(null);
  const [grvBulkError, setGrvBulkError] = useState<string | null>(null);
  const [grvBulkRowErrors, setGrvBulkRowErrors] = useState<string[]>([]);
  const [grvBulkResult, setGrvBulkResult] = useState<BulkGrvImportResultDto | null>(null);
  const [grvBulkUploading, setGrvBulkUploading] = useState(false);
  const [grvLoading, setGrvLoading] = useState(false);
  const [grvError, setGrvError] = useState<string | null>(null);
  const [grvSelectedPurchaseOrderId, setGrvSelectedPurchaseOrderId] = useState("");
  const [grvPoReceivedByLine, setGrvPoReceivedByLine] = useState<Record<number, number>>({});
  const [grvPoReceivedLoading, setGrvPoReceivedLoading] = useState(false);
  const [grvSheetResetKey, setGrvSheetResetKey] = useState(0);
  const [grvFilterIngredientId, setGrvFilterIngredientId] = useState("all");
  const [grvFilterFrom, setGrvFilterFrom] = useState("");
  const [grvFilterTo, setGrvFilterTo] = useState("");

  const [wasteIngredientId, setWasteIngredientId] = useState("");
  const [wasteLocationId, setWasteLocationId] = useState("");
  const [wasteQuantity, setWasteQuantity] = useState("");
  const [wasteReason, setWasteReason] = useState("");
  const [wasteNote, setWasteNote] = useState("");
  const [wasteError, setWasteError] = useState<string | null>(null);
  const [wasteSaving, setWasteSaving] = useState(false);
  const [wasteEntries, setWasteEntries] = useState<WasteEntryListItemDto[]>([]);
  const [wasteEntriesLoading, setWasteEntriesLoading] = useState(false);
  const [wasteEntriesError, setWasteEntriesError] = useState<string | null>(null);

  const [stockTakeIngredientId, setStockTakeIngredientId] = useState("");
  const [stockTakeCountedQuantity, setStockTakeCountedQuantity] = useState("");
  const [stockTakeNote, setStockTakeNote] = useState("");
  const [stockTakeError, setStockTakeError] = useState<string | null>(null);
  const [stockTakeSaving, setStockTakeSaving] = useState(false);
  const [stockTakes, setStockTakes] = useState<StockTakeListItemDto[]>([]);
  const [stockTakesLoading, setStockTakesLoading] = useState(false);
  const [stockTakesError, setStockTakesError] = useState<string | null>(null);

  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderDto[]>([]);
  const [purchaseOrdersLoading, setPurchaseOrdersLoading] = useState(false);
  const [purchaseOrdersError, setPurchaseOrdersError] = useState<string | null>(null);
  const [purchaseOrderSupplierName, setPurchaseOrderSupplierName] = useState("");
  const [purchaseOrderLines, setPurchaseOrderLines] = useState<PurchaseOrderDraftLine[]>([
    { id: "line-1", ingredientId: "", quantity: "", note: "" },
  ]);
  const [purchaseOrderSaveError, setPurchaseOrderSaveError] = useState<string | null>(null);
  const [purchaseOrderSaving, setPurchaseOrderSaving] = useState(false);
  const [statusSavingId, setStatusSavingId] = useState<number | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.replace("/login");
      return;
    }
    if (!canManageInventory(user?.role)) {
      router.replace("/dashboard");
    }
  }, [authLoading, isAuthenticated, router, user]);

  const fetchIngredients = useCallback(async () => {
    setIngredientsLoading(true);
    setIngredientsError(null);
    try {
      const res = await authFetch("/admin/ingredients");
      const body = (await res.json().catch(() => null)) as IngredientDto[] | unknown;
      if (!res.ok || !Array.isArray(body)) {
        throw new Error(parseError(body, "Unable to load ingredients."));
      }

      setIngredients(body);

      const stockEntries = await Promise.all(
        body.map(async (ingredient) => {
          try {
            const stockRes = await authFetch(`/admin/ingredients/${ingredient.id}/stock`);
            const stockBody = (await stockRes.json().catch(() => null)) as IngredientStockDto | unknown;
            if (!stockRes.ok || !stockBody) {
              throw new Error(parseError(stockBody, "Unable to load stock."));
            }
            return [ingredient.id, stockBody as IngredientStockDto] as const;
          } catch {
            return [ingredient.id, { totalStock: 0, byLocation: [], lastMovementAt: undefined }] as const;
          }
        }),
      );

      setIngredientStocks(Object.fromEntries(stockEntries));
    } catch (err) {
      setIngredientsError(err instanceof Error ? err.message : "Unable to load ingredients.");
      setIngredients([]);
      setIngredientStocks({});
    } finally {
      setIngredientsLoading(false);
    }
  }, [authFetch]);

  const fetchGrvs = useCallback(async () => {
    setGrvLoading(true);
    setGrvError(null);
    try {
      const params = new URLSearchParams();
      if (grvFilterIngredientId !== "all") params.set("ingredientId", grvFilterIngredientId);
      const from = dateToApiBoundary(grvFilterFrom, false);
      const to = dateToApiBoundary(grvFilterTo, true);
      if (from) params.set("from", from);
      if (to) params.set("to", to);

      const path = params.size > 0 ? `/admin/grv?${params.toString()}` : "/admin/grv";
      const res = await authFetch(path);
      const body = (await res.json().catch(() => null)) as GrvDto[] | unknown;
      if (!res.ok || !Array.isArray(body)) {
        throw new Error(parseError(body, "Unable to load GRVs."));
      }
      setGrvs(body);
    } catch (err) {
      setGrvError(err instanceof Error ? err.message : "Unable to load GRVs.");
      setGrvs([]);
    } finally {
      setGrvLoading(false);
    }
  }, [authFetch, grvFilterFrom, grvFilterIngredientId, grvFilterTo]);

  const fetchWasteEntries = useCallback(async () => {
    setWasteEntriesLoading(true);
    setWasteEntriesError(null);
    try {
      const res = await authFetch("/admin/waste");
      const body = (await res.json().catch(() => null)) as WasteListResponseDto | unknown;
      if (!res.ok || !body || typeof body !== "object" || !Array.isArray((body as WasteListResponseDto).entries)) {
        throw new Error(parseError(body, "Unable to load waste entries."));
      }
      setWasteEntries((body as WasteListResponseDto).entries);
    } catch (err) {
      setWasteEntriesError(err instanceof Error ? err.message : "Unable to load waste entries.");
      setWasteEntries([]);
    } finally {
      setWasteEntriesLoading(false);
    }
  }, [authFetch]);

  const fetchStockTakes = useCallback(async () => {
    setStockTakesLoading(true);
    setStockTakesError(null);
    try {
      const res = await authFetch("/admin/stock-takes");
      const body = (await res.json().catch(() => null)) as StockTakeListResponseDto | unknown;
      if (!res.ok || !body || typeof body !== "object" || !Array.isArray((body as StockTakeListResponseDto).entries)) {
        throw new Error(parseError(body, "Unable to load stock takes."));
      }
      setStockTakes((body as StockTakeListResponseDto).entries);
    } catch (err) {
      setStockTakesError(err instanceof Error ? err.message : "Unable to load stock takes.");
      setStockTakes([]);
    } finally {
      setStockTakesLoading(false);
    }
  }, [authFetch]);

  const fetchPurchaseOrders = useCallback(async () => {
    setPurchaseOrdersLoading(true);
    setPurchaseOrdersError(null);
    try {
      const res = await authFetch("/admin/purchase-orders");
      const body = (await res.json().catch(() => null)) as PurchaseOrderDto[] | unknown;
      if (!res.ok || !Array.isArray(body)) {
        throw new Error(parseError(body, "Unable to load purchase orders."));
      }
      setPurchaseOrders(body);
    } catch (err) {
      setPurchaseOrdersError(err instanceof Error ? err.message : "Unable to load purchase orders.");
      setPurchaseOrders([]);
    } finally {
      setPurchaseOrdersLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (isAuthenticated && canManageInventory(user?.role)) {
      void fetchIngredients();
      void fetchGrvs();
      void fetchPurchaseOrders();
      void fetchWasteEntries();
      if (canManageStockTakes(user?.role)) void fetchStockTakes();
    }
  }, [fetchGrvs, fetchIngredients, fetchPurchaseOrders, fetchWasteEntries, fetchStockTakes, isAuthenticated, user]);

  useEffect(() => {
    if (!isAuthenticated || !canManageInventory(user?.role)) return;
    void fetchGrvs();
  }, [fetchGrvs, isAuthenticated, user]);

  const ingredientOptions = useMemo(
    () => ingredients.filter((ingredient) => ingredient.active),
    [ingredients],
  );

  // GRV never auto-fills the price — unlike Issue, the whole point is recording *this*
  // invoice's price as written, so it's always left blank for the user to enter.
  const grvIngredientOptions: IngredientOption[] = useMemo(
    () =>
      ingredientOptions.map((ingredient) => ({
        id: ingredient.id,
        name: ingredient.name,
        unit: ingredient.unit,
        unitValue: null,
        itemCode: ingredient.itemCode ?? null,
        defaultVatCode: ingredient.defaultVatCode ?? "STANDARD",
      })),
    [ingredientOptions],
  );

  const selectedGrvPurchaseOrder = useMemo(
    () => purchaseOrders.find((po) => String(po.id) === grvSelectedPurchaseOrderId) ?? null,
    [purchaseOrders, grvSelectedPurchaseOrderId],
  );

  const grvTableRows: GrvTableRow[] = useMemo(
    () =>
      grvs.flatMap((grv) =>
        grv.lines.map((line) => ({
          rowId: `${grv.id}-${line.id}`,
          grvId: grv.id,
          invoiceNumber: grv.invoiceNumber,
          pricesIncludeVat: grv.pricesIncludeVat,
          ingredientName: line.ingredientName,
          quantityReceived: line.quantityReceived,
          quantityOrdered: line.quantityOrdered,
          receiptVariance: line.receiptVariance,
          unitPrice: line.unitPrice,
          vatCode: line.vatCode,
          lineExclVat: line.lineExclVat,
          lineVat: line.lineVat,
          lineInclVat: line.lineInclVat,
          costPerUnit: line.costPerUnit,
          supplierName: grv.supplierName,
          receivedAt: grv.receivedAt,
        })),
      ),
    [grvs],
  );

  const openGrvEditDialog = useCallback((grv: GrvDto) => {
    setGrvEditTarget(grv);
    setGrvEditInvoiceNumber(grv.invoiceNumber);
    setGrvEditSupplierName(grv.supplierName);
    setGrvEditNote(grv.note ?? "");
    setGrvEditPricesIncludeVat(grv.pricesIncludeVat);
    setGrvEditInvoiceTotal(grv.invoiceTotalInclVat !== null && grv.invoiceTotalInclVat !== undefined ? String(grv.invoiceTotalInclVat) : "");
    setGrvEditLines(
      grv.lines.map((line) => ({
        id: line.id,
        ingredientName: line.ingredientName,
        quantityReceived: String(line.quantityReceived),
        // Legacy lines: the old cost was the inclusive price as invoiced.
        unitPrice: String(line.unitPrice ?? line.costPerUnit),
        // A legacy line has no code yet; it falls back to the ingredient's default.
        vatCode:
          line.vatCode ?? ingredients.find((ingredient) => ingredient.id === line.ingredientId)?.defaultVatCode ?? "STANDARD",
      })),
    );
    setGrvEditError(null);
    setGrvEditDialogOpen(true);
  }, [ingredients]);

  const grvTableColumns: ColumnDef<GrvTableRow>[] = useMemo(
    () => [
      {
        accessorKey: "invoiceNumber",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Invoice
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => <span className="font-medium">{row.getValue("invoiceNumber")}</span>,
      },
      {
        accessorKey: "ingredientName",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Ingredient
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
      },
      {
        accessorKey: "quantityReceived",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Qty Received
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
      },
      {
        accessorKey: "quantityOrdered",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Ordered
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => row.original.quantityOrdered ?? "—",
      },
      {
        accessorKey: "receiptVariance",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Variance
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => {
          const variance = row.original.receiptVariance;
          if (variance === null) return "—";
          return (
            <span
              className={
                variance < 0
                  ? "font-medium text-rose-700"
                  : variance > 0
                  ? "font-medium text-emerald-700"
                  : "font-medium"
              }
            >
              {variance > 0 ? "+" : ""}
              {variance}
            </span>
          );
        },
      },
      {
        accessorKey: "unitPrice",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Unit Price (invoiced)
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="flex flex-col items-start gap-0.5">
            <span>{moneyOrDash(row.original.unitPrice)}</span>
            <InvoiceBasisChip pricesIncludeVat={row.original.pricesIncludeVat} />
          </span>
        ),
      },
      {
        accessorKey: "vatCode",
        header: "VAT",
        cell: ({ row }) => vatCodeLabel(row.original.vatCode, vatRate),
      },
      {
        accessorKey: "lineExclVat",
        header: "Line excl. VAT",
        cell: ({ row }) => moneyOrDash(row.original.lineExclVat),
      },
      {
        accessorKey: "lineVat",
        header: "VAT amount",
        cell: ({ row }) => moneyOrDash(row.original.lineVat),
      },
      {
        accessorKey: "lineInclVat",
        header: "Line incl. VAT",
        cell: ({ row }) => moneyOrDash(row.original.lineInclVat),
      },
      {
        accessorKey: "costPerUnit",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Stock Cost (incl. VAT)
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => formatStockCost(row.original.costPerUnit),
      },
      {
        accessorKey: "supplierName",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Supplier
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        filterFn: "equals",
      },
      {
        accessorKey: "receivedAt",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Received At
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => formatDateTime(row.original.receivedAt),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          if (!canEditRecords) return null;
          const editable = isSameLocalDay(row.original.receivedAt);
          return (
            <Button
              size="sm"
              variant="outline"
              disabled={!editable}
              title={editable ? undefined : "GRVs can only be edited on the day they were received"}
              onClick={() => {
                const grv = grvs.find((g) => g.id === row.original.grvId);
                if (grv) openGrvEditDialog(grv);
              }}
            >
              Edit
            </Button>
          );
        },
      },
    ],
    [canEditRecords, grvs, openGrvEditDialog, vatRate],
  );

  const grvEditable = (grv: GrvDto) => isSameLocalDay(grv.receivedAt);

  // Live recalculation in the edit dialog; null until the basis and rate are known.
  const grvEditVatPreview = useMemo(() => {
    if (vatRate === null || grvEditPricesIncludeVat === null) return null;
    const lines = grvEditLines.map((line) =>
      computeVatLine(Number(line.quantityReceived), Number(line.unitPrice), grvEditPricesIncludeVat, line.vatCode, vatRate),
    );
    const totals = sumVatLines(lines);
    return { lines, totals, check: previewInvoiceCheck(parseOptionalAmount(grvEditInvoiceTotal), totals.totalInclVat) };
  }, [grvEditInvoiceTotal, grvEditLines, grvEditPricesIncludeVat, vatRate]);

  const grvSupplierOptions = useMemo(
    () => Array.from(new Set(grvs.map((grv) => grv.supplierName))).sort(),
    [grvs],
  );

  const grvTable = useReactTable({
    data: grvTableRows,
    columns: grvTableColumns,
    getRowId: (row) => row.rowId,
    state: {
      sorting: grvTableSorting,
      columnFilters: grvTableColumnFilters,
      globalFilter: grvTableSearch,
    },
    onSortingChange: setGrvTableSorting,
    onColumnFiltersChange: setGrvTableColumnFilters,
    onGlobalFilterChange: setGrvTableSearch,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  // The invoice view honours the same supplier filter and search as the line view.
  const grvSupplierFilter = grvTable.getColumn("supplierName")?.getFilterValue() as string | undefined;
  const filteredGrvInvoices = useMemo(() => {
    const search = grvTableSearch.trim().toLowerCase();
    return grvs.filter((grv) => {
      if (grvSupplierFilter && grv.supplierName !== grvSupplierFilter) return false;
      if (!search) return true;
      return (
        grv.invoiceNumber.toLowerCase().includes(search) ||
        grv.supplierName.toLowerCase().includes(search) ||
        grv.lines.some((line) => line.ingredientName.toLowerCase().includes(search))
      );
    });
  }, [grvSupplierFilter, grvTableSearch, grvs]);

  // Client-side reconciliation of two existing calls — no new backend endpoint for
  // "what's outstanding on this PO": sum quantityReceived per purchaseOrderLineId
  // across every GRV already recorded against it.
  useEffect(() => {
    if (!selectedGrvPurchaseOrder) {
      setGrvPoReceivedByLine({});
      return;
    }
    let cancelled = false;
    setGrvPoReceivedLoading(true);
    (async () => {
      try {
        const res = await authFetch(`/admin/grv?purchaseOrderId=${selectedGrvPurchaseOrder.id}`);
        const body = (await res.json().catch(() => null)) as GrvDto[] | unknown;
        if (!res.ok || !Array.isArray(body)) throw new Error("Unable to load received quantities.");
        const receivedByLine: Record<number, number> = {};
        for (const grv of body as GrvDto[]) {
          for (const line of grv.lines) {
            if (line.purchaseOrderLineId === undefined) continue;
            receivedByLine[line.purchaseOrderLineId] =
              (receivedByLine[line.purchaseOrderLineId] ?? 0) + line.quantityReceived;
          }
        }
        if (!cancelled) setGrvPoReceivedByLine(receivedByLine);
      } catch {
        if (!cancelled) setGrvPoReceivedByLine({});
      } finally {
        if (!cancelled) setGrvPoReceivedLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authFetch, selectedGrvPurchaseOrder]);

  const activeCountSheetCategories = useMemo(
    () => countSheetCategories.filter((category) => category.active),
    [countSheetCategories],
  );

  const countSheetCategoryNames = useMemo(
    () => new Map(countSheetCategories.map((category) => [category.id, category.name])),
    [countSheetCategories],
  );

  // Active categories, plus the edited ingredient's current one if it has since been deactivated.
  const ingredientCategoryOptions = useMemo(() => {
    const current = countSheetCategories.find((category) => String(category.id) === ingredientCategoryId);
    if (!current || current.active) return activeCountSheetCategories;
    return [...activeCountSheetCategories, current].sort((a, b) => a.id - b.id);
  }, [activeCountSheetCategories, countSheetCategories, ingredientCategoryId]);

  const bulkIngredientSampleCsv = useMemo(() => {
    const sampleRows: Array<[string, IngredientUnit, string]> = [
      ["Tomato", "KG", "ZERO_RATED"],
      ["Olive Oil", "LITRE", "STANDARD"],
      ["Paper Straw", "EACH", ""],
    ];
    const names = activeCountSheetCategories.map((category) => category.name);
    const rows = sampleRows.map(
      ([name, unit, vatCode], index) => `${name},${unit},${names.length > 0 ? names[index % names.length] : "CATEGORY"},${vatCode}`,
    );
    return [[...BULK_INGREDIENT_HEADERS, BULK_INGREDIENT_OPTIONAL_HEADER].join(","), ...rows].join("\n");
  }, [activeCountSheetCategories]);

  const openCategoryDialog = () => {
    setNewCategoryName("");
    setCategoryNameDrafts({});
    setCategoryError(null);
    setCategoryDialogOpen(true);
  };

  // Client-side copy of the backend rules, for instant feedback. The backend still enforces them.
  const validateCategoryName = (name: string, ignoreId?: number): string | null => {
    const normalized = normalizeCategoryName(name);
    if (!normalized) return "Category name is required.";
    if (normalized.length > COUNT_SHEET_CATEGORY_NAME_MAX_LENGTH) {
      return `Category name must be at most ${COUNT_SHEET_CATEGORY_NAME_MAX_LENGTH} characters.`;
    }
    const clash = countSheetCategories.find(
      (category) => category.id !== ignoreId && normalizeCategoryName(category.name) === normalized,
    );
    if (clash) return `A count sheet category named '${clash.name}' already exists.`;
    return null;
  };

  const createCountSheetCategory = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newCategoryName.trim();
    const validationError = validateCategoryName(name);
    if (validationError) {
      setCategoryError(validationError);
      return;
    }

    setCategorySavingId("new");
    setCategoryError(null);
    try {
      const res = await authFetch("/admin/count-sheet-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = (await res.json().catch(() => null)) as CountSheetCategoryDto | unknown;
      if (!res.ok) {
        throw new Error(parseCategoryError(res, body, "Unable to create category."));
      }
      // The backend normalises the name, so show what it saved.
      const savedName = (body as CountSheetCategoryDto | null)?.name ?? normalizeCategoryName(name);
      setNewCategoryName("");
      await refetchCountSheetCategories();
      toast({ title: "Category created", description: `${savedName} has been added to the end of the count sheet.` });
    } catch (err) {
      setCategoryError(err instanceof Error ? err.message : "Unable to create category.");
    } finally {
      setCategorySavingId(null);
    }
  };

  // PUT replaces the whole record, so name and active are always sent together.
  const updateCountSheetCategory = async (category: CountSheetCategoryDto, changes: { name?: string; active?: boolean }) => {
    const name = (changes.name ?? category.name).trim();
    const active = changes.active ?? category.active;
    const validationError = validateCategoryName(name, category.id);
    if (validationError) {
      setCategoryError(validationError);
      return;
    }

    setCategorySavingId(category.id);
    setCategoryError(null);
    try {
      const res = await authFetch(`/admin/count-sheet-categories/${category.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, active }),
      });
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        if (res.status === 404) void refetchCountSheetCategories();
        throw new Error(parseCategoryError(res, body, "Unable to update category."));
      }
      setCategoryNameDrafts((current) => {
        const next = { ...current };
        delete next[category.id];
        return next;
      });
      await refetchCountSheetCategories();
    } catch (err) {
      setCategoryError(err instanceof Error ? err.message : "Unable to update category.");
    } finally {
      setCategorySavingId(null);
    }
  };

  const openCreateIngredient = () => {
    setEditingIngredient(null);
    setIngredientName("");
    setIngredientUnit("KG");
    setIngredientCategoryId(activeCountSheetCategories[0] ? String(activeCountSheetCategories[0].id) : "");
    setIngredientActive(true);
    setIngredientItemCode("");
    setIngredientDefaultVatCode("STANDARD");
    setIngredientSaveError(null);
    setIngredientDialogOpen(true);
  };

  const openBulkIngredientDialog = () => {
    setBulkIngredientFile(null);
    setBulkIngredientError(null);
    setBulkImportResult(null);
    setBulkIngredientDialogOpen(true);
  };

  const openEditIngredient = (ingredient: IngredientDto) => {
    setEditingIngredient(ingredient);
    setIngredientName(ingredient.name);
    setIngredientUnit(ingredient.unit);
    setIngredientCategoryId(String(ingredient.countSheetCategoryId));
    setIngredientActive(ingredient.active);
    setIngredientItemCode(ingredient.itemCode ?? "");
    setIngredientDefaultVatCode(ingredient.defaultVatCode ?? "STANDARD");
    setIngredientSaveError(null);
    setIngredientDialogOpen(true);
  };

  const ingredientTableRows: IngredientTableRow[] = useMemo(
    () =>
      ingredients.map((ingredient) => {
        const stock = ingredientStocks[ingredient.id];
        return {
          id: ingredient.id,
          name: ingredient.name,
          itemCode: ingredient.itemCode ?? "",
          unit: ingredient.unit,
          // Prefer the categories list so renames show without reloading ingredients.
          countSheetCategory:
            countSheetCategoryNames.get(ingredient.countSheetCategoryId) ?? ingredient.countSheetCategoryName ?? "—",
          totalStock: stock ? stock.totalStock : 0,
          stockByLocation: stock?.byLocation.map((entry) => `${entry.locationName}: ${entry.stock}`).join(" · ") ?? "",
          lastMovementAt: stock?.lastMovementAt,
          defaultVatCode: ingredient.defaultVatCode ?? "STANDARD",
          active: ingredient.active,
          ingredient,
        };
      }),
    [countSheetCategoryNames, ingredients, ingredientStocks],
  );

  const ingredientTableColumns: ColumnDef<IngredientTableRow>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Name
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: "itemCode",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Item Code
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => row.original.itemCode || "—",
      },
      {
        accessorKey: "unit",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Unit
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
      },
      {
        accessorKey: "countSheetCategory",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Count Sheet Category
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        filterFn: "equals",
      },
      {
        accessorKey: "defaultVatCode",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Default VAT
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => vatCodeLabel(row.original.defaultVatCode),
      },
      {
        accessorKey: "totalStock",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Current Stock
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => (
          <div>
            <div>{row.original.totalStock} {row.original.unit}</div>
            {row.original.stockByLocation && (
              <div className="text-xs text-muted-foreground">{row.original.stockByLocation}</div>
            )}
          </div>
        ),
      },
      {
        accessorKey: "lastMovementAt",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Last Movement
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => formatDateTime(row.original.lastMovementAt),
      },
      {
        accessorKey: "active",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Active
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => (row.original.active ? "Yes" : "No"),
        filterFn: "equals",
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          canEditRecords ? (
            <Button size="sm" variant="outline" onClick={() => openEditIngredient(row.original.ingredient)}>
              Edit
            </Button>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEditRecords],
  );

  const ingredientTable = useReactTable({
    data: ingredientTableRows,
    columns: ingredientTableColumns,
    getRowId: (row) => String(row.id),
    state: {
      sorting: ingredientTableSorting,
      columnFilters: ingredientTableColumnFilters,
      globalFilter: ingredientSearch,
    },
    onSortingChange: setIngredientTableSorting,
    onColumnFiltersChange: setIngredientTableColumnFilters,
    onGlobalFilterChange: setIngredientSearch,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const openGrvBulkDialog = () => {
    setGrvBulkFile(null);
    setGrvBulkError(null);
    setGrvBulkRowErrors([]);
    setGrvBulkResult(null);
    setGrvBulkDialogOpen(true);
  };

  const refreshStockSensitiveData = useCallback(async () => {
    await Promise.all([fetchIngredients(), fetchGrvs()]);
  }, [fetchGrvs, fetchIngredients]);

  const saveIngredient = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ingredientName.trim()) {
      setIngredientSaveError("Ingredient name is required.");
      return;
    }
    if (!ingredientCategoryId) {
      setIngredientSaveError("Count sheet category is required.");
      return;
    }

    setIngredientSaving(true);
    setIngredientSaveError(null);
    try {
      const payload = {
        name: ingredientName.trim(),
        unit: ingredientUnit,
        countSheetCategoryId: Number(ingredientCategoryId),
        active: ingredientActive,
        itemCode: ingredientItemCode.trim() || undefined,
        defaultVatCode: ingredientDefaultVatCode,
      };

      const res = editingIngredient
        ? await authFetch(`/admin/ingredients/${editingIngredient.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await authFetch("/admin/ingredients", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: payload.name,
              unit: payload.unit,
              countSheetCategoryId: payload.countSheetCategoryId,
              itemCode: payload.itemCode,
              defaultVatCode: payload.defaultVatCode,
            }),
          });

      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        throw new Error(parseError(body, "Unable to save ingredient."));
      }

      setIngredientDialogOpen(false);
      await fetchIngredients();
      toast({ title: editingIngredient ? "Ingredient updated" : "Ingredient created", description: `${payload.name} has been saved.` });
    } catch (err) {
      setIngredientSaveError(err instanceof Error ? err.message : "Unable to save ingredient.");
    } finally {
      setIngredientSaving(false);
    }
  };

  const saveBulkIngredients = async (event: React.FormEvent) => {
    event.preventDefault();
    setBulkIngredientError(null);
    setBulkImportResult(null);

    if (!bulkIngredientFile) {
      setBulkIngredientError("Please select a CSV file.");
      return;
    }

    const lowerName = bulkIngredientFile.name.toLowerCase();
    const isCsvMime = bulkIngredientFile.type.toLowerCase().includes("csv");
    if (!lowerName.endsWith(".csv") && !isCsvMime) {
      setBulkIngredientError("Invalid file type. Please upload a .csv file.");
      return;
    }

    let content = "";
    try {
      content = await bulkIngredientFile.text();
    } catch {
      setBulkIngredientError("Unable to read the selected file.");
      return;
    }

    const nonEmptyLine = content
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    if (!nonEmptyLine) {
      setBulkIngredientError("The selected CSV file is empty.");
      return;
    }

    const foundHeaders = parseCsvHeaderLine(nonEmptyLine);
    const expectedHeaders = [...BULK_INGREDIENT_HEADERS];
    const normalizedFoundHeaders = foundHeaders.map(normalizeCsvHeader);
    const normalizedExpectedHeaders = expectedHeaders.map(normalizeCsvHeader);
    // The first three columns are fixed; "Default VAT Code" may follow as an optional fourth.
    const hasOptionalVatHeader =
      normalizedFoundHeaders.length === normalizedExpectedHeaders.length + 1 &&
      normalizedFoundHeaders[normalizedExpectedHeaders.length] === BULK_INGREDIENT_OPTIONAL_HEADER;
    const hasValidHeaders =
      (normalizedFoundHeaders.length === normalizedExpectedHeaders.length || hasOptionalVatHeader) &&
      normalizedExpectedHeaders.every((header, index) => normalizedFoundHeaders[index] === header);

    if (!hasValidHeaders) {
      setBulkIngredientError(
        `CSV header mismatch. Expected: ${expectedHeaders.join(",")} (optionally followed by ${BULK_INGREDIENT_OPTIONAL_HEADER}). Found: ${foundHeaders.join(",") || "(empty)"}.`,
      );
      return;
    }

    setBulkIngredientUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", bulkIngredientFile);

      const res = await authFetch("/admin/ingredients/bulk-import", {
        method: "POST",
        body: formData,
      });
      const body = (await res.json().catch(() => null)) as BulkIngredientImportResultDto | unknown;
      if (!res.ok || !body || typeof body !== "object") {
        throw new Error(parseError(body, "Unable to bulk import ingredients."));
      }

      const result = body as BulkIngredientImportResultDto;
      setBulkImportResult(result);
      await fetchIngredients();
      toast({
        title: "Bulk import completed",
        description: `${result.created} created, ${result.updated} updated.`,
      });
    } catch (err) {
      setBulkIngredientError(err instanceof Error ? err.message : "Unable to bulk import ingredients.");
    } finally {
      setBulkIngredientUploading(false);
    }
  };

  const handleGrvSubmit = async (payload: LineItemSheetSubmitPayload) => {
    if (!payload.vat) throw new Error("Choose whether the prices on this invoice include or exclude VAT.");
    const res = await authFetch("/admin/grv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoiceNumber: payload.extraFields.invoiceNumber?.trim(),
        pricesIncludeVat: payload.vat.pricesIncludeVat,
        invoiceTotalInclVat: payload.vat.invoiceTotalInclVat ?? undefined,
        purchaseOrderId: grvSelectedPurchaseOrderId ? Number(grvSelectedPurchaseOrderId) : undefined,
        supplierName: payload.extraFields.supplierName?.trim(),
        note: payload.extraFields.note?.trim() || undefined,
        lines: payload.lines.map((line) => ({
          ingredientId: line.ingredientId,
          purchaseOrderLineId: line.purchaseOrderLineId ?? undefined,
          quantityReceived: line.quantity,
          unitPrice: line.unitValue,
          vatCode: line.vatCode,
        })),
      }),
    });
    const body = (await res.json().catch(() => null)) as GrvDto | unknown;
    if (!res.ok || !body) {
      throw new Error(parseError(body, "Unable to submit GRV."));
    }

    const grv = body as GrvDto;
    setLastSavedGrv(grv);
    setGrvSelectedPurchaseOrderId("");
    setGrvSheetResetKey((key) => key + 1);
    await refreshStockSensitiveData();
    toast({
      title: "GRV recorded",
      description: `Invoice ${grv.invoiceNumber} recorded with ${grv.lines.length} line(s).`,
    });
  };

  const saveGrvEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!grvEditTarget) return;
    setGrvEditError(null);

    if (grvEditPricesIncludeVat === null) {
      setGrvEditError("Choose whether the prices on this invoice include or exclude VAT.");
      return;
    }
    const printedTotal = parseOptionalAmount(grvEditInvoiceTotal);
    if (grvEditInvoiceTotal.trim() !== "" && (printedTotal === null || printedTotal < 0)) {
      setGrvEditError("Enter the invoice total as a number, or leave it blank.");
      return;
    }

    for (const line of grvEditLines) {
      const quantity = Number(line.quantityReceived);
      const price = Number(line.unitPrice);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setGrvEditError(`${line.ingredientName}: quantity received must be greater than 0.`);
        return;
      }
      if (line.unitPrice.trim() === "" || !Number.isFinite(price) || price < 0) {
        setGrvEditError(`${line.ingredientName}: enter the unit price as written on the invoice.`);
        return;
      }
    }

    setGrvEditSaving(true);
    try {
      const res = await authFetch(`/admin/grv/${grvEditTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNumber: grvEditInvoiceNumber.trim(),
          pricesIncludeVat: grvEditPricesIncludeVat,
          invoiceTotalInclVat: printedTotal ?? undefined,
          supplierName: grvEditSupplierName.trim(),
          note: grvEditNote.trim() || undefined,
          // Every existing line must be sent.
          lines: grvEditLines.map((line) => ({
            id: line.id,
            quantityReceived: Number(line.quantityReceived),
            unitPrice: Number(line.unitPrice),
            vatCode: line.vatCode,
          })),
        }),
      });
      const body = (await res.json().catch(() => null)) as GrvDto | unknown;
      if (!res.ok || !body) {
        throw new Error(parseError(body, "Unable to update GRV. It may only be edited on the day it was received."));
      }

      const grv = body as GrvDto;
      setGrvEditDialogOpen(false);
      setGrvEditTarget(null);
      await refreshStockSensitiveData();
      toast({
        title: "GRV updated",
        description: `Invoice ${grv.invoiceNumber} updated. Total incl. VAT ${moneyOrDash(grv.totalInclVat)}.`,
      });
    } catch (err) {
      setGrvEditError(err instanceof Error ? err.message : "Unable to update GRV.");
    } finally {
      setGrvEditSaving(false);
    }
  };

  const saveBulkGrvs = async (event: React.FormEvent) => {
    event.preventDefault();
    setGrvBulkError(null);
    setGrvBulkRowErrors([]);
    setGrvBulkResult(null);

    if (!grvBulkFile) {
      setGrvBulkError("Please select a CSV file.");
      return;
    }

    const lowerName = grvBulkFile.name.toLowerCase();
    const isCsvMime = grvBulkFile.type.toLowerCase().includes("csv");
    if (!lowerName.endsWith(".csv") && !isCsvMime) {
      setGrvBulkError("Invalid file type. Please upload a .csv file.");
      return;
    }

    let content = "";
    try {
      content = await grvBulkFile.text();
    } catch {
      setGrvBulkError("Unable to read the selected file.");
      return;
    }

    const nonEmptyLine = content
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    if (!nonEmptyLine) {
      setGrvBulkError("The selected CSV file is empty.");
      return;
    }

    // Header order doesn't matter; the required columns must be present. The server re-validates every row.
    const normalizedFoundHeaders = new Set(parseCsvHeaderLine(nonEmptyLine).map(normalizeCsvHeader));
    if (normalizedFoundHeaders.has("COST PER UNIT")) {
      setGrvBulkError(
        "The Cost Per Unit column has been replaced: use Unit Price (as written on the invoice) and Prices Include VAT (Y/N). Download the new template.",
      );
      return;
    }
    const missingHeaders = BULK_GRV_REQUIRED_HEADERS.filter((header) => !normalizedFoundHeaders.has(header));
    if (missingHeaders.length > 0) {
      setGrvBulkError(`The CSV is missing required columns: ${missingHeaders.join(", ")}. Download the template for the expected layout.`);
      return;
    }

    setGrvBulkUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", grvBulkFile);

      const res = await authFetch("/admin/grv/bulk-import", {
        method: "POST",
        body: formData,
      });
      const body = (await res.json().catch(() => null)) as BulkGrvImportResultDto | unknown;
      if (!res.ok || !body || typeof body !== "object") {
        // Row-level errors: the whole file was rejected and nothing was saved.
        const rowErrors =
          body && typeof body === "object" && Array.isArray((body as { errors?: unknown }).errors)
            ? ((body as { errors: unknown[] }).errors.filter((item): item is string => typeof item === "string"))
            : [];
        if (rowErrors.length > 0) {
          setGrvBulkRowErrors(rowErrors);
          throw new Error("Nothing was imported. Fix these rows and upload the file again:");
        }
        throw new Error(parseError(body, "Unable to bulk import GRVs."));
      }

      const result = body as BulkGrvImportResultDto;
      setGrvBulkResult(result);
      await refreshStockSensitiveData();
      toast({
        title: "GRV bulk import completed",
        description: `${result.created} GRV records created.`,
      });
    } catch (err) {
      setGrvBulkError(err instanceof Error ? err.message : "Unable to bulk import GRVs.");
    } finally {
      setGrvBulkUploading(false);
    }
  };

  const saveWaste = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!wasteLocationId) {
      setWasteError("Location is required.");
      return;
    }
    setWasteSaving(true);
    setWasteError(null);
    try {
      const res = await authFetch("/admin/waste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredientId: Number(wasteIngredientId),
          locationId: Number(wasteLocationId),
          quantity: Number(wasteQuantity),
          reason: wasteReason.trim(),
          note: wasteNote.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as WasteEntryDto | unknown;
      if (!res.ok || !body) {
        throw new Error(parseError(body, "Unable to record waste."));
      }

      const wasteEntry = body as WasteEntryDto;
      setWasteIngredientId("");
      setWasteLocationId("");
      setWasteQuantity("");
      setWasteReason("");
      setWasteNote("");
      await Promise.all([refreshStockSensitiveData(), fetchWasteEntries()]);
      toast({ title: "Waste recorded", description: `${wasteEntry.ingredientName} decreased by ${wasteEntry.quantity}.` });
    } catch (err) {
      setWasteError(err instanceof Error ? err.message : "Unable to record waste.");
    } finally {
      setWasteSaving(false);
    }
  };

  const saveStockTake = async (event: React.FormEvent) => {
    event.preventDefault();
    setStockTakeSaving(true);
    setStockTakeError(null);
    try {
      const ingredientId = Number(stockTakeIngredientId);
      const countedQuantity = Number(stockTakeCountedQuantity);

      const res = await authFetch("/admin/stock-takes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredientId,
          countedQuantity,
          note: stockTakeNote.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as StockTakeResponseDto | unknown;
      if (!res.ok || !body) {
        throw new Error(parseError(body, "Unable to record stock take."));
      }

      const ingredientName = ingredients.find((ingredient) => ingredient.id === ingredientId)?.name ?? "Ingredient";
      const response = body as StockTakeResponseDto;
      setStockTakeIngredientId("");
      setStockTakeCountedQuantity("");
      setStockTakeNote("");
      await Promise.all([refreshStockSensitiveData(), fetchStockTakes()]);
      toast({ title: "Stock take recorded", description: `${ingredientName} variance: ${response.variance > 0 ? "+" : ""}${response.variance}.` });
    } catch (err) {
      setStockTakeError(err instanceof Error ? err.message : "Unable to record stock take.");
    } finally {
      setStockTakeSaving(false);
    }
  };

  const addPurchaseOrderLine = () => {
    setPurchaseOrderLines((prev) => [
      ...prev,
      { id: `line-${Date.now()}-${prev.length}`, ingredientId: "", quantity: "", note: "" },
    ]);
  };

  const updatePurchaseOrderLine = (lineId: string, field: keyof PurchaseOrderDraftLine, value: string) => {
    setPurchaseOrderLines((prev) =>
      prev.map((line) => (line.id === lineId ? { ...line, [field]: value } : line)),
    );
  };

  const removePurchaseOrderLine = (lineId: string) => {
    setPurchaseOrderLines((prev) => (prev.length === 1 ? prev : prev.filter((line) => line.id !== lineId)));
  };

  const savePurchaseOrder = async (event: React.FormEvent) => {
    event.preventDefault();
    setPurchaseOrderSaving(true);
    setPurchaseOrderSaveError(null);
    try {
      const lines = purchaseOrderLines
        .filter((line) => line.ingredientId && line.quantity)
        .map((line) => ({
          ingredientId: Number(line.ingredientId),
          quantity: Number(line.quantity),
          note: line.note.trim() || undefined,
        }));

      if (!purchaseOrderSupplierName.trim() || lines.length === 0) {
        throw new Error("Supplier name and at least one complete line are required.");
      }

      const res = await authFetch("/admin/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierName: purchaseOrderSupplierName.trim(),
          lines,
        }),
      });
      const body = (await res.json().catch(() => null)) as PurchaseOrderDto | unknown;
      if (!res.ok || !body) {
        throw new Error(parseError(body, "Unable to create purchase order."));
      }

      setPurchaseOrderSupplierName("");
      setPurchaseOrderLines([{ id: "line-1", ingredientId: "", quantity: "", note: "" }]);
      await fetchPurchaseOrders();
      const purchaseOrder = body as PurchaseOrderDto;
      toast({ title: "Purchase order created", description: `${purchaseOrder.supplierName} order saved as ${purchaseOrder.status}.` });
    } catch (err) {
      setPurchaseOrderSaveError(err instanceof Error ? err.message : "Unable to create purchase order.");
    } finally {
      setPurchaseOrderSaving(false);
    }
  };

  const updatePurchaseOrderStatus = async (purchaseOrderId: number, status: PurchaseOrderStatus) => {
    setStatusSavingId(purchaseOrderId);
    try {
      const res = await authFetch(`/admin/purchase-orders/${purchaseOrderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = (await res.json().catch(() => null)) as PurchaseOrderDto | unknown;
      if (!res.ok || !body) {
        throw new Error(parseError(body, "Unable to update purchase order status."));
      }
      await fetchPurchaseOrders();
      toast({ title: "Purchase order updated", description: `Status changed to ${status}.` });
    } catch (err) {
      setPurchaseOrdersError(
        err instanceof Error ? err.message : "Unable to update purchase order status.",
      );
    } finally {
      setStatusSavingId(null);
    }
  };

  if (authLoading || !isAuthenticated || !canManageInventory(user?.role)) {
    return null;
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">Admin</BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Inventory</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <div className="flex gap-1 border-b">
            {([
              ["ingredients", "Ingredients"],
              ["grv", "GRV"],
              ["waste", "Waste"],
              ["stockTake", "Stock Take"],
              ["purchaseOrders", "Purchase Orders"],
            ] as Array<[InventoryTab, string]>)
              // Head Chefs manage inventory but not stock takes.
              .filter(([tab]) => tab !== "stockTake" || canManageStockTakes(user?.role))
              .map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === tab
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {activeTab === "ingredients" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Ingredient Master</h2>
                  <p className="text-sm text-muted-foreground">
                    Manage raw ingredients and see current stock derived from the movement ledger.
                  </p>
                </div>
                {canEditRecords ? (
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={openCategoryDialog}>
                      Manage Categories
                    </Button>
                    <Button size="sm" variant="outline" onClick={openBulkIngredientDialog}>
                      Bulk Upload CSV
                    </Button>
                    <Button size="sm" onClick={openCreateIngredient}>+ Add Ingredient</Button>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">View only</span>
                )}
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1 w-[220px]">
                  <Label htmlFor="ingredient-search">Search</Label>
                  <Input
                    id="ingredient-search"
                    value={ingredientSearch}
                    onChange={(event) => setIngredientSearch(event.target.value)}
                    placeholder="Search ingredients"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Count Sheet Category</Label>
                  <Select
                    value={(ingredientTable.getColumn("countSheetCategory")?.getFilterValue() as string) ?? "all"}
                    onValueChange={(value) =>
                      ingredientTable.getColumn("countSheetCategory")?.setFilterValue(value === "all" ? undefined : value)
                    }
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="All categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All categories</SelectItem>
                      {countSheetCategories.map((category) => (
                        <SelectItem key={category.id} value={category.name}>
                          {category.name}{category.active ? "" : " (inactive)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Active</Label>
                  <Select
                    value={
                      ingredientTable.getColumn("active")?.getFilterValue() === undefined
                        ? "all"
                        : String(ingredientTable.getColumn("active")?.getFilterValue())
                    }
                    onValueChange={(value) =>
                      ingredientTable.getColumn("active")?.setFilterValue(value === "all" ? undefined : value === "true")
                    }
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="true">Active</SelectItem>
                      <SelectItem value="false">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <span className="pb-2 text-sm text-muted-foreground whitespace-nowrap">
                  {ingredientTable.getFilteredRowModel().rows.length} of {ingredientTableRows.length} ingredients
                </span>
              </div>

              {ingredientsError && <p className="text-sm text-destructive">{ingredientsError}</p>}

              {ingredientsLoading ? (
                <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
              ) : (
                <div className="max-h-[65vh] overflow-y-auto rounded-md border">
                  <table className="w-full caption-bottom text-sm">
                    <TableHeader>
                      {ingredientTable.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id} className="sticky top-0 z-10 bg-background">
                          {headerGroup.headers.map((header) => (
                            <TableHead key={header.id}>
                              {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                            </TableHead>
                          ))}
                        </TableRow>
                      ))}
                    </TableHeader>
                    <TableBody>
                      {ingredientTable.getRowModel().rows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={ingredientTableColumns.length} className="py-8 text-center text-sm text-muted-foreground">
                            No ingredients found.
                          </TableCell>
                        </TableRow>
                      ) : (
                        ingredientTable.getRowModel().rows.map((row) => (
                          <TableRow key={row.id}>
                            {row.getVisibleCells().map((cell) => (
                              <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                            ))}
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === "grv" && (
            <div className="space-y-6">
              <div className="space-y-4 rounded-lg border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">GRV Entry</h2>
                    <p className="text-sm text-muted-foreground">
                      Receive ingredient stock into the ledger — one invoice, any number of lines.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setGrvViewDialogOpen(true)}>
                      View GRVs
                    </Button>
                    {canEditRecords && (
                      <Button type="button" size="sm" variant="outline" onClick={openGrvBulkDialog}>
                        Bulk Upload CSV
                      </Button>
                    )}
                  </div>
                </div>

                {canEditRecords ? (
                  <>
                {lastSavedGrv && (
                  <div className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50/60 p-4 text-sm dark:border-emerald-800 dark:bg-emerald-950/30">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        Saved: invoice {lastSavedGrv.invoiceNumber} · {lastSavedGrv.supplierName}{" "}
                        <InvoiceBasisChip pricesIncludeVat={lastSavedGrv.pricesIncludeVat} />
                      </p>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setLastSavedGrv(null)}>
                        Dismiss
                      </Button>
                    </div>
                    <p>
                      Excl. VAT {moneyOrDash(lastSavedGrv.totalExclVat)} · VAT {moneyOrDash(lastSavedGrv.totalVat)} · Incl. VAT{" "}
                      <span className="font-semibold">{moneyOrDash(lastSavedGrv.totalInclVat)}</span>
                    </p>
                    {lastSavedGrv.invoiceCheck && (
                      <p className="flex flex-wrap items-center gap-2">
                        Printed total {moneyOrDash(lastSavedGrv.invoiceTotalInclVat)} <InvoiceCheckChip check={lastSavedGrv.invoiceCheck} />
                        {lastSavedGrv.invoiceCheck.status === "WARN" && (
                          <span className="text-xs text-muted-foreground">Saved anyway. Check the invoice and edit today if needed.</span>
                        )}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">These are the saved figures. Stock is costed incl. VAT.</p>
                  </div>
                )}

                <LineItemSheet
                  key={grvSheetResetKey}
                  title="GRV"
                  requestType="GRV"
                  locationCount={0}
                  extraFieldsConfig={[
                    { key: "invoiceNumber", label: "Invoice Number", kind: "text-input", required: true },
                    { key: "supplierName", label: "Supplier Name", kind: "text-input", required: true },
                    { key: "note", label: "Note (optional)", kind: "text-input" },
                  ]}
                  columnConfig={{
                    reasonRequirement: "hidden",
                    quantityMode: { kind: "orderedReceived", receivedLabel: "Qty Received", showVariance: true },
                    // The VAT columns (excl. / VAT / incl.) replace the single line value.
                    showLineValue: false,
                    unitValueEditable: true,
                    unitValueLabel: "Unit Price (as invoiced)",
                  }}
                  vat={{ standardRate: vatRate }}
                  ingredientOptions={grvIngredientOptions}
                  requestedByName={user?.name ?? "Admin"}
                  submitLabel="Submit GRV"
                  onSubmit={handleGrvSubmit}
                  renderAboveLines={({ rows, addRow }) => (
                    <div className="space-y-3 rounded-lg border p-4">
                      <div className="space-y-1">
                        <Label>Purchase Order (optional)</Label>
                        <Select value={grvSelectedPurchaseOrderId} onValueChange={setGrvSelectedPurchaseOrderId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Link to a purchase order…" />
                          </SelectTrigger>
                          <SelectContent>
                            {purchaseOrders.map((po) => (
                              <SelectItem key={po.id} value={String(po.id)}>
                                PO-{po.id} — {po.supplierName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {selectedGrvPurchaseOrder && (
                        <div className="space-y-2">
                          <p className="text-sm font-medium">Outstanding lines</p>
                          {grvPoReceivedLoading ? (
                            <p className="text-sm text-muted-foreground animate-pulse">Loading received quantities…</p>
                          ) : (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Ingredient</TableHead>
                                  <TableHead>Ordered</TableHead>
                                  <TableHead>Already Received</TableHead>
                                  <TableHead>Outstanding</TableHead>
                                  <TableHead className="w-24" />
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {selectedGrvPurchaseOrder.lines.map((line) => {
                                  const alreadyReceived = grvPoReceivedByLine[line.id] ?? 0;
                                  const outstanding = line.quantity - alreadyReceived;
                                  const alreadyAdded = rows.some((row) => row.purchaseOrderLineId === line.id);
                                  const lineIngredient = ingredients.find((i) => i.id === line.ingredientId);
                                  return (
                                    <TableRow key={line.id}>
                                      <TableCell className="font-medium">{line.ingredientName}</TableCell>
                                      <TableCell>{line.quantity}</TableCell>
                                      <TableCell>{alreadyReceived}</TableCell>
                                      <TableCell>{outstanding}</TableCell>
                                      <TableCell>
                                        {alreadyAdded ? (
                                          <span className="text-xs text-muted-foreground">Already added</span>
                                        ) : (
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() =>
                                              addRow({
                                                ingredientId: line.ingredientId,
                                                ingredientName: line.ingredientName,
                                                unit: lineIngredient?.unit ?? null,
                                                purchaseOrderLineId: line.id,
                                                quantityOrdered: line.quantity,
                                              })
                                            }
                                          >
                                            Add
                                          </Button>
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                />
                  </>
                ) : (
                  <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                    GRVs are captured by an Admin or Stock Admin. Use View GRVs to see deliveries received.
                  </p>
                )}
              </div>
            </div>
          )}

          {activeTab === "waste" && (
            <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
              {canEditRecords ? (
              <form onSubmit={saveWaste} className="space-y-4 rounded-lg border p-4">
                <div>
                  <h2 className="text-lg font-semibold">Waste Entry</h2>
                  <p className="text-sm text-muted-foreground">Record stock losses without blocking service.</p>
                </div>

                <div className="space-y-1">
                  <Label>Ingredient</Label>
                  <Select value={wasteIngredientId} onValueChange={setWasteIngredientId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select an ingredient…" />
                    </SelectTrigger>
                    <SelectContent>
                      {ingredientOptions.map((ingredient) => (
                        <SelectItem key={ingredient.id} value={String(ingredient.id)}>{ingredient.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label>Location</Label>
                  <Select value={wasteLocationId} onValueChange={setWasteLocationId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a location…" />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((location) => (
                        <SelectItem key={location.id} value={String(location.id)}>{location.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="waste-qty">Quantity</Label>
                  <Input id="waste-qty" type="number" min="0.0001" step="0.0001" value={wasteQuantity} onChange={(event) => setWasteQuantity(event.target.value)} required />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="waste-reason">Reason</Label>
                  <Input id="waste-reason" value={wasteReason} onChange={(event) => setWasteReason(event.target.value)} required />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="waste-note">Note (optional)</Label>
                  <Input id="waste-note" value={wasteNote} onChange={(event) => setWasteNote(event.target.value)} />
                </div>

                {wasteError && <p className="text-sm text-destructive">{wasteError}</p>}

                <Button type="submit" disabled={wasteSaving} className="w-full">
                  {wasteSaving ? "Saving…" : "Record Waste"}
                </Button>
              </form>
              ) : (
                <div className="space-y-2 rounded-lg border p-4">
                  <h2 className="text-lg font-semibold">Waste Entry</h2>
                  <p className="text-sm text-muted-foreground">
                    Report waste as a request at the stock-movement station (New Waste Request); it is approved under Stock Requests.
                  </p>
                </div>
              )}

              <div className="space-y-4 rounded-lg border p-4">
                <div>
                  <h2 className="text-lg font-semibold">Recent Waste Entries</h2>
                  <p className="text-sm text-muted-foreground">Full history, sourced from the backend.</p>
                </div>
                {wasteEntriesError && <p className="text-sm text-destructive">{wasteEntriesError}</p>}
                {wasteEntriesLoading ? (
                  <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
                ) : wasteEntries.length > 0 ? (
                  <div className="space-y-3">
                    {wasteEntries.map((entry) => (
                      <div key={entry.id} className="space-y-1 rounded-md bg-muted p-4 text-sm">
                        <p><span className="font-medium">Ingredient:</span> {entry.ingredientName}</p>
                        {entry.locationName && <p><span className="font-medium">Location:</span> {entry.locationName}</p>}
                        <p><span className="font-medium">Quantity:</span> {entry.quantity}</p>
                        <p><span className="font-medium">Reason:</span> {entry.reason}</p>
                        {entry.note && <p><span className="font-medium">Note:</span> {entry.note}</p>}
                        <p><span className="font-medium">Recorded By:</span> {entry.recordedBy}</p>
                        <p><span className="font-medium">Recorded At:</span> {formatDateTime(entry.createdAt)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No waste entries recorded yet.</p>
                )}
              </div>
            </div>
          )}

          {activeTab === "stockTake" && canManageStockTakes(user?.role) && (
            <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
              <form onSubmit={saveStockTake} className="space-y-4 rounded-lg border p-4">
                <div>
                  <h2 className="text-lg font-semibold">Stock Take</h2>
                  <p className="text-sm text-muted-foreground">Reconcile expected stock to a physical count.</p>
                </div>

                <div className="space-y-1">
                  <Label>Ingredient</Label>
                  <Select value={stockTakeIngredientId} onValueChange={setStockTakeIngredientId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select an ingredient…" />
                    </SelectTrigger>
                    <SelectContent>
                      {ingredientOptions.map((ingredient) => (
                        <SelectItem key={ingredient.id} value={String(ingredient.id)}>{ingredient.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {stockTakeIngredientId && (
                  <div className="rounded-md bg-muted px-3 py-2 text-sm">
                    Expected stock (Main Store):{" "}
                    {ingredientStocks[Number(stockTakeIngredientId)]?.byLocation.find(
                      (entry) => entry.locationName === "Main Store",
                    )?.stock ?? 0}
                  </div>
                )}

                <div className="space-y-1">
                  <Label htmlFor="stock-counted">Counted Quantity</Label>
                  <Input id="stock-counted" type="number" step="0.0001" value={stockTakeCountedQuantity} onChange={(event) => setStockTakeCountedQuantity(event.target.value)} required />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="stock-note">Note (optional)</Label>
                  <Input id="stock-note" value={stockTakeNote} onChange={(event) => setStockTakeNote(event.target.value)} />
                </div>

                {stockTakeError && <p className="text-sm text-destructive">{stockTakeError}</p>}

                <Button type="submit" disabled={stockTakeSaving} className="w-full">
                  {stockTakeSaving ? "Saving…" : "Submit Stock Take"}
                </Button>
              </form>

              <div className="space-y-4 rounded-lg border p-4">
                <div>
                  <h2 className="text-lg font-semibold">Recent Stock Takes</h2>
                  <p className="text-sm text-muted-foreground">Full history, sourced from the backend. Expected quantity and variance are the historical values recorded at the time, not recalculated against current stock.</p>
                </div>
                {stockTakesError && <p className="text-sm text-destructive">{stockTakesError}</p>}
                {stockTakesLoading ? (
                  <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
                ) : stockTakes.length > 0 ? (
                  <div className="space-y-3">
                    {stockTakes.map((entry) => (
                      <div key={entry.id} className="space-y-1 rounded-md bg-muted p-4 text-sm">
                        <p><span className="font-medium">Ingredient:</span> {entry.ingredientName}</p>
                        <p><span className="font-medium">Expected:</span> {entry.expectedQuantity}</p>
                        <p><span className="font-medium">Counted:</span> {entry.countedQuantity}</p>
                        {entry.note && <p><span className="font-medium">Note:</span> {entry.note}</p>}
                        <p><span className="font-medium">Recorded By:</span> {entry.recordedBy}</p>
                        <p><span className="font-medium">Recorded At:</span> {formatDateTime(entry.createdAt)}</p>
                        <p className={entry.variance === 0 ? "font-medium" : entry.variance > 0 ? "font-medium text-emerald-700" : "font-medium text-rose-700"}>
                          Variance: {entry.variance > 0 ? "+" : ""}{entry.variance}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No stock takes recorded yet.</p>
                )}
              </div>
            </div>
          )}

          {activeTab === "purchaseOrders" && (
            <div className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
              <form onSubmit={savePurchaseOrder} className="space-y-4 rounded-lg border p-4">
                <div>
                  <h2 className="text-lg font-semibold">Create Purchase Order</h2>
                  <p className="text-sm text-muted-foreground">Purely informational. No stock or planning automation depends on it.</p>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="po-supplier">Supplier Name</Label>
                  <Input id="po-supplier" value={purchaseOrderSupplierName} onChange={(event) => setPurchaseOrderSupplierName(event.target.value)} required />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Lines</Label>
                    <Button type="button" variant="outline" size="sm" onClick={addPurchaseOrderLine}>Add Line</Button>
                  </div>

                  {purchaseOrderLines.map((line) => (
                    <div key={line.id} className="grid gap-3 rounded-md border p-3 md:grid-cols-[1.2fr_0.8fr_1fr_auto]">
                      <Select value={line.ingredientId} onValueChange={(value) => updatePurchaseOrderLine(line.id, "ingredientId", value)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Ingredient…" />
                        </SelectTrigger>
                        <SelectContent>
                          {ingredientOptions.map((ingredient) => (
                            <SelectItem key={ingredient.id} value={String(ingredient.id)}>{ingredient.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Input type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(event) => updatePurchaseOrderLine(line.id, "quantity", event.target.value)} placeholder="Quantity" />
                      <Input value={line.note} onChange={(event) => updatePurchaseOrderLine(line.id, "note", event.target.value)} placeholder="Line note" />
                      <Button type="button" variant="outline" onClick={() => removePurchaseOrderLine(line.id)}>Remove</Button>
                    </div>
                  ))}
                </div>

                {purchaseOrderSaveError && <p className="text-sm text-destructive">{purchaseOrderSaveError}</p>}

                <Button type="submit" disabled={purchaseOrderSaving} className="w-full">
                  {purchaseOrderSaving ? "Saving…" : "Create Purchase Order"}
                </Button>
              </form>

              <div className="space-y-4 rounded-lg border p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold">Purchase Orders</h2>
                    <p className="text-sm text-muted-foreground">Manual status updates only.</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => void fetchPurchaseOrders()} disabled={purchaseOrdersLoading}>
                    {purchaseOrdersLoading ? "Refreshing…" : "Refresh"}
                  </Button>
                </div>

                {purchaseOrdersError && <p className="text-sm text-destructive">{purchaseOrdersError}</p>}

                {purchaseOrdersLoading ? (
                  <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
                ) : purchaseOrders.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No purchase orders yet.</p>
                ) : (
                  <div className="space-y-3">
                    {purchaseOrders.map((purchaseOrder) => (
                      <div key={purchaseOrder.id} className="rounded-lg border p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold">{purchaseOrder.supplierName}</p>
                            <p className="text-xs text-muted-foreground">Created {formatDateTime(purchaseOrder.createdAt)}</p>
                            <Link href={`/inventory/purchase-orders/${purchaseOrder.id}`} className="text-xs text-primary hover:underline">
                              View
                            </Link>
                          </div>
                          <div className="flex items-center gap-2">
                            <Select
                              value={purchaseOrder.status}
                              onValueChange={(value: PurchaseOrderStatus) => void updatePurchaseOrderStatus(purchaseOrder.id, value)}
                            >
                              <SelectTrigger className="w-[150px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PURCHASE_ORDER_STATUSES.map((status) => (
                                  <SelectItem key={status} value={status}>{status}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {statusSavingId === purchaseOrder.id && <span className="text-xs text-muted-foreground">Saving…</span>}
                          </div>
                        </div>

                        <div className="mt-3 space-y-1 text-sm">
                          {purchaseOrder.lines.map((line, index) => (
                            <p key={`${purchaseOrder.id}-${index}`}>
                              {line.ingredientName}: {line.quantity}
                              {line.note ? ` · ${line.note}` : ""}
                            </p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <Dialog open={ingredientDialogOpen} onOpenChange={setIngredientDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingIngredient ? "Edit Ingredient" : "New Ingredient"}</DialogTitle>
            </DialogHeader>

            <form onSubmit={saveIngredient} className="space-y-4 pt-2">
              <div className="space-y-1">
                <Label htmlFor="ingredient-name">Name</Label>
                <Input id="ingredient-name" value={ingredientName} onChange={(event) => setIngredientName(event.target.value)} required />
              </div>

              <div className="space-y-1">
                <Label htmlFor="ingredient-item-code">Item Code (optional)</Label>
                <Input id="ingredient-item-code" value={ingredientItemCode} onChange={(event) => setIngredientItemCode(event.target.value)} />
              </div>

              <div className="space-y-1">
                <Label htmlFor="ingredient-default-vat">Default VAT</Label>
                <Select value={ingredientDefaultVatCode} onValueChange={(value) => setIngredientDefaultVatCode(value as VatCode)}>
                  <SelectTrigger id="ingredient-default-vat">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VAT_CODES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {vatCodeLabel(code, vatRate)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Pre-selected on GRV lines. Zero-rated staples (rice, samp, eggs, milk, cooking oil, fresh produce) should be set
                  here. Confirm with the accountant.
                </p>
              </div>

              <div className="space-y-1">
                <Label>Unit</Label>
                <Select value={ingredientUnit} onValueChange={(value: IngredientUnit) => setIngredientUnit(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INGREDIENT_UNITS.map((unit) => (
                      <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Count Sheet Category</Label>
                <Select value={ingredientCategoryId} onValueChange={setIngredientCategoryId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {ingredientCategoryOptions.map((category) => (
                      <SelectItem key={category.id} value={String(category.id)}>
                        {category.name}{category.active ? "" : " (inactive)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {countSheetCategoriesError && <p className="text-xs text-destructive">{countSheetCategoriesError}</p>}
              </div>

              {editingIngredient && (
                <div className="flex items-center gap-2">
                  <Checkbox id="ingredient-active" checked={ingredientActive} onCheckedChange={(value) => setIngredientActive(Boolean(value))} />
                  <Label htmlFor="ingredient-active">Active</Label>
                </div>
              )}

              {ingredientSaveError && <p className="text-sm text-destructive">{ingredientSaveError}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setIngredientDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={ingredientSaving}>{ingredientSaving ? "Saving…" : "Save"}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Count Sheet Categories</DialogTitle>
              <DialogDescription>
                Categories appear on the count sheet in the order shown. New categories are added at the end. Deactivate a
                category to hide it from new ingredients. Existing ingredients keep it.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              {countSheetCategories.length === 0 && (
                <p className="text-sm text-muted-foreground">{countSheetCategoriesError ?? "No categories yet."}</p>
              )}
              {countSheetCategories.map((category) => {
                const draft = categoryNameDrafts[category.id] ?? category.name;
                const nameChanged = normalizeCategoryName(draft) !== category.name;
                const saving = categorySavingId === category.id;
                return (
                  <div key={category.id} className="flex items-center gap-2">
                    <Input
                      value={draft}
                      onChange={(event) =>
                        setCategoryNameDrafts((current) => ({ ...current, [category.id]: event.target.value }))
                      }
                      maxLength={COUNT_SHEET_CATEGORY_NAME_MAX_LENGTH}
                      className={category.active ? "" : "text-muted-foreground"}
                      aria-label={`Name for ${category.name}`}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!nameChanged || saving}
                      onClick={() => void updateCountSheetCategory(category, { name: draft })}
                    >
                      Rename
                    </Button>
                    <div className="flex w-[90px] items-center gap-2">
                      <Checkbox
                        id={`category-active-${category.id}`}
                        checked={category.active}
                        disabled={saving}
                        onCheckedChange={(value) => void updateCountSheetCategory(category, { active: Boolean(value) })}
                      />
                      <Label htmlFor={`category-active-${category.id}`}>Active</Label>
                    </div>
                  </div>
                );
              })}
            </div>

            <form onSubmit={createCountSheetCategory} className="flex items-end gap-2 border-t pt-4">
              <div className="flex-1 space-y-1">
                <Label htmlFor="new-category-name">New category</Label>
                <Input
                  id="new-category-name"
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                  maxLength={COUNT_SHEET_CATEGORY_NAME_MAX_LENGTH}
                  placeholder="e.g. POULTRY"
                />
              </div>
              <Button type="submit" disabled={categorySavingId === "new" || !newCategoryName.trim()}>
                {categorySavingId === "new" ? "Adding…" : "Add"}
              </Button>
            </form>

            {categoryError && <p className="text-sm text-destructive">{categoryError}</p>}
            <p className="text-xs text-muted-foreground">
              Names are saved in uppercase and must be unique. Renaming updates every ingredient straight away, but CSV
              files that use the old name will fail to import.
            </p>
          </DialogContent>
        </Dialog>

        <Dialog open={bulkIngredientDialogOpen} onOpenChange={setBulkIngredientDialogOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Bulk Upload Ingredients (CSV)</DialogTitle>
            </DialogHeader>

            <form onSubmit={saveBulkIngredients} className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                Prepare a CSV file using the exact column order below, then upload it to import ingredients in bulk.
              </p>

              <div className="space-y-1">
                <Label htmlFor="bulk-ingredient-csv">CSV file</Label>
                <Input
                  id="bulk-ingredient-csv"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setBulkIngredientFile(file);
                    setBulkIngredientError(null);
                    setBulkImportResult(null);
                  }}
                />
                {bulkIngredientFile && (
                  <p className="text-xs text-muted-foreground">Selected: {bulkIngredientFile.name}</p>
                )}
              </div>

              <div className="rounded-md border bg-muted/40 p-3">
                <p className="mb-2 font-medium">Required header order:</p>
                <p className="font-mono text-xs">NAME,UNIT,COUNT SHEET[,DEFAULT VAT CODE]</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  DEFAULT VAT CODE is optional: STANDARD, ZERO_RATED or NO_VAT. A blank cell gives a new ingredient STANDARD and
                  leaves an existing ingredient&apos;s code unchanged.
                </p>
              </div>

              <div className="rounded-md border bg-muted/40 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="font-medium">Sample CSV:</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => downloadTextFile("ingredient-upload-template.csv", INGREDIENT_UPLOAD_TEMPLATE)}
                  >
                    Download template
                  </Button>
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed">
{bulkIngredientSampleCsv}
                </pre>
              </div>

              <div className="rounded-md border bg-muted/40 p-3">
                <p className="mb-2 font-medium">Valid COUNT SHEET values (not case-sensitive):</p>
                <p className="font-mono text-xs">
                  {activeCountSheetCategories.map((category) => category.name).join(", ") || "—"}
                </p>
              </div>

              {bulkIngredientError && <p className="text-sm text-destructive">{bulkIngredientError}</p>}

              {bulkImportResult && (
                <div className="rounded-md border bg-emerald-50 p-3 text-sm text-emerald-900">
                  Imported successfully: {bulkImportResult.created} created, {bulkImportResult.updated} updated.
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setBulkIngredientDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={bulkIngredientUploading || !bulkIngredientFile}>
                  {bulkIngredientUploading ? "Importing…" : "Import CSV"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={grvViewDialogOpen} onOpenChange={setGrvViewDialogOpen}>
          <DialogContent className="flex max-h-[85vh] w-[98vw] flex-col sm:max-w-[90vw]">
            <DialogHeader>
              <DialogTitle>Recent GRVs</DialogTitle>
              <DialogDescription>Filter by ingredient and date range.</DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label>Ingredient</Label>
                <Select value={grvFilterIngredientId} onValueChange={setGrvFilterIngredientId}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All ingredients</SelectItem>
                    {ingredients.map((ingredient) => (
                      <SelectItem key={ingredient.id} value={String(ingredient.id)}>{ingredient.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="grv-from">From</Label>
                <Input id="grv-from" type="date" value={grvFilterFrom} onChange={(event) => setGrvFilterFrom(event.target.value)} className="w-[150px]" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="grv-to">To</Label>
                <Input id="grv-to" type="date" value={grvFilterTo} onChange={(event) => setGrvFilterTo(event.target.value)} className="w-[150px]" />
              </div>
              <div className="space-y-1">
                <Label>Supplier</Label>
                <Select
                  value={(grvTable.getColumn("supplierName")?.getFilterValue() as string) ?? "all"}
                  onValueChange={(value) =>
                    grvTable.getColumn("supplierName")?.setFilterValue(value === "all" ? undefined : value)
                  }
                >
                  <SelectTrigger className="w-[170px]">
                    <SelectValue placeholder="All suppliers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All suppliers</SelectItem>
                    {grvSupplierOptions.map((supplier) => (
                      <SelectItem key={supplier} value={supplier}>{supplier}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 flex-1 min-w-[200px]">
                <Label htmlFor="grv-search">Search</Label>
                <Input
                  id="grv-search"
                  placeholder="Invoice, ingredient, supplier…"
                  value={grvTableSearch}
                  onChange={(event) => setGrvTableSearch(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label id="grv-view-mode-label">View</Label>
                <div role="radiogroup" aria-labelledby="grv-view-mode-label" className="inline-flex rounded-md border p-0.5">
                  {([
                    ["invoices", "By invoice"],
                    ["lines", "By line"],
                  ] as Array<[GrvViewMode, string]>).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={grvViewMode === mode}
                      onClick={() => setGrvViewMode(mode)}
                      className={`rounded px-3 py-1.5 text-sm font-medium ${
                        grvViewMode === mode ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <span className="pb-2 text-sm text-muted-foreground whitespace-nowrap">
                {grvViewMode === "invoices"
                  ? `${filteredGrvInvoices.length} of ${grvs.length} invoices`
                  : `${grvTable.getFilteredRowModel().rows.length} of ${grvTableRows.length} lines`}
              </span>
            </div>

            {grvError && <p className="text-sm text-destructive">{grvError}</p>}

            <div className="min-h-0 flex-1 overflow-auto rounded-md border">
              {grvLoading ? (
                <p className="p-4 text-sm text-muted-foreground animate-pulse">Loading…</p>
              ) : grvViewMode === "invoices" ? (
                <table className="w-full caption-bottom text-sm">
                  <TableHeader>
                    <TableRow className="sticky top-0 z-10 bg-background">
                      <TableHead>Invoice</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Prices</TableHead>
                      <TableHead className="text-right">Lines</TableHead>
                      <TableHead className="text-right">Total excl. VAT</TableHead>
                      <TableHead className="text-right">VAT</TableHead>
                      <TableHead className="text-right">Total incl. VAT</TableHead>
                      <TableHead>Invoice check</TableHead>
                      <TableHead>Received At</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredGrvInvoices.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">No GRVs found.</TableCell>
                      </TableRow>
                    ) : (
                      filteredGrvInvoices.map((grv) => {
                        // Recorded before VAT capture: only the incl. figures exist.
                        const legacy = grv.totalExclVat === null || grv.totalExclVat === undefined;
                        return (
                          <TableRow key={grv.id}>
                            <TableCell className="font-medium">{grv.invoiceNumber}</TableCell>
                            <TableCell>{grv.supplierName}</TableCell>
                            <TableCell>
                              <InvoiceBasisChip pricesIncludeVat={grv.pricesIncludeVat} />
                            </TableCell>
                            <TableCell className="text-right">{grv.lines.length}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {moneyOrDash(grv.totalExclVat)}
                              {legacy && <span className="block text-[11px] text-muted-foreground">Recorded before VAT capture</span>}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{moneyOrDash(grv.totalVat)}</TableCell>
                            <TableCell className="text-right font-medium tabular-nums">{moneyOrDash(grv.totalInclVat)}</TableCell>
                            <TableCell>
                              {grv.invoiceCheck ? <InvoiceCheckChip check={grv.invoiceCheck} /> : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">{formatDateTime(grv.receivedAt)}</TableCell>
                            <TableCell>
                              {canEditRecords && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!grvEditable(grv)}
                                  title={grvEditable(grv) ? undefined : "GRVs can only be edited on the day they were received"}
                                  onClick={() => openGrvEditDialog(grv)}
                                >
                                  Edit
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </table>
              ) : (
                <table className="w-full caption-bottom text-sm">
                  <TableHeader>
                    {grvTable.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id} className="sticky top-0 z-10 bg-background">
                        {headerGroup.headers.map((header) => (
                          <TableHead key={header.id}>
                            {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {grvTable.getRowModel().rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={grvTableColumns.length} className="py-8 text-center text-sm text-muted-foreground">No GRVs found.</TableCell>
                      </TableRow>
                    ) : (
                      grvTable.getRowModel().rows.map((row) => (
                        <TableRow key={row.id}>
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                          ))}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </table>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={grvEditDialogOpen} onOpenChange={setGrvEditDialogOpen}>
          <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>Edit GRV</DialogTitle>
              <DialogDescription>
                Corrections only — GRVs can only be edited on the day they were received.
              </DialogDescription>
            </DialogHeader>

            {grvEditTarget && (
              <form onSubmit={saveGrvEdit} className="flex-1 space-y-4 overflow-y-auto text-sm">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="grv-edit-invoice">Invoice Number</Label>
                    <Input
                      id="grv-edit-invoice"
                      value={grvEditInvoiceNumber}
                      onChange={(event) => setGrvEditInvoiceNumber(event.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="grv-edit-supplier">Supplier Name</Label>
                    <Input
                      id="grv-edit-supplier"
                      value={grvEditSupplierName}
                      onChange={(event) => setGrvEditSupplierName(event.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="grv-edit-note">Note (optional)</Label>
                  <Input id="grv-edit-note" value={grvEditNote} onChange={(event) => setGrvEditNote(event.target.value)} />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label id="grv-edit-basis-label">
                      Prices on this invoice <span className="text-destructive">*</span>
                    </Label>
                    <div>
                      <PricesIncludeVatToggle
                        value={grvEditPricesIncludeVat}
                        onChange={setGrvEditPricesIncludeVat}
                        labelId="grv-edit-basis-label"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="grv-edit-invoice-total">Invoice total incl. VAT (as printed, optional)</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        id="grv-edit-invoice-total"
                        type="number"
                        min="0"
                        step="0.01"
                        value={grvEditInvoiceTotal}
                        onChange={(event) => setGrvEditInvoiceTotal(event.target.value)}
                        className="w-36"
                      />
                      {grvEditVatPreview && grvEditVatPreview.check && <InvoiceCheckChip check={grvEditVatPreview.check} />}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Lines</Label>
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ingredient</TableHead>
                        <TableHead>Qty Received</TableHead>
                        <TableHead>Unit Price (as invoiced)</TableHead>
                        <TableHead>VAT</TableHead>
                        <TableHead className="text-right">Line excl.</TableHead>
                        <TableHead className="text-right">VAT</TableHead>
                        <TableHead className="text-right">Line incl.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {grvEditLines.map((line, index) => (
                        <TableRow key={line.id}>
                          <TableCell className="font-medium">{line.ingredientName}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0.0001"
                              step="0.0001"
                              value={line.quantityReceived}
                              onChange={(event) =>
                                setGrvEditLines((prev) =>
                                  prev.map((l, i) => (i === index ? { ...l, quantityReceived: event.target.value } : l)),
                                )
                              }
                              className="w-28"
                              required
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.unitPrice}
                              onChange={(event) =>
                                setGrvEditLines((prev) =>
                                  prev.map((l, i) => (i === index ? { ...l, unitPrice: event.target.value } : l)),
                                )
                              }
                              className="w-28"
                              required
                            />
                          </TableCell>
                          <TableCell>
                            <VatCodeSelect
                              value={line.vatCode}
                              onChange={(vatCode) =>
                                setGrvEditLines((prev) => prev.map((l, i) => (i === index ? { ...l, vatCode } : l)))
                              }
                              standardRate={vatRate}
                            />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {moneyOrDash(grvEditVatPreview?.lines[index]?.lineExclVat)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{moneyOrDash(grvEditVatPreview?.lines[index]?.lineVat)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {moneyOrDash(grvEditVatPreview?.lines[index]?.lineInclVat)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    {grvEditVatPreview && (
                      <TableBody>
                        <TableRow className="font-medium">
                          <TableCell colSpan={4}>Totals</TableCell>
                          <TableCell className="text-right tabular-nums">{moneyOrDash(grvEditVatPreview.totals.totalExclVat)}</TableCell>
                          <TableCell className="text-right tabular-nums">{moneyOrDash(grvEditVatPreview.totals.totalVat)}</TableCell>
                          <TableCell className="text-right tabular-nums">{moneyOrDash(grvEditVatPreview.totals.totalInclVat)}</TableCell>
                        </TableRow>
                      </TableBody>
                    )}
                  </Table>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    A preview using the current VAT rate. Saving recalculates everything, including stock.
                  </p>
                </div>

                {grvEditError && <p className="text-sm text-destructive">{grvEditError}</p>}

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setGrvEditDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={grvEditSaving}>
                    {grvEditSaving ? "Saving…" : "Save Changes"}
                  </Button>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={grvBulkDialogOpen} onOpenChange={setGrvBulkDialogOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Bulk Upload GRVs (CSV)</DialogTitle>
            </DialogHeader>

            <form onSubmit={saveBulkGrvs} className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                Enter each invoice exactly as written. Rows sharing an Invoice Number become one GRV with several lines, and must
                agree on supplier, Prices Include VAT and Invoice Total. The whole file is checked first: any error saves nothing.
              </p>

              <div className="space-y-1">
                <Label htmlFor="bulk-grv-csv">CSV file</Label>
                <Input
                  id="bulk-grv-csv"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setGrvBulkFile(file);
                    setGrvBulkError(null);
                    setGrvBulkRowErrors([]);
                    setGrvBulkResult(null);
                  }}
                />
                {grvBulkFile && (
                  <p className="text-xs text-muted-foreground">Selected: {grvBulkFile.name}</p>
                )}
              </div>

              <div className="space-y-2 rounded-md border bg-muted/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">Columns (any order)</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => downloadTextFile("grv-upload-template.csv", GRV_UPLOAD_TEMPLATE)}
                  >
                    Download template
                  </Button>
                </div>
                <p className="text-xs">
                  <span className="font-medium">Required:</span>{" "}
                  <span className="font-mono">{BULK_GRV_REQUIRED_HEADERS.join(", ")}</span>
                </p>
                <p className="text-xs">
                  <span className="font-medium">Optional:</span> <span className="font-mono">{BULK_GRV_OPTIONAL_HEADERS.join(", ")}</span>
                </p>
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                  <li>Unit Price is the price exactly as printed on the invoice.</li>
                  <li>Prices Include VAT: Y or N (Yes/No and True/False also work).</li>
                  <li>VAT Code: STANDARD, ZERO_RATED or NO_VAT. Leave blank to use the ingredient&apos;s default.</li>
                  <li>Invoice Total: the printed VAT-inclusive total, used to check the invoice.</li>
                </ul>
              </div>

              <div className="rounded-md border bg-muted/40 p-3">
                <p className="mb-2 font-medium">Sample CSV:</p>
                <pre className="overflow-x-auto whitespace-pre font-mono text-xs leading-relaxed">{GRV_UPLOAD_TEMPLATE}</pre>
              </div>

              {grvBulkError && <p className="text-sm text-destructive">{grvBulkError}</p>}
              {grvBulkRowErrors.length > 0 && (
                <ul className="max-h-40 list-disc space-y-1 overflow-y-auto rounded-md border border-destructive/40 bg-destructive/5 py-2 pl-7 pr-3 text-xs text-destructive">
                  {grvBulkRowErrors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              )}

              {grvBulkResult && (
                <div className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50/60 p-3 text-sm dark:border-emerald-800 dark:bg-emerald-950/30">
                  <p className="font-medium">Imported: {grvBulkResult.created} GRVs created. Compare each invoice with the paper copy:</p>
                  {(grvBulkResult.invoices ?? []).length > 0 && (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Invoice</TableHead>
                            <TableHead>Prices</TableHead>
                            <TableHead className="text-right">Lines</TableHead>
                            <TableHead className="text-right">Excl. VAT</TableHead>
                            <TableHead className="text-right">VAT</TableHead>
                            <TableHead className="text-right">Incl. VAT</TableHead>
                            <TableHead>Invoice check</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(grvBulkResult.invoices ?? []).map((invoice) => (
                            <TableRow key={invoice.invoiceNumber}>
                              <TableCell className="font-medium">{invoice.invoiceNumber}</TableCell>
                              <TableCell>
                                <InvoiceBasisChip pricesIncludeVat={invoice.pricesIncludeVat} />
                              </TableCell>
                              <TableCell className="text-right">{invoice.lineCount}</TableCell>
                              <TableCell className="text-right tabular-nums">{moneyOrDash(invoice.totalExclVat)}</TableCell>
                              <TableCell className="text-right tabular-nums">{moneyOrDash(invoice.totalVat)}</TableCell>
                              <TableCell className="text-right font-medium tabular-nums">{moneyOrDash(invoice.totalInclVat)}</TableCell>
                              <TableCell>
                                {invoice.invoiceCheck ? (
                                  <InvoiceCheckChip check={invoice.invoiceCheck} />
                                ) : (
                                  <span className="text-xs text-muted-foreground">No printed total</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setGrvBulkDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={grvBulkUploading || !grvBulkFile}>
                  {grvBulkUploading ? "Importing…" : "Import CSV"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </SidebarInset>
    </SidebarProvider>
  );
}