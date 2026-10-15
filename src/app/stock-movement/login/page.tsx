"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PackageSearch } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { isStockAccessRole } from "@/lib/roles";

// Stock Admin and Stock Clerk accounts log in by email and password; they don't have a PIN.
export default function StockMovementLoginPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, user, login, error, clearError, logout } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) return;

    if (isStockAccessRole(user?.role)) {
      router.replace("/stock-movement");
      return;
    }

    // Signed in, but not with a stock role (e.g. a cashier session left in this browser).
    logout();
    setFormError("This account doesn't have stock access. Sign in with a stock or admin account.");
  }, [isAuthenticated, isLoading, logout, router, user?.role]);

  const submit = async () => {
    if (submitting) return;

    if (!email.trim() || !password) {
      setFormError("Enter your email and password.");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    if (error) clearError();

    try {
      await login({ email: email.trim().toLowerCase(), password });
      // The effect above routes stock roles in and signs anyone else out.
    } catch {
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  };

  const message = formError ?? error;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-black/30">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/35">
            <PackageSearch className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-white">Stock Movement Station</h1>
          <p className="mt-1 text-sm text-slate-400">Sign in with your email to submit or track stock requests.</p>
        </div>

        {message && (
          <p role="alert" className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-center text-sm text-rose-200">
            {message}
          </p>
        )}

        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="stock-email" className="text-sm font-medium text-slate-200">
              Email
            </label>
            <input
              id="stock-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setFormError(null);
                if (error) clearError();
              }}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-base text-white outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="stock-password" className="text-sm font-medium text-slate-200">
              Password
            </label>
            <input
              id="stock-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setFormError(null);
                if (error) clearError();
              }}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-base text-white outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || isLoading}
            className="w-full rounded-2xl bg-blue-500 py-3.5 text-base font-semibold text-white transition hover:bg-blue-400 active:bg-blue-600 disabled:pointer-events-none disabled:opacity-50"
          >
            {submitting || isLoading ? "Signing in..." : "Open Stock Requests"}
          </button>
        </form>
      </div>
    </div>
  );
}
