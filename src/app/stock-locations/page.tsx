"use client"

// T0-5d: Admin → Stock locations (ADMIN only). The primary and secondary locations, the assignments (production and
// the source of each sales station) and who changed what (docs/2026-11-21-t0-5c-locations-api-contract.md, part 4).

import { useState } from "react"
import { DevicePageShell, useDeviceAdminGuard } from "@/components/devices/device-page-shell"
import { LocationsList } from "@/components/stock-locations/locations-list"

export default function StockLocationsPage() {
  const allowed = useDeviceAdminGuard("/stock-locations")
  const [reloadKey] = useState(0)

  if (!allowed) return null

  return (
    <DevicePageShell title="Stock locations">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Stock locations</h1>
        <p className="text-sm text-muted-foreground">Where stock is held. Pickers on the stock screens show the active locations in this order.</p>
      </div>
      <LocationsList reloadKey={reloadKey} />
    </DevicePageShell>
  )
}
