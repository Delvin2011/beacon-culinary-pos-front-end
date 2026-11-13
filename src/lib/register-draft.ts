// The "Register this till" form, kept in sessionStorage (this tab only) while the admin signs in again.
// Only these three fields: never a password.
const KEY = "devices.register.draft"

export interface RegisterDraft {
  name: string
  serialNumber: string
  assetTag: string
}

export function saveRegisterDraft(draft: RegisterDraft): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ name: draft.name, serialNumber: draft.serialNumber, assetTag: draft.assetTag }))
  } catch {
    // Storage blocked: the admin retypes the form.
  }
}

// Returns the saved draft once, and deletes it.
export function takeRegisterDraft(): RegisterDraft | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const text = (value: unknown) => (typeof value === "string" ? value : "")
    return { name: text(parsed.name), serialNumber: text(parsed.serialNumber), assetTag: text(parsed.assetTag) }
  } catch {
    return null
  }
}
