"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { formatZarCurrency } from "@/lib/utils";

type IngredientUnit = "KG" | "LITRE" | "EACH";
type StockTakeStatus = "SUBMITTED" | "APPROVED" | "REJECTED";

type StockTakeLineDto = {
  id: number;
  ingredientId: number;
  ingredientName: string;
  expectedQuantity: number;
  actualQuantity: number;
  unitCost: number;
  varianceQuantity: number;
  varianceValue: number;
  appliedAdjustmentQuantity: number | null;
};

type StockTakeDto = {
  id: number;
  locationId: number;
  locationName: string;
  submittedById: number;
  submittedByName: string;
  submittedAt: string;
  status: StockTakeStatus;
  reviewedById?: number;
  reviewedAt?: string;
  note?: string;
  lines: StockTakeLineDto[];
};

type IngredientDto = {
  id: number;
  unit: IngredientUnit;
};

const EPSILON = 0.0001;

function formatDateTime(value?: string): string {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function varianceClassName(variance: number): string {
  if (variance < 0) return "font-medium text-rose-700";
  if (variance > 0) return "font-medium text-emerald-700";
  return "font-medium";
}

function parseError(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) return record.message;
  if (typeof record.error === "string" && record.error.trim()) return record.error;
  return fallback;
}

export default function StockTakeReviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user, authFetch } = useAuth();

  const [stockTake, setStockTake] = useState<StockTakeDto | null>(null);
  const [unitByIngredient, setUnitByIngredient] = useState<Record<number, IngredientUnit>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reviewedLines, setReviewedLines] = useState<StockTakeLineDto[] | null>(null);

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

  const fetchStockTake = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [stockTakeRes, ingredientsRes] = await Promise.all([
        authFetch(`/stock-takes/${params.id}`),
        authFetch("/admin/ingredients"),
      ]);

      const body = (await stockTakeRes.json().catch(() => null)) as StockTakeDto | unknown;
      if (!stockTakeRes.ok || !body) {
        throw new Error(parseError(body, "Unable to load this stock take."));
      }
      setStockTake(body as StockTakeDto);

      const ingredientsBody = (await ingredientsRes.json().catch(() => null)) as IngredientDto[] | unknown;
      if (ingredientsRes.ok && Array.isArray(ingredientsBody)) {
        setUnitByIngredient(Object.fromEntries(ingredientsBody.map((i) => [i.id, i.unit])));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load this stock take.");
      setStockTake(null);
    } finally {
      setLoading(false);
    }
  }, [authFetch, params.id]);

  useEffect(() => {
    if (isAuthenticated && user?.role?.toUpperCase().includes("ADMIN")) {
      void fetchStockTake();
    }
  }, [fetchStockTake, isAuthenticated, user]);

  const discrepancies = useMemo(() => {
    if (!reviewedLines) return [];
    return reviewedLines.filter(
      (line) =>
        line.appliedAdjustmentQuantity !== null &&
        Math.abs(line.appliedAdjustmentQuantity - line.varianceQuantity) > EPSILON,
    );
  }, [reviewedLines]);

  const submitDecision = async (decision: "APPROVE" | "REJECT") => {
    if (!stockTake) return;
    if (decision === "REJECT" && !note.trim()) {
      setError("A note is required to reject a stock take.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await authFetch(`/stock-takes/${stockTake.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: note.trim() || undefined }),
      });
      const body = (await res.json().catch(() => null)) as StockTakeDto | unknown;
      if (!res.ok || !body) {
        throw new Error(parseError(body, "Unable to submit this review."));
      }

      const updated = body as StockTakeDto;
      setStockTake(updated);
      setReviewedLines(updated.lines);
      toast({
        title: decision === "APPROVE" ? "Stock take approved" : "Stock take rejected",
        description: `Stock Take #${updated.id} — status ${updated.status}.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit this review.");
    } finally {
      setSubmitting(false);
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
                  <BreadcrumbPage>Stock Takes</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <Button variant="ghost" size="sm" className="w-fit" onClick={() => router.push("/inventory/stock-takes")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to queue
          </Button>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {loading ? (
            <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
          ) : stockTake ? (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Review Stock Take — #{stockTake.id}</h2>
              </div>

              <div className="grid gap-4 rounded-lg border p-4 md:grid-cols-4">
                <div className="space-y-1">
                  <Label>Location</Label>
                  <p className="text-sm text-muted-foreground">{stockTake.locationName}</p>
                </div>
                <div className="space-y-1">
                  <Label>Submitted By</Label>
                  <p className="text-sm text-muted-foreground">{stockTake.submittedByName}</p>
                </div>
                <div className="space-y-1">
                  <Label>Submitted</Label>
                  <p className="text-sm text-muted-foreground">{formatDateTime(stockTake.submittedAt)}</p>
                </div>
                <div className="space-y-1">
                  <Label>Status</Label>
                  <p className="text-sm text-muted-foreground">{stockTake.status}</p>
                </div>
              </div>

              {discrepancies.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <p className="font-medium">Applied adjustment differs from the originally counted variance:</p>
                  <div className="mt-2 space-y-1">
                    {discrepancies.map((line) => (
                      <p key={line.id}>
                        {line.ingredientName}: applied adjustment {line.appliedAdjustmentQuantity} (originally counted
                        variance was {line.varianceQuantity} — stock moved before this was reviewed).
                      </p>
                    ))}
                  </div>
                </div>
              )}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ingredient</TableHead>
                    <TableHead>UoM</TableHead>
                    <TableHead>Expected Qty</TableHead>
                    <TableHead>Actual Qty</TableHead>
                    <TableHead>Variance Qty</TableHead>
                    <TableHead>Variance Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stockTake.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="font-medium">{line.ingredientName}</TableCell>
                      <TableCell>{unitByIngredient[line.ingredientId] ?? "—"}</TableCell>
                      <TableCell>{line.expectedQuantity}</TableCell>
                      <TableCell>{line.actualQuantity}</TableCell>
                      <TableCell>
                        <span className={varianceClassName(line.varianceQuantity)}>
                          {line.varianceQuantity > 0 ? "+" : ""}
                          {line.varianceQuantity}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={varianceClassName(line.varianceValue)}>
                          {line.varianceValue > 0 ? "+" : ""}
                          {formatZarCurrency(line.varianceValue)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {stockTake.status === "SUBMITTED" ? (
                <div className="space-y-4 rounded-lg border p-4">
                  <div className="space-y-1">
                    <Label htmlFor="review-note">Note (required to reject, optional to approve)</Label>
                    <Input id="review-note" value={note} onChange={(event) => setNote(event.target.value)} />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1"
                      disabled={submitting || !note.trim()}
                      onClick={() => void submitDecision("REJECT")}
                    >
                      {submitting ? "Submitting…" : "Reject"}
                    </Button>
                    <Button type="button" className="flex-1" disabled={submitting} onClick={() => void submitDecision("APPROVE")}>
                      {submitting ? "Submitting…" : "Approve"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border bg-muted/40 px-4 py-3 text-sm">
                  <p className="font-medium">Already reviewed — {stockTake.status}</p>
                  {stockTake.note && <p className="mt-1 text-muted-foreground">Note: {stockTake.note}</p>}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
