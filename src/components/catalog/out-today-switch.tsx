"use client"

import { useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { toast } from "@/hooks/use-toast"
import { setOutToday } from "@/lib/catalog"
import { cn } from "@/lib/utils"

interface OutTodaySwitchProps {
  mealCatalogId: number
  name: string
  outToday: boolean
  // False shows the state read-only (the role can't change it).
  canToggle: boolean
  // Gets the meal the server returns, so the caller can update its row.
  onChange: (updated: { outToday: boolean } & Record<string, unknown>) => void
}

// An always-available item's "Out today" switch. Out clears itself at midnight, hence "Back tomorrow".
export function OutTodaySwitch({ mealCatalogId, name, outToday, canToggle, onChange }: OutTodaySwitchProps) {
  const { authFetch } = useAuth()
  const [saving, setSaving] = useState(false)

  const toggle = async () => {
    setSaving(true)
    try {
      const updated = await setOutToday<{ outToday: boolean } & Record<string, unknown>>(authFetch, mealCatalogId, !outToday)
      onChange(updated)
      toast({
        title: updated.outToday ? `${name} is out today` : `${name} is back on sale`,
        description: updated.outToday ? "It comes back automatically tomorrow." : undefined,
      })
    } catch (err) {
      toast({ title: "Couldn't change Out today", description: err instanceof Error ? err.message : undefined, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={outToday}
        aria-label={`${name} out today`}
        disabled={!canToggle || saving}
        onClick={() => void toggle()}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          outToday ? "bg-rose-500" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
            outToday ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </button>
      <span className={cn("whitespace-nowrap text-xs", outToday ? "font-medium text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
        {outToday ? "Out today · Back tomorrow" : "On sale"}
      </span>
    </div>
  )
}
