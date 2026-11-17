"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table"
import { Info } from "lucide-react"
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
import { AdminChip, CashCountBadge, ForceClosedChip, ShiftStatusBadge, VarianceText } from "@/components/pos-activity/shift-badges"
import { ShiftActivityDialog } from "@/components/pos-activity/shift-activity-dialog"
import { TillsView } from "@/components/pos-activity/tills-view"
import { ForceCloseDialog, type ForceCloseTarget } from "@/components/pos-activity/force-close-dialog"
import { isAdminRole } from "@/lib/roles"
import { toShiftOwnerOptions } from "@/lib/users"
import { UNREGISTERED_TILL, tillLabel } from "@/lib/till"
import { loadForceCloseDraft, type ForceCloseDraft } from "@/lib/tills-admin"
import {
  formatJhbDateTime,
  formatMoney,
  jhbIsoDate,
  readApiError,
  type AdminShiftRow,
  type PageResponse,
  type PersonRef,
  type ShiftDisplayStatus,
} from "@/lib/pos-activity"

type DatePreset = "today" | "7d" | "30d" | "custom"
type StatusFilter = "all" | ShiftDisplayStatus

const PAGE_SIZE = 25
const POLL_INTERVAL_MS = 30_000

function presetRange(preset: Exclude<DatePreset, "custom">): { from: string; to: string } {
  const days = preset === "today" ? 0 : preset === "7d" ? 6 : 29
  return { from: jhbIsoDate(days), to: jhbIsoDate() }
}

// useSearchParams (?shiftId) needs a Suspense boundary.
export default function PosActivityPage() {
  return (
    <Suspense fallback={null}>
      <PosActivityContent />
    </Suspense>
  )
}

function PosActivityContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
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

  const [cashiers, setCashiers] = useState<PersonRef[]>([])
  const [dialogShiftId, setDialogShiftId] = useState<number | null>(null)
  const [tillsReload, setTillsReload] = useState(0)
  const [forceClose, setForceClose] = useState<ForceCloseTarget | null>(null)
  const [forceCloseDraft, setForceCloseDraft] = useState<ForceCloseDraft | null>(null)

  // Back from the password re-sign-in: reopen the force close with the form as it was.
  useEffect(() => {
    const draft = loadForceCloseDraft()
    if (!draft) return
    setForceCloseDraft(draft)
    setForceClose({ shiftId: draft.shiftId, ownerName: draft.ownerName, till: draft.till })
  }, [])

  // ?shiftId=412 opens that shift's details (the link from a refused sign-off in the reports).
  useEffect(() => {
    const shiftId = Number(searchParams.get("shiftId"))
    if (Number.isInteger(shiftId) && shiftId > 0) setDialogShiftId(shiftId)
  }, [searchParams])

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

  // The Tills view polls itself; this reloads the shift list too (after a force close, a late count, …).
  const refreshAll = useCallback(() => {
    void fetchShifts()
    setTillsReload((n) => n + 1)
  }, [fetchShifts])

  useEffect(() => {
    if (isAuthenticated && isAdmin) void fetchShifts()
  }, [fetchShifts, isAdmin, isAuthenticated])

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
      if (document.visibilityState === "visible") void fetchShifts()
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [fetchShifts, hasActiveShift])

  // The cashier list can miss admins who own shifts, so merge in owners we've seen.
  const ownerOptions = useMemo(() => {
    const byId = new Map<number, PersonRef>()
    for (const person of cashiers) byId.set(person.id, person)
    for (const row of rows) if (!byId.has(row.owner.id)) byId.set(row.owner.id, row.owner)
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [cashiers, rows])

  const columns: ColumnDef<AdminShiftRow>[] = useMemo(
    () => [
      {
        id: "till",
        header: "Till",
        cell: ({ row }) => (
          <span className="whitespace-nowrap" title={row.original.tillName ?? undefined}>
            {row.original.tillCode ?? UNREGISTERED_TILL}
          </span>
        ),
      },
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
        id: "cashCount",
        header: "Cash count",
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1">
            <CashCountBadge cashCount={row.original.cashCount} />
            {row.original.forceClosed && <ForceClosedChip />}
          </span>
        ),
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
          <TillsView
            reloadKey={tillsReload}
            onActivity={setDialogShiftId}
            onForceClose={(row) => {
              if (!row.shift) return
              setForceCloseDraft(null)
              setForceClose({ shiftId: row.shift.shiftId, ownerName: row.shift.ownerName, till: tillLabel(row.tillCode, row.tillName) })
            }}
          />

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

        <ShiftActivityDialog
          shiftId={dialogShiftId}
          onOpenChange={(open) => !open && setDialogShiftId(null)}
          onChanged={refreshAll}
        />
        <ForceCloseDialog
          target={forceClose}
          draft={forceCloseDraft}
          onClose={() => {
            setForceClose(null)
            setForceCloseDraft(null)
          }}
          onDone={() => {
            setForceClose(null)
            setForceCloseDraft(null)
            refreshAll()
          }}
          onStale={refreshAll}
        />
      </SidebarInset>
    </SidebarProvider>
  )
}
