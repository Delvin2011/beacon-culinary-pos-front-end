"use client"

// T0-4b: Admin → Site settings (ADMIN only). The customer's own settings, changed without a redeploy
// (docs/2026-11-19-t0-4-site-settings-api-contract.md).

import { DevicePageShell, useDeviceAdminGuard } from "@/components/devices/device-page-shell"
import { SettingsEditor } from "@/components/site-settings/settings-editor"

export default function SiteSettingsPage() {
  const allowed = useDeviceAdminGuard("/site-settings")
  if (!allowed) return null

  return (
    <DevicePageShell title="Site settings">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Site settings</h1>
        <p className="text-sm text-muted-foreground">
          Changes apply without a restart. Other app servers pick them up within 30 seconds.
        </p>
      </div>
      <SettingsEditor />
    </DevicePageShell>
  )
}
