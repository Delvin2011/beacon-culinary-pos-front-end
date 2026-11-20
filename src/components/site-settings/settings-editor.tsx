"use client"

// The site settings form (T0-4b). Groups as the API groups them. Edits are held as text per key; Save sends only
// the settings that change, in one PUT (all or nothing). Reset is its own call, at once after a confirm, and keeps
// the other unsaved edits. 400s go under their fields (both fields for a cross-field rule).

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { toast } from "@/hooks/use-toast"
import {
  SiteSettingsError,
  SiteSettingsErrorCode,
  checkEdits,
  fetchSiteSettings,
  fieldMessage,
  groupSettings,
  pruneEdits,
  resetSiteSetting,
  saveSiteSettings,
  settingCopy,
  toInputText,
  type SettingEdits,
  type SiteSetting,
  type SiteSettings,
} from "@/lib/site-settings"
import { ResetConfirmDialog } from "@/components/site-settings/reset-confirm-dialog"
import { SettingRow } from "@/components/site-settings/setting-row"
import { SettingsGroup } from "@/components/site-settings/settings-group"

// Splits a 400 field map into messages under the settings on screen and the rest (unknown keys, "body").
export function splitFieldErrors(settings: SiteSetting[], fieldErrors: Record<string, string>): { byKey: Record<string, string>; other: string[] } {
  const byKey: Record<string, string> = {}
  const other: string[] = []
  for (const [key, message] of Object.entries(fieldErrors)) {
    if (settings.some((s) => s.key === key)) byKey[key] = fieldMessage(key, message)
    else if (key === "body") other.push(message)
    else other.push(`${key}: ${message}`)
  }
  return { byKey, other }
}

interface SettingsEditorProps {
  // Tells the page whether there are unsaved edits.
  onDirtyChange?: (dirty: boolean) => void
}

export function SettingsEditor({ onDirtyChange }: SettingsEditorProps) {
  const { authFetch } = useAuth()
  const [data, setData] = useState<SiteSettings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [edits, setEdits] = useState<SettingEdits>({})
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [topErrors, setTopErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [resetKey, setResetKey] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const loaded = await fetchSiteSettings(authFetch)
      setData(loaded)
      return loaded
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Unable to load the site settings.")
      return null
    }
  }, [authFetch])

  useEffect(() => {
    void load()
  }, [load])

  const settings = useMemo(() => data?.settings ?? [], [data])
  const groups = useMemo(() => groupSettings(settings), [settings])
  const check = useMemo(() => checkEdits(settings, edits), [settings, edits])
  const changeCount = Object.keys(check.changes).length
  const invalidCount = Object.keys(check.invalid).length
  const dirty = changeCount > 0 || invalidCount > 0

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  const edit = (setting: SiteSetting, text: string) => {
    setEdits((current) => {
      const next = { ...current }
      if (text === toInputText(setting, setting.value)) delete next[setting.key]
      else next[setting.key] = text
      return next
    })
    setServerErrors((current) => {
      if (!(setting.key in current)) return current
      const next = { ...current }
      delete next[setting.key]
      return next
    })
  }

  const undo = (key: string) => {
    setEdits((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
    setServerErrors((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const discard = () => {
    setEdits({})
    setServerErrors({})
    setTopErrors([])
  }

  const showError = (err: unknown, fallback: string) => {
    if (err instanceof SiteSettingsError && Object.keys(err.fieldErrors).length > 0) {
      const { byKey, other } = splitFieldErrors(settings, err.fieldErrors)
      setServerErrors(byKey)
      setTopErrors([err.message, ...other])
    } else {
      setTopErrors([err instanceof Error ? err.message : fallback])
    }
  }

  const save = async () => {
    if (changeCount === 0 || invalidCount > 0) return
    setSaving(true)
    setTopErrors([])
    setServerErrors({})
    try {
      const saved = await saveSiteSettings(authFetch, check.changes)
      setData(saved)
      setEdits({})
      toast({ title: "Settings saved", description: `${changeCount} setting${changeCount === 1 ? "" : "s"} changed.` })
    } catch (err) {
      showError(err, "Unable to save the site settings.")
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    const key = resetKey
    if (!key) return
    setResetting(true)
    setTopErrors([])
    try {
      const next = await resetSiteSetting(authFetch, key)
      setData(next)
      // Keep the other unsaved edits; drop the one to the setting just reset.
      setEdits((current) => {
        const rest = { ...current }
        delete rest[key]
        return pruneEdits(next.settings, rest)
      })
      setServerErrors({})
      setResetKey(null)
      toast({ title: `${settingCopy(key).label} reset to the default` })
    } catch (err) {
      setResetKey(null)
      if (err instanceof SiteSettingsError && err.code === SiteSettingsErrorCode.UNKNOWN_SETTING) {
        setTopErrors([err.message])
        void load()
      } else if (err instanceof SiteSettingsError && Object.keys(err.fieldErrors).length > 0) {
        const { byKey, other } = splitFieldErrors(settings, err.fieldErrors)
        setServerErrors(byKey)
        setTopErrors([`${settingCopy(key).label} wasn't reset; nothing was changed.`, ...other])
      } else {
        setTopErrors([err instanceof Error ? err.message : "Unable to reset the setting."])
      }
    } finally {
      setResetting(false)
    }
  }

  if (loadError && !data) {
    return (
      <div className="space-y-3 rounded-md border p-4">
        <p className="text-sm text-destructive">{loadError}</p>
        <Button variant="outline" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    )
  }
  if (!data) return <p className="text-sm text-muted-foreground">Loading the site settings…</p>

  const busy = saving || resetting
  const resetSetting = resetKey ? (settings.find((s) => s.key === resetKey) ?? null) : null

  return (
    <div className="space-y-4">
      {topErrors.length > 0 && (
        <div role="alert" className="space-y-1 rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {topErrors.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}

      {groups.map(({ group, settings: inGroup }) => (
        <SettingsGroup key={group} group={group} settings={inGroup}>
          {inGroup.map((setting) => {
            const text = edits[setting.key] ?? toInputText(setting, setting.value)
            return (
              <SettingRow
                key={setting.key}
                setting={setting}
                text={text}
                edited={setting.key in edits}
                error={serverErrors[setting.key] ?? check.invalid[setting.key] ?? null}
                needsSignIn={false}
                busy={busy}
                onChange={(value) => edit(setting, value)}
                onUndo={() => undo(setting.key)}
                onReset={() => setResetKey(setting.key)}
              />
            )
          })}
        </SettingsGroup>
      ))}

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-3 border-t bg-background/95 py-3 backdrop-blur">
        <p className="mr-auto text-sm text-muted-foreground" aria-live="polite">
          {changeCount === 0 && invalidCount === 0
            ? "No unsaved changes."
            : `${changeCount} unsaved change${changeCount === 1 ? "" : "s"}${invalidCount > 0 ? `, ${invalidCount} to fix` : ""}.`}
        </p>
        <Button variant="outline" onClick={discard} disabled={busy || !dirty}>
          Discard changes
        </Button>
        <Button onClick={() => void save()} disabled={busy || changeCount === 0 || invalidCount > 0}>
          {saving ? "Saving…" : changeCount > 0 ? `Save (${changeCount})` : "Save"}
        </Button>
      </div>

      <ResetConfirmDialog setting={resetSetting} busy={resetting} onCancel={() => setResetKey(null)} onConfirm={() => void reset()} />
    </div>
  )
}
