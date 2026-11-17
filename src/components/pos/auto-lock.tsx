"use client"

// The auto-lock warning on every POS screen with a signed-in session (/pos, /pos/shift-open). Nothing is shown
// until the till has been idle for idleLockMinutes.

import { useRouter } from "next/navigation"
import { Lock } from "lucide-react"
import { useAutoLock } from "@/hooks/use-auto-lock"

export function AutoLock() {
  const router = useRouter()
  const { warningSecondsLeft, staySignedIn } = useAutoLock(() => router.replace("/pos/login"))

  if (warningSecondsLeft === null) return null

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="auto-lock-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    >
      <div className="w-full max-w-sm rounded-3xl border border-slate-700 bg-slate-900 p-6 text-center">
        <Lock className="mx-auto h-10 w-10 text-sky-300" />
        <h2 id="auto-lock-title" className="mt-4 text-xl font-bold text-white">
          Locking the till in {warningSecondsLeft} s
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          No activity for a while. Your shift stays open and your order is kept.
        </p>
        <button
          type="button"
          onClick={staySignedIn}
          className="mt-6 w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-400"
        >
          Stay signed in
        </button>
      </div>
    </div>
  )
}
