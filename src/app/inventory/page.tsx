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
import { formatZarCurrency } from "@/lib/utils";
import { LineItemSheet } from "@/components/inventory/line-item-sheet";
import { useLocations } from "@/hooks/use-locations";
import type { IngredientOption, LineItemSheetSubmitPayload } from "@/components/inventory/line-item-sheet-types";

type InventoryTab = "ingredients" | "grv" | "waste" | "stockTake" | "purchaseOrders";
type IngredientUnit = "KG" | "LITRE" | "EACH";
type CountSheetCategory = "PREP" | "BULK" | "DRYSTOCK" | "FVEG";
type PurchaseOrderStatus = "DRAFT" | "SUBMITTED" | "RECEIVED";

type IngredientDto = {
  id: number;
  name: string;
  unit: IngredientUnit;
  countSheetCategory: CountSheetCategory;
  active: boolean;
  itemCode?: string;
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
  countSheetCategory: CountSheetCategory;
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
  lines: GrvLineDto[];
};

type GrvTableRow = {
  rowId: string;
  grvId: number;
  invoiceNumber: string;
  ingredientName: string;
  quantityReceived: number;
  quantityOrdered: number | null;
  receiptVariance: number | null;
  costPerUnit: number;
  supplierName: string;
  receivedAt: string;
};

type GrvEditLineState = {
  id: number;
  ingredientName: string;
  quantityReceived: string;
  costPerUnit: string;
};

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

type BulkGrvImportResultDto = {
  created: number;
  grvs: GrvDto[];
};

type PurchaseOrderDraftLine = {
  id: string;
  ingredientId: string;
  quantity: string;
  note: string;
};

const INGREDIENT_UNITS: IngredientUnit[] = ["KG", "LITRE", "EACH"];
const COUNT_SHEET_CATEGORIES: CountSheetCategory[] = ["PREP", "BULK", "DRYSTOCK", "FVEG"];
const PURCHASE_ORDER_STATUSES: PurchaseOrderStatus[] = ["DRAFT", "SUBMITTED", "RECEIVED"];
const BULK_INGREDIENT_HEADERS = ["NAME", "UNIT", "COUNT SHEET"] as const;
const BULK_GRV_HEADERS = ["INGREDIENT NAME", "QUANTITY", "COST PER UNIT", "SUPPLIER NAME", "NOTE (OPTIONAL)", "INVOICE NUMBER"] as const;

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
  const { locations } = useLocations();

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
  const [ingredientCategory, setIngredientCategory] = useState<CountSheetCategory>("PREP");
  const [ingredientActive, setIngredientActive] = useState(true);
  const [ingredientItemCode, setIngredientItemCode] = useState("");
  const [ingredientSaveError, setIngredientSaveError] = useState<string | null>(null);
  const [ingredientSaving, setIngredientSaving] = useState(false);

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
  const [grvEditLines, setGrvEditLines] = useState<GrvEditLineState[]>([]);
  const [grvEditError, setGrvEditError] = useState<string | null>(null);
  const [grvEditSaving, setGrvEditSaving] = useState(false);
  const [grvBulkDialogOpen, setGrvBulkDialogOpen] = useState(false);
  const [grvBulkFile, setGrvBulkFile] = useState<File | null>(null);
  const [grvBulkError, setGrvBulkError] = useState<string | null>(null);
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
    if (!user?.role?.toUpperCase().includes("ADMIN")) {
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
    if (isAuthenticated && user?.role?.toUpperCase().includes("ADMIN")) {
      void fetchIngredients();
      void fetchGrvs();
      void fetchPurchaseOrders();
      void fetchWasteEntries();
      void fetchStockTakes();
    }
  }, [fetchGrvs, fetchIngredients, fetchPurchaseOrders, fetchWasteEntries, fetchStockTakes, isAuthenticated, user]);

  useEffect(() => {
    if (!isAuthenticated || !user?.role?.toUpperCase().includes("ADMIN")) return;
    void fetchGrvs();
  }, [fetchGrvs, isAuthenticated, user]);

  const ingredientOptions = useMemo(
    () => ingredients.filter((ingredient) => ingredient.active),
    [ingredients],
  );

  // GRV never auto-fills cost — unlike Issue, the whole point is recording *this*
  // delivery's actual cost, so Unit Cost is always left blank for the user to enter.
  const grvIngredientOptions: IngredientOption[] = useMemo(
    () =>
      ingredientOptions.map((ingredient) => ({
        id: ingredient.id,
        name: ingredient.name,
        unit: ingredient.unit,
        unitValue: null,
        itemCode: ingredient.itemCode ?? null,
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
          ingredientName: line.ingredientName,
          quantityReceived: line.quantityReceived,
          quantityOrdered: line.quantityOrdered,
          receiptVariance: line.receiptVariance,
          costPerUnit: line.costPerUnit,
          supplierName: grv.supplierName,
          receivedAt: grv.receivedAt,
        })),
      ),
    [grvs],
  );

  const openGrvEditDialog = (grv: GrvDto) => {
    setGrvEditTarget(grv);
    setGrvEditInvoiceNumber(grv.invoiceNumber);
    setGrvEditSupplierName(grv.supplierName);
    setGrvEditNote(grv.note ?? "");
    setGrvEditLines(
      grv.lines.map((line) => ({
        id: line.id,
        ingredientName: line.ingredientName,
        quantityReceived: String(line.quantityReceived),
        costPerUnit: String(line.costPerUnit),
      })),
    );
    setGrvEditError(null);
    setGrvEditDialogOpen(true);
  };

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
        accessorKey: "costPerUnit",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Cost / Unit
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => formatZarCurrency(row.original.costPerUnit),
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
    [grvs],
  );

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

  const openCreateIngredient = () => {
    setEditingIngredient(null);
    setIngredientName("");
    setIngredientUnit("KG");
    setIngredientCategory("PREP");
    setIngredientActive(true);
    setIngredientItemCode("");
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
    setIngredientCategory(ingredient.countSheetCategory);
    setIngredientActive(ingredient.active);
    setIngredientItemCode(ingredient.itemCode ?? "");
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
          countSheetCategory: ingredient.countSheetCategory,
          totalStock: stock ? stock.totalStock : 0,
          stockByLocation: stock?.byLocation.map((entry) => `${entry.locationName}: ${entry.stock}`).join(" · ") ?? "",
          lastMovementAt: stock?.lastMovementAt,
          active: ingredient.active,
          ingredient,
        };
      }),
    [ingredients, ingredientStocks],
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
        cell: ({ row }) => (
          <Button size="sm" variant="outline" onClick={() => openEditIngredient(row.original.ingredient)}>
            Edit
          </Button>
        ),
      },
    ],
    [],
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

    setIngredientSaving(true);
    setIngredientSaveError(null);
    try {
      const payload = {
        name: ingredientName.trim(),
        unit: ingredientUnit,
        countSheetCategory: ingredientCategory,
        active: ingredientActive,
        itemCode: ingredientItemCode.trim() || undefined,
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
              countSheetCategory: payload.countSheetCategory,
              itemCode: payload.itemCode,
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
    const hasValidHeaders =
      normalizedFoundHeaders.length === normalizedExpectedHeaders.length &&
      normalizedFoundHeaders.every((header, index) => header === normalizedExpectedHeaders[index]);

    if (!hasValidHeaders) {
      setBulkIngredientError(
        `CSV header mismatch. Expected: ${expectedHeaders.join(",")}. Found: ${foundHeaders.join(",") || "(empty)"}.`,
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
    const res = await authFetch("/admin/grv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoiceNumber: payload.extraFields.invoiceNumber?.trim(),
        purchaseOrderId: grvSelectedPurchaseOrderId ? Number(grvSelectedPurchaseOrderId) : undefined,
        supplierName: payload.extraFields.supplierName?.trim(),
        note: payload.extraFields.note?.trim() || undefined,
        lines: payload.lines.map((line) => ({
          ingredientId: line.ingredientId,
          purchaseOrderLineId: line.purchaseOrderLineId ?? undefined,
          quantityReceived: line.quantity,
          costPerUnit: line.unitValue ?? 0,
        })),
      }),
    });
    const body = (await res.json().catch(() => null)) as GrvDto | unknown;
    if (!res.ok || !body) {
      throw new Error(parseError(body, "Unable to submit GRV."));
    }

    const grv = body as GrvDto;
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

    for (const line of grvEditLines) {
      const quantity = Number(line.quantityReceived);
      const cost = Number(line.costPerUnit);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setGrvEditError(`${line.ingredientName}: quantity received must be greater than 0.`);
        return;
      }
      if (!Number.isFinite(cost) || cost < 0) {
        setGrvEditError(`${line.ingredientName}: cost per unit must be 0 or more.`);
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
          supplierName: grvEditSupplierName.trim(),
          note: grvEditNote.trim() || undefined,
          lines: grvEditLines.map((line) => ({
            id: line.id,
            quantityReceived: Number(line.quantityReceived),
            costPerUnit: Number(line.costPerUnit),
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
        description: `Invoice ${grv.invoiceNumber} updated.`,
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

    const foundHeaders = parseCsvHeaderLine(nonEmptyLine);
    const expectedHeaders = [...BULK_GRV_HEADERS];
    const normalizedFoundHeaders = foundHeaders.map(normalizeCsvHeader);
    const normalizedExpectedHeaders = expectedHeaders.map(normalizeCsvHeader);

    const hasValidHeaders =
      normalizedFoundHeaders.length === normalizedExpectedHeaders.length &&
      normalizedFoundHeaders.every((header, index) => header === normalizedExpectedHeaders[index]);

    if (!hasValidHeaders) {
      setGrvBulkError(
        `CSV header mismatch. Expected: ${expectedHeaders.join(",")}. Found: ${foundHeaders.join(",") || "(empty)"}.`,
      );
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

  if (authLoading || !isAuthenticated || !user?.role?.toUpperCase().includes("ADMIN")) {
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
            ] as Array<[InventoryTab, string]>).map(([tab, label]) => (
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
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={openBulkIngredientDialog}>
                    Bulk Upload CSV
                  </Button>
                  <Button size="sm" onClick={openCreateIngredient}>+ Add Ingredient</Button>
                </div>
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
                      {COUNT_SHEET_CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>{category}</SelectItem>
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
                    <Button type="button" size="sm" variant="outline" onClick={openGrvBulkDialog}>
                      Bulk Upload CSV
                    </Button>
                  </div>
                </div>

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
                    showLineValue: true,
                    unitValueEditable: true,
                    unitValueLabel: "Unit Cost",
                  }}
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
              </div>
            </div>
          )}

          {activeTab === "waste" && (
            <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
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

          {activeTab === "stockTake" && (
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
                <Select value={ingredientCategory} onValueChange={(value: CountSheetCategory) => setIngredientCategory(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNT_SHEET_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>{category}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                <p className="font-mono text-xs">NAME,UNIT,COUNT SHEET</p>
              </div>

              <div className="rounded-md border bg-muted/40 p-3">
                <p className="mb-2 font-medium">Sample CSV:</p>
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed">
{`NAME,UNIT,COUNT SHEET
Tomato,KG,FVEG
Olive Oil,LITRE,PREP
Paper Straw,EACH,DRYSTOCK`}
                </pre>
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
              <span className="pb-2 text-sm text-muted-foreground whitespace-nowrap">
                {grvTable.getFilteredRowModel().rows.length} of {grvTableRows.length} lines
              </span>
            </div>

            {grvError && <p className="text-sm text-destructive">{grvError}</p>}

            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
              {grvLoading ? (
                <p className="p-4 text-sm text-muted-foreground animate-pulse">Loading…</p>
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
          <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
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

                <div className="space-y-2">
                  <Label>Lines</Label>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ingredient</TableHead>
                        <TableHead>Qty Received</TableHead>
                        <TableHead>Cost / Unit</TableHead>
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
                              value={line.costPerUnit}
                              onChange={(event) =>
                                setGrvEditLines((prev) =>
                                  prev.map((l, i) => (i === index ? { ...l, costPerUnit: event.target.value } : l)),
                                )
                              }
                              className="w-28"
                              required
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
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
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Bulk Upload GRVs (CSV)</DialogTitle>
            </DialogHeader>

            <form onSubmit={saveBulkGrvs} className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                Prepare your GRV CSV using the exact column order below, then upload to import GRVs in bulk.
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
                    setGrvBulkResult(null);
                  }}
                />
                {grvBulkFile && (
                  <p className="text-xs text-muted-foreground">Selected: {grvBulkFile.name}</p>
                )}
              </div>

              <div className="rounded-md border bg-muted/40 p-3">
                <p className="mb-2 font-medium">Required header order:</p>
                <p className="font-mono text-xs">INGREDIENT NAME,QUANTITY,COST PER UNIT,SUPPLIER NAME,NOTE (OPTIONAL),INVOICE NUMBER</p>
              </div>

              <div className="rounded-md border bg-muted/40 p-3">
                <p className="mb-2 font-medium">Sample CSV:</p>
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed">
{`INGREDIENT NAME,QUANTITY,COST PER UNIT,SUPPLIER NAME,NOTE (OPTIONAL),INVOICE NUMBER
Tomato,25,17.50,Fresh Farms,Weekly produce delivery,INV-1001
Olive Oil,12,89.00,Med Supply,,INV-1002
Paper Straw,500,0.35,Bar Essentials,Promo weekend restock,INV-1003`}
                </pre>
              </div>

              {grvBulkError && <p className="text-sm text-destructive">{grvBulkError}</p>}

              {grvBulkResult && (
                <div className="rounded-md border bg-emerald-50 p-3 text-sm text-emerald-900">
                  Imported successfully: {grvBulkResult.created} GRV records created.
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