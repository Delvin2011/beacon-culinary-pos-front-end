export interface UserOption {
  id: number
  name: string
  role?: string
}

// Shift owners (and report "Owner" filters) are cashiers or admins.
// Exact match on purpose: STOCK_ADMIN also contains "ADMIN".
const SHIFT_OWNER_ROLES = new Set(["CASHIER", "ADMIN"])

// Parses GET /users (admin-only), accepting a plain array or a paged { content } body.
export function toShiftOwnerOptions(body: unknown): UserOption[] {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { content?: unknown }).content)
      ? (body as { content: unknown[] }).content
      : []
  const people: UserOption[] = []
  for (const item of list) {
    if (!item || typeof item !== "object") continue
    const user = item as Record<string, unknown>
    const role = typeof user.role === "string" ? user.role.toUpperCase().replace(/^ROLE_/, "") : ""
    const name = [user.name, user.fullName, user.username].find(
      (value): value is string => typeof value === "string" && value.trim() !== "",
    )
    if (typeof user.id !== "number" || !name || !SHIFT_OWNER_ROLES.has(role)) continue
    people.push({ id: user.id, name, role })
  }
  return people.sort((a, b) => a.name.localeCompare(b.name))
}
