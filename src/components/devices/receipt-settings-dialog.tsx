"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/hooks/use-auth"
import { resetReceiptSettingsCache } from "@/hooks/use-receipt-settings"
import { toast } from "@/hooks/use-toast"
import { formatJhbDateTime } from "@/lib/pos-activity"
import {
  ReceiptSettingsError,
  getAdminReceiptSettings,
  receiptSettingsBody,
  saveAdminReceiptSettings,
  validateReceiptSettings,
  type ReceiptSettingsField,
} from "@/lib/receipt-settings-admin"
import { RECEIPT_SETTINGS_LIMITS, type AdminReceiptSettings, type ReceiptSettings } from "@/lib/receipt-settings"

type TextField = "receiptTitle" | "businessName" | "phone" | "vatNumber" | "footerText"

interface Form {
  receiptTitle: string
  businessName: string
  addressLines: string[]
  phone: string
  vatNumber: string
  footerText: string
  showVatLine: boolean
}

const ADDRESS_INPUTS = RECEIPT_SETTINGS_LIMITS.addressLines

function toForm(settings: AdminReceiptSettings): Form {
  const lines = [...settings.addressLines]
  while (lines.length < ADDRESS_INPUTS) lines.push("")
  return {
    receiptTitle: settings.receiptTitle ?? "",
    businessName: settings.businessName ?? "",
    addressLines: lines,
    phone: settings.phone ?? "",
    vatNumber: settings.vatNumber ?? "",
    footerText: settings.footerText ?? "",
    showVatLine: settings.showVatLine,
  }
}

const blankToNull = (value: string) => (value.trim() ? value.trim() : null)

// Start from what GET returned and change only the fields the admin edited (handoff 2.1): the PUT replaces everything.
function toBody(loaded: AdminReceiptSettings, form: Form, edited: Set<ReceiptSettingsField>): ReceiptSettings {
  return {
    receiptTitle: edited.has("receiptTitle") ? blankToNull(form.receiptTitle) : loaded.receiptTitle,
    businessName: edited.has("businessName") ? blankToNull(form.businessName) : loaded.businessName,
    addressLines: edited.has("addressLines") ? form.addressLines.map((line) => line.trim()).filter(Boolean) : loaded.addressLines,
    phone: edited.has("phone") ? blankToNull(form.phone) : loaded.phone,
    vatNumber: edited.has("vatNumber") ? blankToNull(form.vatNumber) : loaded.vatNumber,
    footerText: edited.has("footerText") ? blankToNull(form.footerText) : loaded.footerText,
    showVatLine: edited.has("showVatLine") ? form.showVatLine : loaded.showVatLine,
  }
}

// True when saving would store something different: typing and then undoing it, or adding only spaces, isn't a change.
function hasChanges(loaded: AdminReceiptSettings, body: ReceiptSettings): boolean {
  return JSON.stringify(receiptSettingsBody(loaded)) !== JSON.stringify(receiptSettingsBody(body))
}

function lastSavedLine(settings: AdminReceiptSettings): string | null {
  if (!settings.updatedBy && !settings.updatedAt) return null
  const at = settings.updatedAt ? formatJhbDateTime(settings.updatedAt) : null
  if (settings.updatedBy && at) return `Last saved by ${settings.updatedBy} at ${at}`
  return settings.updatedBy ? `Last saved by ${settings.updatedBy}` : `Last saved at ${at}`
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  )
}

// Admin: the receipt's header, footer and VAT line (O2b contract 2.3, 2.4), opened from Registered tills. Read fresh
// each time it opens. Save is enabled only when something changed; Cancel always closes and drops the edits.
// Changes apply to the next receipt printed; reprints use the settings current at the time of the reprint.
export function ReceiptSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { authFetch } = useAuth()
  const [loaded, setLoaded] = useState<AdminReceiptSettings | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [edited, setEdited] = useState<Set<ReceiptSettingsField>>(new Set())
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ReceiptSettingsField, string>>>({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    setLoaded(null)
    setForm(null)
    setEdited(new Set())
    setFieldErrors({})
    setSaveError(null)
    try {
      const settings = await getAdminReceiptSettings(authFetch)
      setLoaded(settings)
      setForm(toForm(settings))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load the receipt settings. Try again.")
    }
  }, [authFetch])

  useEffect(() => {
    if (open) void load()
    // Only when the dialog opens: a token refresh mustn't reload it under the admin's edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const body = loaded && form ? toBody(loaded, form, edited) : null
  const changed = loaded !== null && body !== null && hasChanges(loaded, body)

  const change = <K extends keyof Form>(field: K, value: Form[K]) => {
    setForm((current) => (current ? { ...current, [field]: value } : current))
    setEdited((current) => new Set(current).add(field))
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
  }

  const save = async () => {
    if (!body || !changed) return
    const errors = validateReceiptSettings(body)
    setSaveError(null)
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return
    setSaving(true)
    try {
      await saveAdminReceiptSettings(authFetch, body)
      // The tills read them again at their next sign-in; this browser re-reads them at once.
      resetReceiptSettingsCache()
      toast({ title: "Receipt settings saved" })
      onClose()
    } catch (err) {
      if (err instanceof ReceiptSettingsError) {
        setFieldErrors(err.fieldErrors)
        setSaveError(err.message)
      } else {
        setSaveError("Couldn't save the receipt settings. Try again.")
      }
    } finally {
      setSaving(false)
    }
  }

  const textInput = (field: TextField, label: string, max: number) => (
    <div className="space-y-1">
      <Label htmlFor={field}>{label}</Label>
      <Input
        id={field}
        value={form?.[field] ?? ""}
        maxLength={max}
        aria-invalid={Boolean(fieldErrors[field])}
        aria-describedby={fieldErrors[field] ? `${field}-error` : undefined}
        onChange={(event) => change(field, event.target.value)}
      />
      <FieldError id={`${field}-error`} message={fieldErrors[field]} />
    </div>
  )

  const saved = loaded ? lastSavedLine(loaded) : null

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Receipt settings</DialogTitle>
          <DialogDescription>
            The header, footer and VAT line on every receipt. Changes apply to the next receipt printed; reprints use the settings at the time of
            the reprint.
          </DialogDescription>
          {saved && <p className="text-xs text-muted-foreground">{saved}</p>}
        </DialogHeader>

        {loadError ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
            <p className="text-sm text-destructive">{loadError}</p>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : !form ? (
          <p className="animate-pulse text-sm text-muted-foreground">Loading…</p>
        ) : (
          <form
            id="receipt-settings-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            {textInput("receiptTitle", "Receipt title (e.g. Tax Invoice)", RECEIPT_SETTINGS_LIMITS.receiptTitle)}
            {textInput("businessName", "Business name", RECEIPT_SETTINGS_LIMITS.businessName)}

            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">Address (up to 4 lines)</legend>
              {form.addressLines.map((line, index) => (
                <Input
                  key={index}
                  aria-label={`Address line ${index + 1}`}
                  value={line}
                  maxLength={RECEIPT_SETTINGS_LIMITS.addressLine}
                  aria-invalid={Boolean(fieldErrors.addressLines)}
                  onChange={(event) => {
                    const lines = [...form.addressLines]
                    lines[index] = event.target.value
                    change("addressLines", lines)
                  }}
                />
              ))}
              <FieldError id="addressLines-error" message={fieldErrors.addressLines} />
            </fieldset>

            {textInput("phone", "Phone", RECEIPT_SETTINGS_LIMITS.phone)}
            {textInput("vatNumber", "VAT number", RECEIPT_SETTINGS_LIMITS.vatNumber)}

            <div className="space-y-1">
              <Label htmlFor="footerText">Footer text</Label>
              <textarea
                id="footerText"
                rows={3}
                value={form.footerText}
                maxLength={RECEIPT_SETTINGS_LIMITS.footerText}
                aria-invalid={Boolean(fieldErrors.footerText)}
                onChange={(event) => change("footerText", event.target.value)}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <FieldError id="footerText-error" message={fieldErrors.footerText} />
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Checkbox id="showVatLine" checked={form.showVatLine} onCheckedChange={(value) => change("showVatLine", value === true)} />
                <Label htmlFor="showVatLine">Show the VAT line on receipts</Label>
              </div>
              <FieldError id="showVatLine-error" message={fieldErrors.showVatLine} />
            </div>

            {saveError && (
              <p role="alert" className="text-sm text-destructive">
                {saveError}
              </p>
            )}
          </form>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="receipt-settings-form" disabled={!changed || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
