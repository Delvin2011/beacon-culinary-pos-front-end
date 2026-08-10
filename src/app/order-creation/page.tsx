"use client";

import Link from "next/link";

export default function Page() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-12">
      <section className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-100">
        <h1 className="text-xl font-bold text-white">Route Retired</h1>
        <p className="mt-3 text-sm text-slate-300">
          The old order-creation flow has been retired because Stage 4 uses the new payments array contract and account/split payment rules.
        </p>
        <p className="mt-2 text-sm text-slate-300">
          Use the POS terminal flow for all new orders.
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/pos/login"
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400"
          >
            Open POS Login
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
          >
            Back to Dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}
