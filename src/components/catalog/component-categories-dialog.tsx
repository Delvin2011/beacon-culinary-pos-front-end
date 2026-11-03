"use client"

import { useCallback, useEffect, useState } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toast } from "@/hooks/use-toast"
import { parseApiError } from "@/lib/catalog"
import { type ComponentCategory, byComponentCategoryOrder } from "@/lib/component-categories"
import { cn } from "@/lib/utils"

interface ComponentCategoriesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Called after any change so the Components tab and the component form reload their categories.
  onChanged: () => void
}

class CategoryRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
  }
}

async function requestError(res: Response, fallback: string): Promise<CategoryRequestError> {
  const body = (await res.json().catch(() => null)) as unknown
  if (res.status === 403) return new CategoryRequestError("You don't have permission to change component categories.", 403)
  if (res.status === 404) return new CategoryRequestError("That category no longer exists. The list has been reloaded.", 404)
  const error = parseApiError(body, fallback)
  return new CategoryRequestError(error.message, res.status, error.code)
}

// A flat list editor: add, rename, reorder, deactivate and reactivate. There is no delete.
export function ComponentCategoriesDialog({ open, onOpenChange, onChanged }: ComponentCategoriesDialogProps) {
  const { authFetch } = useAuth()
  const [categories, setCategories] = useState<ComponentCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // CATEGORY_NAME_TAKEN shows on the name field being edited.
  const [nameError, setNameError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null)
  const [adding, setAdding] = useState<{ name: string; sortOrder: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authFetch("/admin/component-categories?includeInactive=true")
      if (!res.ok) throw await requestError(res, "Unable to load component categories.")
      const body = (await res.json().catch(() => null)) as unknown
      setCategories(Array.isArray(body) ? (body as ComponentCategory[]) : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load component categories.")
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  // PUT always sends name, sortOrder and active: a missing active would default to true.
  const putCategory = async (category: ComponentCategory, changes: Partial<Pick<ComponentCategory, "name" | "sortOrder" | "active">>) => {
    const res = await authFetch(`/admin/component-categories/${category.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: changes.name ?? category.name,
        sortOrder: changes.sortOrder ?? category.sortOrder,
        active: changes.active ?? category.active,
      }),
    })
    if (!res.ok) throw await requestError(res, "Unable to save the category.")
  }

  const run = async (action: () => Promise<void>, success?: string) => {
    setBusy(true)
    setError(null)
    setNameError(null)
    try {
      await action()
      if (success) toast({ title: success })
    } catch (err) {
      if (err instanceof CategoryRequestError && err.code === "CATEGORY_NAME_TAKEN") setNameError(err.message)
      else setError(err instanceof Error ? err.message : "Unable to save the category.")
    } finally {
      // Reload even after a failure: a reorder may have saved some rows before one failed, or a row may be gone (404).
      await load()
      onChanged()
      setBusy(false)
    }
  }

  const saveRename = (category: ComponentCategory) => {
    if (!renaming) return
    const name = renaming.name.trim()
    if (!name || name === category.name) {
      setRenaming(null)
      return
    }
    void run(async () => {
      await putCategory(category, { name })
      setRenaming(null)
    }, `Renamed to ${name}`)
  }

  // No bulk reorder: renumber the rows 1..n in their new order and PUT each one whose sortOrder changes.
  const move = (rows: ComponentCategory[], index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= rows.length) return
    const reordered = [...rows]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    void run(async () => {
      for (let position = 0; position < reordered.length; position += 1) {
        const category = reordered[position]
        if (category.sortOrder !== position + 1) await putCategory(category, { sortOrder: position + 1 })
      }
    })
  }

  const setActive = (category: ComponentCategory, active: boolean) =>
    void run(() => putCategory(category, { active }), active ? `${category.name} reactivated` : `${category.name} deactivated`)

  const nextSortOrder = categories.reduce((max, category) => Math.max(max, category.sortOrder), 0) + 1

  const saveAdd = () => {
    if (!adding) return
    const name = adding.name.trim()
    const sortOrder = Number(adding.sortOrder)
    if (!name) return
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      setNameError("Sort order must be a whole number.")
      return
    }
    void run(async () => {
      const res = await authFetch("/admin/component-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, sortOrder }),
      })
      if (!res.ok) throw await requestError(res, "Unable to add the category.")
      setAdding(null)
    }, `${name} added`)
  }

  const rows = [...categories].sort(byComponentCategoryOrder)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setError(null)
          setNameError(null)
          setRenaming(null)
          setAdding(null)
        }
      }}
    >
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Component Categories</DialogTitle>
          <DialogDescription>
            Add, rename, reorder or deactivate component categories. Counts are active components. These are separate from meal categories.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
          <div className="grid grid-cols-[1fr_80px_100px_auto] items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>Name</span>
            <span>Sort order</span>
            <span>Components</span>
            <span className="text-right">Status</span>
          </div>
          <ul className="divide-y">
            {loading && rows.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground animate-pulse">Loading…</li>}
            {!loading && rows.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No component categories yet.</li>}
            {rows.map((category, index) => (
              <li key={category.id} className={cn("px-3 py-2", !category.active && "opacity-60")}>
                {renaming?.id === category.id ? (
                  <form
                    className="space-y-1"
                    onSubmit={(event) => {
                      event.preventDefault()
                      saveRename(category)
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Input
                        autoFocus
                        value={renaming.name}
                        onChange={(event) => {
                          setRenaming({ id: category.id, name: event.target.value })
                          setNameError(null)
                        }}
                        className="h-8"
                        aria-label="Category name"
                        aria-invalid={Boolean(nameError)}
                      />
                      <Button type="submit" size="sm" className="h-8" disabled={busy}>Save</Button>
                      <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => { setRenaming(null); setNameError(null) }}>Cancel</Button>
                    </div>
                    {nameError && <p className="text-xs text-destructive">{nameError}</p>}
                  </form>
                ) : (
                  <div className="grid grid-cols-[1fr_80px_100px_auto] items-center gap-2">
                    <p className="text-sm font-medium">
                      {category.name}
                      {!category.active && <span className="ml-2 text-xs font-normal text-muted-foreground">Inactive</span>}
                    </p>
                    <span className="text-sm text-muted-foreground">{category.sortOrder}</span>
                    <span className="text-sm text-muted-foreground">{category.componentCount}</span>
                    <div className="flex items-center justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" disabled={busy || index === 0} onClick={() => move(rows, index, -1)} aria-label={`Move ${category.name} up`}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" disabled={busy || index === rows.length - 1} onClick={() => move(rows, index, 1)} aria-label={`Move ${category.name} down`}>
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => { setAdding(null); setRenaming({ id: category.id, name: category.name }); setNameError(null) }}>
                        Rename
                      </Button>
                      {category.active ? (
                        // A disabled button fires no hover events, so the tooltip sits on a wrapper.
                        <span title={category.componentCount > 0 ? "Move its components first." : undefined}>
                          <Button size="sm" variant="outline" className="h-8" disabled={busy || category.componentCount > 0} onClick={() => setActive(category, false)}>
                            Deactivate
                          </Button>
                        </span>
                      ) : (
                        <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => setActive(category, true)}>
                          Reactivate
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
            <li className="px-3 py-2">
              {adding ? (
                <form
                  className="space-y-1"
                  onSubmit={(event) => {
                    event.preventDefault()
                    saveAdd()
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Input
                      autoFocus
                      value={adding.name}
                      onChange={(event) => {
                        setAdding({ ...adding, name: event.target.value })
                        setNameError(null)
                      }}
                      placeholder="New category, e.g. Vegetables"
                      className="h-8"
                      aria-label="New category name"
                      aria-invalid={Boolean(nameError)}
                    />
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={adding.sortOrder}
                      onChange={(event) => setAdding({ ...adding, sortOrder: event.target.value })}
                      className="h-8 w-20"
                      aria-label="Sort order"
                    />
                    <Button type="submit" size="sm" className="h-8" disabled={busy || !adding.name.trim()}>Add</Button>
                    <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => { setAdding(null); setNameError(null) }}>Cancel</Button>
                  </div>
                  {nameError && <p className="text-xs text-destructive">{nameError}</p>}
                </form>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  disabled={busy || loading}
                  onClick={() => {
                    setRenaming(null)
                    setNameError(null)
                    setAdding({ name: "", sortOrder: String(nextSortOrder) })
                  }}
                >
                  + Add category
                </Button>
              )}
            </li>
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  )
}
