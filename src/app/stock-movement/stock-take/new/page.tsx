"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { isStockAccessRole } from "@/lib/roles";
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

function parseError(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) return record.message;
  if (typeof record.error === "string" && record.error.trim()) return record.error;
  return fallback;
}

export default function StockMovementNewStockTakePage() {
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

      // Unit Cost is server-snapshotted at submission for Stock Take — there's nothing to
      // auto-fill pre-submit, so Unit Value stays blank here (not an approximation from GRV
      // history, since it would just be misleading next to the frozen figure shown after review).
      setIngredientOptions(
        ingredients
          .filter((ingredient) => ingredient.active)
          .map((ingredient) => ({
            id: ingredient.id,
            name: ingredient.name,
            unit: ingredient.unit,
            unitValue: null,
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
      reasonRequirement: "hidden" as const,
      quantityMode: { kind: "expectedActual" as const, expectedLabel: "Expected Qty", actualLabel: "Actual Qty" },
      showLineValue: false,
      allowZeroQuantity: true,
      // Blind count: the clerk enters Actual Qty with no Unit Value/Expected/Variance figures
      // visible, so there's nothing to match their count against. Admin review shows all of it.
      revealExpectedAndVariance: false,
    }),
    [],
  );

  const handleSubmit = async (payload: LineItemSheetSubmitPayload) => {
    const res = await authFetch("/stock-takes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId: payload.locationIds[0],
        lines: payload.lines.map((line) => ({
          ingredientId: line.ingredientId,
          actualQuantity: line.quantity,
        })),
      }),
    });
    const body = (await res.json().catch(() => null)) as { id?: number } | unknown;
    if (!res.ok) {
      throw new Error(parseError(body, "Unable to submit stock take."));
    }

    const id = body && typeof body === "object" ? (body as { id?: number }).id : undefined;
    toast({
      title: "Stock take submitted",
      description: id ? `Stock Take #${id} sent for stock-admin authorization.` : "Sent for stock-admin authorization.",
    });
    // Stock Takes are a separate resource from /stock-requests — "My Requests" wouldn't show
    // this one, so return to the kiosk landing rather than a list that can't display it.
    router.push("/stock-movement");
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
              title="New Stock Take"
              requestType="STOCK_TAKE"
              locationCount={1}
              locationLabels={["Location"]}
              columnConfig={columnConfig}
              ingredientOptions={ingredientOptions}
              requestedByName={user?.name ?? "Stock Clerk"}
              submitLabel="Submit Stock Take"
              onSubmit={handleSubmit}
            />
          )}
        </div>
      </div>
    </div>
  );
}
