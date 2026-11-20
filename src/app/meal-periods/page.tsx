"use client"

// T0-5b: Admin → Meal periods (ADMIN only). Add, edit, deactivate and activate the periods set meals are planned
// and sold under, and see who changed what (docs/2026-11-20-t0-5-meal-periods-locations-api-contract.md, part 2).
// The list stays mounted while the history is shown, so its filter has every period to offer.

import { useState } from "react"
import { DevicePageShell, useDeviceAdminGuard } from "@/components/devices/device-page-shell"
import { MealPeriodsHistory } from "@/components/meal-periods/meal-periods-history"
import { MealPeriodsList } from "@/components/meal-periods/meal-periods-list"
import type { AdminMealPeriod } from "@/lib/meal-periods"
import { cn } from "@/lib/utils"

type Tab = "periods" | "history"

function initialTab(): Tab {
  if (typeof window === "undefined") return "periods"
  return new URLSearchParams(window.location.search).get("tab") === "history" ? "history" : "periods"
}

function writeTab(tab: Tab) {
  const params = new URLSearchParams(window.location.search)
  if (tab === "history") params.set("tab", "history")
  else {
    params.delete("tab")
    params.delete("periodId")
    params.delete("page")
    params.delete("size")
  }
  const search = params.toString()
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}`)
}

export default function MealPeriodsPage() {
  const allowed = useDeviceAdminGuard("/meal-periods")
  const [tab, setTab] = useState<Tab>(initialTab)
  const [periods, setPeriods] = useState<AdminMealPeriod[]>([])

  if (!allowed) return null

  const choose = (next: Tab) => {
    setTab(next)
    writeTab(next)
  }

  const tabButton = (value: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      id={`meal-periods-tab-${value}`}
      aria-selected={tab === value}
      aria-controls={`meal-periods-panel-${value}`}
      onClick={() => choose(value)}
      className={cn(
        "border-b-2 px-3 py-2 text-sm font-medium",
        tab === value ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  )

  return (
    <DevicePageShell title="Meal periods">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Meal periods</h1>
        <p className="text-sm text-muted-foreground">
          Set meals are planned and sold under a meal period. The tills show the active periods in this order.
        </p>
      </div>
      <div role="tablist" aria-label="Meal periods" className="flex gap-1 border-b">
        {tabButton("periods", "Periods")}
        {tabButton("history", "Change history")}
      </div>
      <div role="tabpanel" id="meal-periods-panel-periods" aria-labelledby="meal-periods-tab-periods" hidden={tab !== "periods"}>
        <MealPeriodsList onLoaded={setPeriods} />
      </div>
      {tab === "history" && (
        <div role="tabpanel" id="meal-periods-panel-history" aria-labelledby="meal-periods-tab-history">
          <MealPeriodsHistory periods={periods} />
        </div>
      )}
    </DevicePageShell>
  )
}
