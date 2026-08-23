"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { isStockAccessRole } from "@/lib/roles";

type StockRequestStatus = "REQUESTED" | "PARTIALLY_ACTIONED" | "ACTIONED" | "REJECTED";

type StockRequestSummaryDto = {
  id: number;
  requestType: string;
  status: StockRequestStatus;
  requestedAt: string;
  purchaseOrderId?: number;
  locationName?: string;
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

function statusStyles(status: StockRequestStatus): string {
  switch (status) {
    case "ACTIONED":
      return "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/35";
    case "REJECTED":
      return "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/35";
    default:
      return "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/35";
  }
}

export default function StockMovementRequestsPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user, authFetch } = useAuth();

  const hasStockAccess = isStockAccessRole(user?.role);

  const [requests, setRequests] = useState<StockRequestSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.replace("/stock-movement/login");
      return;
    }
    if (!hasStockAccess) {
      router.replace("/stock-movement/login");
    }
  }, [authLoading, hasStockAccess, isAuthenticated, router]);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // No query params — visibility is auto-scoped server-side by the caller's role,
      // a STOCK_CLERK only ever sees their own requests here.
      const res = await authFetch("/stock-requests");
      const body = (await res.json().catch(() => null)) as StockRequestSummaryDto[] | unknown;
      if (!res.ok || !Array.isArray(body)) {
        throw new Error("Unable to load your requests.");
      }
      setRequests(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load your requests.");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (isAuthenticated && hasStockAccess) {
      void fetchRequests();
    }
  }, [fetchRequests, hasStockAccess, isAuthenticated]);

  if (authLoading || !isAuthenticated || !hasStockAccess) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <span className="text-lg text-slate-400 animate-pulse">Loading...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.push("/stock-movement")}
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <button
            type="button"
            onClick={() => void fetchRequests()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        <div>
          <h1 className="text-xl font-semibold text-white">My Requests</h1>
          <p className="text-sm text-slate-400">Track the status of stock requests you&apos;ve submitted.</p>
        </div>

        {error && <p className="text-sm text-rose-300">{error}</p>}

        {loading ? (
          <p className="text-sm text-slate-400 animate-pulse">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">
            No requests submitted yet.
          </p>
        ) : (
          <div className="space-y-3">
            {requests.map((request) => (
              <div key={request.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Request #{request.id} · {request.requestType}
                    </p>
                    <p className="text-xs text-slate-400">
                      {request.lines.length} line{request.lines.length === 1 ? "" : "s"} · {formatDateTime(request.requestedAt)}
                      {request.locationName ? ` · ${request.locationName}` : ""}
                    </p>
                    {request.purchaseOrderId && (
                      // STOCK_CLERK has no access to Purchase Orders (role hierarchy), so this
                      // is a plain reference, not a link — only STOCK_ADMIN/ADMIN can view it.
                      <p className="mt-1 text-xs text-slate-500">Purchase Order #{request.purchaseOrderId} created</p>
                    )}
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusStyles(request.status)}`}>
                    {request.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
