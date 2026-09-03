"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type StockRequestSummaryDto = {
  id: number;
  requestType: "ISSUE" | "WASTE" | "ORDER";
  status: "REQUESTED" | "PARTIALLY_ACTIONED" | "ACTIONED" | "REJECTED";
  requestedByName: string;
  requestedAt: string;
  locationName?: string;
  lines: { ingredientId: number }[];
};

type StockRequestTableRow = {
  id: number;
  requestType: "ISSUE" | "WASTE" | "ORDER";
  locationName: string;
  requestedByName: string;
  lineCount: number;
  requestedAt: string;
};

const PENDING_STATUSES = new Set(["REQUESTED", "PARTIALLY_ACTIONED"]);
const STOCK_REQUEST_TYPES = ["ISSUE", "WASTE", "ORDER"] as const;

function formatDateTime(value?: string): string {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function StockRequestsQueuePage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user, authFetch } = useAuth();

  const [requests, setRequests] = useState<StockRequestSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestSearch, setRequestSearch] = useState("");
  const [requestSorting, setRequestSorting] = useState<SortingState>([]);
  const [requestColumnFilters, setRequestColumnFilters] = useState<ColumnFiltersState>([]);

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

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/stock-requests");
      const body = (await res.json().catch(() => null)) as StockRequestSummaryDto[] | unknown;
      if (!res.ok || !Array.isArray(body)) {
        throw new Error("Unable to load pending stock requests.");
      }
      setRequests(body.filter((request) => PENDING_STATUSES.has(request.status)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load pending stock requests.");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (isAuthenticated && user?.role?.toUpperCase().includes("ADMIN")) {
      void fetchQueue();
    }
  }, [fetchQueue, isAuthenticated, user]);

  const requestTableRows: StockRequestTableRow[] = useMemo(
    () =>
      requests.map((request) => ({
        id: request.id,
        requestType: request.requestType,
        locationName: request.locationName ?? "",
        requestedByName: request.requestedByName,
        lineCount: request.lines.length,
        requestedAt: request.requestedAt,
      })),
    [requests],
  );

  const requestTableColumns: ColumnDef<StockRequestTableRow>[] = useMemo(
    () => [
      {
        accessorKey: "id",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Request
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => <span className="font-medium">#{row.original.id}</span>,
      },
      {
        accessorKey: "requestType",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Type
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        filterFn: "equals",
      },
      {
        accessorKey: "locationName",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Location
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => row.original.locationName || "—",
      },
      {
        accessorKey: "requestedByName",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Requested By
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
      },
      {
        accessorKey: "lineCount",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Lines
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
      },
      {
        accessorKey: "requestedAt",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Submitted
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => formatDateTime(row.original.requestedAt),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/inventory/stock-requests/${row.original.id}`}>Review</Link>
          </Button>
        ),
      },
    ],
    [],
  );

  const requestTable = useReactTable({
    data: requestTableRows,
    columns: requestTableColumns,
    getRowId: (row) => String(row.id),
    state: {
      sorting: requestSorting,
      columnFilters: requestColumnFilters,
      globalFilter: requestSearch,
    },
    onSortingChange: setRequestSorting,
    onColumnFiltersChange: setRequestColumnFilters,
    onGlobalFilterChange: setRequestSearch,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

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
                  <BreadcrumbPage>Stock Requests</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Pending Stock Requests</h2>
              <p className="text-sm text-muted-foreground">Issue, Waste, and Order requests awaiting stock-admin authorization.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => void fetchQueue()} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 w-[220px]">
              <Label htmlFor="request-search">Search</Label>
              <Input
                id="request-search"
                value={requestSearch}
                onChange={(event) => setRequestSearch(event.target.value)}
                placeholder="Search requests"
              />
            </div>
            <div className="space-y-1">
              <Label>Type</Label>
              <Select
                value={(requestTable.getColumn("requestType")?.getFilterValue() as string) ?? "all"}
                onValueChange={(value) =>
                  requestTable.getColumn("requestType")?.setFilterValue(value === "all" ? undefined : value)
                }
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {STOCK_REQUEST_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <span className="pb-2 text-sm text-muted-foreground whitespace-nowrap">
              {requestTable.getFilteredRowModel().rows.length} of {requestTableRows.length} requests
            </span>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
          ) : (
            <div className="max-h-[65vh] overflow-y-auto rounded-md border">
              <table className="w-full caption-bottom text-sm">
                <TableHeader>
                  {requestTable.getHeaderGroups().map((headerGroup) => (
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
                  {requestTable.getRowModel().rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={requestTableColumns.length} className="py-8 text-center text-sm text-muted-foreground">
                        No pending requests.
                      </TableCell>
                    </TableRow>
                  ) : (
                    requestTable.getRowModel().rows.map((row) => (
                      <TableRow key={row.id}>
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
      </SidebarInset>
    </SidebarProvider>
  );
}
