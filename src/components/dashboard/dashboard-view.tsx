"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/use-auth"
import { DashboardSectionContext, type DashboardSectionContextValue } from "@/hooks/use-dashboard-section"
import {
  DEFAULT_RANGE,
  RANGE_OPTIONS,
  formatJhbClock,
  formatJhbLongDate,
  laterInstant,
  layoutPath,
  parseRange,
  type DashboardLayout,
  type DashboardRange,
  type LayoutSection,
} from "@/lib/dashboard"
import { landingPathFor } from "@/lib/roles"
import { cn } from "@/lib/utils"
import { SectionError, cardClass, sectionFlex } from "./dashboard-ui"
import { AttentionSection, NowSection, TodaySection } from "./sections-overview"
import { BusyHoursSection, HeatmapSection, SalesMixSection, SalesTrendSection } from "./sections-charts"
import { LightMealStockSection, SellThroughSection, TopSellersSection } from "./sections-lists"
import { AccountCustomersSection, BasketSection, PaymentMixSection, WaitingSection } from "./sections-customers"

type SectionRenderer = (section: LayoutSection, range: DashboardRange | undefined) => ReactNode

// One renderer per section key. A key the app doesn't know yet is left out (nothing else decides what shows).
const RENDERERS: Record<string, SectionRenderer> = {
  attention: (section) => <AttentionSection section={section} />,
  now: (section) => <NowSection section={section} />,
  today: (section) => <TodaySection section={section} />,
  "sales-trend": (section, range) => <SalesTrendSection section={section} range={range} />,
  "sales-mix": (section, range) => <SalesMixSection section={section} range={range} />,
  "busy-hours": (section) => <BusyHoursSection section={section} />,
  heatmap: (section) => <HeatmapSection section={section} />,
  "top-sellers": (section, range) => <TopSellersSection section={section} range={range} />,
  "sell-through": (section) => <SellThroughSection section={section} />,
  "light-meal-stock": (section) => <LightMealStockSection section={section} />,
  "payment-mix": (section, range) => <PaymentMixSection section={section} range={range} />,
  basket: (section, range) => <BasketSection section={section} range={range} />,
  waiting: (section) => <WaitingSection section={section} />,
  "account-customers": (section, range) => <AccountCustomersSection section={section} range={range} />,
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden")
    update()
    document.addEventListener("visibilitychange", update)
    return () => document.removeEventListener("visibilitychange", update)
  }, [])
  return visible
}

type LayoutState =
  | { status: "loading" }
  | { status: "ready"; layout: DashboardLayout }
  | { status: "error"; message: string }
  | { status: "forbidden" }

export function DashboardView() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { authFetch, isAuthenticated, isLoading: authLoading, user } = useAuth()
  const visible = useDocumentVisible()

  // The range is read from the URL once, then kept in state and mirrored back to the URL (?range=). Writing it with
  // history.replaceState avoids a navigation, so only the range-aware sections reload.
  const [range, setRangeState] = useState<DashboardRange>(() => parseRange(searchParams.get("range")))

  const [layoutState, setLayoutState] = useState<LayoutState>({ status: "loading" })
  const [dropped, setDropped] = useState<Set<string>>(() => new Set())
  const [asOfByKey, setAsOfByKey] = useState<Record<string, string>>({})
  const [refreshSignals, setRefreshSignals] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.replace("/login")
  }, [authLoading, isAuthenticated, router])

  const loadLayout = useCallback(async () => {
    setLayoutState((prev) => (prev.status === "ready" ? prev : { status: "loading" }))
    try {
      const res = await authFetch(layoutPath())
      const body = (await res.json().catch(() => null)) as DashboardLayout | null
      if (res.ok && body && Array.isArray(body.sections)) {
        setDropped(new Set())
        setLayoutState({ status: "ready", layout: body })
      } else if (res.status === 403) {
        setLayoutState({ status: "forbidden" })
      } else if (res.status === 401) {
        // authFetch couldn't refresh the session; the auth effect sends the user to sign in.
        setLayoutState({ status: "error", message: "Your session has expired. Please sign in again." })
      } else {
        setLayoutState({ status: "error", message: "The dashboard couldn't be loaded." })
      }
    } catch {
      setLayoutState({ status: "error", message: "The dashboard couldn't be loaded. Check the connection." })
    }
  }, [authFetch])

  useEffect(() => {
    if (authLoading || !isAuthenticated) return
    void loadLayout()
  }, [authLoading, isAuthenticated, loadLayout])

  // Layout 403: this user has no dashboard. Send them to their landing page (unless that is the dashboard itself).
  const landing = landingPathFor(user?.role)
  useEffect(() => {
    if (layoutState.status === "forbidden" && landing !== pathname) router.replace(landing)
  }, [layoutState.status, landing, pathname, router])

  const setRange = useCallback((next: DashboardRange) => setRangeState(next), [])
  // Mirror the range to the URL. Anything other than today / 7d / month in the URL has already fallen back to 7d.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("range") === range) return
    params.set("range", range)
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`)
  }, [range])

  const dropSection = useCallback((key: string) => {
    setDropped((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
  }, [])
  const reportAsOf = useCallback((key: string, asOf: string) => {
    setAsOfByKey((prev) => (prev[key] === asOf ? prev : { ...prev, [key]: asOf }))
  }, [])
  const resetRange = useCallback(() => setRangeState(DEFAULT_RANGE), [])
  const requestRefresh = useCallback((keys: string[]) => {
    setRefreshSignals((prev) => {
      const next = { ...prev }
      for (const key of keys) next[key] = (next[key] ?? 0) + 1
      return next
    })
  }, [])

  const contextValue = useMemo<DashboardSectionContextValue>(
    () => ({ visible, refreshSignals, requestRefresh, reportAsOf, dropSection, resetRange }),
    [visible, refreshSignals, requestRefresh, reportAsOf, dropSection, resetRange],
  )

  const layout = layoutState.status === "ready" ? layoutState.layout : null
  const sections = useMemo(
    () => (layout ? layout.sections.filter((section) => !dropped.has(section.key) && RENDERERS[section.key]) : []),
    [layout, dropped],
  )
  const usesRange = sections.some((section) => section.usesRange)
  // "updated hh:mm": the latest asOf among the sections shown.
  const updatedAt = sections.reduce<string | null>((latest, section) => laterInstant(latest, asOfByKey[section.key] ?? null), null)

  if (authLoading || !isAuthenticated) return null

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0 bg-[#F5F6F8]">
        <header className="flex h-16 shrink-0 items-center gap-2 bg-[#F5F6F8] transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage>Dashboard</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <main className="flex min-w-0 flex-1 flex-col gap-5 px-4 pb-8 text-[#172033] tabular-nums sm:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[28px] font-bold leading-tight">Dashboard</h1>
              <p className="mt-1 text-sm text-[#5B6475]">
                {formatJhbLongDate(layout?.asOf ?? new Date())}
                {updatedAt && <> · updated {formatJhbClock(updatedAt)}</>}
              </p>
            </div>
            {usesRange && (
              <div className="flex flex-wrap items-center gap-2.5">
                <span id="dash-range-label" className="text-[13px] text-[#5B6475]">
                  Range for trends and top items
                </span>
                <div role="group" aria-labelledby="dash-range-label" className="flex gap-1 rounded-[10px] border border-[#E3E6EB] bg-white p-1">
                  {RANGE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={range === option.value}
                      onClick={() => range !== option.value && setRange(option.value)}
                      className={cn(
                        "min-h-[44px] rounded-[7px] px-4 text-sm font-semibold transition-colors",
                        range === option.value ? "bg-[#2455D6] text-white" : "text-[#3B4457] hover:bg-[#F5F6F8]",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {layoutState.status === "loading" || layoutState.status === "forbidden" ? (
            layoutState.status === "forbidden" && landing === pathname ? (
              <div className={cardClass}>
                <p className="text-sm text-[#5B6475]">The dashboard isn&apos;t available to you.</p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-5">
                {["attention", "now", "today", "sales-trend", "sales-mix"].map((key) => (
                  <div key={key} className={cn(cardClass, sectionFlex(key), "space-y-3")}>
                    <Skeleton className="h-4 w-1/3 bg-[#EEF0F4]" />
                    <Skeleton className="h-24 w-full bg-[#EEF0F4]" />
                  </div>
                ))}
              </div>
            )
          ) : layoutState.status === "error" ? (
            <div className={cardClass}>
              <SectionError message={layoutState.message} onRetry={() => void loadLayout()} />
            </div>
          ) : (
            <DashboardSectionContext.Provider value={contextValue}>
              {/* One flowing row: sections pair up as in the design and re-flow when one isn't sent. */}
              <div className="flex flex-wrap items-stretch gap-5">
                {sections.map((section) => (
                  <SectionSlot key={section.key} section={section} range={section.usesRange ? range : undefined} />
                ))}
              </div>
            </DashboardSectionContext.Provider>
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

function SectionSlot({ section, range }: { section: LayoutSection; range: DashboardRange | undefined }) {
  const render = RENDERERS[section.key]
  return <>{render ? render(section, range) : null}</>
}
