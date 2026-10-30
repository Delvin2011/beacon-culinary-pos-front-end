"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useAuth } from "@/hooks/use-auth"
import { toast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  BATCH_QUICK_PICKS,
  MAX_BATCH_UNITS,
  type StockReview,
  batchQuantities,
  formatQuantity,
  formatQuantityWithUom,
  formatUom,
  parseBatchUnits,
  roundQuantity,
  submitIssueRequest,
} from "@/lib/light-meal-stock"
import { cn } from "@/lib/utils"

type UnitsChoice = (typeof BATCH_QUICK_PICKS)[number] | "custom"

interface DraftRow {
  ingredientId: number
  quantity: string
}

interface RequestStockDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The review already loaded in the panel: no extra call.
  review: StockReview
}

// Batch prompt: "How many more units?" → units × per unit for each ingredient, editable, sent as an Issue request.
export function RequestStockDialog({ open, onOpenChange, review }: RequestStockDialogProps) {
  const { authFetch } = useAuth()
  const [unitsChoice, setUnitsChoice] = useState<UnitsChoice>(20)
  const [customUnits, setCustomUnits] = useState("")
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [rows, setRows] = useState<DraftRow[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const units = unitsChoice === "custom" ? parseBatchUnits(customUnits) : unitsChoice
  const linesById = useMemo(() => new Map(review.lines.map((line) => [line.ingredientId, line])), [review.lines])

  // Changing the units or the toggle recalculates and overwrites any edits.
  useEffect(() => {
    if (!open) return
    setRows(
      units === null
        ? []
        : batchQuantities(review.lines, units, onlyMissing).map(({ line, quantity }) => ({
            ingredientId: line.ingredientId,
            quantity: formatQuantity(quantity),
          })),
    )
  }, [open, units, onlyMissing, review.lines])

  // Fresh prompt each time it opens.
  useEffect(() => {
    if (!open) return
    setUnitsChoice(20)
    setCustomUnits("")
    setOnlyMissing(false)
    setError(null)
  }, [open])

  const parsedRows = rows.map((row) => {
    const value = Number(row.quantity)
    const valid = row.quantity.trim() !== "" && Number.isFinite(value) && value >= 0
    return { ...row, value: valid ? roundQuantity(value) : null }
  })
  const requestLines = parsedRows
    .filter((row): row is DraftRow & { value: number } => row.value !== null && row.value > 0)
    .map((row) => ({ ingredientId: row.ingredientId, quantity: row.value }))
  const hasInvalid = parsedRows.some((row) => row.value === null)
  const canSubmit = units !== null && !hasInvalid && requestLines.length > 0 && !submitting

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const created = await submitIssueRequest(authFetch, requestLines)
      toast({
        title: "Request submitted. An approver will review it.",
        description: created.id ? (
          <Link href={`/inventory/stock-requests/${created.id}`} className="font-medium underline underline-offset-2">
            View request #{created.id} in Stock Requests
          </Link>
        ) : undefined,
      })
      onOpenChange(false)
    } catch (err) {
      // Keep the dialog open so the chef can fix the quantities.
      setError(err instanceof Error ? err.message : "Unable to submit the stock request.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Request stock</DialogTitle>
          <DialogDescription>
            {units !== null ? `Batch of ${units} × ${review.name}` : review.name} · Issued from the Main Store to the Kitchen.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label>How many more units do you want to make?</Label>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Units">
              {[...BATCH_QUICK_PICKS, "custom" as const].map((choice) => (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={unitsChoice === choice}
                  onClick={() => setUnitsChoice(choice)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm transition-colors",
                    unitsChoice === choice ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {choice === "custom" ? "Custom" : choice}
                </button>
              ))}
              {unitsChoice === "custom" && (
                <Input
                  type="number"
                  min="1"
                  max={MAX_BATCH_UNITS}
                  step="1"
                  inputMode="numeric"
                  value={customUnits}
                  onChange={(event) => setCustomUnits(event.target.value)}
                  placeholder="Units"
                  aria-label="Custom number of units"
                  className="h-8 w-28"
                  autoFocus
                />
              )}
            </div>
            {unitsChoice === "custom" && customUnits.trim() !== "" && units === null && (
              <p className="text-xs text-destructive">Enter a whole number from 1 to {MAX_BATCH_UNITS}.</p>
            )}
          </div>

          <div className="flex items-start gap-2">
            <Checkbox id="request-only-missing" checked={onlyMissing} onCheckedChange={(value) => setOnlyMissing(value === true)} className="mt-0.5" />
            <div>
              <Label htmlFor="request-only-missing">Only what&apos;s missing</Label>
              <p className="text-xs text-muted-foreground">
                Off: the full batch, on top of what&apos;s in the Kitchen. On: only what the Kitchen can&apos;t cover. Changing the
                units or this option recalculates the quantities and overwrites your edits.
              </p>
            </div>
          </div>

          {units === null ? (
            <p className="rounded-md border bg-muted/40 px-4 py-6 text-sm text-muted-foreground">Choose how many units to make.</p>
          ) : rows.length === 0 ? (
            <p className="rounded-md border bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
              The Kitchen already has enough for {units} units. Turn off &quot;Only what&apos;s missing&quot; to top up anyway.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ingredient</TableHead>
                  <TableHead className="w-[170px]">Quantity</TableHead>
                  <TableHead className="text-right">In Kitchen</TableHead>
                  <TableHead className="text-right">Main Store</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsedRows.map((row) => {
                  const line = linesById.get(row.ingredientId)
                  if (!line) return null
                  const mainStoreShort = row.value !== null && row.value > 0 && line.mainStoreAvailable < row.value
                  return (
                    <TableRow key={row.ingredientId}>
                      <TableCell className="align-top font-medium">{line.name}</TableCell>
                      <TableCell className="align-top">
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min="0"
                            step="0.0001"
                            value={row.quantity}
                            onChange={(event) => {
                              const value = event.target.value
                              setRows((prev) => prev.map((entry) => (entry.ingredientId === row.ingredientId ? { ...entry, quantity: value } : entry)))
                            }}
                            aria-label={`${line.name} quantity`}
                            className={cn("h-8", row.value === null && "border-destructive")}
                          />
                          <span className="text-sm text-muted-foreground">{formatUom(line.uom)}</span>
                        </div>
                        {mainStoreShort && (
                          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                            Main Store has only {formatQuantityWithUom(line.mainStoreAvailable, line.uom)}. The approver can only issue
                            what is there.
                          </p>
                        )}
                      </TableCell>
                      <TableCell className={cn("text-right align-top", line.kitchenAvailable < 0 && "text-rose-600 dark:text-rose-400")}>
                        {formatQuantityWithUom(line.kitchenAvailable, line.uom)}
                      </TableCell>
                      <TableCell className={cn("text-right align-top", line.mainStoreAvailable < 0 && "text-rose-600 dark:text-rose-400")}>
                        {formatQuantityWithUom(line.mainStoreAvailable, line.uom)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}

          {hasInvalid && <p className="text-sm text-destructive">Each quantity must be a number, 0 or more.</p>}
          {units !== null && !hasInvalid && rows.length > 0 && requestLines.length === 0 && (
            <p className="text-sm text-muted-foreground">Enter a quantity above 0 for at least one ingredient.</p>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={() => void submit()}>
            {submitting ? "Submitting…" : "Submit request"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
