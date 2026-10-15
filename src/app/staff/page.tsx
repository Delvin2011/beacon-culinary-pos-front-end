"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { ArrowUpDown, Check, Minus } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StaffFormDialog } from "@/components/staff/staff-form-dialog"
import { CredentialResetDialog, type CredentialKind } from "@/components/staff/credential-reset-dialog"
import { toast } from "@/hooks/use-toast"
import { isAdminRole } from "@/lib/roles"
import { cn } from "@/lib/utils"
import {
  readStaffError,
  roleLabel,
  usesPassword,
  usesPin,
  type StaffMember,
  type StaffRoleRule,
} from "@/lib/staff"

function CredentialBadge({ label, set }: { label: string; set: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        set
          ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
          : "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300",
      )}
    >
      {set ? <Check className="h-3 w-3" aria-hidden /> : <Minus className="h-3 w-3" aria-hidden />}
      {label} {set ? "set" : "not set"}
    </span>
  )
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        active
          ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
          : "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200",
      )}
    >
      {active ? "Active" : "Inactive"}
    </span>
  )
}

const sortableHeader = (label: string) =>
  function SortableHeader({ column }: { column: { toggleSorting: (desc: boolean) => void; getIsSorted: () => false | "asc" | "desc" } }) {
    return (
      <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
        {label}
        <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
      </Button>
    )
  }

export default function StaffPage() {
  const router = useRouter()
  const { isAuthenticated, isLoading: authLoading, user, authFetch } = useAuth()
  const isAdmin = isAdminRole(user?.role)

  const [roles, setRoles] = useState<StaffRoleRule[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pageMessage, setPageMessage] = useState<string | null>(null)

  const [search, setSearch] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<StaffMember | null>(null)
  const [credentialTarget, setCredentialTarget] = useState<{ staff: StaffMember; kind: CredentialKind } | null>(null)
  const [activeTarget, setActiveTarget] = useState<StaffMember | null>(null)
  const [togglingActive, setTogglingActive] = useState(false)

  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated) {
      router.replace("/login")
      return
    }
    if (!isAdmin) router.replace("/dashboard")
  }, [authLoading, isAdmin, isAuthenticated, router])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [rolesRes, staffRes] = await Promise.all([authFetch("/admin/staff/roles"), authFetch("/admin/staff")])
      if (!rolesRes.ok || !staffRes.ok) {
        const failed = !rolesRes.ok ? rolesRes : staffRes
        throw new Error((await readStaffError(failed, "Unable to load staff.")).pageError ?? "Unable to load staff.")
      }
      setRoles((await rolesRes.json()) as StaffRoleRule[])
      setStaff((await staffRes.json()) as StaffMember[])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Unable to load staff.")
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    if (isAuthenticated && isAdmin) void load()
  }, [isAdmin, isAuthenticated, load])

  // Keep the list sorted by name, as the server returns it.
  const upsert = useCallback((member: StaffMember) => {
    setStaff((current) =>
      [...current.filter((existing) => existing.id !== member.id), member].sort((a, b) => a.name.localeCompare(b.name)),
    )
  }, [])

  const openCreate = () => {
    setEditing(null)
    setPageMessage(null)
    setFormOpen(true)
  }

  const openEdit = useCallback((member: StaffMember) => {
    setEditing(member)
    setPageMessage(null)
    setFormOpen(true)
  }, [])

  const toggleActive = async () => {
    if (!activeTarget) return
    const member = activeTarget
    setTogglingActive(true)
    try {
      const res = await authFetch(`/admin/staff/${member.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: member.name,
          role: member.role,
          ...(member.email ? { email: member.email } : {}),
          active: !member.active,
        }),
      })
      if (!res.ok) {
        const apiError = await readStaffError(res, "Unable to change this person's status.")
        // LAST_ADMIN and other conflicts show as a page message.
        setPageMessage(apiError.pageError ?? Object.values(apiError.fieldErrors).join(" "))
        return
      }
      const updated = (await res.json()) as StaffMember
      upsert(updated)
      toast({
        title: updated.active ? "Staff member activated" : "Staff member deactivated",
        description: updated.active ? `${updated.name} can log in again.` : `${updated.name} can no longer log in.`,
      })
    } catch {
      setPageMessage("Unable to reach the server. Try again.")
    } finally {
      setTogglingActive(false)
      setActiveTarget(null)
    }
  }

  const columns: ColumnDef<StaffMember>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: sortableHeader("Name"),
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: "role",
        header: sortableHeader("Role"),
        cell: ({ row }) => roleLabel(roles, row.original.role),
        filterFn: "equals",
      },
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => row.original.email ?? <span className="text-muted-foreground">—</span>,
      },
      {
        id: "credentials",
        header: "Login",
        cell: ({ row }) => {
          const rule = roles.find((candidate) => candidate.role === row.original.role)
          return (
            <div className="flex flex-wrap gap-1">
              {usesPassword(rule) && <CredentialBadge label="Password" set={row.original.hasPassword} />}
              {usesPin(rule) && <CredentialBadge label="PIN" set={row.original.hasPin} />}
            </div>
          )
        },
      },
      {
        accessorKey: "active",
        header: sortableHeader("Status"),
        cell: ({ row }) => <StatusBadge active={row.original.active} />,
        filterFn: "equals",
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const member = row.original
          const rule = roles.find((candidate) => candidate.role === member.role)
          return (
            <div className="flex flex-wrap justify-end gap-1.5">
              <Button size="sm" variant="outline" onClick={() => openEdit(member)}>
                Edit
              </Button>
              {usesPassword(rule) && (
                <Button size="sm" variant="outline" onClick={() => setCredentialTarget({ staff: member, kind: "password" })}>
                  {member.hasPassword ? "Reset password" : "Set password"}
                </Button>
              )}
              {usesPin(rule) && (
                <Button size="sm" variant="outline" onClick={() => setCredentialTarget({ staff: member, kind: "pin" })}>
                  {member.hasPin ? "Reset PIN" : "Set PIN"}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className={member.active ? "text-destructive hover:text-destructive" : undefined}
                onClick={() => {
                  setPageMessage(null)
                  setActiveTarget(member)
                }}
              >
                {member.active ? "Deactivate" : "Activate"}
              </Button>
            </div>
          )
        },
      },
    ],
    [openEdit, roles],
  )

  const table = useReactTable({
    data: staff,
    columns,
    getRowId: (row) => String(row.id),
    state: { sorting, columnFilters, globalFilter: search },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setSearch,
    globalFilterFn: (row, _columnId, filterValue: string) => {
      const query = filterValue.trim().toLowerCase()
      if (!query) return true
      const member = row.original
      return [member.name, member.email ?? "", roleLabel(roles, member.role)].some((value) => value.toLowerCase().includes(query))
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  if (authLoading || !isAuthenticated || !isAdmin) return null

  const roleFilter = (table.getColumn("role")?.getFilterValue() as string | undefined) ?? "all"
  const activeFilter = table.getColumn("active")?.getFilterValue()

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
                  <BreadcrumbPage>Staff</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold">Staff</h1>
              <p className="text-sm text-muted-foreground">
                Create staff and manage their roles and logins. Staff are deactivated, never deleted.
              </p>
            </div>
            <Button size="sm" onClick={openCreate} disabled={roles.length === 0}>
              + Add Staff
            </Button>
          </div>

          {pageMessage && (
            <div role="alert" className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <p>{pageMessage}</p>
              <Button size="sm" variant="ghost" onClick={() => setPageMessage(null)}>
                Dismiss
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <div className="w-[220px] space-y-1">
              <Label htmlFor="staff-search">Search</Label>
              <Input id="staff-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email or role" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="staff-role-filter">Role</Label>
              <Select
                value={roleFilter}
                onValueChange={(value) => table.getColumn("role")?.setFilterValue(value === "all" ? undefined : value)}
              >
                <SelectTrigger id="staff-role-filter" className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {roles.map((rule) => (
                    <SelectItem key={rule.role} value={rule.role}>
                      {rule.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="staff-status-filter">Status</Label>
              <Select
                value={activeFilter === undefined ? "all" : String(activeFilter)}
                onValueChange={(value) => table.getColumn("active")?.setFilterValue(value === "all" ? undefined : value === "true")}
              >
                <SelectTrigger id="staff-status-filter" className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="true">Active</SelectItem>
                  <SelectItem value="false">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <span className="whitespace-nowrap pb-2 text-sm text-muted-foreground">
              {table.getFilteredRowModel().rows.length} of {staff.length} staff
            </span>
          </div>

          {loadError ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
              <p className="text-sm text-destructive">{loadError}</p>
              <Button size="sm" variant="outline" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          ) : loading ? (
            <p className="animate-pulse text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="max-h-[65vh] overflow-auto rounded-md border">
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
                        No staff found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    table.getRowModel().rows.map((row) => (
                      <TableRow key={row.id} className={row.original.active ? undefined : "text-muted-foreground"}>
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
        </div>

        <StaffFormDialog
          open={formOpen}
          staff={editing}
          roles={roles}
          onOpenChange={setFormOpen}
          onSaved={(member, created) => {
            upsert(member)
            setFormOpen(false)
            toast({
              title: created ? "Staff member created" : "Changes saved",
              description: created ? `${member.name} has been added as ${roleLabel(roles, member.role)}.` : `${member.name} has been updated.`,
            })
          }}
        />

        <CredentialResetDialog
          target={credentialTarget}
          onOpenChange={(open) => !open && setCredentialTarget(null)}
          onSaved={(member, kind) => {
            upsert(member)
            setCredentialTarget(null)
            toast({ title: kind === "pin" ? "PIN saved" : "Password saved", description: `${member.name}'s ${kind === "pin" ? "PIN" : "password"} has been updated.` })
          }}
        />

        <Dialog open={activeTarget !== null} onOpenChange={(open) => !open && setActiveTarget(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {activeTarget?.active ? "Deactivate" : "Activate"} {activeTarget?.name}?
              </DialogTitle>
              <DialogDescription>
                {activeTarget?.active
                  ? "They won't be able to log in by email or PIN, they'll disappear from the login tiles, and their current session will end when it next refreshes. You can activate them again later."
                  : "They'll be able to log in again with their existing credentials and will reappear on the login tiles."}
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setActiveTarget(null)}>
                Cancel
              </Button>
              <Button
                variant={activeTarget?.active ? "destructive" : "default"}
                disabled={togglingActive}
                onClick={() => void toggleActive()}
              >
                {togglingActive ? "Saving…" : activeTarget?.active ? "Deactivate" : "Activate"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </SidebarInset>
    </SidebarProvider>
  )
}
