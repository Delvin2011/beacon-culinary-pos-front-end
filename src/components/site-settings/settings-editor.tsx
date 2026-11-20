"use client"

// The site settings form (T0-4b). Groups as the API groups them. Edits are held as text per key; Save sends only
// the settings that change, in one PUT (all or nothing). Reset is its own call, at once after a confirm, and keeps
// the other unsaved edits. 400s go under their fields (both fields for a cross-field rule).
//
// Sensitive settings: on REAUTH_REQUIRED (from Save or Reset) the edits, the reset asked for and what was loaded are
// kept in sessionStorage (never a password or token) and the admin signs in again with their password. Back here,
// the settings are loaded again and the edits put back; a setting someone else saved meanwhile is pointed out, and
// Save asks once before replacing it. Nothing is sent until the admin saves (or confirms the reset) again.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAuth } from "@/hooks/use-auth"
import { toast } from "@/hooks/use-toast"
import { reauthLoginPath } from "@/lib/return-to"
import {
  SiteSettingsError,
  SiteSettingsErrorCode,
  buildBaseline,
  checkEdits,
  clearSiteSettingsDraft,
  fetchSiteSettings,
  fieldMessage,
  formatSettingValue,
  groupSettings,
  loadSiteSettingsDraft,
  pruneEdits,
  resetSiteSetting,
  saveSiteSettings,
  saveSiteSettingsDraft,
  settingCopy,
  staleKeys,
  toInputText,
  type DraftBaseline,
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
  // Called just before leaving for the password re-sign-in (the edits are kept), so no leave warning is shown.
  onLeaveForSignIn?: () => void
}

export function SettingsEditor({ onDirtyChange, onLeaveForSignIn }: SettingsEditorProps) {
  const router = useRouter()
  const { authFetch } = useAuth()
  const [data, setData] = useState<SiteSettings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [edits, setEdits] = useState<SettingEdits>({})
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [topErrors, setTopErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [resetKey, setResetKey] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  // Back from the re-sign-in.
  const [restored, setRestored] = useState<{ dropped: string[] } | null>(null)
  const [reauthKeys, setReauthKeys] = useState<string[]>([])
  const [stale, setStale] = useState<string[]>([])
  const [resetAfterSignIn, setResetAfterSignIn] = useState(false)
  const [staleConfirm, setStaleConfirm] = useState(false)
  // What each edited setting was when first loaded, kept across more than one re-sign-in.
  const baselineRef = useRef<Record<string, DraftBaseline>>({})

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

  // First load; put back a draft kept through the re-sign-in.
  useEffect(() => {
    const draft = loadSiteSettingsDraft()
    void load().then((loaded) => {
      if (!loaded || !draft) return
      clearSiteSettingsDraft()
      const known = new Set(loaded.settings.map((s) => s.key))
      const kept: SettingEdits = {}
      const dropped: string[] = []
      for (const [key, text] of Object.entries(draft.edits)) {
        if (known.has(key)) kept[key] = text
        else dropped.push(key)
      }
      setEdits(pruneEdits(loaded.settings, kept))
      baselineRef.current = draft.baseline
      setReauthKeys(draft.reauthKeys)
      setStale(staleKeys(draft, loaded.settings))
      setRestored({ dropped })
      const pending = draft.pendingReset ? loaded.settings.find((s) => s.key === draft.pendingReset) : undefined
      if (pending && !pending.isDefault) {
        setResetKey(pending.key)
        setResetAfterSignIn(true)
      }
    })
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

  // Keeps the form through the password re-sign-in and goes there; it comes back to this page.
  const goSignIn = (pendingReset: string | null, keys: string[]) => {
    const touched = [...Object.keys(edits), ...(pendingReset ? [pendingReset] : [])]
    saveSiteSettingsDraft({ edits, pendingReset, baseline: buildBaseline(settings, touched, baselineRef.current), reauthKeys: keys })
    onLeaveForSignIn?.()
    router.push(reauthLoginPath("/site-settings"))
  }

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

  const staleInSave = stale.filter((key) => key in check.changes)

  const save = async (replaceNewer = false) => {
    if (changeCount === 0 || invalidCount > 0) return
    if (staleInSave.length > 0 && !replaceNewer) {
      setStaleConfirm(true)
      return
    }
    setStaleConfirm(false)
    setSaving(true)
    setTopErrors([])
    setServerErrors({})
    try {
      const saved = await saveSiteSettings(authFetch, check.changes)
      setData(saved)
      setEdits({})
      setStale([])
      setReauthKeys([])
      setRestored(null)
      baselineRef.current = {}
      toast({ title: "Settings saved", description: `${changeCount} setting${changeCount === 1 ? "" : "s"} changed.` })
    } catch (err) {
      if (err instanceof SiteSettingsError && err.needsReauth) {
        goSignIn(null, err.reauthKeys)
        return
      }
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
      setResetAfterSignIn(false)
      setStale((keys) => keys.filter((k) => k !== key))
      setReauthKeys((keys) => keys.filter((k) => k !== key))
      toast({ title: `${settingCopy(key).label} reset to the default` })
    } catch (err) {
      if (err instanceof SiteSettingsError && err.needsReauth) {
        goSignIn(key, err.reauthKeys)
        return
      }
      setResetKey(null)
      setResetAfterSignIn(false)
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
  const labelOf = (key: string) => settingCopy(key).label
  const staleSettings = stale.map((key) => settings.find((s) => s.key === key)).filter((s): s is SiteSetting => !!s)

  return (
    <div className="space-y-4">
      {restored && (
        <div role="status" className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-700 dark:bg-amber-950/30">
          <p>You&apos;re signed in again. Your unsaved changes are back; press Save to apply them.</p>
          {restored.dropped.map((key) => (
            <p key={key}>{key} is no longer a site setting, so its change was dropped.</p>
          ))}
          {staleSettings.map((setting) => (
            <p key={setting.key} data-testid="stale-notice">
              Someone else changed {labelOf(setting.key)} since you started (now {formatSettingValue(setting, setting.value)}). Saving will replace it.
            </p>
          ))}
        </div>
      )}

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
                needsSignIn={reauthKeys.includes(setting.key)}
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

      <ResetConfirmDialog
        setting={resetSetting}
        afterSignIn={resetAfterSignIn}
        busy={resetting}
        onCancel={() => {
          setResetKey(null)
          setResetAfterSignIn(false)
        }}
        onConfirm={() => void reset()}
      />

      <Dialog open={staleConfirm} onOpenChange={(open) => !open && setStaleConfirm(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Replace a newer change?</DialogTitle>
            <DialogDescription>
              Someone else changed {staleInSave.map(labelOf).join(", ")} since you started. Saving replaces their value with yours.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStaleConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save(true)}>Save anyway</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
