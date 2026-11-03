// Component categories (Meat, Chicken, Starch, ...): a flat list, separate from the meal catalogue tree
// in ./catalog.ts. Every component may carry one; null means uncategorised.

export interface ComponentCategoryRef {
  id: number
  name: string
  sortOrder: number
}

export interface ComponentCategory extends ComponentCategoryRef {
  active: boolean
  // Active components in this category.
  componentCount: number
}

// The Components tab filter, kept in the URL: ?category=<id>|uncategorised&q=<text>.
export const UNCATEGORISED = "uncategorised"

export interface ComponentFilter {
  // "" = all, a category id, or UNCATEGORISED.
  category: string
  name: string
}

export function readComponentFilter(params: URLSearchParams): ComponentFilter {
  return { category: params.get("category") ?? "", name: (params.get("q") ?? "").trim() }
}

export function hasComponentFilter(filter: ComponentFilter): boolean {
  return filter.category !== "" || filter.name !== ""
}

// GET /admin/component-catalog query: all optional, combined with AND on the server.
export function componentFilterQuery(filter: ComponentFilter): string {
  const query = new URLSearchParams()
  if (filter.category === UNCATEGORISED) query.set("uncategorised", "true")
  else if (filter.category) query.set("categoryId", filter.category)
  if (filter.name) query.set("name", filter.name)
  return query.toString()
}

export const byComponentCategoryOrder = (a: ComponentCategoryRef, b: ComponentCategoryRef) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)

// Groups items by category in sortOrder, with uncategorised items last.
export function groupByComponentCategory<T extends { category?: ComponentCategoryRef | null }>(
  items: T[],
): Array<{ key: string; name: string; items: T[] }> {
  const groups = new Map<string, { category: ComponentCategoryRef | null; items: T[] }>()
  for (const item of items) {
    const key = item.category ? String(item.category.id) : UNCATEGORISED
    const group = groups.get(key) ?? { category: item.category ?? null, items: [] }
    group.items.push(item)
    groups.set(key, group)
  }
  return Array.from(groups.entries())
    .sort(([, a], [, b]) => {
      if (!a.category) return b.category ? 1 : 0
      if (!b.category) return -1
      return byComponentCategoryOrder(a.category, b.category)
    })
    .map(([key, group]) => ({ key, name: group.category?.name ?? "Uncategorised", items: group.items }))
}
