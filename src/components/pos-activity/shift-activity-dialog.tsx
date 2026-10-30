"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Gift, Info } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AdminChip, ShiftStatusBadge, VarianceText } from "@/components/pos-activity/shift-badges"
import { cn } from "@/lib/utils"
import { isAdminRole } from "@/lib/roles"
import { isComplimentary } from "@/lib/complimentary"
import {
  ADJUSTMENT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  REFUND_METHOD_LABELS,
  formatJhbDateTime,
  formatJhbTime,
  formatMoney,
  humaniseCode,
  readApiError,
  type ExpectedCashBreakdown,
  type ShiftActivity,
  type ShiftActivityOrder,
} from "@/lib/pos-activity"

type SalesFilter = "all" | "successful" | "voided" | "refunded" | "discounted" | "extrasRemoved" | "complimentary"
type DialogTab = "sales" | "adjustments"

const SALES_FILTERS: { value: SalesFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "successful", label: "Successful" },
  { value: "voided", label: "Voided" },
  { value: "refunded", label: "Refunded" },
  { value: "discounted", label: "Discounted" },
  { value: "extrasRemoved", label: "Extras removed" },
  { value: "complimentary", label: "Complimentary" },
]

function matchesSalesFilter(order: ShiftActivityOrder, filter: SalesFilter): boolean {
  switch (filter) {
    case "successful":
      // A discounted sale still counts as successful.
      return order.status !== "VOIDED" && order.status !== "REFUNDED"
    case "voided":
      return order.status === "VOIDED"
    case "refunded":
      return order.status === "REFUNDED"
    case "discounted":
      return order.discounted
    case "extrasRemoved":
      return order.extrasRemoved
    case "complimentary":
      return isComplimentary(order)
    default:
      return true
  }
}

const ORDER_STATUS_STYLES: Record<string, string> = {
  // A cold-drinks-only order: handed over at the till straight away.
  COLLECTED: "text-sky-700 dark:text-sky-400",
  VOIDED: "text-red-600 dark:text-red-400",
  REFUNDED: "text-amber-700 dark:text-amber-400",
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{children}</p>
    </div>
  )
}

function ComplimentaryBadge() {
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 rounded border border-violet-300 bg-violet-50 px-1.5 text-[10px] font-semibold uppercase text-violet-800 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-200">
      <Gift className="h-3 w-3" aria-hidden />
      Complimentary
    </span>
  )
}

function SummaryTile({ label, count, amount }: { label: string; count?: number; amount: number }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">
        {count !== undefined && <span className="mr-1.5 text-muted-foreground">{count} ·</span>}
        {formatMoney(amount)}
      </p>
    </div>
  )
}

function BreakdownLines({
  openingFloat,
  cashSales,
  cashRefundsProcessed,
  expectedCash,
}: {
  openingFloat: number
  cashSales: number
  cashRefundsProcessed: number
  expectedCash: number
}) {
  return (
    <dl className="space-y-1 text-sm">
      <div className="flex justify-between gap-4">
        <dt className="text-muted-foreground">Start float</dt>
        <dd>{formatMoney(openingFloat)}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-muted-foreground">+ Cash sales</dt>
        <dd>{formatMoney(cashSales)}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-muted-foreground">− Cash refunds processed</dt>
        <dd>{formatMoney(cashRefundsProcessed)}</dd>
      </div>
      <div className="flex justify-between gap-4 border-t pt-1 font-semibold">
        <dt>= Expected</dt>
        <dd>{formatMoney(expectedCash)}</dd>
      </div>
    </dl>
  )
}

function BreakdownBlock({ breakdown }: { breakdown: ExpectedCashBreakdown }) {
  if (breakdown.source === "SNAPSHOT" && breakdown.breakdownMismatch === true) {
    return (
      <div className="rounded-md border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/40">
        <p className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
          <AlertTriangle className="h-4 w-4" />
          Stored figures and recalculated figures disagree
        </p>
        <p className="mt-1 text-xs text-red-700/80 dark:text-red-300/80">
          This is an integrity warning. Report it to the system administrator.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stored at close</p>
            <BreakdownLines {...breakdown} />
          </div>
          {breakdown.recomputed && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recalculated now</p>
              <BreakdownLines openingFloat={breakdown.openingFloat} {...breakdown.recomputed} />
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Expected cash{breakdown.source === "LIVE" ? " (live)" : ""}
      </p>
      <BreakdownLines {...breakdown} />
      {breakdown.source === "RECALCULATED" && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Closed before the breakdown was recorded; figures recalculated.
            {breakdown.storedExpectedCash !== undefined && (
              <> Expected cash stored at close: {formatMoney(breakdown.storedExpectedCash)}.</>
            )}
          </span>
        </p>
      )}
    </div>
  )
}

interface ShiftActivityDialogProps {
  shiftId: number | null
  onOpenChange: (open: boolean) => void
}

export function ShiftActivityDialog({ shiftId, onOpenChange }: ShiftActivityDialogProps) {
  const { authFetch } = useAuth()
  const [activity, setActivity] = useState<ShiftActivity | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<DialogTab>("sales")
  const [salesFilter, setSalesFilter] = useState<SalesFilter>("all")

  const loadActivity = useCallback(async () => {
    if (shiftId === null) return
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch(`/admin/shifts/${shiftId}/activity`)
      if (res.status === 404) throw new Error("This shift no longer exists.")
      if (!res.ok) throw new Error((await readApiError(res, "Unable to load shift activity.")).message)
      setActivity((await res.json()) as ShiftActivity)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load shift activity.")
    } finally {
      setLoading(false)
    }
  }, [authFetch, shiftId])

  useEffect(() => {
    if (shiftId === null) return
    setActivity(null)
    setTab("sales")
    setSalesFilter("all")
    void loadActivity()
  }, [loadActivity, shiftId])

  const filteredOrders = useMemo(
    () => activity?.orders.filter((order) => matchesSalesFilter(order, salesFilter)) ?? [],
    [activity, salesFilter],
  )

  const shift = activity?.shift
  const isOpen = shift ? shift.displayStatus !== "CLOSED" : false

  return (
    <Dialog open={shiftId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b p-4 pr-12">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {shift ? (
              <>
                <span>{shift.owner.name}</span>
                {isAdminRole(shift.owner.role) && <AdminChip />}
                <ShiftStatusBadge status={shift.displayStatus} />
              </>
            ) : (
              <span>Shift activity</span>
            )}
          </DialogTitle>
          <DialogDescription>
            {shift
              ? `${formatJhbDateTime(shift.openedAt)} → ${shift.closedAt ? formatJhbDateTime(shift.closedAt) : "still open"}`
              : "Sales and adjustments for this shift."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {loading && !activity && <p className="animate-pulse text-sm text-muted-foreground">Loading…</p>}

          {error && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-sm text-destructive">{error}</p>
              <Button size="sm" variant="outline" onClick={() => void loadActivity()}>
                Retry
              </Button>
            </div>
          )}

          {activity && shift && (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Figure label="Start float">{formatMoney(shift.openingFloat)}</Figure>
                {isOpen ? (
                  <Figure label="Expected (live)">{formatMoney(shift.expectedCash)}</Figure>
                ) : (
                  <>
                    <Figure label="Close float (counted)">{formatMoney(shift.closingCash)}</Figure>
                    <Figure label="Expected">{formatMoney(shift.expectedCash)}</Figure>
                    <Figure label="Variance">
                      <VarianceText variance={shift.variance} />
                    </Figure>
                  </>
                )}
              </div>

              {!isOpen && (
                <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">Closed by</dt>
                    <dd>{shift.closedBy?.name ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Variance reason</dt>
                    <dd>
                      {humaniseCode(shift.varianceReasonCode)}
                      {shift.varianceNote && <span className="text-muted-foreground"> — {shift.varianceNote}</span>}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Authorised by</dt>
                    <dd>{shift.varianceAuthorizedBy?.name ?? "—"}</dd>
                  </div>
                </dl>
              )}

              <BreakdownBlock breakdown={activity.expectedCashBreakdown} />

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-md border px-3 py-2">
                  <p className="text-xs text-muted-foreground">Sale orders</p>
                  <p className="text-sm font-semibold">{activity.totals.orderCount}</p>
                </div>
                <SummaryTile label="Cash sales" amount={activity.totals.salesByMethod.CASH} />
                <SummaryTile label="Card sales" amount={activity.totals.salesByMethod.CARD} />
                <SummaryTile label="Account sales" amount={activity.totals.salesByMethod.ACCOUNT} />
                <SummaryTile label="Voids" count={activity.totals.voids.count} amount={activity.totals.voids.amount} />
                <SummaryTile label="Refunds" count={activity.totals.refunds.count} amount={activity.totals.refunds.amount} />
                <SummaryTile
                  label="Discounts at sale"
                  count={activity.totals.discounts.count}
                  amount={activity.totals.discounts.amount}
                />
                <SummaryTile
                  label="Extras removed"
                  count={activity.totals.extrasRemoved.count}
                  amount={activity.totals.extrasRemoved.amount}
                />
                {activity.totals.legacyDiscountsAfterPayment && (
                  <SummaryTile
                    label="Discounts after payment (legacy)"
                    count={activity.totals.legacyDiscountsAfterPayment.count}
                    amount={activity.totals.legacyDiscountsAfterPayment.amount}
                  />
                )}
              </div>

              {/* Server totals only: complimentary orders are kept out of sales, voids and cash on purpose. */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-dashed border-violet-300 bg-violet-50/60 px-3 py-2 dark:border-violet-800 dark:bg-violet-950/30">
                <p className="flex items-center gap-1.5 text-xs font-medium text-violet-800 dark:text-violet-200">
                  <Gift className="h-3.5 w-3.5" aria-hidden />
                  Complimentary
                </p>
                <p className="text-sm font-semibold">
                  {activity.totals.complimentary.count} meal{activity.totals.complimentary.count === 1 ? "" : "s"} ·{" "}
                  {formatMoney(activity.totals.complimentary.amount)} at list price
                </p>
                <p className="text-xs text-muted-foreground">Not part of sales or cash.</p>
              </div>

              <div className="flex gap-1 border-b" role="tablist">
                {([
                  ["sales", `Sales in this shift (${activity.orders.length})`],
                  ["adjustments", `Adjustments processed in this shift (${activity.adjustments.length})`],
                ] as Array<[DialogTab, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={tab === value}
                    onClick={() => setTab(value)}
                    className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                      tab === value
                        ? "border-foreground text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === "sales" ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {SALES_FILTERS.map((filter) => (
                      <button
                        key={filter.value}
                        type="button"
                        aria-pressed={salesFilter === filter.value}
                        onClick={() => setSalesFilter(filter.value)}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                          salesFilter === filter.value
                            ? "border-foreground bg-foreground text-background"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        {filter.label}
                      </button>
                    ))}
                  </div>

                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full caption-bottom text-sm">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Order #</TableHead>
                          <TableHead>Time</TableHead>
                          <TableHead>Rung by</TableHead>
                          <TableHead>Payment methods</TableHead>
                          <TableHead>Total</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Flags</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredOrders.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                              {activity.orders.length === 0 ? "No orders in this shift." : "No orders match this filter."}
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredOrders.map((order) => (
                            <TableRow key={order.orderId}>
                              <TableCell className="whitespace-nowrap font-medium">
                                #{order.orderNumber}
                                {isComplimentary(order) && <ComplimentaryBadge />}
                              </TableCell>
                              <TableCell>{formatJhbTime(order.createdAt)}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                {order.rungBy.name}
                                {order.rungBy.id !== shift.owner.id && isAdminRole(order.rungBy.role) && <AdminChip />}
                              </TableCell>
                              <TableCell>
                                {isComplimentary(order)
                                  ? "Complimentary"
                                  : order.payments
                                      .map((payment) => `${PAYMENT_METHOD_LABELS[payment.method] ?? payment.method} ${formatMoney(payment.amount)}`)
                                      .join(" + ") || "—"}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                {isComplimentary(order) ? (
                                  order.preDiscountTotal !== undefined ? (
                                    <>
                                      {formatMoney(order.preDiscountTotal)}
                                      <span className="block text-xs text-muted-foreground">at list price · not charged</span>
                                    </>
                                  ) : (
                                    <span className="text-muted-foreground">Not charged</span>
                                  )
                                ) : Math.round(order.originalTotal * 100) === Math.round(order.total * 100) ? (
                                  formatMoney(order.total)
                                ) : (
                                  <>
                                    <span className="text-muted-foreground line-through">{formatMoney(order.originalTotal)}</span>
                                    {" → "}
                                    {formatMoney(order.total)}
                                  </>
                                )}
                              </TableCell>
                              <TableCell className={cn("font-medium", ORDER_STATUS_STYLES[order.status])}>
                                {humaniseCode(order.status)}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {[
                                  (order.saleDiscount ?? 0) > 0
                                    ? `Discount at sale −${formatMoney(order.saleDiscount)}`
                                    : order.discounted && "Discounted after payment (legacy)",
                                  order.extrasRemoved && "Extras removed",
                                ]
                                  .filter(Boolean)
                                  .join(", ") || "—"}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Adjustments are listed under the shift that processed them, because the cash-out belongs to that shift&apos;s
                    drawer. An order sold earlier can be adjusted here.
                  </p>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full caption-bottom text-sm">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time</TableHead>
                          <TableHead>Order #</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Paid out as</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead>Requested by</TableHead>
                          <TableHead>Authorised by</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activity.adjustments.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                              No adjustments processed in this shift.
                            </TableCell>
                          </TableRow>
                        ) : (
                          activity.adjustments.map((adjustment) => (
                            <TableRow key={adjustment.adjustmentId}>
                              <TableCell>{formatJhbTime(adjustment.createdAt)}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                <span className="font-medium">#{adjustment.orderNumber}</span>
                                {adjustment.crossShift && (
                                  <span className="mt-0.5 block text-xs text-amber-700 dark:text-amber-400">
                                    Sold in an earlier shift (#{adjustment.orderSoldInShiftId})
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                {ADJUSTMENT_TYPE_LABELS[adjustment.type] ?? humaniseCode(adjustment.type)}
                                {isComplimentary(adjustment) && <ComplimentaryBadge />}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">{formatMoney(adjustment.amount)}</TableCell>
                              <TableCell>
                                {isComplimentary(adjustment)
                                  ? "No refund"
                                  : REFUND_METHOD_LABELS[adjustment.refundMethod] ?? humaniseCode(adjustment.refundMethod)}
                              </TableCell>
                              <TableCell>
                                {humaniseCode(adjustment.reasonCode)}
                                {adjustment.note && <span className="block text-xs text-muted-foreground">{adjustment.note}</span>}
                              </TableCell>
                              <TableCell>{adjustment.requestedBy?.name ?? "—"}</TableCell>
                              <TableCell>{adjustment.authorizedBy?.name ?? "—"}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
