"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type StockRequestSummaryDto = {
  id: number;
  requestType: "ISSUE" | "WASTE" | "ORDER";
  status: "REQUESTED" | "PARTIALLY_ACTIONED" | "ACTIONED" | "REJECTED";
  requestedByName: string;
  requestedAt: string;
  locationName?: string;
  lines: { ingredientId: number }[];
};

const PENDING_STATUSES = new Set(["REQUESTED", "PARTIALLY_ACTIONED"]);

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

          {loading ? (
            <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Requested By</TableHead>
                  <TableHead>Lines</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      No pending requests.
                    </TableCell>
                  </TableRow>
                ) : (
                  requests.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell className="font-medium">#{request.id}</TableCell>
                      <TableCell>{request.requestType}</TableCell>
                      <TableCell>{request.locationName ?? "—"}</TableCell>
                      <TableCell>{request.requestedByName}</TableCell>
                      <TableCell>{request.lines.length}</TableCell>
                      <TableCell>{formatDateTime(request.requestedAt)}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/inventory/stock-requests/${request.id}`}>Review</Link>
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
