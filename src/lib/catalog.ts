// Catalogue groups and categories. Every meal sits in a category; the category decides its group.
//   SET_MEALS   → PLANNED daily with portions (Breakfast, Lunch), station KITCHEN
//   LIGHT_MEALS → ALWAYS available, "Out today" switch, never planned (All Day), station KITCHEN
//   BEVERAGES   → ALWAYS available, no period, station BAR or NONE

export type CatalogGroup = "SET_MEALS" | "LIGHT_MEALS" | "BEVERAGES"
export type Availability = "PLANNED" | "ALWAYS"
export type Station = "KITCHEN" | "BAR" | "NONE"

export interface CategoryRef {
  id: number
  name: string
  sortOrder: number
}

export interface CategoryNode {
  id: number
  name: string
  group: CatalogGroup
  sortOrder: number
  active: boolean
  // Top-level groups are fixed: no rename, reorder or deactivate.
  topLevel: boolean
  // Only assignable && active nodes can hold meals. "Set meals" is assignable; the other group rows are not.
  assignable: boolean
  // Active meals; a group row's count includes its children.
  itemCount: number
  children: CategoryNode[]
}

export const GROUP_LABELS: Record<CatalogGroup, string> = {
  SET_MEALS: "Set meals",
  LIGHT_MEALS: "Light meals",
  BEVERAGES: "Beverages",
}

export function availabilityLabel(availability: Availability): string {
  return availability === "PLANNED" ? "Planned daily" : "Always available"
}

// Before a meal is saved, its availability follows the selected category's group.
export function availabilityForGroup(group: CatalogGroup): Availability {
  return group === "SET_MEALS" ? "PLANNED" : "ALWAYS"
}

// Every node in the tree, depth-first, in sortOrder.
export function flattenCategories(nodes: CategoryNode[]): CategoryNode[] {
  return [...nodes]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((node) => [node, ...flattenCategories(node.children ?? [])])
}

export function isSelectableCategory(node: CategoryNode): boolean {
  return node.assignable && node.active
}

function normaliseRole(role?: string): string {
  return (role ?? "").toUpperCase().replace(/^ROLE_/, "")
}

// Who can mark an always-on item out today. The server answers 403 OUT_TODAY_NOT_PERMITTED for anyone else.
export function canToggleOutToday(role: string | undefined, group: CatalogGroup): boolean {
  const normalised = normaliseRole(role)
  if (group === "SET_MEALS") return false
  if (normalised === "ADMIN") return true
  if (normalised === "HEAD_CHEF") return group === "LIGHT_MEALS"
  if (normalised === "BARISTA") return group === "BEVERAGES"
  return false
}

export interface ApiError {
  message: string
  code?: string
}

// Rule errors: { error, code }. Field errors: { field: "message" }. Older endpoints: { message }.
export function parseApiError(body: unknown, fallback: string): ApiError {
  if (!body || typeof body !== "object") return { message: fallback }
  const record = body as Record<string, unknown>
  const code = typeof record.code === "string" ? record.code : undefined
  if (typeof record.error === "string" && record.error.trim()) return { message: record.error, code }
  if (typeof record.message === "string" && record.message.trim()) return { message: record.message, code }
  const fieldErrors = Object.values(record).filter((value): value is string => typeof value === "string" && value.trim().length > 0)
  if (fieldErrors.length > 0) return { message: fieldErrors.join(" "), code }
  return { message: fallback, code }
}

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>

// POST /admin/meal-catalog/{id}/out-today → the updated meal. Clears itself at midnight (Johannesburg).
export async function setOutToday<T>(authFetch: AuthFetch, mealCatalogId: number, out: boolean): Promise<T> {
  const res = await authFetch(`/admin/meal-catalog/${mealCatalogId}/out-today`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ out }),
  })
  const body = (await res.json().catch(() => null)) as unknown
  if (!res.ok) {
    const error = parseApiError(body, "Unable to change Out today.")
    if (error.code === "OUT_TODAY_NOT_PERMITTED") error.message = "You can't change Out today for this item."
    throw new Error(error.message)
  }
  return body as T
}
