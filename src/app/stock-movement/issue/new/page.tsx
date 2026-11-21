"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useLocations } from "@/hooks/use-locations";
import { readApiError } from "@/lib/api-error";
import { LocationError, chooseAgainMessage, defaultIssueLocationId, isChooseAgain } from "@/lib/locations";
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

export default function StockMovementNewIssuePage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user, authFetch } = useAuth();

  const hasStockAccess = isStockAccessRole(user?.role);
  const { primary, secondaries, loading: locationsLoading, error: locationsError, refetch: refetchLocations } = useLocations();

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
      quantityMode: { kind: "single" as const, label: "Qty" },
      showLineValue: true,
    }),
    [],
  );

  const handleSubmit = async (payload: LineItemSheetSubmitPayload) => {
    const locationId = payload.locationIds[0];
    const res = await authFetch("/stock-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestType: "ISSUE",
        locationId,
        lines: payload.lines.map((line) => ({
          ingredientId: line.ingredientId,
          quantity: line.quantity,
          reason: line.reason || undefined,
        })),
      }),
    });
    if (!res.ok) {
      // ISSUE_LOCATION_NOT_SECONDARY, LOCATION_INACTIVE, LOCATION_NOT_FOUND: reload the pickers, choose again.
      const error = new LocationError(await readApiError(res), "Unable to submit issue request.");
      if (isChooseAgain(error)) {
        await refetchLocations();
        throw new Error(chooseAgainMessage(error) ?? error.message);
      }
      const failure = await res.json().catch(() => null);
      throw new Error(parseError(failure, "Unable to submit issue request."));
    }
    const body = (await res.json().catch(() => null)) as { id?: number } | unknown;

    const id = body && typeof body === "object" ? (body as { id?: number }).id : undefined;
    toast({
      title: "Issue request submitted",
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
          {/* Only the first load: a reload after a refusal keeps the sheet (and its lines) on screen. */}
          {loadingIngredients || (locationsLoading && !primary) ? (
            <p className="text-sm text-muted-foreground animate-pulse">Loading ingredients…</p>
          ) : locationsError ? (
            <p role="alert" className="text-sm text-destructive">
              {locationsError}
            </p>
          ) : secondaries.length === 0 ? (
            <p role="alert" className="text-sm text-muted-foreground">
              There is no active location to issue to. An admin can add one under Admin → Stock locations.
            </p>
          ) : (
            <LineItemSheet
              title="New Issue Request"
              requestType="ISSUE"
              locationCount={1}
              locationLabels={["Requesting location"]}
              locationOptions={secondaries}
              defaultLocationIdByIndex={[defaultIssueLocationId(secondaries)]}
              headerInfo={primary ? [{ label: "Supplied from", value: primary.name }] : []}
              locationSummary={([id]) => {
                const to = secondaries.find((location) => location.id === id);
                return primary && to ? `From ${primary.name} to ${to.name}` : null;
              }}
              columnConfig={columnConfig}
              ingredientOptions={ingredientOptions}
              requestedByName={user?.name ?? "Stock Clerk"}
              submitLabel="Submit Issue Request"
              onSubmit={handleSubmit}
            />
          )}
        </div>
      </div>
    </div>
  );
}
