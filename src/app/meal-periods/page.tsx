"use client"

// T0-5b: Admin → Meal periods (ADMIN only). Add, edit, deactivate and activate the periods set meals are planned
// and sold under (docs/2026-11-20-t0-5-meal-periods-locations-api-contract.md, part 2).

import { DevicePageShell, useDeviceAdminGuard } from "@/components/devices/device-page-shell"
import { MealPeriodsList } from "@/components/meal-periods/meal-periods-list"

export default function MealPeriodsPage() {
  const allowed = useDeviceAdminGuard("/meal-periods")
  if (!allowed) return null

  return (
    <DevicePageShell title="Meal periods">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Meal periods</h1>
        <p className="text-sm text-muted-foreground">
          Set meals are planned and sold under a meal period. The tills show the active periods in this order.
        </p>
      </div>
      <MealPeriodsList />
    </DevicePageShell>
  )
}
