"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { KitchenQueueBoard } from "@/components/kitchen/kitchen-queue-board";
import { useAuth } from "@/hooks/use-auth";
import { isKitchenAccessRole } from "@/lib/roles";

export default function KitchenPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, user, logout } = useAuth();

  const hasKitchenAccess = isKitchenAccessRole(user?.role);

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      router.replace("/kitchen/login");
      return;
    }

    if (!hasKitchenAccess) {
      logout();
      router.replace("/kitchen/login");
    }
  }, [hasKitchenAccess, isAuthenticated, isLoading, logout, router]);

  if (isLoading || !isAuthenticated || !hasKitchenAccess) {
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
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Kitchen Display</p>
          <p className="text-sm font-semibold text-white">{user?.name ?? "Kitchen Station"}</p>
        </div>

        <button
          type="button"
          onClick={() => {
            logout();
            router.replace("/kitchen/login");
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-800"
        >
          <LogOut className="h-4 w-4" />
          Logout
        </button>
      </header>

      <KitchenQueueBoard />
    </div>
  );
}
