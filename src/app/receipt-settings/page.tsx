"use client"

import { useCallback, useEffect, useState } from "react"
import { DevicePageShell, useDeviceAdminGuard } from "@/components/devices/device-page-shell"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/hooks/use-auth"
import { resetReceiptSettingsCache } from "@/hooks/use-receipt-settings"
import { toast } from "@/hooks/use-toast"
import { formatJhbDateTime } from "@/lib/pos-activity"
import {
  ReceiptSettingsError,
  getAdminReceiptSettings,
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

// Admin: the receipt's header, footer and VAT line (O2b contract 2.3, 2.4). ADMIN only. Changes apply to the next
// receipt printed; reprints use the settings current at the time of the reprint.
export default function ReceiptSettingsPage() {
  const ready = useDeviceAdminGuard("/receipt-settings")
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
    try {
      const settings = await getAdminReceiptSettings(authFetch)
      setLoaded(settings)
      setForm(toForm(settings))
      setEdited(new Set())
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load the receipt settings. Try again.")
    }
  }, [authFetch])

  useEffect(() => {
    if (ready) void load()
  }, [ready, load])

  if (!ready) return null

  const change = <K extends keyof Form>(field: K, value: Form[K]) => {
    setForm((current) => (current ? { ...current, [field]: value } : current))
    setEdited((current) => new Set(current).add(field))
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
  }

  const save = async () => {
    if (!loaded || !form) return
    const body = toBody(loaded, form, edited)
    const errors = validateReceiptSettings(body)
    setSaveError(null)
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return
    setSaving(true)
    try {
      const saved = await saveAdminReceiptSettings(authFetch, body)
      setLoaded(saved)
      setForm(toForm(saved))
      setEdited(new Set())
      // The till reads them again at its next sign-in; this browser re-reads them at once.
      resetReceiptSettingsCache()
      toast({ title: "Receipt settings saved" })
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
    <DevicePageShell title="Receipt settings">
      <div>
        <h1 className="text-lg font-semibold">Receipt settings</h1>
        <p className="text-sm text-muted-foreground">
          The header, footer and VAT line on every receipt. Changes apply to the next receipt printed; reprints use the settings at the time of the reprint.
        </p>
        {saved && <p className="mt-1 text-xs text-muted-foreground">{saved}</p>}
      </div>

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
          className="max-w-xl space-y-4"
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
              rows={4}
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

          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
      )}
    </DevicePageShell>
  )
}
