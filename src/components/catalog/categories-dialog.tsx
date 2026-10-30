"use client"

import { useState } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toast } from "@/hooks/use-toast"
import { type CategoryNode, parseApiError } from "@/lib/catalog"
import { cn } from "@/lib/utils"

interface CategoriesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: CategoryNode[]
  // Reloads the tree after any change; the parent's dropdowns use it too.
  onChanged: () => Promise<void>
}

const bySortOrder = (a: CategoryNode, b: CategoryNode) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)

// Top-level groups are fixed. Subcategories under a group can be added, renamed, reordered and
// deactivated; there is no delete. An inactive one stays in the tree, dimmed, with "Reactivate".
export function CategoriesDialog({ open, onOpenChange, categories, onChanged }: CategoriesDialogProps) {
  const { authFetch } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null)
  const [adding, setAdding] = useState<{ parentId: number; name: string } | null>(null)

  // PUT always sends name, sortOrder and active: a missing active would default to true.
  const putCategory = async (node: CategoryNode, changes: Partial<Pick<CategoryNode, "name" | "sortOrder" | "active">>) => {
    const res = await authFetch(`/admin/catalog/categories/${node.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: changes.name ?? node.name,
        sortOrder: changes.sortOrder ?? node.sortOrder,
        active: changes.active ?? node.active,
      }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as unknown
      throw new Error(parseApiError(body, "Unable to save the category.").message)
    }
  }

  const run = async (action: () => Promise<void>, success?: string) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      if (success) toast({ title: success })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the category.")
    } finally {
      // Reload even after a failure: a reorder may have saved some rows before one failed.
      await onChanged()
      setBusy(false)
    }
  }

  const saveRename = (node: CategoryNode) => {
    if (!renaming) return
    const name = renaming.name.trim()
    if (!name || name === node.name) {
      setRenaming(null)
      return
    }
    void run(async () => {
      await putCategory(node, { name })
      setRenaming(null)
    }, `Renamed to ${name}`)
  }

  // No bulk reorder: renumber the siblings 1..n in their new order and PUT each one whose sortOrder changes.
  const move = (siblings: CategoryNode[], index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= siblings.length) return
    const reordered = [...siblings]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    void run(async () => {
      for (let position = 0; position < reordered.length; position += 1) {
        const node = reordered[position]
        if (node.sortOrder !== position + 1) await putCategory(node, { sortOrder: position + 1 })
      }
    })
  }

  const setActive = (node: CategoryNode, active: boolean) =>
    void run(() => putCategory(node, { active }), active ? `${node.name} reactivated` : `${node.name} deactivated`)

  const saveAdd = (group: CategoryNode) => {
    if (!adding) return
    const name = adding.name.trim()
    if (!name) return
    const children = group.children ?? []
    const sortOrder = children.reduce((max, child) => Math.max(max, child.sortOrder), 0) + 1
    void run(async () => {
      const res = await authFetch("/admin/catalog/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: group.id, name, sortOrder }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as unknown
        throw new Error(parseApiError(body, "Unable to add the subcategory.").message)
      }
      setAdding(null)
    }, `${name} added`)
  }

  const groups = [...categories].sort(bySortOrder)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setError(null)
          setRenaming(null)
          setAdding(null)
        }
      }}
    >
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Categories</DialogTitle>
          <DialogDescription>
            Groups are fixed. Add, rename, reorder or deactivate the subcategories under them. Counts are active meals.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {groups.map((group) => {
            const children = [...(group.children ?? [])].sort(bySortOrder)
            // "Set meals" holds meals itself; groups that aren't assignable hold subcategories.
            const takesSubcategories = !group.assignable
            return (
              <section key={group.id} className="rounded-lg border">
                <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                  <p className="font-semibold">
                    {group.name}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{group.itemCount} active</span>
                  </p>
                  <span className="text-xs text-muted-foreground">Fixed group</span>
                </div>

                {takesSubcategories && (
                  <ul className="divide-y">
                    {children.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No subcategories yet.</li>}
                    {children.map((child, index) => (
                      <li key={child.id} className={cn("flex flex-wrap items-center gap-2 px-3 py-2", !child.active && "opacity-60")}>
                        {renaming?.id === child.id ? (
                          <form
                            className="flex flex-1 items-center gap-2"
                            onSubmit={(event) => {
                              event.preventDefault()
                              saveRename(child)
                            }}
                          >
                            <Input
                              autoFocus
                              value={renaming.name}
                              onChange={(event) => setRenaming({ id: child.id, name: event.target.value })}
                              className="h-8"
                              aria-label="Subcategory name"
                            />
                            <Button type="submit" size="sm" className="h-8" disabled={busy}>Save</Button>
                            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setRenaming(null)}>Cancel</Button>
                          </form>
                        ) : (
                          <>
                            <p className="flex-1 text-sm">
                              {child.name}
                              <span className="ml-2 text-xs text-muted-foreground">
                                {child.itemCount} active{child.active ? "" : " · Inactive"}
                              </span>
                            </p>
                            <div className="flex items-center gap-1">
                              <Button size="icon" variant="ghost" className="h-8 w-8" disabled={busy || index === 0} onClick={() => move(children, index, -1)} aria-label={`Move ${child.name} up`}>
                                <ArrowUp className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8" disabled={busy || index === children.length - 1} onClick={() => move(children, index, 1)} aria-label={`Move ${child.name} down`}>
                                <ArrowDown className="h-4 w-4" />
                              </Button>
                              <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => setRenaming({ id: child.id, name: child.name })}>
                                Rename
                              </Button>
                              {child.active ? (
                                <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => setActive(child, false)}>
                                  Deactivate
                                </Button>
                              ) : (
                                <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => setActive(child, true)}>
                                  Reactivate
                                </Button>
                              )}
                            </div>
                          </>
                        )}
                      </li>
                    ))}
                    <li className="px-3 py-2">
                      {adding?.parentId === group.id ? (
                        <form
                          className="flex items-center gap-2"
                          onSubmit={(event) => {
                            event.preventDefault()
                            saveAdd(group)
                          }}
                        >
                          <Input
                            autoFocus
                            value={adding.name}
                            onChange={(event) => setAdding({ parentId: group.id, name: event.target.value })}
                            placeholder={`New ${group.name.toLowerCase()} subcategory, e.g. Pizzas`}
                            className="h-8"
                            aria-label="New subcategory name"
                          />
                          <Button type="submit" size="sm" className="h-8" disabled={busy || !adding.name.trim()}>Add</Button>
                          <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setAdding(null)}>Cancel</Button>
                        </form>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-8" disabled={busy} onClick={() => setAdding({ parentId: group.id, name: "" })}>
                          + Add subcategory
                        </Button>
                      )}
                    </li>
                  </ul>
                )}
              </section>
            )
          })}
          {groups.length === 0 && <p className="text-sm text-muted-foreground">No categories loaded.</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
