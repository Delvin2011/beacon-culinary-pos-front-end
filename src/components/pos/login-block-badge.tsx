"use client"

import { Lock } from "lucide-react"
import { formatWait } from "@/lib/login-protection"
import type { LoginBlockState } from "@/hooks/use-login-blocks"

// Shown on a blocked person's tile. A block is per person, so other tiles stay usable.
export function LoginBlockBadge({ state }: { state: LoginBlockState | null }) {
  if (!state) return null
  const label =
    state.active && state.remainingSeconds !== null ? formatWait(state.remainingSeconds) : state.code === "ACCOUNT_LOCKED" ? "Locked" : null
  if (!label) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-medium text-rose-200 ring-1 ring-rose-500/30">
      <Lock className="h-3 w-3" aria-hidden />
      <span className="sr-only">Blocked: </span>
      {label}
    </span>
  )
}
