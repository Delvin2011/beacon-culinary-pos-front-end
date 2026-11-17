// The admin Receipt settings screen's API (O2b contract 2.3, 2.4). The PUT replaces every field: a field left out is
// saved as null. So the body starts from what GET returned and changes only what the admin edited.

import { readApiError } from "@/lib/api-error"
import { RECEIPT_SETTINGS_LIMITS, parseAdminReceiptSettings, type AdminReceiptSettings, type ReceiptSettings } from "@/lib/receipt-settings"

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>

export type ReceiptSettingsField = keyof ReceiptSettings

export class ReceiptSettingsError extends Error {
  constructor(
    message: string,
    // The 400 field map (contract 2.4), keyed by the screen's field names.
    readonly fieldErrors: Partial<Record<ReceiptSettingsField, string>> = {},
  ) {
    super(message)
    this.name = "ReceiptSettingsError"
  }
}

const LOAD_FAILED = "Couldn't load the receipt settings. Try again."
const SAVE_FAILED = "Couldn't save the receipt settings. Try again."
const FIELDS: ReceiptSettingsField[] = ["receiptTitle", "businessName", "addressLines", "phone", "vatNumber", "footerText", "showVatLine"]

export async function getAdminReceiptSettings(authFetch: AuthFetch): Promise<AdminReceiptSettings> {
  let res: Response
  try {
    res = await authFetch("/admin/receipt-settings")
  } catch {
    throw new ReceiptSettingsError(LOAD_FAILED)
  }
  const settings = res.ok ? parseAdminReceiptSettings(await res.json().catch(() => null)) : null
  if (!settings) throw new ReceiptSettingsError(LOAD_FAILED)
  return settings
}

// The PUT body: the full 2.1 shape without updatedAt and updatedBy.
export function receiptSettingsBody(settings: ReceiptSettings): ReceiptSettings {
  return {
    receiptTitle: settings.receiptTitle,
    businessName: settings.businessName,
    addressLines: settings.addressLines,
    phone: settings.phone,
    vatNumber: settings.vatNumber,
    footerText: settings.footerText,
    showVatLine: settings.showVatLine,
  }
}

// "addressLines[2]" and the like count as the address field.
function fieldOf(key: string): ReceiptSettingsField | null {
  const base = key.replace(/[[.].*$/, "") as ReceiptSettingsField
  return FIELDS.includes(base) ? base : null
}

export async function saveAdminReceiptSettings(authFetch: AuthFetch, settings: ReceiptSettings): Promise<AdminReceiptSettings> {
  let res: Response
  try {
    res = await authFetch("/admin/receipt-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(receiptSettingsBody(settings)),
    })
  } catch {
    throw new ReceiptSettingsError(SAVE_FAILED)
  }
  if (res.ok) {
    const saved = parseAdminReceiptSettings(await res.json().catch(() => null))
    if (saved) return saved
    throw new ReceiptSettingsError(SAVE_FAILED)
  }
  const error = await readApiError(res)
  const fieldErrors: Partial<Record<ReceiptSettingsField, string>> = {}
  for (const [key, message] of Object.entries(error.fieldErrors)) {
    const field = fieldOf(key)
    if (field && !fieldErrors[field]) fieldErrors[field] = message
  }
  if (Object.keys(fieldErrors).length > 0) throw new ReceiptSettingsError("Check the highlighted fields.", fieldErrors)
  throw new ReceiptSettingsError(SAVE_FAILED)
}

// The same limits the backend checks (handoff 7), so most mistakes are caught before saving.
export function validateReceiptSettings(settings: ReceiptSettings): Partial<Record<ReceiptSettingsField, string>> {
  const errors: Partial<Record<ReceiptSettingsField, string>> = {}
  const tooLong = (value: string | null, max: number) => (value ?? "").trim().length > max
  if (tooLong(settings.receiptTitle, RECEIPT_SETTINGS_LIMITS.receiptTitle)) errors.receiptTitle = "Receipt title must be 50 characters or fewer."
  if (tooLong(settings.businessName, RECEIPT_SETTINGS_LIMITS.businessName)) errors.businessName = "Business name must be 100 characters or fewer."
  if (settings.addressLines.length > RECEIPT_SETTINGS_LIMITS.addressLines) errors.addressLines = "At most 4 address lines."
  else if (settings.addressLines.some((line) => tooLong(line, RECEIPT_SETTINGS_LIMITS.addressLine)))
    errors.addressLines = "Each address line must be 100 characters or fewer."
  if (tooLong(settings.phone, RECEIPT_SETTINGS_LIMITS.phone)) errors.phone = "Phone must be 50 characters or fewer."
  if (tooLong(settings.vatNumber, RECEIPT_SETTINGS_LIMITS.vatNumber)) errors.vatNumber = "VAT number must be 20 characters or fewer."
  if (tooLong(settings.footerText, RECEIPT_SETTINGS_LIMITS.footerText)) errors.footerText = "Footer text must be 500 characters or fewer."
  return errors
}
