"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, LogOut, PackagePlus, ShoppingCart, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { isStockAccessRole } from "@/lib/roles";

export default function StockMovementLandingPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, user, logout } = useAuth();

  const hasStockAccess = isStockAccessRole(user?.role);

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      router.replace("/stock-movement/login");
      return;
    }

    if (!hasStockAccess) {
      logout();
      router.replace("/stock-movement/login");
    }
  }, [hasStockAccess, isAuthenticated, isLoading, logout, router]);

  if (isLoading || !isAuthenticated || !hasStockAccess) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <span className="text-lg text-slate-400 animate-pulse">Loading...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-4 py-3 backdrop-blur md:px-6">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Stock Requests</p>
          <p className="text-sm font-semibold text-white">{user?.name ?? "Stock Movement Station"}</p>
        </div>

        <button
          type="button"
          onClick={() => {
            logout();
            router.replace("/stock-movement/login");
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-800"
        >
          <LogOut className="h-4 w-4" />
          Logout
        </button>
      </header>

      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
        <button
          type="button"
          onClick={() => router.push("/stock-movement/issue/new")}
          className="flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-left transition hover:border-blue-500/50 hover:bg-slate-800"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/35">
            <PackagePlus className="h-6 w-6" />
          </div>
          <div>
            <p className="text-base font-semibold text-white">New Issue Request</p>
            <p className="text-sm text-slate-400">Request stock to be issued from Main Store to Kitchen.</p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => router.push("/stock-movement/order/new")}
          className="flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-left transition hover:border-blue-500/50 hover:bg-slate-800"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/35">
            <ShoppingCart className="h-6 w-6" />
          </div>
          <div>
            <p className="text-base font-semibold text-white">New Order Request</p>
            <p className="text-sm text-slate-400">Request ingredients to be ordered from a supplier.</p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => router.push("/stock-movement/waste/new")}
          className="flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-left transition hover:border-blue-500/50 hover:bg-slate-800"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/35">
            <Trash2 className="h-6 w-6" />
          </div>
          <div>
            <p className="text-base font-semibold text-white">New Waste Request</p>
            <p className="text-sm text-slate-400">Report stock to be written off at a specific location.</p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => router.push("/stock-movement/requests")}
          className="flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-left transition hover:border-blue-500/50 hover:bg-slate-800"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/35">
            <ClipboardList className="h-6 w-6" />
          </div>
          <div>
            <p className="text-base font-semibold text-white">My Requests</p>
            <p className="text-sm text-slate-400">Track the status of requests you&apos;ve submitted.</p>
          </div>
        </button>
      </div>
    </div>
  );
}
