"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type PurchaseOrderStatus = "DRAFT" | "SUBMITTED" | "RECEIVED";

type PurchaseOrderLineDto = {
  id: number;
  ingredientId: number;
  ingredientName: string;
  quantity: number;
  note?: string;
};

type PurchaseOrderDetailDto = {
  id: number;
  supplierName: string;
  status: PurchaseOrderStatus;
  createdAt: string;
  stockRequestId?: number;
  lines: PurchaseOrderLineDto[];
};

function formatDateTime(value?: string): string {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function parseError(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) return record.message;
  if (typeof record.error === "string" && record.error.trim()) return record.error;
  return fallback;
}

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user, authFetch } = useAuth();

  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrderDetailDto | null>(null);
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

  const fetchPurchaseOrder = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/admin/purchase-orders/${params.id}`);
      const body = (await res.json().catch(() => null)) as PurchaseOrderDetailDto | unknown;
      if (!res.ok || !body) {
        throw new Error(parseError(body, "Unable to load this purchase order."));
      }
      setPurchaseOrder(body as PurchaseOrderDetailDto);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load this purchase order.");
      setPurchaseOrder(null);
    } finally {
      setLoading(false);
    }
  }, [authFetch, params.id]);

  useEffect(() => {
    if (isAuthenticated && user?.role?.toUpperCase().includes("ADMIN")) {
      void fetchPurchaseOrder();
    }
  }, [fetchPurchaseOrder, isAuthenticated, user]);

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
                <BreadcrumbItem className="hidden md:block">Inventory</BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Purchase Order</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <Button variant="ghost" size="sm" className="w-fit" onClick={() => router.push("/inventory")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Inventory
          </Button>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {loading ? (
            <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
          ) : purchaseOrder ? (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Purchase Order #{purchaseOrder.id}</h2>
              </div>

              <div className="grid gap-4 rounded-lg border p-4 md:grid-cols-4">
                <div className="space-y-1">
                  <Label>Supplier</Label>
                  <p className="text-sm text-muted-foreground">{purchaseOrder.supplierName}</p>
                </div>
                <div className="space-y-1">
                  <Label>Status</Label>
                  <p className="text-sm text-muted-foreground">{purchaseOrder.status}</p>
                </div>
                <div className="space-y-1">
                  <Label>Created</Label>
                  <p className="text-sm text-muted-foreground">{formatDateTime(purchaseOrder.createdAt)}</p>
                </div>
                {purchaseOrder.stockRequestId && (
                  <div className="space-y-1">
                    <Label>Source</Label>
                    <p className="text-sm text-muted-foreground">Order Request #{purchaseOrder.stockRequestId}</p>
                  </div>
                )}
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ingredient</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchaseOrder.lines.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                        No lines on this purchase order.
                      </TableCell>
                    </TableRow>
                  ) : (
                    purchaseOrder.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="font-medium">{line.ingredientName}</TableCell>
                        <TableCell>{line.quantity}</TableCell>
                        <TableCell>{line.note || "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
