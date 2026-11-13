// Staff management (/admin/staff). The credential rules per role come from GET /admin/staff/roles,
// so the form is driven by data rather than hard-coded roles.

import { format, isSameDay } from "date-fns"
import { PIN_PATTERN } from "@/lib/pin"

export type CredentialRule = "REQUIRED" | "OPTIONAL" | "NONE"

export interface StaffRoleRule {
  role: string
  label: string
  password: CredentialRule
  pin: CredentialRule
}

export type LockScope = "PASSWORD" | "PIN"
export type BlockScope = "PIN" | "MANAGER_PIN" | "CHANGE_PASSWORD"

// From the backend: lockedUntil is a UTC instant, null when not locked or when an admin must unlock.
// Short-term blocks (PIN per till, manager PIN, change password) aren't listed here.
export interface StaffLock {
  locked: boolean
  lockedUntil: string | null
  requiresAdminUnlock: boolean
}

export interface StaffMember {
  id: number
  name: string
  email: string | null
  role: string
  active: boolean
  hasPassword: boolean
  hasPin: boolean
  // Absent from older backends; every lock is false until enforcement is switched on.
  locks?: Partial<Record<LockScope, StaffLock>>
  // Absent from backends before the blocks change; the staff page can't see short blocks then.
  blocks?: Partial<Record<BlockScope, StaffBlock>>
}

// Short-term blocks (contract 2.8): blockedUntil is a UTC instant, null when not blocked.
// PIN covers a block on any till; blockedUntil is when the last one ends.
export interface StaffBlock {
  blocked: boolean
  blockedUntil: string | null
}

export { PIN_PATTERN }
export const PASSWORD_MIN = 6
export const PASSWORD_MAX = 25
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// What each role does, shown on the staff form. Kept in the frontend; update it when a role's access changes.
const ROLE_DESCRIPTIONS: Record<string, string> = {
  ADMIN:
    "Full back office, including staff, reports, catalog and inventory. Can sell at the POS, and their PIN approves discounts, voids, refunds and cash-up variances.",
  CASHIER: "Opens and closes their own till shift, and takes orders and payments at the POS.",
  KITCHEN: "Works the kitchen display: sees the order queue and moves orders through preparation.",
  HEAD_CHEF:
    "Runs the kitchen display (with a PIN, if set). In the back office: plans daily meals, views the catalog and inventory, and approves stock requests. Raises issue, order and waste requests at the stock-movement station.",
  STOCK_ADMIN: "Manages inventory, GRVs, purchase orders, stock requests and their approvals, and stock takes.",
  STOCK_CLERK: "Uses the stock-movement station to submit stock requests, issues, waste and stock-take counts.",
  BARISTA: "Works the bar display with a PIN: prepares drinks and marks beverages out for the day. Can't sell or open a shift.",
}

export function roleDescription(role: string): string | undefined {
  return ROLE_DESCRIPTIONS[role]
}

export function roleLabel(roles: StaffRoleRule[], role: string): string {
  return roles.find((rule) => rule.role === role)?.label ?? role.replaceAll("_", " ").toLowerCase()
}

// A role with a password also has an email.
export function usesPassword(rule: StaffRoleRule | undefined): boolean {
  return !!rule && rule.password !== "NONE"
}

export function usesPin(rule: StaffRoleRule | undefined): boolean {
  return !!rule && rule.pin !== "NONE"
}

export function validatePin(pin: string, confirm: string, required: boolean): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!pin) {
    if (required) errors.pin = "PIN is required."
    return errors
  }
  if (!PIN_PATTERN.test(pin)) errors.pin = "PIN must be exactly 6 digits."
  else if (pin !== confirm) errors.pinConfirm = "The PINs don't match."
  return errors
}

export function validatePassword(password: string, confirm: string, required: boolean): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!password) {
    if (required) errors.password = "Password is required."
    return errors
  }
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    errors.password = `Password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`
  } else if (password !== confirm) {
    errors.passwordConfirm = "The passwords don't match."
  }
  return errors
}

export function validateEmail(email: string, required: boolean): Record<string, string> {
  if (!email.trim()) return required ? { email: "Email is required." } : {}
  return EMAIL_PATTERN.test(email.trim()) ? {} : { email: "Enter a valid email address." }
}

export interface StaffApiError {
  fieldErrors: Record<string, string>
  pageError: string | null
}

// 400: a map of field -> message. 409: { error, code } with EMAIL_IN_USE, PIN_IN_USE, LAST_ADMIN or SELF_UNLOCK.
export async function readStaffError(res: Response, fallback: string): Promise<StaffApiError> {
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (res.status === 403) return { fieldErrors: {}, pageError: "Only admins can manage staff." }
  if (res.status === 404) return { fieldErrors: {}, pageError: "This staff member no longer exists. Refresh the list." }
  if (body && typeof body.code === "string") {
    const message = typeof body.error === "string" ? body.error : fallback
    switch (body.code) {
      case "EMAIL_IN_USE":
        return { fieldErrors: { email: "This email belongs to someone else." }, pageError: null }
      case "PIN_IN_USE":
        return { fieldErrors: { pin: "Another admin already uses this PIN. Choose a different PIN." }, pageError: null }
      case "LAST_ADMIN":
        return {
          fieldErrors: {},
          pageError: "This is the only active admin, so they can't be deactivated or moved to another role. Make someone else an admin first.",
        }
      case "SELF_UNLOCK":
        return { fieldErrors: {}, pageError: "You can't unlock your own sign-in. Ask another admin to unlock it." }
      default:
        return { fieldErrors: {}, pageError: message }
    }
  }
  if (res.status === 400 && body) {
    const fieldErrors: Record<string, string> = {}
    for (const [field, message] of Object.entries(body)) {
      if (typeof message === "string" && message.trim()) fieldErrors[field] = message
    }
    if (Object.keys(fieldErrors).length > 0) {
      // A plain { error } body isn't a field: show it at the top.
      const { error, ...fields } = fieldErrors
      return { fieldErrors: fields, pageError: error ?? null }
    }
  }
  return { fieldErrors: {}, pageError: fallback }
}

const LOCK_SCOPES: LockScope[] = ["PASSWORD", "PIN"]
const SCOPE_LABEL: Record<LockScope, string> = { PASSWORD: "Password", PIN: "PIN" }

export function lockedScopes(member: StaffMember): { scope: LockScope; lock: StaffLock }[] {
  return LOCK_SCOPES.flatMap((scope) => {
    const lock = member.locks?.[scope]
    return lock?.locked ? [{ scope, lock }] : []
  })
}

export function isLocked(member: StaffMember): boolean {
  return lockedScopes(member).length > 0
}

// The signed-in admin's own row. Password sign-in keeps the email that was typed; PIN sign-in keeps the cashier ID.
export function isOwnRecord(member: StaffMember, user: { email?: string; cashierId?: number } | null | undefined): boolean {
  if (!user) return false
  if (user.cashierId !== undefined && user.cashierId === member.id) return true
  return !!member.email && !!user.email && member.email.trim().toLowerCase() === user.email.trim().toLowerCase()
}

// "Password locked until 14:32" (local time; the date is added when it isn't today) or "PIN locked: needs unlock".
export function lockLabel(scope: LockScope, lock: StaffLock, now: Date = new Date()): string {
  const name = SCOPE_LABEL[scope]
  if (lock.requiresAdminUnlock) return `${name} locked: needs unlock`
  const until = untilText(lock.lockedUntil, now)
  return until ? `${name} locked until ${until}` : `${name} locked`
}

const BLOCK_SCOPES: BlockScope[] = ["PIN", "MANAGER_PIN", "CHANGE_PASSWORD"]
const BLOCK_LABEL: Record<BlockScope, string> = {
  PIN: "PIN blocked at a till",
  MANAGER_PIN: "Manager PIN blocked",
  CHANGE_PASSWORD: "Password change blocked",
}

export function activeBlocks(member: StaffMember): { scope: BlockScope; block: StaffBlock }[] {
  return BLOCK_SCOPES.flatMap((scope) => {
    const block = member.blocks?.[scope]
    return block?.blocked ? [{ scope, block }] : []
  })
}

// Any account lock or short-term block is active: the row is highlighted and offers Unlock.
export function needsUnlock(member: StaffMember): boolean {
  return isLocked(member) || activeBlocks(member).length > 0
}

// "PIN blocked at a till until 12:41", "Manager PIN blocked until 12:41", "Password change blocked until 12:41".
export function blockLabel(scope: BlockScope, block: StaffBlock, now: Date = new Date()): string {
  const until = untilText(block.blockedUntil, now)
  return until ? `${BLOCK_LABEL[scope]} until ${until}` : BLOCK_LABEL[scope]
}

// Local time, with the date when it isn't today; null for a missing or invalid instant.
function untilText(iso: string | null, now: Date): string | null {
  if (!iso) return null
  const until = new Date(iso)
  if (Number.isNaN(until.getTime())) return null
  return format(until, isSameDay(until, now) ? "HH:mm" : "d MMM HH:mm")
}

// POST /admin/staff/{id}/unlock with no body: unlocks every scope. Returns the updated staff record.
export async function unlockStaff(
  authFetch: (path: string, init?: RequestInit) => Promise<Response>,
  id: number,
): Promise<StaffMember> {
  const res = await authFetch(`/admin/staff/${id}/unlock`, { method: "POST" })
  if (res.ok) return (await res.json()) as StaffMember
  if (res.status === 400) throw new Error("The unlock request was refused. Refresh the list and try again.")
  const apiError = await readStaffError(res, "Unable to unlock this person. Try again.")
  throw new Error(apiError.pageError ?? "Unable to unlock this person. Try again.")
}
