// What the staff screen was doing when the server answered 403 REAUTH_REQUIRED (a link for an ADMIN, or creating an
// ADMIN by invite), kept across the password re-sign-in in sessionStorage. Never a token, password or PIN: none
// exists yet. Read once and cleared; back on /staff the admin confirms before anything is sent again, because
// sending replaces any open link and creating makes the person.

export interface SendInviteRequest {
  purpose: "STAFF_SETUP" | "RESET"
  alsoResetPin: boolean
}

export interface CreateByInviteForm {
  name: string
  role: string
  email: string
}

export type InviteDraft = { kind: "send"; staffId: number; request: SendInviteRequest } | { kind: "create"; form: CreateByInviteForm }

const KEY = "staff.invite.pending"

export function saveInviteDraft(draft: InviteDraft): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft))
  } catch {
    // Storage unavailable: the admin starts again after signing in.
  }
}

function isRequest(value: unknown): value is SendInviteRequest {
  const v = value as SendInviteRequest | null
  return !!v && (v.purpose === "STAFF_SETUP" || v.purpose === "RESET") && typeof v.alsoResetPin === "boolean"
}

function isForm(value: unknown): value is CreateByInviteForm {
  const v = value as CreateByInviteForm | null
  return !!v && typeof v.name === "string" && typeof v.role === "string" && typeof v.email === "string"
}

// The saved draft, or null when there is none or it isn't readable. Doesn't clear it.
export function readInviteDraft(): InviteDraft | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed?.kind === "send" && typeof parsed.staffId === "number" && isRequest(parsed.request)) {
      return { kind: "send", staffId: parsed.staffId, request: { purpose: parsed.request.purpose, alsoResetPin: parsed.request.alsoResetPin } }
    }
    if (parsed?.kind === "create" && isForm(parsed.form)) {
      return { kind: "create", form: { name: parsed.form.name, role: parsed.form.role, email: parsed.form.email } }
    }
    return null
  } catch {
    return null
  }
}

export function clearInviteDraft(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // Nothing to clear.
  }
}
