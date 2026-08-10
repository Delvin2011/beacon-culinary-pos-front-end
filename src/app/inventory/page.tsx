"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
};

type IngredientStockDto = {
  currentStock: number;
  lastMovementAt?: string;
};

type GrvDto = {
  id: number;
  ingredientId: number;
  ingredientName: string;
  quantity: number;
  costPerUnit: number;
  supplierName: string;
  note?: string;
  receivedById?: number;
  receivedAt: string;
};

type WasteEntryDto = {
  id: number;
  ingredientId: number;
  ingredientName: string;
  quantity: number;
  reason: string;
  note?: string;
  createdAt: string;
};

type StockTakeResponseDto = {
  id: number;
  variance: number;
};

type PurchaseOrderLineDto = {
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

type PurchaseOrderDraftLine = {
  id: string;
  ingredientId: string;
  quantity: string;
  note: string;
};

type StockTakeHistoryEntry = {
  ingredientName: string;
  countedQuantity: number;
  expectedQuantity: number;
  variance: number;
  recordedAt: string;
};

const INGREDIENT_UNITS: IngredientUnit[] = ["KG", "LITRE", "EACH"];
const COUNT_SHEET_CATEGORIES: CountSheetCategory[] = ["PREP", "BULK", "DRYSTOCK", "FVEG"];
const PURCHASE_ORDER_STATUSES: PurchaseOrderStatus[] = ["DRAFT", "SUBMITTED", "RECEIVED"];

function parseError(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) return record.message;
  if (typeof record.error === "string" && record.error.trim()) return record.error;
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

function dateToApiBoundary(value: string, endOfDay: boolean): string | undefined {
  if (!value) return undefined;
  return `${value}T${endOfDay ? "23:59:59" : "00:00:00"}`;
}

export default function InventoryPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user, authFetch } = useAuth();

  const [activeTab, setActiveTab] = useState<InventoryTab>("ingredients");

  const [ingredients, setIngredients] = useState<IngredientDto[]>([]);
  const [ingredientStocks, setIngredientStocks] = useState<Record<number, IngredientStockDto>>({});
  const [ingredientsLoading, setIngredientsLoading] = useState(true);
  const [ingredientsError, setIngredientsError] = useState<string | null>(null);
  const [ingredientSearch, setIngredientSearch] = useState("");

  const [ingredientDialogOpen, setIngredientDialogOpen] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState<IngredientDto | null>(null);
  const [ingredientName, setIngredientName] = useState("");
  const [ingredientUnit, setIngredientUnit] = useState<IngredientUnit>("KG");
  const [ingredientCategory, setIngredientCategory] = useState<CountSheetCategory>("PREP");
  const [ingredientActive, setIngredientActive] = useState(true);
  const [ingredientSaveError, setIngredientSaveError] = useState<string | null>(null);
  const [ingredientSaving, setIngredientSaving] = useState(false);

  const [grvs, setGrvs] = useState<GrvDto[]>([]);
  const [grvLoading, setGrvLoading] = useState(false);
  const [grvError, setGrvError] = useState<string | null>(null);
  const [grvIngredientId, setGrvIngredientId] = useState("");
  const [grvQuantity, setGrvQuantity] = useState("");
  const [grvCostPerUnit, setGrvCostPerUnit] = useState("");
  const [grvSupplierName, setGrvSupplierName] = useState("");
  const [grvNote, setGrvNote] = useState("");
  const [grvSaveError, setGrvSaveError] = useState<string | null>(null);
  const [grvSaving, setGrvSaving] = useState(false);
  const [grvFilterIngredientId, setGrvFilterIngredientId] = useState("all");
  const [grvFilterFrom, setGrvFilterFrom] = useState("");
  const [grvFilterTo, setGrvFilterTo] = useState("");

  const [wasteIngredientId, setWasteIngredientId] = useState("");
  const [wasteQuantity, setWasteQuantity] = useState("");
  const [wasteReason, setWasteReason] = useState("");
  const [wasteNote, setWasteNote] = useState("");
  const [wasteError, setWasteError] = useState<string | null>(null);
  const [wasteSaving, setWasteSaving] = useState(false);
  const [recentWasteEntries, setRecentWasteEntries] = useState<WasteEntryDto[]>([]);

  const [stockTakeIngredientId, setStockTakeIngredientId] = useState("");
  const [stockTakeCountedQuantity, setStockTakeCountedQuantity] = useState("");
  const [stockTakeNote, setStockTakeNote] = useState("");
  const [stockTakeError, setStockTakeError] = useState<string | null>(null);
  const [stockTakeSaving, setStockTakeSaving] = useState(false);
  const [recentStockTakes, setRecentStockTakes] = useState<StockTakeHistoryEntry[]>([]);

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
            return [ingredient.id, { currentStock: 0 }] as const;
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
    }
  }, [fetchGrvs, fetchIngredients, fetchPurchaseOrders, isAuthenticated, user]);

  useEffect(() => {
    if (!isAuthenticated || !user?.role?.toUpperCase().includes("ADMIN")) return;
    void fetchGrvs();
  }, [fetchGrvs, isAuthenticated, user]);

  const ingredientOptions = useMemo(
    () => ingredients.filter((ingredient) => ingredient.active),
    [ingredients],
  );

  const filteredIngredients = useMemo(() => {
    const term = ingredientSearch.trim().toLowerCase();
    if (!term) return ingredients;
    return ingredients.filter((ingredient) => ingredient.name.toLowerCase().includes(term));
  }, [ingredientSearch, ingredients]);

  const openCreateIngredient = () => {
    setEditingIngredient(null);
    setIngredientName("");
    setIngredientUnit("KG");
    setIngredientCategory("PREP");
    setIngredientActive(true);
    setIngredientSaveError(null);
    setIngredientDialogOpen(true);
  };

  const openEditIngredient = (ingredient: IngredientDto) => {
    setEditingIngredient(ingredient);
    setIngredientName(ingredient.name);
    setIngredientUnit(ingredient.unit);
    setIngredientCategory(ingredient.countSheetCategory);
    setIngredientActive(ingredient.active);
    setIngredientSaveError(null);
    setIngredientDialogOpen(true);
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

  const saveGrv = async (event: React.FormEvent) => {
    event.preventDefault();
    setGrvSaving(true);
    setGrvSaveError(null);
    try {
      const res = await authFetch("/admin/grv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredientId: Number(grvIngredientId),
          quantity: Number(grvQuantity),
          costPerUnit: Number(grvCostPerUnit),
          supplierName: grvSupplierName.trim(),
          note: grvNote.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as GrvDto | unknown;
      if (!res.ok || !body) {
        throw new Error(parseError(body, "Unable to submit GRV."));
      }

      setGrvIngredientId("");
      setGrvQuantity("");
      setGrvCostPerUnit("");
      setGrvSupplierName("");
      setGrvNote("");
      await refreshStockSensitiveData();
      const grv = body as GrvDto;
      toast({ title: "GRV recorded", description: `${grv.ingredientName} stock increased by ${grv.quantity}.` });
    } catch (err) {
      setGrvSaveError(err instanceof Error ? err.message : "Unable to submit GRV.");
    } finally {
      setGrvSaving(false);
    }
  };

  const saveWaste = async (event: React.FormEvent) => {
    event.preventDefault();
    setWasteSaving(true);
    setWasteError(null);
    try {
      const res = await authFetch("/admin/waste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredientId: Number(wasteIngredientId),
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
      setRecentWasteEntries((prev) => [wasteEntry, ...prev].slice(0, 8));
      setWasteIngredientId("");
      setWasteQuantity("");
      setWasteReason("");
      setWasteNote("");
      await refreshStockSensitiveData();
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
      const expectedQuantity = ingredientStocks[ingredientId]?.currentStock ?? 0;
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
      setRecentStockTakes((prev) => [{
        ingredientName,
        countedQuantity,
        expectedQuantity,
        variance: response.variance,
        recordedAt: new Date().toISOString(),
      }, ...prev].slice(0, 8));
      setStockTakeIngredientId("");
      setStockTakeCountedQuantity("");
      setStockTakeNote("");
      await refreshStockSensitiveData();
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
                <Button size="sm" onClick={openCreateIngredient}>+ Add Ingredient</Button>
              </div>

              <Input
                value={ingredientSearch}
                onChange={(event) => setIngredientSearch(event.target.value)}
                placeholder="Search ingredients"
                className="max-w-sm"
              />

              {ingredientsError && <p className="text-sm text-destructive">{ingredientsError}</p>}

              {ingredientsLoading ? (
                <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Count Sheet Category</TableHead>
                      <TableHead>Current Stock</TableHead>
                      <TableHead>Last Movement</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead className="w-16" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredIngredients.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                          No ingredients found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredIngredients.map((ingredient) => {
                        const stock = ingredientStocks[ingredient.id];
                        return (
                          <TableRow key={ingredient.id}>
                            <TableCell className="font-medium">{ingredient.name}</TableCell>
                            <TableCell>{ingredient.unit}</TableCell>
                            <TableCell>{ingredient.countSheetCategory}</TableCell>
                            <TableCell>{stock ? `${stock.currentStock} ${ingredient.unit}` : `0 ${ingredient.unit}`}</TableCell>
                            <TableCell>{formatDateTime(stock?.lastMovementAt)}</TableCell>
                            <TableCell>{ingredient.active ? "Yes" : "No"}</TableCell>
                            <TableCell>
                              <Button size="sm" variant="outline" onClick={() => openEditIngredient(ingredient)}>
                                Edit
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              )}
            </div>
          )}

          {activeTab === "grv" && (
            <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
              <form onSubmit={saveGrv} className="space-y-4 rounded-lg border p-4">
                <div>
                  <h2 className="text-lg font-semibold">GRV Entry</h2>
                  <p className="text-sm text-muted-foreground">
                    Receive ingredient stock into the ledger.
                  </p>
                </div>

                <div className="space-y-1">
                  <Label>Ingredient</Label>
                  <Select value={grvIngredientId} onValueChange={setGrvIngredientId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select an ingredient…" />
                    </SelectTrigger>
                    <SelectContent>
                      {ingredientOptions.map((ingredient) => (
                        <SelectItem key={ingredient.id} value={String(ingredient.id)}>
                          {ingredient.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="grv-qty">Quantity</Label>
                    <Input id="grv-qty" type="number" min="0.0001" step="0.0001" value={grvQuantity} onChange={(event) => setGrvQuantity(event.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="grv-cost">Cost Per Unit</Label>
                    <Input id="grv-cost" type="number" min="0" step="0.01" value={grvCostPerUnit} onChange={(event) => setGrvCostPerUnit(event.target.value)} required />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="grv-supplier">Supplier Name</Label>
                  <Input id="grv-supplier" value={grvSupplierName} onChange={(event) => setGrvSupplierName(event.target.value)} required />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="grv-note">Note (optional)</Label>
                  <Input id="grv-note" value={grvNote} onChange={(event) => setGrvNote(event.target.value)} />
                </div>

                {grvSaveError && <p className="text-sm text-destructive">{grvSaveError}</p>}

                <Button type="submit" disabled={grvSaving} className="w-full">
                  {grvSaving ? "Submitting…" : "Submit GRV"}
                </Button>
              </form>

              <div className="space-y-4 rounded-lg border p-4">
                <div>
                  <h2 className="text-lg font-semibold">Recent GRVs</h2>
                  <p className="text-sm text-muted-foreground">Filter by ingredient and date range.</p>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1">
                    <Label>Ingredient</Label>
                    <Select value={grvFilterIngredientId} onValueChange={setGrvFilterIngredientId}>
                      <SelectTrigger>
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
                    <Input id="grv-from" type="date" value={grvFilterFrom} onChange={(event) => setGrvFilterFrom(event.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="grv-to">To</Label>
                    <Input id="grv-to" type="date" value={grvFilterTo} onChange={(event) => setGrvFilterTo(event.target.value)} />
                  </div>
                </div>

                {grvError && <p className="text-sm text-destructive">{grvError}</p>}

                {grvLoading ? (
                  <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ingredient</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Cost / Unit</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead>Received At</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {grvs.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">No GRVs found.</TableCell>
                        </TableRow>
                      ) : (
                        grvs.map((grv) => (
                          <TableRow key={grv.id}>
                            <TableCell className="font-medium">{grv.ingredientName}</TableCell>
                            <TableCell>{grv.quantity}</TableCell>
                            <TableCell>{formatZarCurrency(grv.costPerUnit)}</TableCell>
                            <TableCell>{grv.supplierName}</TableCell>
                            <TableCell>{formatDateTime(grv.receivedAt)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                )}
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
                  <p className="text-sm text-muted-foreground">Session history shown here because the current backend exposes create-only waste entry endpoints.</p>
                </div>
                {recentWasteEntries.length > 0 ? (
                  <div className="space-y-3">
                    {recentWasteEntries.map((entry) => (
                      <div key={entry.id} className="rounded-md bg-muted p-4 text-sm">
                        <p><span className="font-medium">Ingredient:</span> {entry.ingredientName}</p>
                        <p><span className="font-medium">Quantity:</span> {entry.quantity}</p>
                        <p><span className="font-medium">Reason:</span> {entry.reason}</p>
                        <p><span className="font-medium">Recorded At:</span> {formatDateTime(entry.createdAt)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Record a waste entry to build recent history for this session.</p>
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
                    Expected stock: {ingredientStocks[Number(stockTakeIngredientId)]?.currentStock ?? 0}
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
                  <p className="text-sm text-muted-foreground">Session history shown here because the current backend exposes create-only stock-take endpoints.</p>
                </div>
                {recentStockTakes.length > 0 ? (
                  <div className="space-y-3">
                    {recentStockTakes.map((entry, index) => (
                      <div key={`${entry.recordedAt}-${index}`} className="space-y-3 rounded-md bg-muted p-4 text-sm">
                        <p><span className="font-medium">Ingredient:</span> {entry.ingredientName}</p>
                        <p><span className="font-medium">Expected:</span> {entry.expectedQuantity}</p>
                        <p><span className="font-medium">Counted:</span> {entry.countedQuantity}</p>
                        <p><span className="font-medium">Recorded At:</span> {formatDateTime(entry.recordedAt)}</p>
                        <p className={entry.variance === 0 ? "font-medium" : entry.variance > 0 ? "font-medium text-emerald-700" : "font-medium text-rose-700"}>
                          Variance: {entry.variance > 0 ? "+" : ""}{entry.variance}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Submit a stock take to build recent history for this session.</p>
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
      </SidebarInset>
    </SidebarProvider>
  );
}