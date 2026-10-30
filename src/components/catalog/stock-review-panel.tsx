"use client"

import { useCallback, useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { toast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { RequestStockDialog } from "@/components/catalog/request-stock-dialog"
import { StockStatusChip } from "@/components/catalog/stock-status-chip"
import { canToggleOutToday, setOutToday } from "@/lib/catalog"
import { type StockReview, type StockStatus, fetchStockReview, formatQuantityWithUom } from "@/lib/light-meal-stock"
import { canRequestIssue } from "@/lib/roles"
import { cn, formatZarCurrency } from "@/lib/utils"

// The list row the panel was opened from: the review doesn't repeat category and price.
export interface StockReviewMeal {
  id: number
  name: string
  categoryName?: string | null
  price?: number | null
}

// Fields to patch into the list row, so its chip doesn't go stale.
export interface StockRowPatch {
  stockStatus?: StockStatus | null
  unitsAvailable?: number | null
  lowStockUnits?: number
  outToday?: boolean
}

interface StockReviewPanelProps {
  meal: StockReviewMeal | null
  onOpenChange: (open: boolean) => void
  onStockChange: (mealId: number, patch: StockRowPatch) => void
}

const STATUS_TITLES: Record<StockStatus, string> = { OK: "OK", LOW: "Low", OUT: "Out", NOT_TRACKED: "Not tracked" }

function signedClass(value: number): string | undefined {
  return value < 0 ? "font-medium text-rose-600 dark:text-rose-400" : undefined
}

// A light meal's stock: per-unit ingredients, Kitchen and Main Store amounts, how many units can be made. Opened by
// the Review button in Catalogue Management and Daily Planning.
export function StockReviewPanel({ meal, onOpenChange, onStockChange }: StockReviewPanelProps) {
  const { authFetch, user } = useAuth()
  const [review, setReview] = useState<StockReview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savingOut, setSavingOut] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)

  const canMarkOut = canToggleOutToday(user?.role, "LIGHT_MEALS")
  const canRequest = canRequestIssue(user?.role)
  const mealId = meal?.id ?? null

  const load = useCallback(
    async (id: number) => {
      setLoading(true)
      setError(null)
      try {
        const next = await fetchStockReview(authFetch, id)
        setReview(next)
        onStockChange(id, {
          stockStatus: next.status,
          unitsAvailable: next.unitsAvailable,
          lowStockUnits: next.lowStockUnits,
          outToday: next.outToday,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load the stock review.")
      } finally {
        setLoading(false)
      }
    },
    // onStockChange is a parent callback; reloading on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authFetch],
  )

  useEffect(() => {
    setReview(null)
    setRequestOpen(false)
    if (mealId !== null) void load(mealId)
  }, [mealId, load])

  const toggleOut = async () => {
    if (!review) return
    setSavingOut(true)
    try {
      const updated = await setOutToday<{ outToday: boolean; stockStatus?: StockStatus | null; unitsAvailable?: number | null }>(
        authFetch,
        review.mealId,
        !review.outToday,
      )
      setReview((prev) => (prev ? { ...prev, outToday: updated.outToday, status: updated.stockStatus ?? prev.status } : prev))
      onStockChange(review.mealId, {
        outToday: updated.outToday,
        ...(updated.stockStatus !== undefined ? { stockStatus: updated.stockStatus } : {}),
        ...(updated.unitsAvailable !== undefined ? { unitsAvailable: updated.unitsAvailable } : {}),
      })
      toast({
        title: updated.outToday ? `${review.name} is out today` : `${review.name} is back in stock`,
        description: updated.outToday ? "It comes back automatically tomorrow." : undefined,
      })
    } catch (err) {
      // setOutToday maps OUT_TODAY_NOT_PERMITTED to a plain message.
      const message = err instanceof Error ? err.message : undefined
      toast({
        title: "Couldn't change availability",
        description: message === "You can't change Out today for this item." ? "You can't change this meal's availability." : message,
        variant: "destructive",
      })
    } finally {
      setSavingOut(false)
    }
  }

  const warning = review?.tracked && (review.status === "LOW" || review.status === "OUT") ? review.status : null

  const outButton = canMarkOut && review && (
    <Button size="sm" variant={review.outToday ? "default" : "outline"} disabled={savingOut} onClick={() => void toggleOut()}>
      {savingOut ? "Saving…" : review.outToday ? "Back in stock" : "Mark out today"}
    </Button>
  )
  const requestButton = canRequest && review && (
    <Button size="sm" variant={warning ? "default" : "outline"} onClick={() => setRequestOpen(true)}>
      Request stock
    </Button>
  )

  return (
    <Sheet open={meal !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <SheetHeader className="space-y-2 border-b p-6 pr-12">
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle>{meal?.name ?? review?.name ?? "Stock review"}</SheetTitle>
            {review && <StockStatusChip status={review.status} size="lg" label={STATUS_TITLES[review.status] ?? review.status} />}
            {review?.outToday && (
              <span className="rounded-full border border-rose-300 bg-rose-100 px-2 py-0.5 text-xs font-semibold uppercase text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300">
                Out today
              </span>
            )}
          </div>
          <SheetDescription>
            {[meal?.categoryName, meal?.price != null ? formatZarCurrency(meal.price) : null].filter(Boolean).join(" · ") || "Light meal"}
          </SheetDescription>
          {review?.tracked && (
            <p className="text-sm font-medium">
              Can make {review.unitsAvailable ?? 0} unit{review.unitsAvailable === 1 ? "" : "s"}.
              {review.limitingIngredient ? ` Limited by ${review.limitingIngredient}.` : ""}
            </p>
          )}
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Ingredients for one unit</h3>
            <Button size="sm" variant="ghost" disabled={loading || mealId === null} onClick={() => mealId !== null && void load(mealId)}>
              <RefreshCw className={cn("mr-2 h-3.5 w-3.5", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          {loading && !review ? (
            <p className="text-sm text-muted-foreground animate-pulse">Loading stock…</p>
          ) : !review ? null : !review.tracked ? (
            <div className="rounded-md border bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Stock not tracked</p>
              <p className="mt-1">No recipe is defined for this meal, so stock isn&apos;t tracked. Add components with recipes to track it.</p>
            </div>
          ) : (
            <>
              {warning && (
                <div
                  role="alert"
                  className={cn(
                    "space-y-3 rounded-md border px-4 py-3 text-sm",
                    warning === "OUT"
                      ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
                      : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
                  )}
                >
                  <p className="font-medium">
                    {warning === "OUT"
                      ? "The Kitchen doesn't have enough to make one unit."
                      : `Only ${review.unitsAvailable ?? 0} unit${review.unitsAvailable === 1 ? " can" : "s can"} be made. The low-stock level for this meal is ${review.lowStockUnits}.`}
                  </p>
                  <p className="text-xs opacity-80">
                    {review.outToday ? "Out for today. Back automatically tomorrow." : "It can still be sold unless you mark it out."}
                  </p>
                  {(outButton || requestButton) && (
                    <div className="flex flex-wrap gap-2">
                      {outButton}
                      {requestButton}
                    </div>
                  )}
                </div>
              )}

              {!warning && review.outToday && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-4 py-3 text-sm">
                  <span>Out for today. Back automatically tomorrow.</span>
                  {outButton}
                </div>
              )}

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ingredient</TableHead>
                      <TableHead className="text-right">Needed per unit</TableHead>
                      <TableHead className="text-right">In Kitchen</TableHead>
                      <TableHead className="text-right">Main Store</TableHead>
                      <TableHead className="text-right">Units possible</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {review.lines.map((line) => {
                      const limiting = line.name === review.limitingIngredient
                      return (
                        <TableRow key={line.ingredientId} className={cn(limiting && "bg-amber-50/70 dark:bg-amber-950/40")}>
                          <TableCell className="font-medium">
                            {line.name}
                            {limiting && <span className="ml-2 text-xs font-normal text-muted-foreground">Limiting</span>}
                          </TableCell>
                          <TableCell className="text-right">{formatQuantityWithUom(line.perUnit, line.uom)}</TableCell>
                          <TableCell className={cn("text-right", signedClass(line.kitchenAvailable))}>
                            {formatQuantityWithUom(line.kitchenAvailable, line.uom)}
                          </TableCell>
                          <TableCell className={cn("text-right", signedClass(line.mainStoreAvailable))}>
                            {formatQuantityWithUom(line.mainStoreAvailable, line.uom)}
                          </TableCell>
                          <TableCell className={cn("text-right", signedClass(line.unitsPossible))}>{line.unitsPossible}</TableCell>
                          <TableCell>
                            <StockStatusChip status={line.status} label={STATUS_TITLES[line.status] ?? line.status} />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>

        {/* A chef may top up early, so Request stock shows here when the status is OK. */}
        {review?.tracked && !warning && requestButton && (
          <div className="flex justify-end gap-2 border-t p-4">{requestButton}</div>
        )}

        {review?.tracked && canRequest && (
          <RequestStockDialog open={requestOpen} onOpenChange={setRequestOpen} review={review} />
        )}
      </SheetContent>
    </Sheet>
  )
}
