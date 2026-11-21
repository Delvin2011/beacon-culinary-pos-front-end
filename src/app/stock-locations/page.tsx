"use client"

// T0-5d: Admin → Stock locations (ADMIN only). The primary and secondary locations, the assignments (production and
// the source of each sales station) and who changed what (docs/2026-11-21-t0-5c-locations-api-contract.md, part 4).
// The list stays mounted while the history is shown, so the history's filter has every location to offer.

import { useCallback, useState } from "react"
import { DevicePageShell, useDeviceAdminGuard } from "@/components/devices/device-page-shell"
import { AssignmentsSection } from "@/components/stock-locations/assignments-section"
import { LocationsHistory } from "@/components/stock-locations/locations-history"
import { LocationsList } from "@/components/stock-locations/locations-list"
import type { AdminLocation } from "@/lib/locations"
import { cn } from "@/lib/utils"

type Tab = "locations" | "history"

function initialTab(): Tab {
  if (typeof window === "undefined") return "locations"
  return new URLSearchParams(window.location.search).get("tab") === "history" ? "history" : "locations"
}

function writeTab(tab: Tab) {
  const params = new URLSearchParams(window.location.search)
  if (tab === "history") params.set("tab", "history")
  else {
    params.delete("tab")
    params.delete("locationId")
    params.delete("page")
    params.delete("size")
  }
  const search = params.toString()
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}`)
}

export default function StockLocationsPage() {
  const allowed = useDeviceAdminGuard("/stock-locations")
  const [tab, setTab] = useState<Tab>(initialTab)
  const [locations, setLocations] = useState<AdminLocation[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const reloadList = useCallback(() => setReloadKey((key) => key + 1), [])

  if (!allowed) return null

  const choose = (next: Tab) => {
    setTab(next)
    writeTab(next)
  }

  const tabButton = (value: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      id={`stock-locations-tab-${value}`}
      aria-selected={tab === value}
      aria-controls={`stock-locations-panel-${value}`}
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
    <DevicePageShell title="Stock locations">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Stock locations</h1>
        <p className="text-sm text-muted-foreground">Where stock is held. Pickers on the stock screens show the active locations in this order.</p>
      </div>
      <div role="tablist" aria-label="Stock locations" className="flex gap-1 border-b">
        {tabButton("locations", "Locations")}
        {tabButton("history", "Changes")}
      </div>
      <div
        role="tabpanel"
        id="stock-locations-panel-locations"
        aria-labelledby="stock-locations-tab-locations"
        hidden={tab !== "locations"}
        className="space-y-8"
      >
        <LocationsList onLoaded={setLocations} reloadKey={reloadKey} />
        <AssignmentsSection locations={locations} onChanged={reloadList} />
      </div>
      {tab === "history" && (
        <div role="tabpanel" id="stock-locations-panel-history" aria-labelledby="stock-locations-tab-history">
          <LocationsHistory locations={locations} />
        </div>
      )}
    </DevicePageShell>
  )
}
