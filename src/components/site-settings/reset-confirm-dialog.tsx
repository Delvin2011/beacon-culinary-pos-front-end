"use client"

// Confirms a reset (POST /admin/settings/{key}/reset), which happens at once: the setting goes back to its default.

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatSettingValue, settingCopy, type SiteSetting } from "@/lib/site-settings"

interface ResetConfirmDialogProps {
  setting: SiteSetting | null
  // Shown again after the password re-sign-in.
  afterSignIn?: boolean
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ResetConfirmDialog({ setting, afterSignIn, busy, onCancel, onConfirm }: ResetConfirmDialogProps) {
  const copy = setting ? settingCopy(setting.key) : null
  return (
    <Dialog open={setting !== null} onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Reset {copy?.label} to the default ({setting ? formatSettingValue(setting, setting.defaultValue) : ""})?
          </DialogTitle>
          <DialogDescription>
            {afterSignIn ? "You're signed in again. Confirm the reset you asked for. " : ""}
            It is reset straight away and recorded in the change history.
            {setting ? ` Now: ${formatSettingValue(setting, setting.value)}.` : ""}
          </DialogDescription>
        </DialogHeader>
        {copy?.effect && <p className="text-sm text-muted-foreground">{copy.effect}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? "Resetting…" : "Reset to default"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
