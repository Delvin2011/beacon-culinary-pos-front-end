"use client"

// T0-4b: Admin → Site settings (ADMIN only). The customer's own settings, changed without a redeploy
// (docs/2026-11-19-t0-4-site-settings-api-contract.md), and their change history. The settings form stays mounted
// while the history is shown, so unsaved edits survive switching tabs.

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DevicePageShell, useDeviceAdminGuard } from "@/components/devices/device-page-shell"
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard"
import { SettingsEditor } from "@/components/site-settings/settings-editor"
import { SettingsHistory } from "@/components/site-settings/settings-history"
import { cn } from "@/lib/utils"
import type { SiteSetting } from "@/lib/site-settings"

type Tab = "settings" | "history"

function initialTab(): Tab {
  if (typeof window === "undefined") return "settings"
  return new URLSearchParams(window.location.search).get("tab") === "history" ? "history" : "settings"
}

function writeTab(tab: Tab) {
  const params = new URLSearchParams(window.location.search)
  if (tab === "history") params.set("tab", "history")
  else {
    params.delete("tab")
    params.delete("key")
    params.delete("page")
    params.delete("size")
  }
  const search = params.toString()
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}`)
}

export default function SiteSettingsPage() {
  const allowed = useDeviceAdminGuard("/site-settings")
  const [tab, setTab] = useState<Tab>(initialTab)
  const [settings, setSettings] = useState<SiteSetting[]>([])
  const [dirty, setDirty] = useState(false)
  const guard = useUnsavedChangesGuard(dirty)

  if (!allowed) return null

  const choose = (next: Tab) => {
    setTab(next)
    writeTab(next)
  }

  const tabButton = (value: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      id={`site-settings-tab-${value}`}
      aria-selected={tab === value}
      aria-controls={`site-settings-panel-${value}`}
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
    <DevicePageShell title="Site settings">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Site settings</h1>
        <p className="text-sm text-muted-foreground">Changes apply without a restart. Other app servers pick them up within 30 seconds.</p>
      </div>
      <div role="tablist" aria-label="Site settings" className="flex gap-1 border-b">
        {tabButton("settings", "Settings")}
        {tabButton("history", "Change history")}
      </div>
      <div role="tabpanel" id="site-settings-panel-settings" aria-labelledby="site-settings-tab-settings" hidden={tab !== "settings"}>
        <SettingsEditor onLoaded={setSettings} onDirtyChange={setDirty} onLeaveForSignIn={guard.allowLeave} />
      </div>
      {tab === "history" && (
        <div role="tabpanel" id="site-settings-panel-history" aria-labelledby="site-settings-tab-history">
          <SettingsHistory settings={settings} />
        </div>
      )}

      <Dialog open={guard.pendingHref !== null} onOpenChange={(open) => !open && guard.stay()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Leave without saving?</DialogTitle>
            <DialogDescription>You have unsaved changes to the site settings. If you leave now, they are lost.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={guard.stay}>
              Stay on this page
            </Button>
            <Button variant="destructive" onClick={guard.leave}>
              Leave without saving
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DevicePageShell>
  )
}
