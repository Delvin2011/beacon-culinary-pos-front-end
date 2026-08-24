"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { isStockAccessRole } from "@/lib/roles";
import { mostRecentCostByIngredient } from "@/lib/inventory-cost";
import { LineItemSheet } from "@/components/inventory/line-item-sheet";
import { toast } from "@/hooks/use-toast";
import type { IngredientOption, LineItemSheetSubmitPayload } from "@/components/inventory/line-item-sheet-types";

type IngredientUnit = "KG" | "LITRE" | "EACH";

type IngredientDto = {
  id: number;
  name: string;
  unit: IngredientUnit;
  active: boolean;
  itemCode?: string;
};

type GrvDto = {
  ingredientId: number;
  costPerUnit: number;
  receivedAt: string;
};

function parseError(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) return record.message;
  if (typeof record.error === "string" && record.error.trim()) return record.error;
  return fallback;
}

export default function StockMovementNewOrderPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user, authFetch } = useAuth();

  const hasStockAccess = isStockAccessRole(user?.role);

  const [ingredientOptions, setIngredientOptions] = useState<IngredientOption[]>([]);
  const [loadingIngredients, setLoadingIngredients] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.replace("/stock-movement/login");
      return;
    }
    if (!hasStockAccess) {
      router.replace("/stock-movement/login");
    }
  }, [authLoading, hasStockAccess, isAuthenticated, router]);

  const fetchIngredientOptions = useCallback(async () => {
    setLoadingIngredients(true);
    try {
      const ingredientsRes = await authFetch("/admin/ingredients");
      const ingredientsBody = (await ingredientsRes.json().catch(() => null)) as IngredientDto[] | unknown;
      const ingredients = ingredientsRes.ok && Array.isArray(ingredientsBody) ? ingredientsBody : [];

      // Cost lookup requires GRV history, which this role may not have access to —
      // fall back to a blank Unit Value rather than blocking the screen.
      let costByIngredient: Record<number, number> = {};
      try {
        const grvRes = await authFetch("/admin/grv");
        const grvBody = (await grvRes.json().catch(() => null)) as GrvDto[] | unknown;
        if (grvRes.ok && Array.isArray(grvBody)) {
          costByIngredient = mostRecentCostByIngredient(grvBody);
        }
      } catch {
        // no-op — Unit Value stays blank for this session
      }

      setIngredientOptions(
        ingredients
          .filter((ingredient) => ingredient.active)
          .map((ingredient) => ({
            id: ingredient.id,
            name: ingredient.name,
            unit: ingredient.unit,
            unitValue: costByIngredient[ingredient.id] ?? null,
            itemCode: ingredient.itemCode ?? null,
          })),
      );
    } finally {
      setLoadingIngredients(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (isAuthenticated && hasStockAccess) {
      void fetchIngredientOptions();
    }
  }, [fetchIngredientOptions, hasStockAccess, isAuthenticated]);

  const columnConfig = useMemo(
    () => ({
      reasonRequirement: "optional" as const,
      reasonLabel: "Reason for Ordering",
      quantityMode: { kind: "single" as const, label: "Qty" },
      showLineValue: true,
    }),
    [],
  );

  const handleSubmit = async (payload: LineItemSheetSubmitPayload) => {
    const res = await authFetch("/stock-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestType: "ORDER",
        lines: payload.lines.map((line) => ({
          ingredientId: line.ingredientId,
          quantity: line.quantity,
          reason: line.reason || undefined,
        })),
      }),
    });
    const body = (await res.json().catch(() => null)) as { id?: number } | unknown;
    if (!res.ok) {
      throw new Error(parseError(body, "Unable to submit order request."));
    }

    const id = body && typeof body === "object" ? (body as { id?: number }).id : undefined;
    toast({
      title: "Order request submitted",
      description: id ? `Request #${id} sent for stock-admin authorization.` : "Sent for stock-admin authorization.",
    });
    router.push("/stock-movement/requests");
  };

  if (authLoading || !isAuthenticated || !hasStockAccess) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <span className="text-lg text-slate-400 animate-pulse">Loading...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <button
          type="button"
          onClick={() => router.push("/stock-movement")}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          {loadingIngredients ? (
            <p className="text-sm text-muted-foreground animate-pulse">Loading ingredients…</p>
          ) : (
            <LineItemSheet
              title="New Order Request"
              requestType="ORDER"
              locationCount={0}
              columnConfig={columnConfig}
              ingredientOptions={ingredientOptions}
              requestedByName={user?.name ?? "Stock Clerk"}
              submitLabel="Submit Order Request"
              onSubmit={handleSubmit}
            />
          )}
        </div>
      </div>
    </div>
  );
}
