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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

// ── Types ─────────────────────────────────────────────────────────────────────

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
  // Backend may expose component name under either field
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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DailyPlanningPage() {
  const router = useRouter()
  const { isAuthenticated, isLoading: authLoading, user, authFetch } = useAuth()

  const [periods, setPeriods] = useState<MealPeriod[]>([])
  const [selectedPeriod, setSelectedPeriod] = useState<MealPeriod | null>(null)

  const [mealCatalog, setMealCatalog] = useState<MealCatalogEntry[]>([])
  const [componentCatalog, setComponentCatalog] = useState<ComponentCatalogEntry[]>([])

  const [todayPlan, setTodayPlan] = useState<TodayPlan | null>(null)
  const [planLoading, setPlanLoading] = useState(false)

  // Meal option form
  const [selectedMealId, setSelectedMealId] = useState("")
  const [plannedPortions, setPlannedPortions] = useState("")
  const [mealOptionSaving, setMealOptionSaving] = useState(false)
  const [mealOptionError, setMealOptionError] = useState<string | null>(null)

  // Component stock form
  const [selectedComponentId, setSelectedComponentId] = useState("")
  const [bufferQuantity, setBufferQuantity] = useState("")
  const [stockSaving, setStockSaving] = useState(false)
  const [stockError, setStockError] = useState<string | null>(null)

  // ── Role guard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated) { router.replace("/login"); return }
    if (!user?.role?.toUpperCase().includes("ADMIN")) router.replace("/dashboard")
  }, [authLoading, isAuthenticated, user, router])

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchPeriods = useCallback(async () => {
    try {
      const res = await authFetch("/meal-periods")
      if (!res.ok) return
      const data = (await res.json()) as MealPeriod[]
      setPeriods(data)
      if (data.length > 0) setSelectedPeriod(data[0])
    } catch { /* no-op */ }
  }, [authFetch])

  const fetchCatalogs = useCallback(async () => {
    try {
      const [mRes, cRes] = await Promise.all([
        authFetch("/admin/meal-catalog"),
        authFetch("/admin/component-catalog"),
      ])
      if (mRes.ok) setMealCatalog((await mRes.json()) as MealCatalogEntry[])
      if (cRes.ok) setComponentCatalog((await cRes.json()) as ComponentCatalogEntry[])
    } catch { /* no-op */ }
  }, [authFetch])

  const fetchTodayPlan = useCallback(async (period: MealPeriod) => {
    setPlanLoading(true)
    try {
      const res = await authFetch(`/menu/today?period=${period.name.toUpperCase()}`)
      if (res.ok) setTodayPlan((await res.json()) as TodayPlan)
    } catch { /* no-op */ } finally {
      setPlanLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    if (isAuthenticated && user?.role?.toUpperCase().includes("ADMIN")) {
      fetchPeriods()
      fetchCatalogs()
    }
  }, [isAuthenticated, user, fetchPeriods, fetchCatalogs])

  useEffect(() => {
    if (selectedPeriod) fetchTodayPlan(selectedPeriod)
  }, [selectedPeriod, fetchTodayPlan])

  // ── Derived values ─────────────────────────────────────────────────────────
  const selectedMeal = mealCatalog.find((m) => String(m.id) === selectedMealId)
  const selectedComponent = componentCatalog.find((c) => String(c.id) === selectedComponentId)

  // ── Form handlers ──────────────────────────────────────────────────────────
  const handleAddMealOption = async (e: React.FormEvent) => {
    e.preventDefault()
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
      fetchTodayPlan(selectedPeriod)
    } catch (err) {
      setMealOptionError(err instanceof Error ? err.message : "Failed to add meal option.")
    } finally {
      setMealOptionSaving(false)
    }
  }

  const handleAddComponentStock = async (e: React.FormEvent) => {
    e.preventDefault()
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
      fetchTodayPlan(selectedPeriod)
    } catch (err) {
      setStockError(err instanceof Error ? err.message : "Failed to add component stock.")
    } finally {
      setStockSaving(false)
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
                  <BreadcrumbPage>Daily Planning</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-6 p-4 pt-0">

          {/* ── Period toggle ──────────────────────────────────────────── */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Period:</span>
            <div className="flex gap-1 rounded-lg border p-1">
              {periods.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPeriod(p)}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                    selectedPeriod?.id === p.id
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p.name}
                  <span className="ml-1.5 text-xs opacity-60">
                    {formatPeriodTime(p.startTime)}–{formatPeriodTime(p.endTime)}
                  </span>
                </button>
              ))}
              {periods.length === 0 && (
                <span className="px-3 py-1.5 text-sm text-muted-foreground animate-pulse">
                  Loading periods…
                </span>
              )}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* ── Add Meal Option ────────────────────────────────────── */}
            <div className="space-y-4 rounded-lg border p-4">
              <div>
                <h2 className="font-semibold">Add Meal Option</h2>
                <p className="text-sm text-muted-foreground">
                  Select a catalog meal and declare portions for today.
                </p>
              </div>
              <form onSubmit={handleAddMealOption} className="space-y-3">
                <div className="space-y-1">
                  <Label>Meal</Label>
                  <Select value={selectedMealId} onValueChange={setSelectedMealId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a meal…" />
                    </SelectTrigger>
                    <SelectContent>
                      {mealCatalog
                        .filter((m) => m.active)
                        .map((m) => (
                          <SelectItem key={m.id} value={String(m.id)}>
                            {m.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Price shown read-only — never a price input on this screen */}
                {selectedMeal && (
                  <div className="rounded-md bg-muted px-3 py-2 text-sm">
                    Price: <span className="font-medium">R {selectedMeal.price.toFixed(2)}</span>
                    <span className="ml-2 text-xs text-muted-foreground">(from catalog — read only)</span>
                  </div>
                )}

                <div className="space-y-1">
                  <Label htmlFor="planned-portions">Planned portions</Label>
                  <Input
                    id="planned-portions"
                    type="number"
                    min="1"
                    step="1"
                    value={plannedPortions}
                    onChange={(e) => setPlannedPortions(e.target.value)}
                    placeholder="e.g. 50"
                    required
                  />
                </div>

                {mealOptionError && (
                  <p className="text-sm text-destructive">{mealOptionError}</p>
                )}

                <Button
                  type="submit"
                  disabled={mealOptionSaving || !selectedMealId || !plannedPortions}
                  className="w-full"
                >
                  {mealOptionSaving ? "Adding…" : "Add Meal Option"}
                </Button>
              </form>
            </div>

            {/* ── Add Component Stock ────────────────────────────────── */}
            <div className="space-y-4 rounded-lg border p-4">
              <div>
                <h2 className="font-semibold">Add Component Stock</h2>
                <p className="text-sm text-muted-foreground">
                  Declare extra-portion availability for today — independent of any specific meal.
                </p>
              </div>
              <form onSubmit={handleAddComponentStock} className="space-y-3">
                <div className="space-y-1">
                  <Label>Component</Label>
                  <Select value={selectedComponentId} onValueChange={setSelectedComponentId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a component…" />
                    </SelectTrigger>
                    <SelectContent>
                      {componentCatalog
                        .filter((c) => c.active)
                        .map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            {c.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Extra price shown read-only */}
                {selectedComponent && (
                  <div className="rounded-md bg-muted px-3 py-2 text-sm">
                    Extra price: <span className="font-medium">R {selectedComponent.extraPrice.toFixed(2)}</span>
                    <span className="ml-2 text-xs text-muted-foreground">(from catalog — read only)</span>
                  </div>
                )}

                <div className="space-y-1">
                  <Label htmlFor="buffer-qty">Buffer quantity</Label>
                  <Input
                    id="buffer-qty"
                    type="number"
                    min="1"
                    step="1"
                    value={bufferQuantity}
                    onChange={(e) => setBufferQuantity(e.target.value)}
                    placeholder="e.g. 40"
                    required
                  />
                </div>

                {stockError && (
                  <p className="text-sm text-destructive">{stockError}</p>
                )}

                <Button
                  type="submit"
                  disabled={stockSaving || !selectedComponentId || !bufferQuantity}
                  className="w-full"
                >
                  {stockSaving ? "Adding…" : "Add Component Stock"}
                </Button>
              </form>
            </div>
          </div>

          {/* ── Today's Plan ───────────────────────────────────────────── */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">
                  Today&apos;s Plan — {selectedPeriod?.name ?? "…"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {todayISO()} · Stock cannot be increased once set — plan carefully.
                </p>
              </div>
              {selectedPeriod && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fetchTodayPlan(selectedPeriod)}
                  disabled={planLoading}
                >
                  {planLoading ? "Refreshing…" : "Refresh"}
                </Button>
              )}
            </div>

            {/* Meal options */}
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Meal Options
              </h3>
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
                        <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                          No meal options planned for this period yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      todayPlan.options.map((o) => (
                        <TableRow key={o.id}>
                          <TableCell className="font-medium">{o.name}</TableCell>
                          <TableCell>R {o.price.toFixed(2)}</TableCell>
                          <TableCell>{o.plannedPortions}</TableCell>
                          <TableCell>
                            <span className={o.portionsRemaining === 0 ? "text-destructive font-medium" : ""}>
                              {o.portionsRemaining}
                            </span>
                            {o.portionsRemaining === 0 && (
                              <span className="ml-2 text-xs text-destructive">sold out</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </div>

            {/* Available extras */}
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Available Extras (component stock)
              </h3>
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
                        <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                          No component stock declared for this period yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      todayPlan.availableExtras.map((ex) => (
                        <TableRow key={ex.id}>
                          <TableCell className="font-medium">
                            {ex.componentName ?? ex.name ?? "—"}
                          </TableCell>
                          <TableCell>R {ex.extraPrice.toFixed(2)}</TableCell>
                          <TableCell>{ex.bufferQuantity}</TableCell>
                          <TableCell>
                            <span className={ex.bufferRemaining === 0 ? "text-destructive font-medium" : ""}>
                              {ex.bufferRemaining}
                            </span>
                            {ex.bufferRemaining === 0 && (
                              <span className="ml-2 text-xs text-destructive">sold out</span>
                            )}
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
      </SidebarInset>
    </SidebarProvider>
  )
}
