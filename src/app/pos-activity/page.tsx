"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table"
import { AlertTriangle, Info, RefreshCw } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AdminChip, ShiftStatusBadge, VarianceText } from "@/components/pos-activity/shift-badges"
import { ShiftActivityDialog } from "@/components/pos-activity/shift-activity-dialog"
import { isAdminRole } from "@/lib/roles"
import { toShiftOwnerOptions } from "@/lib/users"
import {
  formatJhbDateTime,
  formatJhbTime,
  formatMoney,
  jhbIsoDate,
  readApiError,
  type AdminShiftRow,
  type OpenShift,
  type PageResponse,
  type PersonRef,
  type ShiftActivity,
  type ShiftDisplayStatus,
} from "@/lib/pos-activity"

type DatePreset = "today" | "7d" | "30d" | "custom"
type StatusFilter = "all" | ShiftDisplayStatus

interface TillNow {
  openShift: OpenShift
  displayStatus: ShiftDisplayStatus
  expectedCash: number
  orderCount: number
}

const PAGE_SIZE = 25
const POLL_INTERVAL_MS = 30_000

function presetRange(preset: Exclude<DatePreset, "custom">): { from: string; to: string } {
  const days = preset === "today" ? 0 : preset === "7d" ? 6 : 29
  return { from: jhbIsoDate(days), to: jhbIsoDate() }
}

export default function PosActivityPage() {
  const router = useRouter()
  const { isAuthenticated, isLoading: authLoading, user, authFetch } = useAuth()
  const isAdmin = isAdminRole(user?.role)

  const [datePreset, setDatePreset] = useState<DatePreset>("7d")
  const [customFrom, setCustomFrom] = useState(() => jhbIsoDate(6))
  const [customTo, setCustomTo] = useState(() => jhbIsoDate())
  const [ownerFilter, setOwnerFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [page, setPage] = useState(0)

  const [shiftPage, setShiftPage] = useState<PageResponse<AdminShiftRow> | null>(null)
  const [shiftsLoading, setShiftsLoading] = useState(true)
  const [shiftsError, setShiftsError] = useState<string | null>(null)

  const [tillNow, setTillNow] = useState<TillNow | null>(null)
  const [tillLoading, setTillLoading] = useState(true)
  const [tillError, setTillError] = useState<string | null>(null)

  const [cashiers, setCashiers] = useState<PersonRef[]>([])
  const [dialogShiftId, setDialogShiftId] = useState<number | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated) {
      router.replace("/login")
      return
    }
    if (!isAdmin) {
      router.replace("/dashboard")
    }
  }, [authLoading, isAdmin, isAuthenticated, router])

  const range = useMemo(
    () => (datePreset === "custom" ? { from: customFrom, to: customTo } : presetRange(datePreset)),
    [customFrom, customTo, datePreset],
  )
  const rangeError = range.from && range.to && range.from > range.to ? "The start date must not be after the end date." : null

  const fetchShifts = useCallback(async () => {
    if (!range.from || !range.to || rangeError) return
    setShiftsLoading(true)
    setShiftsError(null)
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to, page: String(page), size: String(PAGE_SIZE) })
      if (ownerFilter !== "all") params.set("ownerId", ownerFilter)
      if (statusFilter !== "all") params.set("status", statusFilter)
      const res = await authFetch(`/admin/shifts?${params.toString()}`)
      if (!res.ok) throw new Error((await readApiError(res, "Unable to load shifts.")).message)
      setShiftPage((await res.json()) as PageResponse<AdminShiftRow>)
    } catch (err) {
      setShiftsError(err instanceof Error ? err.message : "Unable to load shifts.")
    } finally {
      setShiftsLoading(false)
    }
  }, [authFetch, ownerFilter, page, range.from, range.to, rangeError, statusFilter])

  const fetchTillNow = useCallback(async () => {
    setTillError(null)
    try {
      const openRes = await authFetch("/shifts/open")
      if (openRes.status === 404) {
        setTillNow(null)
        return
      }
      if (!openRes.ok) throw new Error((await readApiError(openRes, "Unable to check the till.")).message)
      const openShift = (await openRes.json()) as OpenShift

      const activityRes = await authFetch(`/admin/shifts/${openShift.shiftId}/activity`)
      if (!activityRes.ok) throw new Error((await readApiError(activityRes, "Unable to load the open shift.")).message)
      const activity = (await activityRes.json()) as ShiftActivity
      setTillNow({
        openShift,
        displayStatus: activity.shift.displayStatus,
        expectedCash: activity.shift.expectedCash,
        orderCount: activity.shift.orderCount,
      })
    } catch (err) {
      setTillError(err instanceof Error ? err.message : "Unable to check the till.")
    } finally {
      setTillLoading(false)
    }
  }, [authFetch])

  const refreshAll = useCallback(() => {
    void fetchShifts()
    void fetchTillNow()
  }, [fetchShifts, fetchTillNow])

  useEffect(() => {
    if (isAuthenticated && isAdmin) void fetchShifts()
  }, [fetchShifts, isAdmin, isAuthenticated])

  useEffect(() => {
    if (isAuthenticated && isAdmin) void fetchTillNow()
  }, [fetchTillNow, isAdmin, isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated || !isAdmin) return
    // Shift owners are cashiers or admins; /admin/staff lists every staff member, inactive ones included.
    authFetch("/admin/staff")
      .then(async (res) => (res.ok ? ((await res.json()) as unknown) : []))
      .then((body) => setCashiers(toShiftOwnerOptions(body)))
      .catch(() => setCashiers([]))
  }, [authFetch, isAdmin, isAuthenticated])

  const rows = useMemo(() => shiftPage?.content ?? [], [shiftPage])
  const hasActiveShift = rows.some((row) => row.displayStatus !== "CLOSED")

  // Poll only while this tab is visible and the current page shows an open shift.
  useEffect(() => {
    if (!hasActiveShift) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshAll()
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [hasActiveShift, refreshAll])

  // The cashier list can miss admins who own shifts, so merge in owners we've seen.
  const ownerOptions = useMemo(() => {
    const byId = new Map<number, PersonRef>()
    for (const person of cashiers) byId.set(person.id, person)
    for (const row of rows) if (!byId.has(row.owner.id)) byId.set(row.owner.id, row.owner)
    if (tillNow && !byId.has(tillNow.openShift.owner.id)) byId.set(tillNow.openShift.owner.id, tillNow.openShift.owner)
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [cashiers, rows, tillNow])

  const columns: ColumnDef<AdminShiftRow>[] = useMemo(
    () => [
      {
        id: "owner",
        header: "Cashier",
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-medium">
            {row.original.owner.name}
            {isAdminRole(row.original.owner.role) && <AdminChip />}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => <ShiftStatusBadge status={row.original.displayStatus} />,
      },
      {
        id: "openedAt",
        header: "Shift opened",
        cell: ({ row }) => <span className="whitespace-nowrap">{formatJhbDateTime(row.original.openedAt)}</span>,
      },
      {
        id: "closedAt",
        header: "Shift closed",
        cell: ({ row }) => <span className="whitespace-nowrap">{formatJhbDateTime(row.original.closedAt)}</span>,
      },
      {
        id: "openingFloat",
        header: "Start float",
        cell: ({ row }) => formatMoney(row.original.openingFloat),
      },
      {
        id: "closingCash",
        header: "Close float",
        cell: ({ row }) => formatMoney(row.original.closingCash),
      },
      {
        id: "variance",
        header: "Variance",
        cell: ({ row }) => <VarianceText variance={row.original.variance} />,
      },
      {
        id: "info",
        header: "",
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="outline"
            aria-label={`Shift details for ${row.original.owner.name}, opened ${formatJhbDateTime(row.original.openedAt)}`}
            onClick={() => setDialogShiftId(row.original.shiftId)}
          >
            <Info className="h-4 w-4" />
          </Button>
        ),
      },
    ],
    [],
  )

  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (row) => String(row.shiftId),
    getCoreRowModel: getCoreRowModel(),
  })

  const changeFilter = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value)
    setPage(0)
  }

  if (authLoading || !isAuthenticated || !isAdmin) {
    return null
  }

  const totalPages = shiftPage?.totalPages ?? 0

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
                <BreadcrumbItem className="hidden md:block">POS Terminal</BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>POS Activity</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <section
            className={`rounded-lg border p-4 ${
              tillNow?.displayStatus === "OVERDUE" ? "border-amber-300 bg-amber-50/60 dark:border-amber-700 dark:bg-amber-950/30" : ""
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">On the till now</p>
                {tillLoading ? (
                  <p className="animate-pulse text-sm text-muted-foreground">Checking…</p>
                ) : tillError ? (
                  <p className="text-sm text-destructive">{tillError}</p>
                ) : tillNow ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-semibold">{tillNow.openShift.owner.name}</span>
                      {isAdminRole(tillNow.openShift.owner.role) && <AdminChip />}
                      <ShiftStatusBadge status={tillNow.displayStatus} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {tillNow.displayStatus === "OVERDUE"
                        ? `Opened ${formatJhbDateTime(tillNow.openShift.openedAt)}`
                        : `On shift since ${formatJhbTime(tillNow.openShift.openedAt)}`}
                      {" · "}Expected cash {formatMoney(tillNow.expectedCash)} · {tillNow.orderCount} order
                      {tillNow.orderCount === 1 ? "" : "s"}
                    </p>
                    {tillNow.displayStatus === "OVERDUE" && (
                      <p className="flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-300">
                        <AlertTriangle className="h-4 w-4" />
                        Opened yesterday — close it before a new shift can start.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-lg font-semibold">No shift open.</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={refreshAll}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Refresh
                </Button>
                <Button size="sm" asChild>
                  <a href="/pos/login">Open Cashier Portal</a>
                </Button>
              </div>
            </div>
          </section>

          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Shift History</h2>
              <p className="text-sm text-muted-foreground">
                Every till shift, newest first. Open a shift&apos;s details to see its sales and adjustments.
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label>Date range</Label>
                <Select value={datePreset} onValueChange={changeFilter((value: string) => setDatePreset(value as DatePreset))}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="7d">Last 7 days</SelectItem>
                    <SelectItem value="30d">Last 30 days</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {datePreset === "custom" && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="shift-from">From</Label>
                    <Input
                      id="shift-from"
                      type="date"
                      value={customFrom}
                      max={customTo || undefined}
                      onChange={(event) => changeFilter(setCustomFrom)(event.target.value)}
                      className="w-[160px]"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="shift-to">To</Label>
                    <Input
                      id="shift-to"
                      type="date"
                      value={customTo}
                      min={customFrom || undefined}
                      onChange={(event) => changeFilter(setCustomTo)(event.target.value)}
                      className="w-[160px]"
                    />
                  </div>
                </>
              )}
              <div className="space-y-1">
                <Label>Cashier</Label>
                <Select value={ownerFilter} onValueChange={changeFilter(setOwnerFilter)}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="All cashiers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All cashiers</SelectItem>
                    {ownerOptions.map((person) => (
                      <SelectItem key={person.id} value={String(person.id)}>
                        {person.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={statusFilter} onValueChange={changeFilter((value: string) => setStatusFilter(value as StatusFilter))}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="ON_SHIFT">On shift</SelectItem>
                    <SelectItem value="CLOSED">Closed</SelectItem>
                    <SelectItem value="OVERDUE">Overdue</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {shiftPage && (
                <span className="whitespace-nowrap pb-2 text-sm text-muted-foreground">
                  {shiftPage.totalElements} shift{shiftPage.totalElements === 1 ? "" : "s"}
                </span>
              )}
            </div>

            {rangeError && <p className="text-sm text-destructive">{rangeError}</p>}
            {shiftsError && <p className="text-sm text-destructive">{shiftsError}</p>}

            {shiftsLoading && !shiftPage ? (
              <p className="animate-pulse text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="max-h-[65vh] overflow-y-auto rounded-md border">
                <table className="w-full caption-bottom text-sm">
                  <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id} className="sticky top-0 z-10 bg-background">
                        {headerGroup.headers.map((header) => (
                          <TableHead key={header.id}>
                            {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {table.getRowModel().rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={columns.length} className="py-8 text-center text-sm text-muted-foreground">
                          No shifts found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      table.getRowModel().rows.map((row) => (
                        <TableRow
                          key={row.id}
                          className={row.original.displayStatus === "OVERDUE" ? "bg-amber-50/60 dark:bg-amber-950/30" : undefined}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                          ))}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </table>
              </div>
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-end gap-2">
                <span className="text-sm text-muted-foreground">
                  Page {page + 1} of {totalPages}
                </span>
                <Button size="sm" variant="outline" disabled={page === 0 || shiftsLoading} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page + 1 >= totalPages || shiftsLoading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        </div>

        <ShiftActivityDialog shiftId={dialogShiftId} onOpenChange={(open) => !open && setDialogShiftId(null)} />
      </SidebarInset>
    </SidebarProvider>
  )
}
