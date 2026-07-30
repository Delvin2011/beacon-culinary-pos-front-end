"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

// ── Types ─────────────────────────────────────────────────────────────────────

interface ComponentEntry {
  id: number
  name: string
  extraPrice: number
  active: boolean
}

interface MealEntry {
  id: number
  name: string
  description?: string
  price: number
  active: boolean
  // Backend may return either field — handle both
  componentIds?: number[]
  components?: { id: number; name: string }[]
}

type Tab = "components" | "meals"

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractComponentIds(meal: MealEntry): number[] {
  if (meal.componentIds?.length) return meal.componentIds
  if (meal.components?.length) return meal.components.map((c) => c.id)
  return []
}

function parseError(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>
    if (typeof b.message === "string") return b.message
  }
  return fallback
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CatalogPage() {
  const router = useRouter()
  const { isAuthenticated, isLoading: authLoading, user, authFetch } = useAuth()

  const [activeTab, setActiveTab] = useState<Tab>("components")

  // ── Component catalog state ────────────────────────────────────────────────
  const [components, setComponents] = useState<ComponentEntry[]>([])
  const [componentsLoading, setComponentsLoading] = useState(true)
  const [componentDialogOpen, setComponentDialogOpen] = useState(false)
  const [editingComponent, setEditingComponent] = useState<ComponentEntry | null>(null)
  const [componentForm, setComponentForm] = useState({ name: "", extraPrice: "" })
  const [componentSaving, setComponentSaving] = useState(false)
  const [componentError, setComponentError] = useState<string | null>(null)

  // ── Meal catalog state ─────────────────────────────────────────────────────
  const [meals, setMeals] = useState<MealEntry[]>([])
  const [mealsLoading, setMealsLoading] = useState(true)
  const [mealDialogOpen, setMealDialogOpen] = useState(false)
  const [editingMeal, setEditingMeal] = useState<MealEntry | null>(null)
  const [mealForm, setMealForm] = useState({ name: "", description: "", price: "", componentIds: [] as number[] })
  const [mealSaving, setMealSaving] = useState(false)
  const [mealError, setMealError] = useState<string | null>(null)

  // ── Role guard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated) { router.replace("/login"); return }
    if (!user?.role?.toUpperCase().includes("ADMIN")) router.replace("/dashboard")
  }, [authLoading, isAuthenticated, user, router])

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchComponents = useCallback(async () => {
    setComponentsLoading(true)
    try {
      const res = await authFetch("/admin/component-catalog")
      if (res.ok) setComponents((await res.json()) as ComponentEntry[])
    } catch {
      // leave list as-is on network error
    } finally {
      setComponentsLoading(false)
    }
  }, [authFetch])

  const fetchMeals = useCallback(async () => {
    setMealsLoading(true)
    try {
      const res = await authFetch("/admin/meal-catalog")
      if (res.ok) setMeals((await res.json()) as MealEntry[])
    } catch {
      // leave list as-is on network error
    } finally {
      setMealsLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    if (isAuthenticated && user?.role?.toUpperCase().includes("ADMIN")) {
      fetchComponents()
      fetchMeals()
    }
  }, [isAuthenticated, user, fetchComponents, fetchMeals])

  // ── Component dialog handlers ──────────────────────────────────────────────
  const openNewComponent = () => {
    setEditingComponent(null)
    setComponentForm({ name: "", extraPrice: "" })
    setComponentError(null)
    setComponentDialogOpen(true)
  }

  const openEditComponent = (c: ComponentEntry) => {
    setEditingComponent(c)
    setComponentForm({ name: c.name, extraPrice: String(c.extraPrice) })
    setComponentError(null)
    setComponentDialogOpen(true)
  }

  const handleSaveComponent = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!componentForm.name.trim() || !componentForm.extraPrice) return
    setComponentSaving(true)
    setComponentError(null)
    try {
      const payload = {
        name: componentForm.name.trim(),
        extraPrice: parseFloat(componentForm.extraPrice),
      }
      const res = editingComponent
        ? await authFetch(`/admin/component-catalog/${editingComponent.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await authFetch("/admin/component-catalog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as unknown
        throw new Error(parseError(body, "Save failed."))
      }
      setComponentDialogOpen(false)
      await fetchComponents()
      // Re-fetch meals so linked component names stay current
      fetchMeals()
    } catch (err) {
      setComponentError(err instanceof Error ? err.message : "Save failed.")
    } finally {
      setComponentSaving(false)
    }
  }

  // ── Meal dialog handlers ───────────────────────────────────────────────────
  const openNewMeal = () => {
    setEditingMeal(null)
    setMealForm({ name: "", description: "", price: "", componentIds: [] })
    setMealError(null)
    setMealDialogOpen(true)
  }

  const openEditMeal = (m: MealEntry) => {
    setEditingMeal(m)
    setMealForm({
      name: m.name,
      description: m.description ?? "",
      price: String(m.price),
      componentIds: extractComponentIds(m),
    })
    setMealError(null)
    setMealDialogOpen(true)
  }

  const toggleMealComponent = (id: number) => {
    setMealForm((prev) => ({
      ...prev,
      componentIds: prev.componentIds.includes(id)
        ? prev.componentIds.filter((c) => c !== id)
        : [...prev.componentIds, id],
    }))
  }

  const handleSaveMeal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mealForm.name.trim() || !mealForm.price) return
    setMealSaving(true)
    setMealError(null)
    try {
      const payload = {
        name: mealForm.name.trim(),
        description: mealForm.description.trim() || null,
        price: parseFloat(mealForm.price),
        componentIds: mealForm.componentIds,
      }
      const res = editingMeal
        ? await authFetch(`/admin/meal-catalog/${editingMeal.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await authFetch("/admin/meal-catalog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as unknown
        throw new Error(parseError(body, "Save failed."))
      }
      setMealDialogOpen(false)
      fetchMeals()
    } catch (err) {
      setMealError(err instanceof Error ? err.message : "Save failed.")
    } finally {
      setMealSaving(false)
    }
  }

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (authLoading || !isAuthenticated || !user?.role?.toUpperCase().includes("ADMIN")) return null

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        {/* Header */}
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">Admin</BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Catalog Management</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          {/* Tab bar */}
          <div className="flex gap-1 border-b">
            {(["components", "meals"] as Tab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                  activeTab === tab
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* ── COMPONENTS tab ──────────────────────────────────────────── */}
          {activeTab === "components" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Component Catalog</h2>
                  <p className="text-sm text-muted-foreground">
                    Extra-portion items with agreed prices. Create these before adding meals.
                  </p>
                </div>
                <Button size="sm" onClick={openNewComponent}>+ Add Component</Button>
              </div>

              {componentsLoading ? (
                <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Extra Price</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead className="w-16" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {components.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                          No components yet — add one to get started.
                        </TableCell>
                      </TableRow>
                    ) : (
                      components.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell>${c.extraPrice.toFixed(2)}</TableCell>
                          <TableCell>{c.active ? "Yes" : "No"}</TableCell>
                          <TableCell>
                            <Button size="sm" variant="outline" onClick={() => openEditComponent(c)}>
                              Edit
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </div>
          )}

          {/* ── MEALS tab ───────────────────────────────────────────────── */}
          {activeTab === "meals" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Meal Catalog</h2>
                  <p className="text-sm text-muted-foreground">
                    Predefined meals with agreed prices. Price here is the source of truth — never re-entered elsewhere.
                  </p>
                </div>
                <Button size="sm" onClick={openNewMeal}>+ Add Meal</Button>
              </div>

              {components.length === 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  No components exist yet. Switch to the Components tab and add some before linking them to meals.
                </div>
              )}

              {mealsLoading ? (
                <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Components</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead className="w-16" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {meals.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                          No meals yet — add one above.
                        </TableCell>
                      </TableRow>
                    ) : (
                      meals.map((m) => {
                        const linkedIds = extractComponentIds(m)
                        const linkedNames = components
                          .filter((c) => linkedIds.includes(c.id))
                          .map((c) => c.name)
                          .join(", ")
                        return (
                          <TableRow key={m.id}>
                            <TableCell className="font-medium">{m.name}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {m.description ?? "—"}
                            </TableCell>
                            <TableCell>${m.price.toFixed(2)}</TableCell>
                            <TableCell className="text-sm">{linkedNames || "—"}</TableCell>
                            <TableCell>{m.active ? "Yes" : "No"}</TableCell>
                            <TableCell>
                              <Button size="sm" variant="outline" onClick={() => openEditMeal(m)}>
                                Edit
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </div>

        {/* ── Component dialog ────────────────────────────────────────────── */}
        <Dialog open={componentDialogOpen} onOpenChange={setComponentDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingComponent ? "Edit Component" : "New Component"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSaveComponent} className="space-y-4 pt-2">
              <div className="space-y-1">
                <Label htmlFor="c-name">Name</Label>
                <Input
                  id="c-name"
                  value={componentForm.name}
                  onChange={(e) => setComponentForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Chicken"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-price">Extra portion price ($)</Label>
                <Input
                  id="c-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={componentForm.extraPrice}
                  onChange={(e) => setComponentForm((p) => ({ ...p, extraPrice: e.target.value }))}
                  placeholder="0.00"
                  required
                />
              </div>
              {componentError && <p className="text-sm text-destructive">{componentError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setComponentDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={componentSaving}>
                  {componentSaving ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* ── Meal dialog ──────────────────────────────────────────────────── */}
        <Dialog open={mealDialogOpen} onOpenChange={setMealDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingMeal ? "Edit Meal" : "New Meal"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSaveMeal} className="space-y-4 pt-2">
              <div className="space-y-1">
                <Label htmlFor="m-name">Name</Label>
                <Input
                  id="m-name"
                  value={mealForm.name}
                  onChange={(e) => setMealForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Potatoes & Beef"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="m-desc">Description (optional)</Label>
                <Input
                  id="m-desc"
                  value={mealForm.description}
                  onChange={(e) => setMealForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Brief description…"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="m-price">Price ($) — agreed with stakeholders</Label>
                <Input
                  id="m-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={mealForm.price}
                  onChange={(e) => setMealForm((p) => ({ ...p, price: e.target.value }))}
                  placeholder="0.00"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Components (informational composition)</Label>
                {components.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No components available — add them in the Components tab first.
                  </p>
                ) : (
                  <div className="max-h-44 overflow-y-auto space-y-2 rounded-md border p-3">
                    {components.map((c) => (
                      <div key={c.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`comp-${c.id}`}
                          checked={mealForm.componentIds.includes(c.id)}
                          onCheckedChange={() => toggleMealComponent(c.id)}
                        />
                        <label htmlFor={`comp-${c.id}`} className="cursor-pointer text-sm">
                          {c.name}
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {mealError && <p className="text-sm text-destructive">{mealError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setMealDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={mealSaving}>
                  {mealSaving ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </SidebarInset>
    </SidebarProvider>
  )
}
