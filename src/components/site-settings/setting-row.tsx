"use client"

// One site setting: label and the server's description, the input, "Default" or "Changed (default: …)", Reset when
// it has a saved value, Undo for an unsaved edit, the last change, the effects of a change, and its error.

import { Info, KeyRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatInstant, formatSettingValue, settingCopy, type SiteSetting } from "@/lib/site-settings"
import { SettingInput } from "@/components/site-settings/setting-input"

interface SettingRowProps {
  setting: SiteSetting
  // The text in the input: the unsaved edit, or the saved value.
  text: string
  edited: boolean
  error: string | null
  // Named by a REAUTH_REQUIRED.
  needsSignIn: boolean
  busy: boolean
  onChange: (text: string) => void
  onUndo: () => void
  onReset: () => void
}

export function settingInputId(key: string): string {
  return `setting-${key.replace(/[^a-zA-Z0-9-]/g, "-")}`
}

export function SettingRow({ setting, text, edited, error, needsSignIn, busy, onChange, onUndo, onReset }: SettingRowProps) {
  const copy = settingCopy(setting.key)
  const id = settingInputId(setting.key)
  const errorId = `${id}-error`
  const descriptionId = `${id}-description`

  return (
    <div
      data-testid={`setting-${setting.key}`}
      data-inactive={!setting.active || undefined}
      data-needs-sign-in={needsSignIn || undefined}
      className={cn(
        "grid gap-3 border-t py-4 first:border-t-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]",
        !setting.active && "opacity-60",
        needsSignIn && "rounded-md bg-amber-50 px-3 dark:bg-amber-950/30",
      )}
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <label id={`${id}-label`} htmlFor={id} className="text-sm font-medium">
            {copy.label}
          </label>
          {setting.sensitive && (
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              <KeyRound className="h-3 w-3" aria-hidden />
              Needs a recent password sign-in
            </span>
          )}
        </div>
        <p id={descriptionId} className="text-sm text-muted-foreground">
          {setting.description}
        </p>
        {copy.effect && (
          <p className="flex gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{copy.effect}</span>
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <SettingInput
          setting={setting}
          id={id}
          text={text}
          invalid={!!error}
          describedBy={error ? `${errorId} ${descriptionId}` : descriptionId}
          disabled={busy}
          onChange={onChange}
        />
        {setting.type === "DATE" && text === "" && copy.emptyMeaning && <p className="text-xs text-muted-foreground">{copy.emptyMeaning}</p>}
        {error && (
          <p id={errorId} className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span data-testid="setting-status" className={setting.isDefault ? "text-muted-foreground" : "font-medium"}>
            {setting.isDefault ? "Default" : `Changed (default: ${formatSettingValue(setting, setting.defaultValue)})`}
          </span>
          {!setting.isDefault && (
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" disabled={busy} onClick={onReset}>
              Reset
            </Button>
          )}
          {edited && (
            <>
              <span className="rounded bg-muted px-1.5 py-0.5">Edited, not saved</span>
              <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" disabled={busy} onClick={onUndo}>
                Undo edit
              </Button>
            </>
          )}
        </div>
        {setting.lastChange && (
          <p className="text-xs text-muted-foreground">
            {setting.lastChange.action === "RESET" ? "Reset" : "Last changed"} by {setting.lastChange.byName}, {formatInstant(setting.lastChange.at)}
          </p>
        )}
      </div>
    </div>
  )
}
