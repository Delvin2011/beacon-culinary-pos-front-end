"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { ArrowUpDown } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { canEditCatalog, canManageMenu, canReviewMealStock } from "@/lib/roles"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CategoriesDialog } from "@/components/catalog/categories-dialog"
import { OutTodaySwitch } from "@/components/catalog/out-today-switch"
import { StockStatusChip } from "@/components/catalog/stock-status-chip"
import { type StockReviewMeal, type StockRowPatch, StockReviewPanel } from "@/components/catalog/stock-review-panel"
import { toast } from "@/hooks/use-toast"
import {
  type Availability,
  type CatalogGroup,
  type CategoryNode,
  type CategoryRef,
  type Station,
  availabilityForGroup,
  availabilityLabel,
  canToggleOutToday,
  flattenCategories,
  isSelectableCategory,
  parseApiError,
} from "@/lib/catalog"
import { DEFAULT_LOW_STOCK_UNITS, MAX_LOW_STOCK_UNITS, type StockStatus, parseLowStockUnits } from "@/lib/light-meal-stock"
import { cn, formatZarCurrency } from "@/lib/utils"

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
  componentIds?: number[]
  components?: { id: number; name: string }[]
  category?: CategoryRef | null
  group?: CatalogGroup
  availability?: Availability
  station?: Station
  // Always-available items only; clears itself at midnight.
  outToday?: boolean
  // Light meals: warn when the Kitchen can make fewer than this many.
  lowStockUnits?: number
  // null on set meals; NOT_TRACKED for beverages and light meals with no recipe.
  stockStatus?: StockStatus | null
  // null unless the meal is tracked.
  unitsAvailable?: number | null
}

type MealGroupFilter = "ALL" | "SET_MEALS" | "LIGHT_MEALS"

interface IngredientEntry {
  id: number
  name: string
  unit: "KG" | "LITRE" | "EACH"
  active: boolean
}

interface RecipeLineDto {
  ingredientId: number
  ingredientName: string
  unit: "KG" | "LITRE" | "EACH"
  quantity: number
}

interface RecipeDto {
  componentCatalogId: number
  batchSize: number
  lines: RecipeLineDto[]
}

type RecipeSummary =
  | { status: "none" }
  | { status: "configured"; batchSize: number; lineCount: number }
  | { status: "error" }

type ComponentTableRow = {
  id: number
  name: string
  extraPrice: number
  recipeLabel: string
  active: boolean
  component: ComponentEntry
}

type MealTableRow = {
  id: number
  name: string
  description: string
  categoryName: string
  price: number
  linkedNames: string
  active: boolean
  meal: MealEntry
}

type RecipeDraftLine = {
  id: string
  ingredientId: string
  quantity: string
}

interface BulkComponentImportResultDto {
  componentsCreated: number
  componentsUpdated: number
  ingredientsCreated: number
  ingredientsUpdated: number
}

type Tab = "components" | "meals" | "beverages"

// Beverages are made at the bar, or handed over at the counter with no preparation.
const PREPARED_BY_OPTIONS: Array<{ value: Extract<Station, "BAR" | "NONE">; label: string }> = [
  { value: "BAR", label: "Bar" },
  { value: "NONE", label: "Counter (no preparation)" },
]

// Same default as the server: Counter for "Cold beverages", Bar for any other beverage category.
function defaultStationFor(categoryName: string | undefined): "BAR" | "NONE" {
  return categoryName?.trim().toLowerCase() === "cold beverages" ? "NONE" : "BAR"
}

const BULK_COMPONENT_HEADERS = ["COMPONENT", "INGREDIENT (NAME)", "UNIT", "COUNT SHEET", "Quantities", "Batch Size", "Per Portion Price (R)"] as const

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

function parseCsvHeaderLine(line: string): string[] {
  const columns: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      const next = line[i + 1]
      if (inQuotes && next === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if ((char === "," || char === "\t") && !inQuotes) {
      columns.push(current.trim())
      current = ""
      continue
    }

    current += char
  }

  columns.push(current.trim())
  return columns
}

function normalizeCsvHeader(header: string): string {
  return header.trim().replace(/\s+/g, " ").toUpperCase()
}

export default function CatalogPage() {
  const router = useRouter()
  const { isAuthenticated, isLoading: authLoading, user, authFetch } = useAuth()
  // Head Chefs can view the catalog and recipes but not change them.
  const readOnly = !canEditCatalog(user?.role)

  const [activeTab, setActiveTab] = useState<Tab>("components")

  const [components, setComponents] = useState<ComponentEntry[]>([])
  const [componentsLoading, setComponentsLoading] = useState(true)
  const [componentDialogOpen, setComponentDialogOpen] = useState(false)
  const [editingComponent, setEditingComponent] = useState<ComponentEntry | null>(null)
  const [componentForm, setComponentForm] = useState({ name: "", extraPrice: "", active: true })
  const [componentSaving, setComponentSaving] = useState(false)
  const [componentError, setComponentError] = useState<string | null>(null)
  const [componentSearch, setComponentSearch] = useState("")
  const [componentSorting, setComponentSorting] = useState<SortingState>([])
  const [componentColumnFilters, setComponentColumnFilters] = useState<ColumnFiltersState>([])

  const [ingredients, setIngredients] = useState<IngredientEntry[]>([])
  const [recipeSummaryByComponentId, setRecipeSummaryByComponentId] = useState<Record<number, RecipeSummary>>({})
  const [recipeDialogOpen, setRecipeDialogOpen] = useState(false)
  const [recipeLoading, setRecipeLoading] = useState(false)
  const [recipeSaving, setRecipeSaving] = useState(false)
  const [recipeError, setRecipeError] = useState<string | null>(null)
  const [recipeComponent, setRecipeComponent] = useState<ComponentEntry | null>(null)
  const [recipeBatchSize, setRecipeBatchSize] = useState("")
  const [recipeLines, setRecipeLines] = useState<RecipeDraftLine[]>([])

  const [bulkImportDialogOpen, setBulkImportDialogOpen] = useState(false)
  const [bulkImportFile, setBulkImportFile] = useState<File | null>(null)
  const [bulkImportError, setBulkImportError] = useState<string | null>(null)
  const [bulkImportResult, setBulkImportResult] = useState<BulkComponentImportResultDto | null>(null)
  const [bulkImportUploading, setBulkImportUploading] = useState(false)

  const [meals, setMeals] = useState<MealEntry[]>([])
  const [mealsLoading, setMealsLoading] = useState(true)
  const [mealDialogOpen, setMealDialogOpen] = useState(false)
  const [editingMeal, setEditingMeal] = useState<MealEntry | null>(null)
  const [mealForm, setMealForm] = useState({ name: "", description: "", price: "", categoryId: "", componentIds: [] as number[], active: true, lowStockUnits: String(DEFAULT_LOW_STOCK_UNITS) })
  const [mealSaving, setMealSaving] = useState(false)
  const [mealError, setMealError] = useState<string | null>(null)
  const [mealSearch, setMealSearch] = useState("")
  const [mealSorting, setMealSorting] = useState<SortingState>([])
  const [mealColumnFilters, setMealColumnFilters] = useState<ColumnFiltersState>([])
  const [mealGroupFilter, setMealGroupFilter] = useState<MealGroupFilter>("ALL")
  const [mealCategoryFilter, setMealCategoryFilter] = useState("all")

  // The light meal whose stock Review panel is open.
  const [reviewMeal, setReviewMeal] = useState<StockReviewMeal | null>(null)

  const [categories, setCategories] = useState<CategoryNode[]>([])
  const [categoriesDialogOpen, setCategoriesDialogOpen] = useState(false)

  const [beverageCategoryFilter, setBeverageCategoryFilter] = useState("all")
  const [beverageDialogOpen, setBeverageDialogOpen] = useState(false)
  const [editingBeverage, setEditingBeverage] = useState<MealEntry | null>(null)
  const [beverageForm, setBeverageForm] = useState({ name: "", price: "", categoryId: "", station: "BAR" as "BAR" | "NONE", active: true })
  const [beverageSaving, setBeverageSaving] = useState(false)
  const [beverageError, setBeverageError] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated) { router.replace("/login"); return }
    if (!canManageMenu(user?.role)) router.replace("/dashboard")
  }, [authLoading, isAuthenticated, user, router])

  const fetchIngredients = useCallback(async () => {
    try {
      const res = await authFetch("/admin/ingredients")
      if (res.ok) setIngredients((await res.json()) as IngredientEntry[])
    } catch {
      setIngredients([])
    }
  }, [authFetch])

  const fetchRecipeSummaries = useCallback(async (nextComponents: ComponentEntry[]) => {
    const entries = await Promise.all(
      nextComponents.map(async (component) => {
        try {
          const res = await authFetch(`/admin/components/${component.id}/recipe`)
          if (res.status === 404) return [component.id, { status: "none" } as RecipeSummary] as const
          const body = (await res.json().catch(() => null)) as RecipeDto | null
          if (!res.ok || !body) return [component.id, { status: "error" } as RecipeSummary] as const
          return [component.id, { status: "configured", batchSize: body.batchSize, lineCount: Array.isArray(body.lines) ? body.lines.length : 0 } as RecipeSummary] as const
        } catch {
          return [component.id, { status: "error" } as RecipeSummary] as const
        }
      }),
    )
    setRecipeSummaryByComponentId(Object.fromEntries(entries))
  }, [authFetch])

  const fetchComponents = useCallback(async () => {
    setComponentsLoading(true)
    try {
      const res = await authFetch("/admin/component-catalog")
      if (res.ok) {
        const nextComponents = (await res.json()) as ComponentEntry[]
        setComponents(nextComponents)
        await fetchRecipeSummaries(nextComponents)
      }
    } catch {
      setComponents([])
      setRecipeSummaryByComponentId({})
    } finally {
      setComponentsLoading(false)
    }
  }, [authFetch, fetchRecipeSummaries])

  const fetchMeals = useCallback(async () => {
    setMealsLoading(true)
    try {
      const res = await authFetch("/admin/meal-catalog")
      if (res.ok) setMeals((await res.json()) as MealEntry[])
    } catch {
      setMeals([])
    } finally {
      setMealsLoading(false)
    }
  }, [authFetch])

  const fetchCategories = useCallback(async () => {
    try {
      const res = await authFetch("/admin/catalog/categories")
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as unknown
        setCategories(Array.isArray(body) ? (body as CategoryNode[]) : [])
      }
    } catch {
      setCategories([])
    }
  }, [authFetch])

  useEffect(() => {
    if (isAuthenticated && canManageMenu(user?.role)) {
      void fetchComponents()
      void fetchMeals()
      void fetchIngredients()
      void fetchCategories()
    }
  }, [isAuthenticated, user, fetchComponents, fetchMeals, fetchIngredients, fetchCategories])

  // Every category node with its group, for lookups by id.
  const categoryById = useMemo(
    () => new Map(flattenCategories(categories).map((node) => [node.id, node])),
    [categories],
  )
  // Meal form and filter: set meals and light meals only (beverages have their own tab).
  const mealCategoryGroups = useMemo(
    () => [...categories].filter((node) => node.group !== "BEVERAGES").sort((a, b) => a.sortOrder - b.sortOrder),
    [categories],
  )
  const selectedMealCategory = mealForm.categoryId ? categoryById.get(Number(mealForm.categoryId)) : undefined
  // Before saving, availability follows the chosen category's group; after saving, the server's value.
  const mealFormAvailability: Availability | null = selectedMealCategory
    ? availabilityForGroup(selectedMealCategory.group)
    : editingMeal?.availability ?? null
  const mealFormIsLightMeal = (selectedMealCategory?.group ?? editingMeal?.group) === "LIGHT_MEALS"

  const updateMealInList = (updated: MealEntry) => {
    setMeals((prev) => prev.map((meal) => (meal.id === updated.id ? { ...meal, ...updated } : meal)))
  }

  // The Review panel patches the row's chip from each review it loads and from Mark out today.
  const patchMealStock = useCallback((mealId: number, patch: StockRowPatch) => {
    setMeals((prev) => prev.map((meal) => (meal.id === mealId ? { ...meal, ...patch } : meal)))
  }, [])

  // Beverage subcategories (Hot, Cold, and any added later), for the form and the filter chips.
  const beverageCategories = useMemo(
    () =>
      flattenCategories(categories.filter((node) => node.group === "BEVERAGES")).filter((node) => node.assignable),
    [categories],
  )
  // No per-item sort order: by category, then name.
  const beverages = useMemo(
    () =>
      meals
        .filter((meal) => meal.group === "BEVERAGES")
        .filter((meal) => beverageCategoryFilter === "all" || String(meal.category?.id) === beverageCategoryFilter)
        .sort(
          (a, b) =>
            (a.category?.sortOrder ?? 0) - (b.category?.sortOrder ?? 0) ||
            (a.category?.name ?? "").localeCompare(b.category?.name ?? "") ||
            a.name.localeCompare(b.name),
        ),
    [meals, beverageCategoryFilter],
  )

  const openNewBeverage = () => {
    setEditingBeverage(null)
    const firstCategory = beverageCategories.find(isSelectableCategory)
    setBeverageForm({
      name: "",
      price: "",
      categoryId: firstCategory ? String(firstCategory.id) : "",
      station: defaultStationFor(firstCategory?.name),
      active: true,
    })
    setBeverageError(null)
    setBeverageDialogOpen(true)
  }

  const openEditBeverage = (beverage: MealEntry) => {
    setEditingBeverage(beverage)
    setBeverageForm({
      name: beverage.name,
      price: String(beverage.price),
      categoryId: beverage.category ? String(beverage.category.id) : "",
      station: beverage.station === "NONE" ? "NONE" : beverage.station === "BAR" ? "BAR" : defaultStationFor(beverage.category?.name),
      active: beverage.active,
    })
    setBeverageError(null)
    setBeverageDialogOpen(true)
  }

  const handleSaveBeverage = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!beverageForm.name.trim() || !beverageForm.price) return
    if (!beverageForm.categoryId) {
      setBeverageError("Choose a category.")
      return
    }
    setBeverageSaving(true)
    setBeverageError(null)
    try {
      // Price is VAT-inclusive, like every price. No components or recipe: beverages are sold as they are.
      const payload = {
        name: beverageForm.name.trim(),
        price: parseFloat(beverageForm.price),
        categoryId: Number(beverageForm.categoryId),
        station: beverageForm.station,
        componentIds: [] as number[],
        ...(editingBeverage ? { active: beverageForm.active } : {}),
      }
      const res = await authFetch(editingBeverage ? `/admin/meal-catalog/${editingBeverage.id}` : "/admin/meal-catalog", {
        method: editingBeverage ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as unknown
        throw new Error(parseApiError(body, "Save failed.").message)
      }
      setBeverageDialogOpen(false)
      void fetchMeals()
      void fetchCategories()
      toast({ title: editingBeverage ? "Beverage updated" : "Beverage created", description: `${payload.name} has been saved.` })
    } catch (err) {
      setBeverageError(err instanceof Error ? err.message : "Save failed.")
    } finally {
      setBeverageSaving(false)
    }
  }

  const activeIngredients = useMemo(() => ingredients.filter((ingredient) => ingredient.active), [ingredients])

  const openNewComponent = () => {
    setEditingComponent(null)
    setComponentForm({ name: "", extraPrice: "", active: true })
    setComponentError(null)
    setComponentDialogOpen(true)
  }

  const openBulkImportDialog = () => {
    setBulkImportFile(null)
    setBulkImportError(null)
    setBulkImportResult(null)
    setBulkImportDialogOpen(true)
  }

  const saveBulkImport = async (event: React.FormEvent) => {
    event.preventDefault()
    setBulkImportError(null)
    setBulkImportResult(null)

    if (!bulkImportFile) {
      setBulkImportError("Please select a CSV file.")
      return
    }

    const lowerName = bulkImportFile.name.toLowerCase()
    const isCsvMime = bulkImportFile.type.toLowerCase().includes("csv")
    if (!lowerName.endsWith(".csv") && !isCsvMime) {
      setBulkImportError("Invalid file type. Please upload a .csv file.")
      return
    }

    let content = ""
    try {
      content = await bulkImportFile.text()
    } catch {
      setBulkImportError("Unable to read the selected file.")
      return
    }

    const nonEmptyLine = content
      .replace(/^﻿/, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0)

    if (!nonEmptyLine) {
      setBulkImportError("The selected CSV file is empty.")
      return
    }

    const foundHeaders = parseCsvHeaderLine(nonEmptyLine)
    const expectedHeaders = [...BULK_COMPONENT_HEADERS]
    const normalizedFoundHeaders = foundHeaders.map(normalizeCsvHeader)
    const normalizedExpectedHeaders = expectedHeaders.map(normalizeCsvHeader)
    const hasValidHeaders =
      normalizedFoundHeaders.length === normalizedExpectedHeaders.length &&
      normalizedFoundHeaders.every((header, index) => header === normalizedExpectedHeaders[index])

    if (!hasValidHeaders) {
      setBulkImportError(`CSV header mismatch. Expected: ${expectedHeaders.join(",")}. Found: ${foundHeaders.join(",") || "(empty)"}.`)
      return
    }

    setBulkImportUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", bulkImportFile)

      const res = await authFetch("/admin/component-catalog/bulk-import", {
        method: "POST",
        body: formData,
      })
      const body = (await res.json().catch(() => null)) as BulkComponentImportResultDto | unknown
      if (!res.ok || !body || typeof body !== "object") {
        throw new Error(parseError(body, "Unable to bulk import components."))
      }

      const result = body as BulkComponentImportResultDto
      setBulkImportResult(result)
      await fetchComponents()
      void fetchIngredients()
      toast({
        title: "Bulk import completed",
        description: `${result.componentsCreated} components created, ${result.componentsUpdated} updated.`,
      })
    } catch (err) {
      setBulkImportError(err instanceof Error ? err.message : "Unable to bulk import components.")
    } finally {
      setBulkImportUploading(false)
    }
  }

  const openEditComponent = (component: ComponentEntry) => {
    setEditingComponent(component)
    setComponentForm({ name: component.name, extraPrice: String(component.extraPrice), active: component.active })
    setComponentError(null)
    setComponentDialogOpen(true)
  }

  const handleSaveComponent = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!componentForm.name.trim() || !componentForm.extraPrice) return
    setComponentSaving(true)
    setComponentError(null)
    try {
      const payload = { name: componentForm.name.trim(), extraPrice: parseFloat(componentForm.extraPrice), active: componentForm.active }
      const res = editingComponent
        ? await authFetch(`/admin/component-catalog/${editingComponent.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await authFetch("/admin/component-catalog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: payload.name, extraPrice: payload.extraPrice }),
          })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as unknown
        throw new Error(parseError(body, "Save failed."))
      }
      setComponentDialogOpen(false)
      await fetchComponents()
      void fetchMeals()
      toast({ title: editingComponent ? "Component updated" : "Component created", description: `${payload.name} has been saved.` })
    } catch (err) {
      setComponentError(err instanceof Error ? err.message : "Save failed.")
    } finally {
      setComponentSaving(false)
    }
  }

  const makeEmptyRecipeLine = (index: number): RecipeDraftLine => ({ id: `recipe-line-${Date.now()}-${index}`, ingredientId: "", quantity: "" })

  const openRecipeDialog = async (component: ComponentEntry) => {
    setRecipeComponent(component)
    setRecipeDialogOpen(true)
    setRecipeLoading(true)
    setRecipeSaving(false)
    setRecipeError(null)
    setRecipeBatchSize("")
    setRecipeLines([makeEmptyRecipeLine(0)])

    try {
      const res = await authFetch(`/admin/components/${component.id}/recipe`)
      if (res.status === 404) return
      const body = (await res.json().catch(() => null)) as RecipeDto | null
      if (!res.ok || !body) {
        throw new Error(parseError(body, "Unable to load recipe."))
      }
      setRecipeBatchSize(String(body.batchSize))
      setRecipeLines((body.lines ?? []).length > 0 ? body.lines.map((line, index) => ({ id: `recipe-line-${line.ingredientId}-${index}`, ingredientId: String(line.ingredientId), quantity: String(line.quantity) })) : [makeEmptyRecipeLine(0)])
    } catch (err) {
      setRecipeError(err instanceof Error ? err.message : "Unable to load recipe.")
    } finally {
      setRecipeLoading(false)
    }
  }

  const componentTableRows: ComponentTableRow[] = useMemo(
    () =>
      components.map((component) => {
        const recipeSummary = recipeSummaryByComponentId[component.id]
        const recipeLabel =
          recipeSummary?.status === "configured"
            ? `${recipeSummary.lineCount} lines · batch ${recipeSummary.batchSize}`
            : recipeSummary?.status === "error"
              ? "Recipe unavailable"
              : "No recipe"
        return {
          id: component.id,
          name: component.name,
          extraPrice: component.extraPrice,
          recipeLabel,
          active: component.active,
          component,
        }
      }),
    [components, recipeSummaryByComponentId],
  )

  const componentTableColumns: ColumnDef<ComponentTableRow>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Name
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: "extraPrice",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Extra Price
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => formatZarCurrency(row.original.extraPrice),
      },
      {
        accessorKey: "recipeLabel",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Recipe
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => <span className="text-sm">{row.original.recipeLabel}</span>,
      },
      {
        accessorKey: "active",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Active
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => (row.original.active ? "Yes" : "No"),
        filterFn: "equals",
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex gap-2">
            {!readOnly && (
              <Button size="sm" variant="outline" onClick={() => openEditComponent(row.original.component)}>Edit</Button>
            )}
            <Button size="sm" variant="outline" onClick={() => void openRecipeDialog(row.original.component)}>
              {readOnly ? "View Recipe" : "Recipe"}
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readOnly],
  )

  const componentTable = useReactTable({
    data: componentTableRows,
    columns: componentTableColumns,
    getRowId: (row) => String(row.id),
    state: {
      sorting: componentSorting,
      columnFilters: componentColumnFilters,
      globalFilter: componentSearch,
    },
    onSortingChange: setComponentSorting,
    onColumnFiltersChange: setComponentColumnFilters,
    onGlobalFilterChange: setComponentSearch,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const addRecipeLine = () => {
    setRecipeLines((prev) => [...prev, makeEmptyRecipeLine(prev.length)])
  }

  const updateRecipeLine = (lineId: string, field: keyof RecipeDraftLine, value: string) => {
    setRecipeLines((prev) => prev.map((line) => (line.id === lineId ? { ...line, [field]: value } : line)))
  }

  const removeRecipeLine = (lineId: string) => {
    setRecipeLines((prev) => (prev.length === 1 ? [makeEmptyRecipeLine(0)] : prev.filter((line) => line.id !== lineId)))
  }

  const saveRecipe = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!recipeComponent) return
    setRecipeSaving(true)
    setRecipeError(null)
    try {
      const batchSize = Number(recipeBatchSize)
      if (!Number.isInteger(batchSize) || batchSize <= 0) throw new Error("Batch size must be a whole number greater than zero.")
      const lines = recipeLines.filter((line) => line.ingredientId && line.quantity).map((line) => ({ ingredientId: Number(line.ingredientId), quantity: Number(line.quantity) }))
      const res = await authFetch(`/admin/components/${recipeComponent.id}/recipe`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchSize, lines }),
      })
      const body = (await res.json().catch(() => null)) as RecipeDto | unknown
      if (!res.ok || !body) {
        throw new Error(parseError(body, "Unable to save recipe."))
      }
      const savedRecipe = body as RecipeDto
      setRecipeSummaryByComponentId((prev) => ({
        ...prev,
        [recipeComponent.id]: { status: "configured", batchSize: savedRecipe.batchSize, lineCount: Array.isArray(savedRecipe.lines) ? savedRecipe.lines.length : 0 },
      }))
      setRecipeDialogOpen(false)
      toast({ title: "Recipe saved", description: `${recipeComponent.name} recipe was replaced successfully.` })
    } catch (err) {
      setRecipeError(err instanceof Error ? err.message : "Unable to save recipe.")
    } finally {
      setRecipeSaving(false)
    }
  }

  const openNewMeal = () => {
    setEditingMeal(null)
    setMealForm({ name: "", description: "", price: "", categoryId: "", componentIds: [], active: true, lowStockUnits: String(DEFAULT_LOW_STOCK_UNITS) })
    setMealError(null)
    setMealDialogOpen(true)
  }

  const openEditMeal = (meal: MealEntry) => {
    setEditingMeal(meal)
    setMealForm({
      name: meal.name,
      description: meal.description ?? "",
      price: String(meal.price),
      categoryId: meal.category ? String(meal.category.id) : "",
      componentIds: extractComponentIds(meal),
      active: meal.active,
      lowStockUnits: meal.lowStockUnits != null ? String(meal.lowStockUnits) : String(DEFAULT_LOW_STOCK_UNITS),
    })
    setMealError(null)
    setMealDialogOpen(true)
  }

  const toggleMealComponent = (id: number) => {
    setMealForm((prev) => ({
      ...prev,
      componentIds: prev.componentIds.includes(id) ? prev.componentIds.filter((componentId) => componentId !== id) : [...prev.componentIds, id],
    }))
  }

  const handleSaveMeal = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!mealForm.name.trim() || !mealForm.price) return
    if (!mealForm.categoryId) {
      setMealError("Choose a category.")
      return
    }
    // Light meals only; blank leaves it out (a PUT keeps the current value).
    const lowStockUnits = mealFormIsLightMeal ? parseLowStockUnits(mealForm.lowStockUnits) : null
    if (lowStockUnits === "invalid") {
      setMealError(`Low-stock level must be a whole number from 0 to ${MAX_LOW_STOCK_UNITS}.`)
      return
    }
    setMealSaving(true)
    setMealError(null)
    try {
      // categoryId is required on create and edit. station is never sent: set and light meals are always KITCHEN.
      const payload = {
        name: mealForm.name.trim(),
        description: mealForm.description.trim() || null,
        price: parseFloat(mealForm.price),
        categoryId: Number(mealForm.categoryId),
        componentIds: mealForm.componentIds,
        active: mealForm.active,
        ...(lowStockUnits !== null ? { lowStockUnits } : {}),
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
            body: JSON.stringify({
              name: payload.name,
              description: payload.description,
              price: payload.price,
              categoryId: payload.categoryId,
              componentIds: payload.componentIds,
              ...(lowStockUnits !== null ? { lowStockUnits } : {}),
            }),
          })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as unknown
        // MEAL_HAS_PLANNED_OPTIONS (moving a planned meal to another group) and CATEGORY_INVALID: show the server's message.
        throw new Error(parseApiError(body, "Save failed.").message)
      }
      setMealDialogOpen(false)
      void fetchMeals()
      void fetchCategories()
      toast({ title: editingMeal ? "Meal updated" : "Meal created", description: `${payload.name} has been saved.` })
    } catch (err) {
      setMealError(err instanceof Error ? err.message : "Save failed.")
    } finally {
      setMealSaving(false)
    }
  }

  // The Meals tab lists set meals and light meals; beverages are left out. Group and subcategory filter client-side.
  const mealTableRows: MealTableRow[] = useMemo(
    () =>
      meals
        .filter((meal) => meal.group !== "BEVERAGES")
        .filter((meal) => mealGroupFilter === "ALL" || meal.group === mealGroupFilter)
        .filter((meal) => mealCategoryFilter === "all" || String(meal.category?.id) === mealCategoryFilter)
        .map((meal) => {
          const linkedIds = extractComponentIds(meal)
          const linkedNames = components.filter((component) => linkedIds.includes(component.id)).map((component) => component.name).join(", ")
          return {
            id: meal.id,
            name: meal.name,
            description: meal.description ?? "",
            categoryName: meal.category?.name ?? "",
            price: meal.price,
            linkedNames,
            active: meal.active,
            meal,
          }
        }),
    [meals, components, mealGroupFilter, mealCategoryFilter],
  )

  // Subcategory filter: assignable categories in the chosen group (inactive ones too, the list includes their meals).
  const mealFilterCategories = useMemo(
    () =>
      flattenCategories(mealCategoryGroups).filter(
        (node) => node.assignable && (mealGroupFilter === "ALL" || node.group === mealGroupFilter),
      ),
    [mealCategoryGroups, mealGroupFilter],
  )

  const mealTableColumns: ColumnDef<MealTableRow>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Name
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: "description",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Description
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.description || "—"}</span>,
      },
      {
        accessorKey: "categoryName",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Category
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => <span className="text-sm">{row.original.categoryName || "—"}</span>,
      },
      {
        accessorKey: "price",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Price
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => formatZarCurrency(row.original.price),
      },
      {
        accessorKey: "linkedNames",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Components
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => <span className="text-sm">{row.original.linkedNames || "—"}</span>,
      },
      {
        id: "availability",
        header: "Availability",
        // Set meals are planned daily; always-available ones get the Out today switch (never on a set meal).
        cell: ({ row }) => {
          const meal = row.original.meal
          if (meal.availability !== "ALWAYS" || !meal.group) {
            return <span className="text-xs text-muted-foreground">{availabilityLabel("PLANNED")}</span>
          }
          return (
            <OutTodaySwitch
              mealCatalogId={meal.id}
              name={meal.name}
              outToday={Boolean(meal.outToday)}
              canToggle={canToggleOutToday(user?.role, meal.group)}
              onChange={(updated) => updateMealInList({ ...meal, ...(updated as Partial<MealEntry>) })}
            />
          )
        },
      },
      {
        id: "stock",
        header: "Stock",
        // Light meals only: set meals have planning's review, beverages aren't tracked. Chips come from the list.
        cell: ({ row }) => {
          const meal = row.original.meal
          if (meal.group !== "LIGHT_MEALS") return <span className="text-xs text-muted-foreground">—</span>
          return (
            <div className="flex items-center gap-2">
              <StockStatusChip status={meal.stockStatus} unitsAvailable={meal.unitsAvailable} />
              {canReviewMealStock(user?.role) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setReviewMeal({ id: meal.id, name: meal.name, categoryName: meal.category?.name, price: meal.price })}
                >
                  Review
                </Button>
              )}
            </div>
          )
        },
      },
      {
        accessorKey: "active",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Active
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => (row.original.active ? "Yes" : "No"),
        filterFn: "equals",
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          readOnly ? null : (
            <Button size="sm" variant="outline" onClick={() => openEditMeal(row.original.meal)}>Edit</Button>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readOnly, user?.role],
  )

  const mealTable = useReactTable({
    data: mealTableRows,
    columns: mealTableColumns,
    getRowId: (row) => String(row.id),
    state: {
      sorting: mealSorting,
      columnFilters: mealColumnFilters,
      globalFilter: mealSearch,
    },
    onSortingChange: setMealSorting,
    onColumnFiltersChange: setMealColumnFilters,
    onGlobalFilterChange: setMealSearch,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

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
                  <BreadcrumbPage>Catalog Management</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <div className="flex gap-1 border-b">
            {(["components", "meals", "beverages"] as Tab[]).map((tab) => (
              <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${activeTab === tab ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {tab}
              </button>
            ))}
          </div>

          {activeTab === "components" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Component Catalog</h2>
                  <p className="text-sm text-muted-foreground">Extra-portion items with agreed prices. Recipe setup is managed per component.</p>
                </div>
                {readOnly ? (
                  <span className="text-xs text-muted-foreground">View only</span>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={openBulkImportDialog}>Bulk Upload CSV</Button>
                    <Button size="sm" onClick={openNewComponent}>+ Add Component</Button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1 w-[220px]">
                  <Label htmlFor="component-search">Search</Label>
                  <Input
                    id="component-search"
                    value={componentSearch}
                    onChange={(event) => setComponentSearch(event.target.value)}
                    placeholder="Search components"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Active</Label>
                  <Select
                    value={
                      componentTable.getColumn("active")?.getFilterValue() === undefined
                        ? "all"
                        : String(componentTable.getColumn("active")?.getFilterValue())
                    }
                    onValueChange={(value) =>
                      componentTable.getColumn("active")?.setFilterValue(value === "all" ? undefined : value === "true")
                    }
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="true">Active</SelectItem>
                      <SelectItem value="false">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <span className="pb-2 text-sm text-muted-foreground whitespace-nowrap">
                  {componentTable.getFilteredRowModel().rows.length} of {componentTableRows.length} components
                </span>
              </div>

              {componentsLoading ? (
                <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
              ) : (
                <div className="max-h-[65vh] overflow-y-auto rounded-md border">
                  <table className="w-full caption-bottom text-sm">
                    <TableHeader>
                      {componentTable.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id} className="sticky top-0 z-10 bg-background">
                          {headerGroup.headers.map((header) => (
                            <TableHead key={header.id}>
                              {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                            </TableHead>
                          ))}
                        </TableRow>
                      ))}
                    </TableHeader>
                    <TableBody>
                      {componentTable.getRowModel().rows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={componentTableColumns.length} className="py-8 text-center text-sm text-muted-foreground">
                            No components yet — add one to get started.
                          </TableCell>
                        </TableRow>
                      ) : (
                        componentTable.getRowModel().rows.map((row) => (
                          <TableRow key={row.id}>
                            {row.getVisibleCells().map((cell) => (
                              <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                            ))}
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === "meals" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Meal Catalog</h2>
                  <p className="text-sm text-muted-foreground">Predefined meals with agreed prices. Price here is the source of truth.</p>
                </div>
                {readOnly ? (
                  <span className="text-xs text-muted-foreground">View only · you can review light meal stock and switch light meals out for today</span>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setCategoriesDialogOpen(true)}>Categories</Button>
                    <Button size="sm" onClick={openNewMeal}>+ Add Meal</Button>
                  </div>
                )}
              </div>

              {components.length === 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">No components exist yet. Add components before linking them to set meals.</div>
              )}

              <div className="flex flex-wrap gap-1" role="group" aria-label="Meal group">
                {([
                  ["ALL", "All"],
                  ["SET_MEALS", "Set meals"],
                  ["LIGHT_MEALS", "Light meals"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mealGroupFilter === value}
                    onClick={() => {
                      setMealGroupFilter(value)
                      setMealCategoryFilter("all")
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1 text-sm transition-colors",
                      mealGroupFilter === value ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label>Category</Label>
                  <Select value={mealCategoryFilter} onValueChange={setMealCategoryFilter}>
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="All categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All categories</SelectItem>
                      {mealFilterCategories.map((node) => (
                        <SelectItem key={node.id} value={String(node.id)}>
                          {node.name}{node.active ? "" : " (inactive)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 w-[220px]">
                  <Label htmlFor="meal-search">Search</Label>
                  <Input
                    id="meal-search"
                    value={mealSearch}
                    onChange={(event) => setMealSearch(event.target.value)}
                    placeholder="Search meals"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Active</Label>
                  <Select
                    value={
                      mealTable.getColumn("active")?.getFilterValue() === undefined
                        ? "all"
                        : String(mealTable.getColumn("active")?.getFilterValue())
                    }
                    onValueChange={(value) =>
                      mealTable.getColumn("active")?.setFilterValue(value === "all" ? undefined : value === "true")
                    }
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="true">Active</SelectItem>
                      <SelectItem value="false">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <span className="pb-2 text-sm text-muted-foreground whitespace-nowrap">
                  {mealTable.getFilteredRowModel().rows.length} of {mealTableRows.length} meals
                </span>
              </div>

              {mealsLoading ? (
                <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
              ) : (
                <div className="max-h-[65vh] overflow-y-auto rounded-md border">
                  <table className="w-full caption-bottom text-sm">
                    <TableHeader>
                      {mealTable.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id} className="sticky top-0 z-10 bg-background">
                          {headerGroup.headers.map((header) => (
                            <TableHead key={header.id}>
                              {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                            </TableHead>
                          ))}
                        </TableRow>
                      ))}
                    </TableHeader>
                    <TableBody>
                      {mealTable.getRowModel().rows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={mealTableColumns.length} className="py-8 text-center text-sm text-muted-foreground">
                            No meals yet — add one above.
                          </TableCell>
                        </TableRow>
                      ) : (
                        mealTable.getRowModel().rows.map((row) => (
                          <TableRow key={row.id}>
                            {row.getVisibleCells().map((cell) => (
                              <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                            ))}
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === "beverages" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Beverages</h2>
                  <p className="text-sm text-muted-foreground">Always available. Prices include VAT. Hot drinks go to the bar; cold drinks are handed over at the counter.</p>
                </div>
                {readOnly ? (
                  <span className="text-xs text-muted-foreground">View only</span>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setCategoriesDialogOpen(true)}>Categories</Button>
                    <Button size="sm" onClick={openNewBeverage} disabled={!beverageCategories.some(isSelectableCategory)}>+ Add Beverage</Button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-1" role="group" aria-label="Beverage category">
                {[{ id: "all", name: "All" }, ...beverageCategories.map((node) => ({ id: String(node.id), name: node.name }))].map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    aria-pressed={beverageCategoryFilter === chip.id}
                    onClick={() => setBeverageCategoryFilter(chip.id)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-sm transition-colors",
                      beverageCategoryFilter === chip.id ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {chip.name}
                  </button>
                ))}
              </div>

              {mealsLoading ? (
                <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
              ) : (
                <div className="max-h-[65vh] overflow-y-auto rounded-md border">
                  <table className="w-full caption-bottom text-sm">
                    <TableHeader>
                      <TableRow className="sticky top-0 z-10 bg-background">
                        <TableHead>Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Prepared by</TableHead>
                        <TableHead>Out today</TableHead>
                        <TableHead>Active</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {beverages.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                            No beverages yet{readOnly ? "." : " — add one above."}
                          </TableCell>
                        </TableRow>
                      ) : (
                        beverages.map((beverage) => (
                          <TableRow key={beverage.id}>
                            <TableCell className="font-medium">{beverage.name}</TableCell>
                            <TableCell>{beverage.category?.name ?? "—"}</TableCell>
                            <TableCell>{formatZarCurrency(beverage.price)}</TableCell>
                            <TableCell>{beverage.station === "NONE" ? "Counter" : "Bar"}</TableCell>
                            <TableCell>
                              <OutTodaySwitch
                                mealCatalogId={beverage.id}
                                name={beverage.name}
                                outToday={Boolean(beverage.outToday)}
                                canToggle={canToggleOutToday(user?.role, "BEVERAGES")}
                                onChange={(updated) => updateMealInList({ ...beverage, ...(updated as Partial<MealEntry>) })}
                              />
                            </TableCell>
                            <TableCell>{beverage.active ? "Yes" : "No"}</TableCell>
                            <TableCell>
                              {!readOnly && (
                                <Button size="sm" variant="outline" onClick={() => openEditBeverage(beverage)}>Edit</Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <Dialog open={beverageDialogOpen} onOpenChange={setBeverageDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingBeverage ? "Edit Beverage" : "New Beverage"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSaveBeverage} className="space-y-4 pt-2">
              <div className="space-y-1">
                <Label htmlFor="b-name">Name</Label>
                <Input id="b-name" value={beverageForm.name} onChange={(e) => setBeverageForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. Cappuccino" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="b-category">Category</Label>
                <Select
                  value={beverageForm.categoryId}
                  onValueChange={(value) => {
                    // Prepared by follows the category's default; the admin can still change it.
                    const node = categoryById.get(Number(value))
                    setBeverageForm((prev) => ({ ...prev, categoryId: value, station: defaultStationFor(node?.name) }))
                  }}
                >
                  <SelectTrigger id="b-category">
                    <SelectValue placeholder="Choose a category…" />
                  </SelectTrigger>
                  <SelectContent>
                    {beverageCategories
                      .filter((node) => isSelectableCategory(node) || String(node.id) === beverageForm.categoryId)
                      .map((node) => (
                        <SelectItem key={node.id} value={String(node.id)} disabled={!isSelectableCategory(node)}>
                          {node.name}{node.active ? "" : " (inactive)"}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="b-price">Price (R, incl. VAT)</Label>
                <Input id="b-price" type="number" min="0" step="0.01" value={beverageForm.price} onChange={(e) => setBeverageForm((prev) => ({ ...prev, price: e.target.value }))} placeholder="0.00" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="b-station">Prepared by</Label>
                <Select value={beverageForm.station} onValueChange={(value) => setBeverageForm((prev) => ({ ...prev, station: value as "BAR" | "NONE" }))}>
                  <SelectTrigger id="b-station">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PREPARED_BY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {beverageForm.station === "BAR" ? "Goes to the bar display to be made." : "Handed over at the till straight away; never on a display."}
                </p>
              </div>
              {editingBeverage && (
                <div className="flex items-center gap-2">
                  <Checkbox id="b-active" checked={beverageForm.active} onCheckedChange={(value) => setBeverageForm((prev) => ({ ...prev, active: Boolean(value) }))} />
                  <Label htmlFor="b-active">Active</Label>
                </div>
              )}
              {beverageError && <p className="text-sm text-destructive">{beverageError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setBeverageDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={beverageSaving}>{beverageSaving ? "Saving…" : "Save"}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={componentDialogOpen} onOpenChange={setComponentDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingComponent ? "Edit Component" : "New Component"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSaveComponent} className="space-y-4 pt-2">
              <div className="space-y-1">
                <Label htmlFor="c-name">Name</Label>
                <Input id="c-name" value={componentForm.name} onChange={(e) => setComponentForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. Chicken" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-price">Extra portion price (R)</Label>
                <Input id="c-price" type="number" min="0" step="0.01" value={componentForm.extraPrice} onChange={(e) => setComponentForm((prev) => ({ ...prev, extraPrice: e.target.value }))} placeholder="0.00" required />
              </div>
              {editingComponent && (
                <div className="flex items-center gap-2">
                  <Checkbox id="c-active" checked={componentForm.active} onCheckedChange={(value) => setComponentForm((prev) => ({ ...prev, active: Boolean(value) }))} />
                  <Label htmlFor="c-active">Active</Label>
                </div>
              )}
              {componentError && <p className="text-sm text-destructive">{componentError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setComponentDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={componentSaving}>{componentSaving ? "Saving…" : "Save"}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog
          open={bulkImportDialogOpen}
          onOpenChange={(open) => {
            setBulkImportDialogOpen(open)
            if (!open) {
              setBulkImportFile(null)
              setBulkImportError(null)
              setBulkImportResult(null)
            }
          }}
        >
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Bulk Upload Components (CSV)</DialogTitle>
            </DialogHeader>

            <form onSubmit={saveBulkImport} className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                Prepare a CSV file using the exact column order below, then upload it to import components and their recipes in bulk.
                Rows sharing the same COMPONENT are grouped into that component&apos;s recipe, which is replaced wholesale on import.
              </p>

              <div className="space-y-1">
                <Label htmlFor="bulk-component-csv">CSV file</Label>
                <Input
                  id="bulk-component-csv"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null
                    setBulkImportFile(file)
                    setBulkImportError(null)
                    setBulkImportResult(null)
                  }}
                />
                {bulkImportFile && (
                  <p className="text-xs text-muted-foreground">Selected: {bulkImportFile.name}</p>
                )}
              </div>

              <div className="rounded-md border bg-muted/40 p-3">
                <p className="mb-2 font-medium">Required header order:</p>
                <p className="font-mono text-xs">COMPONENT,INGREDIENT (NAME),UNIT,COUNT SHEET,Quantities,Batch Size,Per Portion Price (R)</p>
              </div>

              <div className="rounded-md border bg-muted/40 p-3">
                <p className="mb-2 font-medium">Sample CSV:</p>
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed">
{`COMPONENT,INGREDIENT (NAME),UNIT,COUNT SHEET,Quantities,Batch Size,Per Portion Price (R)
Beef Stew,Beef Chuck,kg,bulk,2.5,10,25
Beef Stew,Onion,kg,fveg,0.8,10,25
Beef Stew,Garlic,kg,fveg,0.1,10,25`}
                </pre>
              </div>

              <div className="rounded-md border bg-muted/40 p-3">
                <p className="mb-2 font-medium">Import rules:</p>
                <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                  <li>Comma or tab-delimited; header names are matched loosely.</li>
                  <li>Components and ingredients are upserted by name (case-insensitive) — no need to pre-create either.</li>
                  <li>Batch Size and Per Portion Price must match across every row for the same component.</li>
                  <li>The whole file is validated before anything is saved — one bad row fails the entire import.</li>
                </ul>
              </div>

              {bulkImportError && <p className="text-sm text-destructive">{bulkImportError}</p>}

              {bulkImportResult && (
                <div className="rounded-md border bg-emerald-50 p-3 text-sm text-emerald-900">
                  Imported successfully: {bulkImportResult.componentsCreated} components created, {bulkImportResult.componentsUpdated} updated
                  {" "}· {bulkImportResult.ingredientsCreated} ingredients created, {bulkImportResult.ingredientsUpdated} updated.
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setBulkImportDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={bulkImportUploading || !bulkImportFile}>
                  {bulkImportUploading ? "Importing…" : "Import CSV"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={recipeDialogOpen} onOpenChange={setRecipeDialogOpen}>
          <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
            <DialogHeader>
              <DialogTitle>Recipe · {recipeComponent?.name ?? "Component"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={saveRecipe} className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-2 pr-1">
              {readOnly && <p className="text-xs text-muted-foreground">View only. An admin can change recipes.</p>}
              <fieldset disabled={readOnly} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-[220px_1fr]">
                <div className="space-y-1">
                  <Label htmlFor="recipe-batch-size">Batch Size</Label>
                  <Input id="recipe-batch-size" type="number" min="1" step="1" value={recipeBatchSize} onChange={(event) => setRecipeBatchSize(event.target.value)} placeholder="e.g. 10" required />
                </div>
                <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">Match the paper recipe pattern exactly, for example: 10 portions → 1.5kg Rice. Saving replaces the full recipe for this component.</div>
              </div>

              {recipeLoading ? (
                <p className="text-sm text-muted-foreground animate-pulse">Loading recipe…</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Ingredient Lines</Label>
                    <Button type="button" size="sm" variant="outline" onClick={addRecipeLine}>Add Line</Button>
                  </div>

                  {recipeLines.map((line) => {
                    const ingredient = activeIngredients.find((entry) => String(entry.id) === line.ingredientId)
                    return (
                      <div key={line.id} className="grid gap-3 rounded-md border p-3 md:grid-cols-[1.3fr_0.8fr_0.4fr_auto]">
                        <Select value={line.ingredientId} onValueChange={(value) => updateRecipeLine(line.id, "ingredientId", value)}>
                          <SelectTrigger>
                            <SelectValue placeholder="Ingredient…" />
                          </SelectTrigger>
                          <SelectContent>
                            {activeIngredients.map((entry) => (
                              <SelectItem key={entry.id} value={String(entry.id)}>{entry.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(event) => updateRecipeLine(line.id, "quantity", event.target.value)} placeholder="Quantity" />
                        <div className="flex items-center text-sm text-muted-foreground">{ingredient?.unit ?? "Unit"}</div>
                        <Button type="button" variant="outline" onClick={() => removeRecipeLine(line.id)}>Remove</Button>
                      </div>
                    )
                  })}
                </div>
              )}

              </fieldset>

              {recipeError && <p className="text-sm text-destructive">{recipeError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setRecipeDialogOpen(false)}>{readOnly ? "Close" : "Cancel"}</Button>
                {!readOnly && (
                  <Button type="submit" disabled={recipeSaving || recipeLoading}>{recipeSaving ? "Saving…" : "Save Recipe"}</Button>
                )}
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={mealDialogOpen} onOpenChange={setMealDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingMeal ? "Edit Meal" : "New Meal"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSaveMeal} className="space-y-4 pt-2">
              <div className="space-y-1">
                <Label htmlFor="m-name">Name</Label>
                <Input id="m-name" value={mealForm.name} onChange={(e) => setMealForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. Potatoes & Beef" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="m-desc">Description (optional)</Label>
                <Input id="m-desc" value={mealForm.description} onChange={(e) => setMealForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="Brief description…" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="m-price">Price (R)</Label>
                <Input id="m-price" type="number" min="0" step="0.01" value={mealForm.price} onChange={(e) => setMealForm((prev) => ({ ...prev, price: e.target.value }))} placeholder="0.00" required />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="m-category">Category</Label>
                  {mealFormAvailability && (
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs font-medium",
                        mealFormAvailability === "PLANNED"
                          ? "border-sky-200 bg-sky-50 text-sky-800"
                          : "border-emerald-200 bg-emerald-50 text-emerald-800",
                      )}
                    >
                      {availabilityLabel(mealFormAvailability)}
                    </span>
                  )}
                </div>
                {/* Only assignable && active nodes are selectable: "Set meals" itself, and the subcategories under the other groups. */}
                <Select value={mealForm.categoryId} onValueChange={(value) => setMealForm((prev) => ({ ...prev, categoryId: value }))}>
                  <SelectTrigger id="m-category">
                    <SelectValue placeholder="Choose a category…" />
                  </SelectTrigger>
                  <SelectContent>
                    {mealCategoryGroups.map((group) =>
                      group.assignable ? (
                        <SelectItem key={group.id} value={String(group.id)} disabled={!group.active}>
                          {group.name}
                        </SelectItem>
                      ) : (
                        <SelectGroup key={group.id}>
                          <SelectLabel>{group.name}</SelectLabel>
                          {[...(group.children ?? [])]
                            .sort((a, b) => a.sortOrder - b.sortOrder)
                            // An inactive category stays listed (disabled) only when this meal already uses it.
                            .filter((child) => isSelectableCategory(child) || String(child.id) === mealForm.categoryId)
                            .map((child) => (
                              <SelectItem key={child.id} value={String(child.id)} disabled={!isSelectableCategory(child)} className="pl-6">
                                {child.name}{child.active ? "" : " (inactive)"}
                              </SelectItem>
                            ))}
                        </SelectGroup>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
              {mealFormAvailability === "ALWAYS" && (
                <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                  Always available: no portions or planning needed, and components are optional. Extras aren&apos;t available on this
                  meal. Create an add-on as its own meal (for example &apos;Cheese Burger&apos;).
                  {mealFormIsLightMeal && " Add components with recipes so stock can be tracked and deducted on every sale."}
                </p>
              )}
              {mealFormIsLightMeal && (
                <div className="space-y-1">
                  <Label htmlFor="m-low-stock">Low-stock level (units)</Label>
                  <Input
                    id="m-low-stock"
                    type="number"
                    min="0"
                    max={MAX_LOW_STOCK_UNITS}
                    step="1"
                    inputMode="numeric"
                    value={mealForm.lowStockUnits}
                    onChange={(e) => setMealForm((prev) => ({ ...prev, lowStockUnits: e.target.value }))}
                    className="w-32"
                  />
                  <p className="text-xs text-muted-foreground">Warn when the Kitchen can make fewer than this many.</p>
                </div>
              )}
              <div className="space-y-2">
                <Label>Components{mealFormAvailability === "ALWAYS" ? " (optional)" : ""}</Label>
                {components.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No components available — add them first.</p>
                ) : (
                  <div className="max-h-44 overflow-y-auto space-y-2 rounded-md border p-3">
                    {components.map((component) => (
                      <div key={component.id} className="flex items-center gap-2">
                        <Checkbox id={`comp-${component.id}`} checked={mealForm.componentIds.includes(component.id)} onCheckedChange={() => toggleMealComponent(component.id)} />
                        <label htmlFor={`comp-${component.id}`} className="cursor-pointer text-sm">{component.name}</label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {editingMeal && (
                <div className="flex items-center gap-2">
                  <Checkbox id="m-active" checked={mealForm.active} onCheckedChange={(value) => setMealForm((prev) => ({ ...prev, active: Boolean(value) }))} />
                  <Label htmlFor="m-active">Active</Label>
                </div>
              )}
              {mealError && <p className="text-sm text-destructive">{mealError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setMealDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={mealSaving}>{mealSaving ? "Saving…" : "Save"}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <StockReviewPanel meal={reviewMeal} onOpenChange={(open) => !open && setReviewMeal(null)} onStockChange={patchMealStock} />

        {!readOnly && (
          <CategoriesDialog
            open={categoriesDialogOpen}
            onOpenChange={setCategoriesDialogOpen}
            categories={categories}
            onChanged={fetchCategories}
          />
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}
