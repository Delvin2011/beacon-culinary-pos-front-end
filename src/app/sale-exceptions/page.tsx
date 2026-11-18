"use client"

// O4 task 9: Sale exceptions (ADMIN). What offline sales raised for a manager to review: open REVIEW exceptions by
// default, filtered by status, severity, code, trading day and till, a page at a time (up to 200). Each opens with
// its full order to resolve, or for an account charge, to approve.

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ExceptionDetailDialog } from "@/components/sale-exceptions/exception-detail-dialog"
import { formatTradingDay } from "@/components/orders/offline-order-marks"
import { useAuth } from "@/hooks/use-auth"
import { formatReceiptAmount, formatReceiptDateTime } from "@/lib/receipt"
import { isAdminRole } from "@/lib/roles"
import {
  DEFAULT_FILTERS,
  EXCEPTION_CODES,
  exceptionLabel,
  fetchSaleExceptions,
  type ExceptionFilters,
  type ExceptionSeverity,
  type ExceptionStatus,
  type SaleExceptionPage,
} from "@/lib/sale-exceptions"
import { listAdminTills, type AdminTillRow } from "@/lib/tills-admin"

const PAGE_SIZES = [50, 100, 200]
const SELECT_CLASS = "h-9 rounded-md border bg-background px-2 text-sm"

export default function SaleExceptionsPage() {
  const router = useRouter()
  const { isAuthenticated, isLoading: authLoading, user, authFetch } = useAuth()
  const isAdmin = isAdminRole(user?.role)

  // A link may preset the till or the day (the Tills view links each till's count here).
  const [filters, setFilters] = useState<ExceptionFilters>(() => {
    if (typeof window === "undefined") return DEFAULT_FILTERS
    const params = new URLSearchParams(window.location.search)
    return { ...DEFAULT_FILTERS, deviceId: params.get("deviceId") || null, tradingDay: params.get("tradingDay") || null }
  })
  const [result, setResult] = useState<SaleExceptionPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tills, setTills] = useState<AdminTillRow[]>([])
  const [openId, setOpenId] = useState<number | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated) router.replace("/login")
    else if (!isAdmin) router.replace("/dashboard")
  }, [authLoading, isAdmin, isAuthenticated, router])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setResult(await fetchSaleExceptions(authFetch, filters))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the sale exceptions.")
    } finally {
      setLoading(false)
    }
  }, [authFetch, filters])

  useEffect(() => {
    if (isAuthenticated && isAdmin) void load()
  }, [isAuthenticated, isAdmin, load])

  // The till filter: active tills (GET /admin/tills). Each exception carries its own till, so revoked ones still show.
  useEffect(() => {
    if (!isAuthenticated || !isAdmin) return
    void listAdminTills(authFetch)
      .then((rows) => setTills((rows ?? []).filter((row) => row.deviceId)))
      .catch(() => setTills([]))
  }, [authFetch, isAdmin, isAuthenticated])

  const change = (patch: Partial<ExceptionFilters>) => setFilters((current) => ({ ...current, ...patch, page: patch.page ?? 0 }))

  if (authLoading || !isAuthenticated || !isAdmin) return null

  const totalPages = result ? Math.max(1, Math.ceil(result.totalItems / filters.size)) : 1

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">POS Terminal</BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Sale exceptions</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <main className="space-y-4 p-4 pt-0">
          <div>
            <h1 className="text-2xl font-bold">Sale exceptions</h1>
            <p className="text-sm text-muted-foreground">
              What offline sales raised for review. The sales are recorded as charged; resolving records what was checked.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="filter-status">Status</Label>
              <select id="filter-status" className={SELECT_CLASS} value={filters.status} onChange={(e) => change({ status: e.target.value as ExceptionStatus })}>
                <option value="OPEN">Open</option>
                <option value="RESOLVED">Resolved</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-severity">Severity</Label>
              <select
                id="filter-severity"
                className={SELECT_CLASS}
                value={filters.severity}
                onChange={(e) => change({ severity: e.target.value as ExceptionSeverity })}
              >
                <option value="REVIEW">Needs review</option>
                <option value="INFO">For information</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-code">Type</Label>
              <select id="filter-code" className={SELECT_CLASS} value={filters.code ?? ""} onChange={(e) => change({ code: e.target.value || null })}>
                <option value="">All types</option>
                {Object.entries(EXCEPTION_CODES).map(([code, { label }]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-day">Trading day</Label>
              <Input id="filter-day" type="date" className="h-9 w-40" value={filters.tradingDay ?? ""} onChange={(e) => change({ tradingDay: e.target.value || null })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-till">Till</Label>
              <select id="filter-till" className={SELECT_CLASS} value={filters.deviceId ?? ""} onChange={(e) => change({ deviceId: e.target.value || null })}>
                <option value="">All tills</option>
                {tills.map((till) => (
                  <option key={till.deviceId!} value={till.deviceId!}>
                    {till.tillCode ? `${till.tillCode} · ${till.tillName}` : till.tillName}
                  </option>
                ))}
              </select>
            </div>
            <Button variant="outline" onClick={() => setFilters(DEFAULT_FILTERS)}>
              Reset
            </Button>
          </div>

          {error && (
            <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">
              {error}
            </p>
          )}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Raised</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead>Till</TableHead>
                  <TableHead>Sale</TableHead>
                  <TableHead>Cashier</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && !result ? (
                  <TableRow>
                    <TableCell colSpan={8}>Loading…</TableCell>
                  </TableRow>
                ) : result && result.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8}>No exceptions match these filters.</TableCell>
                  </TableRow>
                ) : (
                  result?.items.map((item) => (
                    <TableRow key={item.id} data-testid="exception-row">
                      <TableCell>{formatReceiptDateTime(item.createdAt) ?? "—"}</TableCell>
                      <TableCell>
                        <span className="font-medium">{exceptionLabel(item.code)}</span>
                        <span className="block font-mono text-xs text-muted-foreground">{item.code}</span>
                      </TableCell>
                      <TableCell>{item.tradingDay ? formatTradingDay(item.tradingDay) : "—"}</TableCell>
                      <TableCell>{item.tillCode ?? "—"}</TableCell>
                      <TableCell>
                        {item.order?.collectionNumber ?? "—"}
                        {item.order?.receiptNumber && <span className="block text-xs text-muted-foreground">{item.order.receiptNumber}</span>}
                        {item.order?.soldAt && <span className="block text-xs text-muted-foreground">Sold {formatReceiptDateTime(item.order.soldAt)}</span>}
                      </TableCell>
                      <TableCell>{item.order?.cashierName ?? "—"}</TableCell>
                      <TableCell className="text-right">{typeof item.order?.total === "number" ? `R ${formatReceiptAmount(item.order.total)}` : "—"}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => setOpenId(item.id)}>
                          {item.status === "OPEN" ? "Review" : "View"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p>
              {result ? `${result.totalItems} exception${result.totalItems === 1 ? "" : "s"}` : ""} · Page {filters.page + 1} of {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <Label htmlFor="page-size">Per page</Label>
              <select id="page-size" className={SELECT_CLASS} value={filters.size} onChange={(e) => change({ size: Number(e.target.value) })}>
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <Button variant="outline" size="sm" disabled={filters.page === 0} onClick={() => change({ page: filters.page - 1 })}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={filters.page + 1 >= totalPages} onClick={() => change({ page: filters.page + 1 })}>
                Next
              </Button>
            </div>
          </div>
        </main>
      </SidebarInset>

      <ExceptionDetailDialog exceptionId={openId} onClose={() => setOpenId(null)} onChanged={() => void load()} />
    </SidebarProvider>
  )
}
