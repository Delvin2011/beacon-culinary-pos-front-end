// Staff management (/admin/staff). The credential rules per role come from GET /admin/staff/roles,
// so the form is driven by data rather than hard-coded roles.

export type CredentialRule = "REQUIRED" | "OPTIONAL" | "NONE"

export interface StaffRoleRule {
  role: string
  label: string
  password: CredentialRule
  pin: CredentialRule
}

export interface StaffMember {
  id: number
  name: string
  email: string | null
  role: string
  active: boolean
  hasPassword: boolean
  hasPin: boolean
}

export const PIN_PATTERN = /^\d{6}$/
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

// 400: a map of field -> message. 409: { error, code } with EMAIL_IN_USE, PIN_IN_USE or LAST_ADMIN.
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
