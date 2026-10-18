"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckCircle2, Circle } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { canManageMenu } from "@/lib/roles"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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

// PLANNED → INGREDIENTS_REVIEWED (ingredient requirements confirmed) → READY (actual recorded, on sale in the POS).
type PlanItemStatus = "PLANNED" | "INGREDIENTS_REVIEWED" | "READY"

interface DailyMealOption {
  id: number
  // Sent by newer backends; otherwise the edit form matches the catalog entry by name.
  mealCatalogId?: number
  mealPeriodId?: number
  optionDate?: string
  name: string
  description?: string
  price: number
  status: PlanItemStatus
  plannedPortions: number
  actualPortions: number | null
  sold: number
  portionsRemaining: number
}

interface DailyComponentStock {
  id: number
  componentCatalogId?: number
  mealPeriodId?: number
  optionDate?: string
  componentName?: string
  name?: string
  extraPrice: number
  status: PlanItemStatus
  bufferQuantity: number
  actualQuantity: number | null
  sold: number
  bufferRemaining: number
}

interface TodayPlan {
  options: DailyMealOption[]
  componentStock: DailyComponentStock[]
}

// Admin view of the plan: every item regardless of status. /menu/today now only returns READY items (for the POS).
const adminPlanPath = (date: string, periodName: string) => `/admin/daily-planning/${date}?period=${periodName.toUpperCase()}`
const mealOptionActualPath = (id: number) => `/admin/daily-options/${id}/actual`
const componentStockActualPath = (id: number) => `/admin/daily-component-stock/${id}/actual`
const mealOptionPath = (id: number) => `/admin/daily-options/${id}`
const componentStockPath = (id: number) => `/admin/daily-component-stock/${id}`

const STATUS_LABELS: Record<PlanItemStatus, { label: string; className: string }> = {
  PLANNED: { label: "Planned", className: "border-slate-200 bg-slate-50 text-slate-700" },
  INGREDIENTS_REVIEWED: { label: "Ingredients reviewed", className: "border-blue-200 bg-blue-50 text-blue-700" },
  READY: { label: "Ready · on sale", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
}

interface IngredientRequirementDto {
  ingredientId: number
  name: string
  unit: "KG" | "LITRE" | "EACH"
  calculatedQuantity: number
  currentStock: number
  kitchenStock: number
}

// A planned item that contributes no ingredients: a meal with no components, or a component with no recipe
// (or a recipe with no ingredient lines). components names the ones missing a recipe.
interface UncoveredPlanItemDto {
  type: "MEAL" | "EXTRA"
  planItemId: number
  name: string
  reason: "NO_COMPONENTS" | "NO_RECIPE" | string
  components: Array<string | { name?: string }>
}

interface IngredientRequirementsResponseDto {
  requirements: IngredientRequirementDto[]
  uncovered?: UncoveredPlanItemDto[]
}

type PlanItemKind = "option" | "stock"

interface PlanItemRef {
  kind: PlanItemKind
  id: number
  name: string
}

interface PlanItemEdit extends PlanItemRef {
  catalogId: string
  quantity: string
  mealPeriodId: number
  optionDate: string
}

function uncoveredComponentNames(item: UncoveredPlanItemDto): string[] {
  return (item.components ?? [])
    .map((component) => (typeof component === "string" ? component : component?.name ?? ""))
    .filter((name) => name.trim().length > 0)
}

function describeUncovered(item: UncoveredPlanItemDto): string {
  if (item.reason === "NO_COMPONENTS") {
    return `${item.name} has no components, so no ingredients will be requested for it. Link components with recipes in the menu catalog.`
  }
  const missing = uncoveredComponentNames(item).filter((name) => name !== item.name)
  if (missing.length === 0) {
    return `${item.name} has no recipe (or its recipe has no ingredient lines), so no ingredients will be requested for it. Add a recipe in the menu catalog.`
  }
  const list = missing.join(", ")
  return `${item.name}: ${list} ${missing.length === 1 ? "has" : "have"} no recipe (or no ingredient lines), so no ingredients will be requested for ${missing.length === 1 ? "it" : "them"}. Add recipes in the menu catalog.`
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
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

// Handles { message }, { error } and field errors like { actualPortions: "..." }.
function parseError(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>
    if (typeof b.message === "string" && b.message.trim()) return b.message
    if (typeof b.error === "string" && b.error.trim()) return b.error
    const fieldErrors = Object.values(b).filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    if (fieldErrors.length > 0) return fieldErrors.join(" ")
  }
  return fallback
}

function toTodayPlan(body: Partial<TodayPlan>): TodayPlan {
  return {
    options: Array.isArray(body.options) ? body.options : [],
    componentStock: Array.isArray(body.componentStock) ? body.componentStock : [],
  }
}

// A period's planning progress, worked out from its items' statuses. Nothing is stored:
// adding an item after everything was Ready simply puts the period back in progress.
interface PlanProgress {
  mealCount: number
  itemCount: number
  toReview: string[]
  toRecord: string[]
  complete: boolean
}

function planProgress(plan: TodayPlan): PlanProgress {
  const items = [
    ...plan.options.map((option) => ({ name: option.name, status: option.status })),
    ...plan.componentStock.map((stock) => ({ name: stock.componentName ?? stock.name ?? "Extra", status: stock.status })),
  ]
  const toReview = items.filter((item) => item.status === "PLANNED").map((item) => item.name)
  const toRecord = items.filter((item) => item.status === "INGREDIENTS_REVIEWED").map((item) => item.name)
  const mealCount = plan.options.length
  return {
    mealCount,
    itemCount: items.length,
    toReview,
    toRecord,
    complete: mealCount > 0 && toReview.length === 0 && toRecord.length === 0,
  }
}

// "Lamb Stew, Cottage Pie and 3 more"
function summariseNames(names: string[], max = 4): string {
  if (names.length <= max) return names.join(", ")
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`
}

function ProgressStep({ done, active, title, children }: { done: boolean; active: boolean; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {done ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
      ) : (
        <Circle className={`mt-0.5 h-4 w-4 shrink-0 ${active ? "text-amber-600" : "text-muted-foreground/50"}`} aria-hidden />
      )}
      <div className="min-w-0 space-y-1">
        <p className={`text-sm font-medium ${done ? "text-muted-foreground line-through decoration-muted-foreground/40" : active ? "" : "text-muted-foreground"}`}>
          {title}
          <span className="sr-only">{done ? " (done)" : " (outstanding)"}</span>
        </p>
        {!done && children}
      </div>
    </li>
  )
}

function StatusBadge({ status }: { status: PlanItemStatus }) {
  const { label, className } = STATUS_LABELS[status] ?? STATUS_LABELS.PLANNED
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>{label}</span>
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
  // The period todayPlan belongs to, so a plan still showing while the next one loads isn't credited to the wrong tab.
  const [planPeriodId, setPlanPeriodId] = useState<number | null>(null)
  // Progress for every period, for the marks on the period tabs.
  const [periodProgress, setPeriodProgress] = useState<Record<number, PlanProgress>>({})
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)

  const [actualDrafts, setActualDrafts] = useState<Record<string, string>>({})
  const [actualErrors, setActualErrors] = useState<Record<string, string | null>>({})
  const [actualSavingKey, setActualSavingKey] = useState<string | null>(null)

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
  // Planned items that request no ingredients. A warning, not an error: bought-in items (bread rolls) have no recipe
  // on purpose. Confirm needs an explicit acknowledgement while any are listed.
  const [uncoveredItems, setUncoveredItems] = useState<UncoveredPlanItemDto[]>([])
  const [uncoveredAcknowledged, setUncoveredAcknowledged] = useState(false)

  // Edit and Remove, only for items still Planned.
  const [editTarget, setEditTarget] = useState<PlanItemEdit | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<PlanItemRef | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated) { router.replace("/login"); return }
    if (!canManageMenu(user?.role)) router.replace("/dashboard")
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
    setPlanError(null)
    try {
      const res = await authFetch(adminPlanPath(todayISO(), period.name))
      const body = (await res.json().catch(() => null)) as Partial<TodayPlan> | unknown
      if (!res.ok || !body || typeof body !== "object") {
        throw new Error(parseError(body, "Unable to load today's plan."))
      }
      setTodayPlan(toTodayPlan(body as Partial<TodayPlan>))
      setPlanPeriodId(period.id)
      setActualDrafts({})
      setActualErrors({})
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Unable to load today's plan.")
      setTodayPlan(null)
      setPlanPeriodId(null)
    } finally {
      setPlanLoading(false)
    }
  }, [authFetch])

  // One summary request per period; a failed one just leaves that tab without a mark.
  const fetchAllPeriodProgress = useCallback(async (list: MealPeriod[]) => {
    const entries = await Promise.all(
      list.map(async (period): Promise<[number, PlanProgress] | null> => {
        try {
          const res = await authFetch(adminPlanPath(todayISO(), period.name))
          if (!res.ok) return null
          const body = (await res.json().catch(() => null)) as Partial<TodayPlan> | null
          return body && typeof body === "object" ? [period.id, planProgress(toTodayPlan(body))] : null
        } catch {
          return null
        }
      }),
    )
    setPeriodProgress((prev) => ({ ...prev, ...Object.fromEntries(entries.filter((entry): entry is [number, PlanProgress] => entry !== null)) }))
  }, [authFetch])

  // Row keys are prefixed because meal option and component stock ids can overlap.
  const saveActual = async (key: string, item: { id: number; sold: number }, kind: "option" | "stock") => {
    const draft = actualDrafts[key]
    const value = Number(draft)
    if (draft === undefined || draft.trim() === "" || !Number.isInteger(value) || value < 0) {
      setActualErrors((prev) => ({ ...prev, [key]: "Enter a whole number, 0 or more." }))
      return
    }
    if (value < item.sold) {
      setActualErrors((prev) => ({ ...prev, [key]: `Can't be below the ${item.sold} already sold.` }))
      return
    }

    setActualSavingKey(key)
    setActualErrors((prev) => ({ ...prev, [key]: null }))
    try {
      const res = await authFetch(kind === "option" ? mealOptionActualPath(item.id) : componentStockActualPath(item.id), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "option" ? { actualPortions: value } : { actualQuantity: value }),
      })
      const body = (await res.json().catch(() => null)) as unknown
      if (!res.ok || !body || typeof body !== "object") {
        throw new Error(parseError(body, res.status === 404 ? "This item no longer exists. Refresh the plan." : "Unable to save the actual."))
      }
      // The endpoint returns the updated row in the planning-page shape, so patch it in place.
      setTodayPlan((prev) => {
        if (!prev) return prev
        return kind === "option"
          ? { ...prev, options: prev.options.map((option) => (option.id === item.id ? (body as DailyMealOption) : option)) }
          : { ...prev, componentStock: prev.componentStock.map((stock) => (stock.id === item.id ? (body as DailyComponentStock) : stock)) }
      })
      setActualDrafts((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      toast({ title: "Actual saved", description: value === 0 ? "Recorded as 0. Nothing is available to sell." : `${value} now available in the POS.` })
    } catch (err) {
      setActualErrors((prev) => ({ ...prev, [key]: err instanceof Error ? err.message : "Unable to save the actual." }))
    } finally {
      setActualSavingKey(null)
    }
  }

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
      const response = body as IngredientRequirementsResponseDto
      const requirements = Array.isArray(response.requirements) ? response.requirements : []
      setRequirementsRows(requirements.map((row) => ({ ...row, editedQuantity: String(row.calculatedQuantity), isEdited: false })))
      setUncoveredItems(Array.isArray(response.uncovered) ? response.uncovered : [])
      setUncoveredAcknowledged(false)
      setRequirementsDialogOpen(true)
    } catch (err) {
      setRequirementsError(err instanceof Error ? err.message : "Unable to load ingredient requirements.")
      setRequirementsDialogOpen(true)
      setRequirementsRows([])
      setUncoveredItems([])
    } finally {
      setRequirementsLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    if (isAuthenticated && canManageMenu(user?.role)) {
      void fetchPeriods()
      void fetchCatalogs()
    }
  }, [isAuthenticated, user, fetchPeriods, fetchCatalogs])

  useEffect(() => {
    if (selectedPeriod) void fetchTodayPlan(selectedPeriod)
  }, [selectedPeriod, fetchTodayPlan])

  useEffect(() => {
    if (periods.length > 0) void fetchAllPeriodProgress(periods)
  }, [periods, fetchAllPeriodProgress])

  // Saving an actual or editing the plan changes todayPlan; keep its tab mark in step.
  useEffect(() => {
    if (todayPlan && planPeriodId !== null) {
      setPeriodProgress((prev) => ({ ...prev, [planPeriodId]: planProgress(todayPlan) }))
    }
  }, [todayPlan, planPeriodId])

  const selectedMeal = mealCatalog.find((meal) => String(meal.id) === selectedMealId)
  const selectedComponent = componentCatalog.find((component) => String(component.id) === selectedComponentId)

  const hasPlannedItems = (todayPlan?.options.length ?? 0) > 0 || (todayPlan?.componentStock.length ?? 0) > 0
  const progress = todayPlan && planPeriodId === selectedPeriod?.id ? planProgress(todayPlan) : null

  const renderActualCell = (key: string, item: { id: number; status: PlanItemStatus; sold: number }, actual: number | null, planned: number, kind: "option" | "stock") => {
    if (item.status === "PLANNED") {
      return <span className="text-xs text-muted-foreground">Review ingredients first</span>
    }
    const draft = actualDrafts[key] ?? (actual === null ? "" : String(actual))
    const draftValue = Number(draft)
    const changed = draft.trim() !== "" && draft !== (actual === null ? "" : String(actual))
    const overPlanned = draft.trim() !== "" && Number.isFinite(draftValue) && draftValue > planned
    const saving = actualSavingKey === key
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={item.sold}
            step="1"
            value={draft}
            onChange={(event) => {
              const value = event.target.value
              setActualDrafts((prev) => ({ ...prev, [key]: value }))
              setActualErrors((prev) => ({ ...prev, [key]: null }))
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && changed) void saveActual(key, item, kind)
            }}
            className="h-8 w-20"
            aria-label="Actual quantity"
          />
          <Button size="sm" variant={actual === null ? "default" : "outline"} className="h-8" disabled={!changed || saving} onClick={() => void saveActual(key, item, kind)}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
        {overPlanned && !actualErrors[key] && <p className="text-xs text-amber-700">More than the {planned} planned.</p>}
        {actualErrors[key] && <p className="text-xs text-destructive">{actualErrors[key]}</p>}
      </div>
    )
  }

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
    if (uncoveredItems.length > 0 && !uncoveredAcknowledged) {
      setConfirmRequirementsError("Tick the box above to confirm that the listed items won't request any ingredients.")
      return
    }
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

  const openEdit = (kind: PlanItemKind, item: DailyMealOption | DailyComponentStock) => {
    if (!selectedPeriod) return
    const isOption = kind === "option"
    const option = item as DailyMealOption
    const stock = item as DailyComponentStock
    const name = isOption ? option.name : stock.componentName ?? stock.name ?? ""
    const catalogId = isOption
      ? option.mealCatalogId ?? mealCatalog.find((meal) => meal.name === name)?.id
      : stock.componentCatalogId ?? componentCatalog.find((component) => component.name === name)?.id
    setEditError(null)
    setEditTarget({
      kind,
      id: item.id,
      name,
      catalogId: catalogId === undefined ? "" : String(catalogId),
      quantity: String(isOption ? option.plannedPortions : stock.bufferQuantity),
      mealPeriodId: item.mealPeriodId ?? selectedPeriod.id,
      optionDate: item.optionDate ?? todayISO(),
    })
  }

  // Refresh what depends on the plan: the tables, and the review if it's open.
  const refreshAfterPlanChange = async () => {
    if (!selectedPeriod) return
    await fetchTodayPlan(selectedPeriod)
    if (requirementsDialogOpen) await loadIngredientRequirements(selectedPeriod)
  }

  const saveEdit = async () => {
    if (!editTarget) return
    const quantity = Number(editTarget.quantity)
    if (!editTarget.catalogId) {
      setEditError(editTarget.kind === "option" ? "Select a meal." : "Select a component.")
      return
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      setEditError("Enter a whole number, 1 or more.")
      return
    }
    setEditSaving(true)
    setEditError(null)
    try {
      // Edit replaces the whole entry, so every field is sent, as for create.
      const isOption = editTarget.kind === "option"
      const res = await authFetch(isOption ? mealOptionPath(editTarget.id) : componentStockPath(editTarget.id), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isOption
            ? {
                mealPeriodId: editTarget.mealPeriodId,
                optionDate: editTarget.optionDate,
                mealCatalogId: Number(editTarget.catalogId),
                plannedPortions: quantity,
              }
            : {
                componentCatalogId: Number(editTarget.catalogId),
                mealPeriodId: editTarget.mealPeriodId,
                optionDate: editTarget.optionDate,
                bufferQuantity: quantity,
              },
        ),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as unknown
        throw new Error(parseError(body, res.status === 404 ? "This item no longer exists. Refresh the plan." : "Unable to save the change."))
      }
      toast({ title: "Plan updated", description: `${editTarget.name} was updated.` })
      setEditTarget(null)
      await refreshAfterPlanChange()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Unable to save the change.")
    } finally {
      setEditSaving(false)
    }
  }

  const confirmRemove = async () => {
    if (!removeTarget) return
    setRemoving(true)
    setRemoveError(null)
    try {
      const res = await authFetch(removeTarget.kind === "option" ? mealOptionPath(removeTarget.id) : componentStockPath(removeTarget.id), {
        method: "DELETE",
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as unknown
        throw new Error(parseError(body, res.status === 404 ? "This item no longer exists. Refresh the plan." : "Unable to remove this item."))
      }
      toast({ title: "Removed from plan", description: `${removeTarget.name} was removed from ${selectedPeriod?.name ?? "the plan"}.` })
      setRemoveTarget(null)
      await refreshAfterPlanChange()
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Unable to remove this item.")
    } finally {
      setRemoving(false)
    }
  }

  const askRemove = (target: PlanItemRef) => {
    setRemoveError(null)
    setRemoveTarget(target)
  }

  const renderPlanActions = (kind: PlanItemKind, item: DailyMealOption | DailyComponentStock, name: string) =>
    item.status === "PLANNED" ? (
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="outline" className="h-8" onClick={() => openEdit(kind, item)}>
          Edit
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-destructive hover:text-destructive" onClick={() => askRemove({ kind, id: item.id, name })}>
          Remove
        </Button>
      </div>
    ) : null

  const requirementRowsWithState = useMemo(() => {
    return requirementsRows.map((row) => {
      const finalQuantity = Number(row.editedQuantity)
      const isFinalValid = Number.isFinite(finalQuantity) && finalQuantity >= 0
      const isShort = isFinalValid && finalQuantity > row.currentStock
      const isKitchenLow = isFinalValid && finalQuantity > row.kitchenStock
      return {
        ...row,
        finalQuantity,
        isFinalValid,
        isShort,
        isKitchenLow,
      }
    })
  }, [requirementsRows])

  if (authLoading || !isAuthenticated || !canManageMenu(user?.role)) return null

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
              {periods.map((period) => {
                const mark = periodProgress[period.id]
                return (
                  <button
                    key={period.id}
                    type="button"
                    onClick={() => setSelectedPeriod(period)}
                    className={`inline-flex items-center rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${selectedPeriod?.id === period.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {mark?.complete ? (
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-emerald-500" aria-label="Planning complete" />
                    ) : mark && mark.itemCount > 0 ? (
                      <span className="mr-1.5 h-2 w-2 rounded-full bg-amber-500" aria-label="Planning in progress" />
                    ) : null}
                    {period.name}
                    <span className="ml-1.5 text-xs opacity-60">{formatPeriodTime(period.startTime)}–{formatPeriodTime(period.endTime)}</span>
                  </button>
                )
              })}
              {periods.length === 0 && <span className="px-3 py-1.5 text-sm text-muted-foreground animate-pulse">Loading periods…</span>}
            </div>
          </div>

          {progress && selectedPeriod && (
            progress.complete ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
                <p>
                  <span className="font-semibold">Planning complete for {selectedPeriod.name}</span> — everything is on sale in the POS.
                </p>
              </div>
            ) : (
              <section aria-labelledby="planning-progress" className="rounded-lg border px-4 py-3">
                <h2 id="planning-progress" className="text-sm font-semibold">
                  {selectedPeriod.name} planning: outstanding steps
                </h2>
                <ol className="mt-2 space-y-2">
                  <ProgressStep done={progress.mealCount > 0} active={progress.mealCount === 0} title="Plan meals and extras">
                    <p className="text-xs text-muted-foreground">Add at least one meal option below.</p>
                  </ProgressStep>
                  <ProgressStep
                    done={progress.mealCount > 0 && progress.toReview.length === 0}
                    active={progress.toReview.length > 0}
                    title="Review ingredient requirements"
                  >
                    {progress.toReview.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs text-muted-foreground">
                          {progress.toReview.length} item{progress.toReview.length === 1 ? "" : "s"} still to review: {summariseNames(progress.toReview)}
                        </p>
                        <Button size="sm" variant="outline" className="h-7" onClick={() => void loadIngredientRequirements(selectedPeriod)} disabled={requirementsLoading}>
                          {requirementsLoading ? "Loading…" : "Review now"}
                        </Button>
                      </div>
                    )}
                  </ProgressStep>
                  <ProgressStep
                    done={progress.mealCount > 0 && progress.toReview.length === 0 && progress.toRecord.length === 0}
                    active={progress.toReview.length === 0 && progress.toRecord.length > 0}
                    title="Record actuals after prep (puts items on sale)"
                  >
                    {progress.toRecord.length > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {summariseNames(progress.toRecord)} still need{progress.toRecord.length === 1 ? "s" : ""} an actual. Enter it in the tables below.
                      </p>
                    ) : progress.toReview.length > 0 ? (
                      <p className="text-xs text-muted-foreground">Available once ingredients are reviewed.</p>
                    ) : null}
                  </ProgressStep>
                </ol>
              </section>
            )
          )}

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
                <p className="text-sm text-muted-foreground">
                  {todayISO()} · Review ingredient requirements, then record actuals after prep. Only items marked Ready are sold in the POS.
                </p>
                {planError && <p className="mt-1 text-sm text-destructive">{planError}</p>}
              </div>
              <div className="flex gap-2">
                {selectedPeriod && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void fetchTodayPlan(selectedPeriod)
                      void fetchAllPeriodProgress(periods)
                    }}
                    disabled={planLoading}
                  >
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
                      <TableHead>Status</TableHead>
                      <TableHead>Planned</TableHead>
                      <TableHead>Actual</TableHead>
                      <TableHead>Sold</TableHead>
                      <TableHead>Remaining</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!todayPlan?.options.length ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">No meal options planned for this period yet.</TableCell>
                      </TableRow>
                    ) : (
                      todayPlan.options.map((option) => (
                        <TableRow key={option.id}>
                          <TableCell className="font-medium">{option.name}</TableCell>
                          <TableCell>{formatZarCurrency(option.price)}</TableCell>
                          <TableCell><StatusBadge status={option.status} /></TableCell>
                          <TableCell>{option.plannedPortions}</TableCell>
                          <TableCell>{renderActualCell(`option-${option.id}`, option, option.actualPortions, option.plannedPortions, "option")}</TableCell>
                          <TableCell>{option.sold}</TableCell>
                          <TableCell>
                            {option.status !== "READY" ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <>
                                <span className={option.portionsRemaining === 0 ? "text-destructive font-medium" : ""}>{option.portionsRemaining}</span>
                                {option.portionsRemaining === 0 && <span className="ml-2 text-xs text-destructive">sold out</span>}
                              </>
                            )}
                          </TableCell>
                          <TableCell>{renderPlanActions("option", option, option.name)}</TableCell>
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
                      <TableHead>Status</TableHead>
                      <TableHead>Declared</TableHead>
                      <TableHead>Actual</TableHead>
                      <TableHead>Sold</TableHead>
                      <TableHead>Remaining</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!todayPlan?.componentStock.length ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">No component stock declared for this period yet.</TableCell>
                      </TableRow>
                    ) : (
                      todayPlan.componentStock.map((extra) => (
                        <TableRow key={extra.id}>
                          <TableCell className="font-medium">{extra.componentName ?? extra.name ?? "—"}</TableCell>
                          <TableCell>{formatZarCurrency(extra.extraPrice)}</TableCell>
                          <TableCell><StatusBadge status={extra.status} /></TableCell>
                          <TableCell>{extra.bufferQuantity}</TableCell>
                          <TableCell>{renderActualCell(`stock-${extra.id}`, extra, extra.actualQuantity, extra.bufferQuantity, "stock")}</TableCell>
                          <TableCell>{extra.sold}</TableCell>
                          <TableCell>
                            {extra.status !== "READY" ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <>
                                <span className={extra.bufferRemaining === 0 ? "text-destructive font-medium" : ""}>{extra.bufferRemaining}</span>
                                {extra.bufferRemaining === 0 && <span className="ml-2 text-xs text-destructive">sold out</span>}
                              </>
                            )}
                          </TableCell>
                          <TableCell>{renderPlanActions("stock", extra, extra.componentName ?? extra.name ?? "This extra")}</TableCell>
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
          <DialogContent className="flex max-h-[85vh] max-w-5xl flex-col">
            <DialogHeader>
              <DialogTitle>Review Ingredient Requirements</DialogTitle>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-2 pr-1">
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

              {uncoveredItems.length > 0 && (
                <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                  <p className="font-medium">
                    {uncoveredItems.length} planned item{uncoveredItems.length === 1 ? "" : "s"} will request no ingredients
                  </p>
                  <ul className="mt-2 space-y-2">
                    {uncoveredItems.map((item) => (
                      <li key={`${item.type}-${item.planItemId}`} className="flex flex-wrap items-start justify-between gap-2">
                        <span className="min-w-0 flex-1">
                          <span className="mr-1.5 rounded border border-amber-300 px-1 text-[10px] font-semibold uppercase">
                            {item.type === "MEAL" ? "Meal" : "Extra"}
                          </span>
                          {describeUncovered(item)}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0"
                          onClick={() => askRemove({ kind: item.type === "MEAL" ? "option" : "stock", id: item.planItemId, name: item.name })}
                        >
                          Remove from plan
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-amber-800">
                    If that&apos;s not intended, fix the recipes in the{" "}
                    <Link href="/catalog" className="font-medium underline underline-offset-2">
                      menu catalog
                    </Link>{" "}
                    and review again, or remove the item from today&apos;s plan. Bought-in items such as bread rolls have no recipe on
                    purpose.
                  </p>
                  <div className="mt-3 flex items-start gap-2">
                    <Checkbox
                      id="acknowledge-uncovered"
                      checked={uncoveredAcknowledged}
                      onCheckedChange={(checked) => {
                        setUncoveredAcknowledged(checked === true)
                        setConfirmRequirementsError(null)
                      }}
                      className="mt-0.5"
                    />
                    <Label htmlFor="acknowledge-uncovered" className="text-sm font-medium leading-snug">
                      I understand these items won&apos;t request any ingredients
                    </Label>
                  </div>
                </div>
              )}

              {requirementsError && <p className="text-sm text-destructive">{requirementsError}</p>}
              {confirmRequirementsError && <p className="text-sm text-destructive">{confirmRequirementsError}</p>}

              {requirementsLoading ? (
                <p className="text-sm text-muted-foreground animate-pulse">Loading ingredient requirements…</p>
              ) : requirementRowsWithState.length === 0 ? (
                uncoveredItems.length > 0 ? null : (
                <div className="rounded-md border bg-muted/40 px-4 py-6 text-sm text-muted-foreground">No unreviewed ingredient requirements remain for this date and period.</div>
                )
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
                      <TableRow key={row.ingredientId} className={row.isKitchenLow ? "bg-amber-50" : row.isEdited ? "bg-blue-50" : ""}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell>{row.unit}</TableCell>
                        <TableCell>{row.calculatedQuantity}</TableCell>
                        <TableCell>
                          <Input type="number" min="0" step="0.0001" value={row.editedQuantity} onChange={(event) => updateRequirementQuantity(row.ingredientId, event.target.value)} className={row.isEdited ? "border-blue-400 bg-blue-50" : ""} />
                        </TableCell>
                        <TableCell>
                          <span className={row.isKitchenLow ? "font-medium text-amber-800" : ""}>{row.kitchenStock}</span>
                          {row.isKitchenLow && (
                            <p className="mt-1 text-xs text-amber-700">
                              Kitchen stock low — an issue request from Main Store to Kitchen will be raised automatically.
                            </p>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setRequirementsDialogOpen(false)}>Close</Button>
                <Button
                  type="button"
                  onClick={() => void confirmIngredientRequirements()}
                  disabled={
                    confirmingRequirements ||
                    (requirementRowsWithState.length === 0 && uncoveredItems.length === 0) ||
                    (uncoveredItems.length > 0 && !uncoveredAcknowledged)
                  }
                >
                  {confirmingRequirements ? "Confirming…" : "Confirm Ingredient Requirements"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={editTarget !== null} onOpenChange={(open) => !open && !editSaving && setEditTarget(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit {editTarget?.name}</DialogTitle>
              <DialogDescription>
                Changing the {editTarget?.kind === "option" ? "meal" : "component"} takes its name and price from the catalog. Changing only the
                quantity keeps the planned price.
              </DialogDescription>
            </DialogHeader>
            {editTarget && (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  void saveEdit()
                }}
              >
                <div className="space-y-1">
                  <Label>{editTarget.kind === "option" ? "Meal" : "Component"}</Label>
                  <Select
                    value={editTarget.catalogId}
                    onValueChange={(value) => setEditTarget((current) => (current ? { ...current, catalogId: value } : current))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={editTarget.kind === "option" ? "Select a meal…" : "Select a component…"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(editTarget.kind === "option" ? mealCatalog : componentCatalog)
                        .filter((entry) => entry.active || String(entry.id) === editTarget.catalogId)
                        .map((entry) => (
                          <SelectItem key={entry.id} value={String(entry.id)}>
                            {entry.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-plan-quantity">{editTarget.kind === "option" ? "Planned portions" : "Buffer quantity"}</Label>
                  <Input
                    id="edit-plan-quantity"
                    type="number"
                    min="1"
                    step="1"
                    value={editTarget.quantity}
                    onChange={(event) => {
                      const value = event.target.value
                      setEditTarget((current) => (current ? { ...current, quantity: value } : current))
                    }}
                    required
                  />
                </div>
                {editError && <p role="alert" className="text-sm text-destructive">{editError}</p>}
                <DialogFooter className="gap-2 sm:gap-0">
                  <Button type="button" variant="outline" disabled={editSaving} onClick={() => setEditTarget(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={editSaving}>
                    {editSaving ? "Saving…" : "Save changes"}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={removeTarget !== null} onOpenChange={(open) => !open && !removing && setRemoveTarget(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Remove {removeTarget?.name}?</DialogTitle>
              <DialogDescription>
                It will be taken off {selectedPeriod?.name ?? "this period"}&apos;s plan for today. This can&apos;t be undone; add it again if you need it.
              </DialogDescription>
            </DialogHeader>
            {removeError && <p role="alert" className="text-sm text-destructive">{removeError}</p>}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" disabled={removing} onClick={() => setRemoveTarget(null)}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" disabled={removing} onClick={() => void confirmRemove()}>
                {removing ? "Removing…" : "Remove"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SidebarInset>
    </SidebarProvider>
  )
}
