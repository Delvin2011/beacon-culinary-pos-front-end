"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/hooks/use-toast"
import { formatZarCurrency } from "@/lib/utils"

interface MealPeriod {
  id: number
  name: string
  startTime: string | null
  endTime: string | null
}

interface MealCatalogEntry {
  id: number
  name: string
  price: number
  active: boolean
}

interface ComponentCatalogEntry {
  id: number
  name: string
  extraPrice: number
  active: boolean
}

interface DailyMealOption {
  id: number
  name: string
  description?: string
  price: number
  plannedPortions: number
  portionsRemaining: number
}

interface DailyComponentStock {
  id: number
  componentName?: string
  name?: string
  extraPrice: number
  bufferQuantity: number
  bufferRemaining: number
}

interface TodayPlan {
  options: DailyMealOption[]
  availableExtras: DailyComponentStock[]
}

interface IngredientRequirementDto {
  ingredientId: number
  name: string
  unit: "KG" | "LITRE" | "EACH"
  calculatedQuantity: number
  currentStock: number
}

interface IngredientRequirementsResponseDto {
  requirements: IngredientRequirementDto[]
}

interface IngredientShortfallDto {
  ingredientId: number
  name: string
  unit: "KG" | "LITRE" | "EACH"
  finalQuantity: number
  resultingStock: number
}

interface ConfirmIngredientRequirementsResponseDto {
  shortfalls: IngredientShortfallDto[]
}

type RequirementRow = IngredientRequirementDto & {
  editedQuantity: string
  isEdited: boolean
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0]
}

function parseError(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>
    if (typeof b.message === "string") return b.message
  }
  return fallback
}

function formatPeriodTime(value: string | null): string {
  if (!value) return "--:--"
  return value.slice(0, 5)
}

export default function DailyPlanningPage() {
  const router = useRouter()
  const { isAuthenticated, isLoading: authLoading, user, authFetch } = useAuth()

  const [periods, setPeriods] = useState<MealPeriod[]>([])
  const [selectedPeriod, setSelectedPeriod] = useState<MealPeriod | null>(null)

  const [mealCatalog, setMealCatalog] = useState<MealCatalogEntry[]>([])
  const [componentCatalog, setComponentCatalog] = useState<ComponentCatalogEntry[]>([])

  const [todayPlan, setTodayPlan] = useState<TodayPlan | null>(null)
  const [planLoading, setPlanLoading] = useState(false)

  const [selectedMealId, setSelectedMealId] = useState("")
  const [plannedPortions, setPlannedPortions] = useState("")
  const [mealOptionSaving, setMealOptionSaving] = useState(false)
  const [mealOptionError, setMealOptionError] = useState<string | null>(null)

  const [selectedComponentId, setSelectedComponentId] = useState("")
  const [bufferQuantity, setBufferQuantity] = useState("")
  const [stockSaving, setStockSaving] = useState(false)
  const [stockError, setStockError] = useState<string | null>(null)

  const [requirementsDialogOpen, setRequirementsDialogOpen] = useState(false)
  const [requirementsLoading, setRequirementsLoading] = useState(false)
  const [requirementsError, setRequirementsError] = useState<string | null>(null)
  const [requirementsRows, setRequirementsRows] = useState<RequirementRow[]>([])
  const [confirmingRequirements, setConfirmingRequirements] = useState(false)
  const [confirmRequirementsError, setConfirmRequirementsError] = useState<string | null>(null)
  const [confirmRequirementsSuccess, setConfirmRequirementsSuccess] = useState<string | null>(null)
  const [requirementShortfalls, setRequirementShortfalls] = useState<IngredientShortfallDto[]>([])

  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated) { router.replace("/login"); return }
    if (!user?.role?.toUpperCase().includes("ADMIN")) router.replace("/dashboard")
  }, [authLoading, isAuthenticated, user, router])

  const fetchPeriods = useCallback(async () => {
    try {
      const res = await authFetch("/meal-periods")
      if (!res.ok) return
      const data = (await res.json()) as MealPeriod[]
      setPeriods(data)
      if (data.length > 0) setSelectedPeriod(data[0])
    } catch {
      // no-op
    }
  }, [authFetch])

  const fetchCatalogs = useCallback(async () => {
    try {
      const [mRes, cRes] = await Promise.all([
        authFetch("/admin/meal-catalog"),
        authFetch("/admin/component-catalog"),
      ])
      if (mRes.ok) setMealCatalog((await mRes.json()) as MealCatalogEntry[])
      if (cRes.ok) setComponentCatalog((await cRes.json()) as ComponentCatalogEntry[])
    } catch {
      // no-op
    }
  }, [authFetch])

  const fetchTodayPlan = useCallback(async (period: MealPeriod) => {
    setPlanLoading(true)
    try {
      const res = await authFetch(`/menu/today?period=${period.name.toUpperCase()}`)
      if (res.ok) setTodayPlan((await res.json()) as TodayPlan)
    } catch {
      // no-op
    } finally {
      setPlanLoading(false)
    }
  }, [authFetch])

  const loadIngredientRequirements = useCallback(async (period: MealPeriod) => {
    setRequirementsLoading(true)
    setRequirementsError(null)
    setConfirmRequirementsError(null)
    setConfirmRequirementsSuccess(null)
    setRequirementShortfalls([])
    try {
      const res = await authFetch(`/admin/daily-planning/${todayISO()}/ingredient-requirements?period=${period.name.toUpperCase()}`)
      const body = (await res.json().catch(() => null)) as IngredientRequirementsResponseDto | unknown
      if (!res.ok || !body) {
        throw new Error(parseError(body, "Unable to load ingredient requirements."))
      }
      const requirements = Array.isArray((body as IngredientRequirementsResponseDto).requirements)
        ? (body as IngredientRequirementsResponseDto).requirements
        : []
      setRequirementsRows(requirements.map((row) => ({ ...row, editedQuantity: String(row.calculatedQuantity), isEdited: false })))
      setRequirementsDialogOpen(true)
    } catch (err) {
      setRequirementsError(err instanceof Error ? err.message : "Unable to load ingredient requirements.")
      setRequirementsDialogOpen(true)
      setRequirementsRows([])
    } finally {
      setRequirementsLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    if (isAuthenticated && user?.role?.toUpperCase().includes("ADMIN")) {
      void fetchPeriods()
      void fetchCatalogs()
    }
  }, [isAuthenticated, user, fetchPeriods, fetchCatalogs])

  useEffect(() => {
    if (selectedPeriod) void fetchTodayPlan(selectedPeriod)
  }, [selectedPeriod, fetchTodayPlan])

  const selectedMeal = mealCatalog.find((meal) => String(meal.id) === selectedMealId)
  const selectedComponent = componentCatalog.find((component) => String(component.id) === selectedComponentId)

  const hasPlannedItems = (todayPlan?.options.length ?? 0) > 0 || (todayPlan?.availableExtras.length ?? 0) > 0

  const handleAddMealOption = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedPeriod || !selectedMealId || !plannedPortions) return
    setMealOptionSaving(true)
    setMealOptionError(null)
    try {
      const res = await authFetch("/admin/daily-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mealPeriodId: selectedPeriod.id,
          optionDate: todayISO(),
          mealCatalogId: Number(selectedMealId),
          plannedPortions: Number(plannedPortions),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as unknown
        throw new Error(parseError(body, "Failed to add meal option."))
      }
      setSelectedMealId("")
      setPlannedPortions("")
      void fetchTodayPlan(selectedPeriod)
      toast({ title: "Meal option added", description: `${selectedMeal?.name ?? "Meal option"} was added to ${selectedPeriod.name}.` })
    } catch (err) {
      setMealOptionError(err instanceof Error ? err.message : "Failed to add meal option.")
    } finally {
      setMealOptionSaving(false)
    }
  }

  const handleAddComponentStock = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedPeriod || !selectedComponentId || !bufferQuantity) return
    setStockSaving(true)
    setStockError(null)
    try {
      const res = await authFetch("/admin/daily-component-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          componentCatalogId: Number(selectedComponentId),
          mealPeriodId: selectedPeriod.id,
          optionDate: todayISO(),
          bufferQuantity: Number(bufferQuantity),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as unknown
        throw new Error(parseError(body, "Failed to add component stock."))
      }
      setSelectedComponentId("")
      setBufferQuantity("")
      void fetchTodayPlan(selectedPeriod)
      toast({ title: "Component stock added", description: `${selectedComponent?.name ?? "Component"} stock was added for ${selectedPeriod.name}.` })
    } catch (err) {
      setStockError(err instanceof Error ? err.message : "Failed to add component stock.")
    } finally {
      setStockSaving(false)
    }
  }

  const updateRequirementQuantity = (ingredientId: number, value: string) => {
    setRequirementsRows((prev) => prev.map((row) => {
      if (row.ingredientId !== ingredientId) return row
      return {
        ...row,
        editedQuantity: value,
        isEdited: value !== String(row.calculatedQuantity),
      }
    }))
  }

  const confirmIngredientRequirements = async () => {
    if (!selectedPeriod) return
    setConfirmingRequirements(true)
    setConfirmRequirementsError(null)
    setConfirmRequirementsSuccess(null)
    try {
      const adjustments = requirementsRows.map((row) => {
        const finalQuantity = Number(row.editedQuantity)
        if (!Number.isFinite(finalQuantity) || finalQuantity < 0) {
          throw new Error(`Enter a valid quantity for ${row.name}.`)
        }
        return {
          ingredientId: row.ingredientId,
          finalQuantity,
        }
      })

      const res = await authFetch(`/admin/daily-planning/${todayISO()}/confirm-ingredient-requirements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period: selectedPeriod.name.toUpperCase(),
          adjustments,
        }),
      })
      const body = (await res.json().catch(() => null)) as ConfirmIngredientRequirementsResponseDto | unknown
      if (!res.ok || !body) {
        throw new Error(parseError(body, "Unable to confirm ingredient requirements."))
      }

      const response = body as ConfirmIngredientRequirementsResponseDto
      // Reload after capturing the response, not before — loadIngredientRequirements
      // resets confirmRequirementsSuccess/requirementShortfalls at its start, so setting
      // them first would have them wiped before the next render ever shows them.
      await loadIngredientRequirements(selectedPeriod)
      await fetchTodayPlan(selectedPeriod)
      setRequirementShortfalls(Array.isArray(response.shortfalls) ? response.shortfalls : [])
      setConfirmRequirementsSuccess(`Ingredient requirements confirmed for ${selectedPeriod.name}. Stock was deducted from Kitchen.`)
      toast({ title: "Ingredient requirements confirmed", description: response.shortfalls?.length ? `${response.shortfalls.length} shortfall warning(s) against Kitchen stock.` : `Requirements for ${selectedPeriod.name} were confirmed and deducted from Kitchen stock.` })
    } catch (err) {
      setConfirmRequirementsError(err instanceof Error ? err.message : "Unable to confirm ingredient requirements.")
    } finally {
      setConfirmingRequirements(false)
    }
  }

  const requirementRowsWithState = useMemo(() => {
    return requirementsRows.map((row) => {
      const finalQuantity = Number(row.editedQuantity)
      const isFinalValid = Number.isFinite(finalQuantity) && finalQuantity >= 0
      const isShort = isFinalValid && finalQuantity > row.currentStock
      return {
        ...row,
        finalQuantity,
        isFinalValid,
        isShort,
      }
    })
  }, [requirementsRows])

  if (authLoading || !isAuthenticated || !user?.role?.toUpperCase().includes("ADMIN")) return null

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">Admin</BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Daily Planning</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Period:</span>
            <div className="flex gap-1 rounded-lg border p-1">
              {periods.map((period) => (
                <button
                  key={period.id}
                  type="button"
                  onClick={() => setSelectedPeriod(period)}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${selectedPeriod?.id === period.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {period.name}
                  <span className="ml-1.5 text-xs opacity-60">{formatPeriodTime(period.startTime)}–{formatPeriodTime(period.endTime)}</span>
                </button>
              ))}
              {periods.length === 0 && <span className="px-3 py-1.5 text-sm text-muted-foreground animate-pulse">Loading periods…</span>}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4 rounded-lg border p-4">
              <div>
                <h2 className="font-semibold">Add Meal Option</h2>
                <p className="text-sm text-muted-foreground">Select a catalog meal and declare portions for today.</p>
              </div>
              <form onSubmit={handleAddMealOption} className="space-y-3">
                <div className="space-y-1">
                  <Label>Meal</Label>
                  <Select value={selectedMealId} onValueChange={setSelectedMealId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a meal…" />
                    </SelectTrigger>
                    <SelectContent>
                      {mealCatalog.filter((meal) => meal.active).map((meal) => (
                        <SelectItem key={meal.id} value={String(meal.id)}>{meal.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedMeal && (
                  <div className="rounded-md bg-muted px-3 py-2 text-sm">
                    Price: <span className="font-medium">{formatZarCurrency(selectedMeal.price)}</span>
                    <span className="ml-2 text-xs text-muted-foreground">(from catalog — read only)</span>
                  </div>
                )}

                <div className="space-y-1">
                  <Label htmlFor="planned-portions">Planned portions</Label>
                  <Input id="planned-portions" type="number" min="1" step="1" value={plannedPortions} onChange={(event) => setPlannedPortions(event.target.value)} placeholder="e.g. 50" required />
                </div>

                {mealOptionError && <p className="text-sm text-destructive">{mealOptionError}</p>}
                <Button type="submit" disabled={mealOptionSaving || !selectedMealId || !plannedPortions} className="w-full">
                  {mealOptionSaving ? "Adding…" : "Add Meal Option"}
                </Button>
              </form>
            </div>

            <div className="space-y-4 rounded-lg border p-4">
              <div>
                <h2 className="font-semibold">Add Component Stock</h2>
                <p className="text-sm text-muted-foreground">Declare extra-portion availability for today — independent of any specific meal.</p>
              </div>
              <form onSubmit={handleAddComponentStock} className="space-y-3">
                <div className="space-y-1">
                  <Label>Component</Label>
                  <Select value={selectedComponentId} onValueChange={setSelectedComponentId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a component…" />
                    </SelectTrigger>
                    <SelectContent>
                      {componentCatalog.filter((component) => component.active).map((component) => (
                        <SelectItem key={component.id} value={String(component.id)}>{component.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedComponent && (
                  <div className="rounded-md bg-muted px-3 py-2 text-sm">
                    Extra price: <span className="font-medium">{formatZarCurrency(selectedComponent.extraPrice)}</span>
                    <span className="ml-2 text-xs text-muted-foreground">(from catalog — read only)</span>
                  </div>
                )}

                <div className="space-y-1">
                  <Label htmlFor="buffer-qty">Buffer quantity</Label>
                  <Input id="buffer-qty" type="number" min="1" step="1" value={bufferQuantity} onChange={(event) => setBufferQuantity(event.target.value)} placeholder="e.g. 40" required />
                </div>

                {stockError && <p className="text-sm text-destructive">{stockError}</p>}
                <Button type="submit" disabled={stockSaving || !selectedComponentId || !bufferQuantity} className="w-full">
                  {stockSaving ? "Adding…" : "Add Component Stock"}
                </Button>
              </form>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Today&apos;s Plan — {selectedPeriod?.name ?? "…"}</h2>
                <p className="text-sm text-muted-foreground">{todayISO()} · Review ingredient requirements before service prep.</p>
              </div>
              <div className="flex gap-2">
                {selectedPeriod && (
                  <Button size="sm" variant="outline" onClick={() => void fetchTodayPlan(selectedPeriod)} disabled={planLoading}>
                    {planLoading ? "Refreshing…" : "Refresh"}
                  </Button>
                )}
                {selectedPeriod && (
                  <Button size="sm" onClick={() => void loadIngredientRequirements(selectedPeriod)} disabled={!hasPlannedItems || requirementsLoading}>
                    {requirementsLoading ? "Loading…" : "Review Ingredient Requirements"}
                  </Button>
                )}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">Meal Options</h3>
              {planLoading ? (
                <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Planned</TableHead>
                      <TableHead>Remaining</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!todayPlan?.options.length ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">No meal options planned for this period yet.</TableCell>
                      </TableRow>
                    ) : (
                      todayPlan.options.map((option) => (
                        <TableRow key={option.id}>
                          <TableCell className="font-medium">{option.name}</TableCell>
                          <TableCell>{formatZarCurrency(option.price)}</TableCell>
                          <TableCell>{option.plannedPortions}</TableCell>
                          <TableCell>
                            <span className={option.portionsRemaining === 0 ? "text-destructive font-medium" : ""}>{option.portionsRemaining}</span>
                            {option.portionsRemaining === 0 && <span className="ml-2 text-xs text-destructive">sold out</span>}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">Available Extras (component stock)</h3>
              {planLoading ? (
                <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Component</TableHead>
                      <TableHead>Extra Price</TableHead>
                      <TableHead>Declared</TableHead>
                      <TableHead>Remaining</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!todayPlan?.availableExtras.length ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">No component stock declared for this period yet.</TableCell>
                      </TableRow>
                    ) : (
                      todayPlan.availableExtras.map((extra) => (
                        <TableRow key={extra.id}>
                          <TableCell className="font-medium">{extra.componentName ?? extra.name ?? "—"}</TableCell>
                          <TableCell>{formatZarCurrency(extra.extraPrice)}</TableCell>
                          <TableCell>{extra.bufferQuantity}</TableCell>
                          <TableCell>
                            <span className={extra.bufferRemaining === 0 ? "text-destructive font-medium" : ""}>{extra.bufferRemaining}</span>
                            {extra.bufferRemaining === 0 && <span className="ml-2 text-xs text-destructive">sold out</span>}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </div>

        <Dialog open={requirementsDialogOpen} onOpenChange={setRequirementsDialogOpen}>
          <DialogContent className="max-w-5xl">
            <DialogHeader>
              <DialogTitle>Review Ingredient Requirements</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">Calculated requirements are editable before confirmation. Edited rows are highlighted. Confirming deducts stock from Kitchen; shortfalls against Kitchen&apos;s stock warn, but do not block confirmation.</p>

              {confirmRequirementsSuccess && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{confirmRequirementsSuccess}</div>
              )}

              {requirementShortfalls.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                  <p className="font-medium">Shortfalls detected after confirmation</p>
                  <div className="mt-2 space-y-1">
                    {requirementShortfalls.map((shortfall) => (
                      <p key={shortfall.ingredientId}>{shortfall.name} is now {Math.abs(shortfall.resultingStock)} {shortfall.unit} short in Kitchen after allocating {shortfall.finalQuantity} {shortfall.unit}. Consider a GRV or stock transfer into Kitchen before service.</p>
                    ))}
                  </div>
                </div>
              )}

              {requirementsError && <p className="text-sm text-destructive">{requirementsError}</p>}
              {confirmRequirementsError && <p className="text-sm text-destructive">{confirmRequirementsError}</p>}

              {requirementsLoading ? (
                <p className="text-sm text-muted-foreground animate-pulse">Loading ingredient requirements…</p>
              ) : requirementRowsWithState.length === 0 ? (
                <div className="rounded-md border bg-muted/40 px-4 py-6 text-sm text-muted-foreground">No unreviewed ingredient requirements remain for this date and period.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ingredient</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Calculated</TableHead>
                      <TableHead>Final Quantity</TableHead>
                      <TableHead>Kitchen Stock</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requirementRowsWithState.map((row) => (
                      <TableRow key={row.ingredientId} className={row.isShort ? "bg-amber-50" : row.isEdited ? "bg-blue-50" : ""}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell>{row.unit}</TableCell>
                        <TableCell>{row.calculatedQuantity}</TableCell>
                        <TableCell>
                          <Input type="number" min="0" step="0.0001" value={row.editedQuantity} onChange={(event) => updateRequirementQuantity(row.ingredientId, event.target.value)} className={row.isEdited ? "border-blue-400 bg-blue-50" : ""} />
                        </TableCell>
                        <TableCell>
                          <span className={row.isShort ? "font-medium text-amber-800" : ""}>{row.currentStock}</span>
                          {row.isShort && <span className="ml-2 text-xs text-amber-700">short</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setRequirementsDialogOpen(false)}>Close</Button>
                <Button type="button" onClick={() => void confirmIngredientRequirements()} disabled={confirmingRequirements || requirementRowsWithState.length === 0}>
                  {confirmingRequirements ? "Confirming…" : "Confirm Ingredient Requirements"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </SidebarInset>
    </SidebarProvider>
  )
}
