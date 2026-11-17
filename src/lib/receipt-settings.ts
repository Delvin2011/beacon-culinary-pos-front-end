// The receipt's header, footer and VAT switch (O2b contract 2). The POS reads GET /pos/receipt-settings once per
// sign-in; the admin screen reads and replaces them with GET / PUT /admin/receipt-settings.

export interface ReceiptSettings {
  receiptTitle: string | null
  businessName: string | null
  addressLines: string[]
  phone: string | null
  vatNumber: string | null
  footerText: string | null
  showVatLine: boolean
}

// The admin endpoints also say when and by whom the settings were last saved (both null before the first save).
export interface AdminReceiptSettings extends ReceiptSettings {
  updatedAt: string | null
  updatedBy: string | null
}

export const RECEIPT_SETTINGS_LIMITS = {
  receiptTitle: 50,
  businessName: 100,
  addressLine: 100,
  addressLines: 4,
  phone: 50,
  vatNumber: 20,
  footerText: 500,
} as const

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

// A body that isn't the contract's shape gives null, which prints like a failed fetch: no header.
export function parseReceiptSettings(body: unknown): ReceiptSettings | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const raw = body as Record<string, unknown>
  return {
    receiptTitle: text(raw.receiptTitle),
    businessName: text(raw.businessName),
    addressLines: Array.isArray(raw.addressLines) ? raw.addressLines.map(text).filter((line): line is string => line !== null) : [],
    phone: text(raw.phone),
    vatNumber: text(raw.vatNumber),
    footerText: text(raw.footerText),
    showVatLine: raw.showVatLine === true,
  }
}

export function parseAdminReceiptSettings(body: unknown): AdminReceiptSettings | null {
  const settings = parseReceiptSettings(body)
  if (!settings) return null
  const raw = body as Record<string, unknown>
  return { ...settings, updatedAt: text(raw.updatedAt), updatedBy: text(raw.updatedBy) }
}

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>

// Never throws: any failure (no answer, 401, 403, a bad body) gives null, and receipts print without the header.
export async function fetchReceiptSettings(authFetch: AuthFetch): Promise<ReceiptSettings | null> {
  try {
    const res = await authFetch("/pos/receipt-settings")
    if (!res.ok) return null
    return parseReceiptSettings(await res.json())
  } catch {
    return null
  }
}
