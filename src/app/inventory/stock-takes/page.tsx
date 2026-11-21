"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { useLocations } from "@/hooks/use-locations";
import { canManageStockTakes } from "@/lib/roles";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type StockTakeSummaryDto = {
  id: number;
  locationName: string;
  status: "SUBMITTED" | "APPROVED" | "REJECTED";
  submittedByName: string;
  submittedAt: string;
  lines: { ingredientId: number }[];
};

function formatDateTime(value?: string): string {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function initialLocationId(): number | null {
  if (typeof window === "undefined") return null;
  const value = Number(new URLSearchParams(window.location.search).get("locationId"));
  return Number.isInteger(value) && value > 0 ? value : null;
}

export default function StockTakesQueuePage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user, authFetch } = useAuth();
  // The filter offers deactivated locations too, so past counts there can still be found (contract section 3).
  const { locations: allLocations } = useLocations({ includeInactive: true });
  const { locations: activeLocations, loading: activeLoading } = useLocations();
  const [locationId, setLocationId] = useState<number | null>(initialLocationId);

  const [stockTakes, setStockTakes] = useState<StockTakeSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.replace("/login");
      return;
    }
    if (!canManageStockTakes(user?.role)) {
      router.replace("/dashboard");
    }
  }, [authLoading, isAuthenticated, router, user]);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status: "SUBMITTED" });
      if (locationId !== null) params.set("locationId", String(locationId));
      const res = await authFetch(`/stock-takes?${params.toString()}`);
      const body = (await res.json().catch(() => null)) as StockTakeSummaryDto[] | unknown;
      if (!res.ok || !Array.isArray(body)) {
        throw new Error("Unable to load pending stock takes.");
      }
      setStockTakes(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load pending stock takes.");
      setStockTakes([]);
    } finally {
      setLoading(false);
    }
  }, [authFetch, locationId]);

  // Keep the filter in the URL (?locationId=…).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (locationId !== null) params.set("locationId", String(locationId));
    else params.delete("locationId");
    const search = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
  }, [locationId]);

  useEffect(() => {
    if (isAuthenticated && canManageStockTakes(user?.role)) {
      void fetchQueue();
    }
  }, [fetchQueue, isAuthenticated, user]);

  if (authLoading || !isAuthenticated || !canManageStockTakes(user?.role)) {
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
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Pending Stock Takes</h2>
              <p className="text-sm text-muted-foreground">Submitted counts awaiting stock-admin review.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => void fetchQueue()} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Location</span>
            <select
              aria-label="Location"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={locationId ?? ""}
              onChange={(event) => setLocationId(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">All locations</option>
              {allLocations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                  {!activeLoading && !activeLocations.some((active) => active.id === location.id) ? " (inactive)" : ""}
                </option>
              ))}
              {locationId !== null && !allLocations.some((location) => location.id === locationId) && (
                <option value={locationId}>Location #{locationId}</option>
              )}
            </select>
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {loading ? (
            <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stock Take</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Submitted By</TableHead>
                  <TableHead>Lines</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {stockTakes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      {locationId !== null ? "No pending stock takes at this location." : "No pending stock takes."}
                    </TableCell>
                  </TableRow>
                ) : (
                  stockTakes.map((stockTake) => (
                    <TableRow key={stockTake.id}>
                      <TableCell className="font-medium">#{stockTake.id}</TableCell>
                      <TableCell>{stockTake.locationName}</TableCell>
                      <TableCell>{stockTake.submittedByName}</TableCell>
                      <TableCell>{stockTake.lines.length}</TableCell>
                      <TableCell>{formatDateTime(stockTake.submittedAt)}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/inventory/stock-takes/${stockTake.id}`}>Review</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
