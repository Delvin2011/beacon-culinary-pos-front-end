"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { mostRecentCostByIngredient } from "@/lib/inventory-cost";
import { LineItemSheetReview } from "@/components/inventory/line-item-sheet-review";
import type {
  ActionedLine,
  LineItemColumnConfig,
  LineItemHeaderField,
  ReviewLine,
} from "@/components/inventory/line-item-sheet-types";

type IngredientUnit = "KG" | "LITRE" | "EACH";
type StockRequestType = "ISSUE" | "WASTE" | "ORDER";

type StockRequestLineDto = {
  id: number;
  ingredientId: number;
  ingredientName: string;
  requestedQuantity: number;
  actionedQuantity: number | null;
  reason?: string;
};

type StockRequestDetailDto = {
  id: number;
  requestType: StockRequestType;
  status: "REQUESTED" | "PARTIALLY_ACTIONED" | "ACTIONED" | "REJECTED";
  requestedByName: string;
  requestedAt: string;
  purchaseOrderId?: number;
  locationId?: number;
  locationName?: string;
  lines: StockRequestLineDto[];
};

type IngredientDto = {
  id: number;
  name: string;
  unit: IngredientUnit;
};

type GrvDto = {
  ingredientId: number;
  costPerUnit: number;
  receivedAt: string;
};

type IngredientStockDto = {
  totalStock: number;
  byLocation: { locationId: number; locationName: string; stock: number }[];
};

function formatDateTime(value?: string): string {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function parseError(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) return record.message;
  if (typeof record.error === "string" && record.error.trim()) return record.error;
  return fallback;
}

export default function StockRequestReviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user, authFetch } = useAuth();

  const [request, setRequest] = useState<StockRequestDetailDto | null>(null);
  const [ingredients, setIngredients] = useState<IngredientDto[]>([]);
  const [costByIngredient, setCostByIngredient] = useState<Record<number, number>>({});
  const [mainStoreStockByIngredient, setMainStoreStockByIngredient] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvedPurchaseOrderId, setApprovedPurchaseOrderId] = useState<number | null>(null);

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

  const fetchRequest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [requestRes, ingredientsRes, grvRes] = await Promise.all([
        authFetch(`/stock-requests/${params.id}`),
        authFetch("/admin/ingredients"),
        authFetch("/admin/grv"),
      ]);

      const body = (await requestRes.json().catch(() => null)) as StockRequestDetailDto | unknown;
      if (!requestRes.ok || !body) {
        throw new Error(parseError(body, "Unable to load this request."));
      }
      const detail = body as StockRequestDetailDto;
      setRequest(detail);

      const ingredientsBody = (await ingredientsRes.json().catch(() => null)) as IngredientDto[] | unknown;
      setIngredients(ingredientsRes.ok && Array.isArray(ingredientsBody) ? ingredientsBody : []);

      const grvBody = (await grvRes.json().catch(() => null)) as GrvDto[] | unknown;
      setCostByIngredient(grvRes.ok && Array.isArray(grvBody) ? mostRecentCostByIngredient(grvBody) : {});

      if (detail.requestType === "ISSUE") {
        const stockEntries = await Promise.all(
          detail.lines.map(async (line) => {
            try {
              const stockRes = await authFetch(`/admin/ingredients/${line.ingredientId}/stock`);
              const stockBody = (await stockRes.json().catch(() => null)) as IngredientStockDto | unknown;
              if (!stockRes.ok || !stockBody) return [line.ingredientId, 0] as const;
              const mainStore = (stockBody as IngredientStockDto).byLocation.find(
                (entry) => entry.locationName === "Main Store",
              );
              return [line.ingredientId, mainStore?.stock ?? 0] as const;
            } catch {
              return [line.ingredientId, 0] as const;
            }
          }),
        );
        setMainStoreStockByIngredient(Object.fromEntries(stockEntries));
      } else {
        setMainStoreStockByIngredient({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load this request.");
      setRequest(null);
    } finally {
      setLoading(false);
    }
  }, [authFetch, params.id]);

  useEffect(() => {
    if (isAuthenticated && user?.role?.toUpperCase().includes("ADMIN")) {
      void fetchRequest();
    }
  }, [fetchRequest, isAuthenticated, user]);

  const unitByIngredient = useMemo(
    () => Object.fromEntries(ingredients.map((ingredient) => [ingredient.id, ingredient.unit])),
    [ingredients],
  );

  const reviewLines: ReviewLine[] = useMemo(() => {
    if (!request) return [];
    return request.lines.map((line) => ({
      lineId: line.id,
      ingredientId: line.ingredientId,
      ingredientName: line.ingredientName,
      unit: unitByIngredient[line.ingredientId] ?? "EACH",
      unitValue: costByIngredient[line.ingredientId] ?? null,
      requestedQuantity: line.requestedQuantity,
      actionedQuantity: String(line.requestedQuantity),
      reason: line.reason ?? "",
    }));
  }, [request, unitByIngredient, costByIngredient]);

  const columnConfig: LineItemColumnConfig = useMemo(
    () => ({
      reasonRequirement: "optional",
      reasonLabel: request?.requestType === "ORDER" ? "Reason for Ordering" : "Reason",
      quantityMode: { kind: "single", label: "Actioned Qty" },
      showLineValue: true,
    }),
    [request?.requestType],
  );

  const extraFieldsConfig: LineItemHeaderField[] = useMemo(() => {
    if (request?.requestType !== "ORDER") return [];
    return [{ key: "supplierName", label: "Supplier Name", kind: "text-input", required: true }];
  }, [request?.requestType]);

  const capRule = useMemo(() => {
    if (!request) return undefined;
    if (request.requestType === "ISSUE") {
      return (line: ReviewLine) => mainStoreStockByIngredient[line.ingredientId];
    }
    if (request.requestType === "WASTE") {
      return (line: ReviewLine) => line.requestedQuantity;
    }
    // ORDER: no cap — the admin can freely adjust quantities up or down before approving.
    return undefined;
  }, [request, mainStoreStockByIngredient]);

  const capLabel =
    request?.requestType === "ISSUE" ? "Main Store Stock" : request?.requestType === "WASTE" ? "Requested Cap" : undefined;

  const handleApprove = async (payload: { lines: ActionedLine[]; extraFields: Record<string, string> }) => {
    if (!request) return;
    const res = await authFetch(`/stock-requests/${request.id}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lines: payload.lines,
        ...(request.requestType === "ORDER" ? { supplierName: payload.extraFields.supplierName } : {}),
      }),
    });
    const body = (await res.json().catch(() => null)) as StockRequestDetailDto | unknown;
    if (!res.ok) {
      throw new Error(parseError(body, "Unable to approve this request."));
    }

    const updated = body as StockRequestDetailDto;

    if (request.requestType === "ORDER" && updated.purchaseOrderId) {
      setApprovedPurchaseOrderId(updated.purchaseOrderId);
      return;
    }

    toast({ title: `${request.requestType} request actioned`, description: `Request #${request.id} — status ${updated.status}.` });
    router.push("/inventory/stock-requests");
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
                  <BreadcrumbPage>Stock Requests</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <Button variant="ghost" size="sm" className="w-fit" onClick={() => router.push("/inventory/stock-requests")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to queue
          </Button>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {approvedPurchaseOrderId && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <p className="font-medium">Order approved — Purchase Order created.</p>
              <Link href={`/inventory/purchase-orders/${approvedPurchaseOrderId}`} className="underline">
                View Purchase Order #{approvedPurchaseOrderId}
              </Link>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
          ) : request && !approvedPurchaseOrderId ? (
            <LineItemSheetReview
              title={`Review ${request.requestType} Request — #${request.id}`}
              headerInfo={[
                { label: "Requested By", value: request.requestedByName },
                { label: "Submitted", value: formatDateTime(request.requestedAt) },
                { label: "Status", value: request.status },
                ...(request.requestType === "WASTE" && request.locationName
                  ? [{ label: "Location", value: request.locationName }]
                  : []),
              ]}
              extraFieldsConfig={extraFieldsConfig}
              columnConfig={columnConfig}
              lines={reviewLines}
              capLabel={capLabel}
              capRule={capRule}
              approveLabel="Approve"
              onApprove={handleApprove}
            />
          ) : null}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
