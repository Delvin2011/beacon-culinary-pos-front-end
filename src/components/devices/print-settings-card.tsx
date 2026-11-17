"use client"

import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { savePrintSettings, usePrintSettings } from "@/lib/print-settings"

// The automatic printing switches of the till this page is open on (O2b). They live in this browser only, so an admin
// changes them here, on the till itself. Clearing the browser data turns both back on.
export function PrintSettingsCard() {
  const settings = usePrintSettings()

  return (
    <section aria-labelledby="print-settings-heading" className="space-y-3 rounded-md border p-4">
      <div>
        <h2 id="print-settings-heading" className="font-semibold">
          Printing on this till
        </h2>
        <p className="text-sm text-muted-foreground">
          Saved in this browser only: set them on each till. Clearing the browser data turns both back on.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="auto-print-receipt"
          checked={settings.autoPrintReceipt}
          onCheckedChange={(value) => savePrintSettings({ ...settings, autoPrintReceipt: value === true })}
        />
        <Label htmlFor="auto-print-receipt">Print receipt automatically</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="auto-print-kitchen-ticket"
          checked={settings.autoPrintKitchenTicket}
          onCheckedChange={(value) => savePrintSettings({ ...settings, autoPrintKitchenTicket: value === true })}
        />
        <Label htmlFor="auto-print-kitchen-ticket">Print kitchen ticket automatically</Label>
      </div>
    </section>
  )
}
