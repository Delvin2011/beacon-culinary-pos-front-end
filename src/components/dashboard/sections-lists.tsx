"use client"

import { useCallback, useRef, useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { toast } from "@/hooks/use-toast"
import { useDashboardContext, useDashboardSection } from "@/hooks/use-dashboard-section"
import { RequestStockDialog } from "@/components/catalog/request-stock-dialog"
import { StockReviewPanel, type StockReviewMeal } from "@/components/catalog/stock-review-panel"
import {
  TOP_SELLER_TAGS,
  formatCount,
  formatPercent,
  formatRand,
  type DashboardRange,
  type LayoutSection,
  type LightMealStockData,
  type LightMealStockRow,
  type SellThroughData,
  type TopSellersData,
  type TopSellersSort,
} from "@/lib/dashboard"
import { fetchStockReview, type StockReview } from "@/lib/light-meal-stock"
import { canRequestIssue, canReviewMealStock } from "@/lib/roles"
import { cn } from "@/lib/utils"
import { Chip, EmptyText, ReportLinkButton, ScaledBar, SectionCard, type ChipTone } from "./dashboard-ui"

const TAG_TONE: Record<string, ChipTone> = { SET_MEAL: "neutral", LIGHT_MEAL: "amber", BEVERAGE: "teal", EXTRA: "blue" }

const toggleButton = (pressed: boolean) =>
  cn(
    "min-h-[44px] rounded-[7px] px-3.5 text-[13px] transition-colors",
    pressed ? "bg-white font-bold text-[#172033] shadow-sm" : "font-semibold text-[#3B4457] hover:text-[#172033]",
  )

// ---- What sells ----

export function TopSellersSection({ section, range }: { section: LayoutSection; range?: DashboardRange }) {
  const [sortBy, setSortBy] = useState<TopSellersSort>("PORTIONS")
  // The toggle is offered only once the server has shown sold values (users who can't see money never get them,
  // and sortBy=VALUE is refused for them). Kept while the range changes.
  const [valuesVisible, setValuesVisible] = useState(false)
  const state = useDashboardSection<TopSellersData>(section, {
    params: { range, sortBy: sortBy === "VALUE" ? "VALUE" : undefined },
    onForbidden: () => {
      if (sortBy !== "VALUE") return false
      setSortBy("PORTIONS")
      setValuesVisible(false)
      return true
    },
  })

  const data = state.envelope?.data
  const hasValues = !!data?.items.some((item) => item.soldValue !== undefined)
  if (hasValues && !valuesVisible) setValuesVisible(true)
  const showToggle = valuesVisible && (hasValues || (data?.items.length ?? 0) === 0)

  const toggle = showToggle ? (
    <div role="group" aria-label="Rank what sells" className="flex gap-1 rounded-[10px] border border-[#E3E6EB] bg-[#F5F6F8] p-1">
      <button type="button" aria-pressed={sortBy === "PORTIONS"} className={toggleButton(sortBy === "PORTIONS")} onClick={() => setSortBy("PORTIONS")}>
        By portions
      </button>
      <button type="button" aria-pressed={sortBy === "VALUE"} className={toggleButton(sortBy === "VALUE")} onClick={() => setSortBy("VALUE")}>
        By value
      </button>
    </div>
  ) : undefined

  return (
    <SectionCard section={section} state={state} headerExtra={toggle} subtitle={hasValues ? "Sold value is before discounts" : undefined}>
      {({ data, reportLink }) => {
        const byValue = data.sortBy === "VALUE"
        const measure = (item: TopSellersData["items"][number]) => (byValue ? item.soldValue ?? 0 : item.portions)
        const max = data.items.reduce((largest, item) => Math.max(largest, measure(item)), 0)
        return (
          <>
            {data.items.length === 0 ? (
              <EmptyText>Nothing sold in this range</EmptyText>
            ) : (
              <ol>
                {data.items.map((item) => (
                  <li key={`${item.rank}-${item.name}`} className="border-t border-[#EEF0F4] py-3 last:pb-0">
                    <div className="mb-1.5 flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm">
                      <span>
                        <span className="mr-2 text-[#5B6475]">{item.rank}</span>
                        <b>{item.name}</b>{" "}
                        <Chip tone={TAG_TONE[item.tag] ?? "neutral"} className="ml-1.5 align-middle font-semibold">
                          {TOP_SELLER_TAGS[item.tag] ?? item.tag}
                        </Chip>
                      </span>
                      <span>
                        <b>{formatCount(item.portions)}</b> portions
                        {item.soldValue !== undefined && (
                          <span title="Sold value (before discounts)">
                            {" "}
                            · <span className="sr-only">sold value before discounts </span>
                            {formatRand(item.soldValue)}
                          </span>
                        )}
                      </span>
                    </div>
                    <ScaledBar value={measure(item)} max={max} />
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-1.5">
              <ReportLinkButton link={reportLink} label="View Meal & Extras Sales" />
            </div>
          </>
        )
      }}
    </SectionCard>
  )
}

// ---- Planned meals: sell-through ----

export function SellThroughSection({ section }: { section: LayoutSection }) {
  const state = useDashboardSection<SellThroughData>(section, { params: {} })

  return (
    <SectionCard section={section} state={state} subtitle="Sold as a share of the planned portions.">
      {({ data, reportLink }) =>
        data.rows.length === 0 ? (
          <EmptyText>No set meals planned today</EmptyText>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-[13px] text-[#5B6475]">
                    <th scope="col" className="px-1.5 py-2 font-semibold">Meal</th>
                    <th scope="col" className="px-1.5 py-2 text-right font-semibold">Planned</th>
                    <th scope="col" className="px-1.5 py-2 text-right font-semibold">Sold</th>
                    <th scope="col" className="px-1.5 py-2 text-right font-semibold">Sell-through</th>
                    <th scope="col" className="px-1.5 py-2 text-right font-semibold">Sold out at</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.name} className="border-t border-[#EEF0F4]">
                      <td className="px-1.5 py-3 font-semibold">{row.name}</td>
                      <td className="px-1.5 py-3 text-right">{formatCount(row.planned)}</td>
                      <td className="px-1.5 py-3 text-right">{formatCount(row.sold)}</td>
                      <td className="px-1.5 py-3 text-right">
                        {row.sellThroughPercent === null ? (
                          <span className="text-[#5B6475]">–</span>
                        ) : (
                          <Chip tone={row.slow ? "amber" : row.soldOutAt ? "teal" : "neutral"}>
                            {formatPercent(row.sellThroughPercent)}
                            {row.slow && " · slow"}
                          </Chip>
                        )}
                      </td>
                      <td className="px-1.5 py-3 text-right">{row.soldOutAt ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[13px] text-[#5B6475]">
              Slow: under {formatPercent(data.thresholdPercent)} sold after {data.afterTime}.
            </p>
            <p className="mt-1 text-[13px] text-[#5B6475]">Light meals and beverages are always available, so they have no planned portions.</p>
            <ReportLinkButton link={reportLink} label="View report" />
          </>
        )
      }
    </SectionCard>
  )
}

// ---- Light meals: kitchen stock ----

const STOCK_CHIP: Record<string, { tone: ChipTone; label: string }> = {
  OUT: { tone: "red", label: "Out" },
  LOW: { tone: "amber", label: "Low" },
  OK: { tone: "teal", label: "OK" },
}

const outlineButton =
  "inline-flex min-h-[44px] items-center rounded-lg border border-[#C9D3EC] bg-white px-3.5 text-[13px] font-semibold text-[#1B3FA8] hover:bg-[#F5F7FD] disabled:opacity-60"
const solidButton =
  "inline-flex min-h-[44px] items-center rounded-lg bg-[#2455D6] px-3.5 text-[13px] font-semibold text-white hover:bg-[#1B3FA8] disabled:opacity-60"

export function LightMealStockSection({ section }: { section: LayoutSection }) {
  const { authFetch, user } = useAuth()
  const { requestRefresh } = useDashboardContext()
  const state = useDashboardSection<LightMealStockData>(section, { params: {} })
  // Until U2 these follow the light meal stock stage's role checks; the server still decides who gets the section.
  const canReview = canReviewMealStock(user?.role)
  const canRequest = canRequestIssue(user?.role)

  const [reviewMeal, setReviewMeal] = useState<StockReviewMeal | null>(null)
  const [requestReview, setRequestReview] = useState<StockReview | null>(null)
  const [requestOpen, setRequestOpen] = useState(false)
  const [loadingRequestFor, setLoadingRequestFor] = useState<number | null>(null)
  const requestSeq = useRef(0)

  const refreshAfterRequest = useCallback(() => requestRefresh(["light-meal-stock", "attention"]), [requestRefresh])

  // Request stock opens the existing Request dialog, which works from the meal's stock review.
  const openRequest = async (meal: LightMealStockRow) => {
    const seq = ++requestSeq.current
    setLoadingRequestFor(meal.mealId)
    try {
      const review = await fetchStockReview(authFetch, meal.mealId)
      if (seq !== requestSeq.current) return
      if (!review.tracked || review.lines.length === 0) {
        toast({ title: "Nothing to request", description: `${meal.name} has no recipe ingredients to request.` })
        return
      }
      setRequestReview(review)
      setRequestOpen(true)
    } catch (err) {
      toast({
        title: "Couldn't open the request",
        description: err instanceof Error ? err.message : "Unable to load the stock review.",
        variant: "destructive",
      })
    } finally {
      if (seq === requestSeq.current) setLoadingRequestFor(null)
    }
  }

  return (
    <SectionCard section={section} state={state} subtitle="How many units the Kitchen can make with the ingredients it holds now.">
      {({ data }) =>
        data.meals.length === 0 ? (
          <EmptyText>No light meals with a recipe to track</EmptyText>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-[13px] text-[#5B6475]">
                    <th scope="col" className="px-1.5 py-2 font-semibold">Meal</th>
                    <th scope="col" className="px-1.5 py-2 font-semibold">Status</th>
                    <th scope="col" className="px-1.5 py-2 text-right font-semibold">Units available</th>
                    <th scope="col" className="px-1.5 py-2 font-semibold">Limited by</th>
                    {(canReview || canRequest) && (
                      <th scope="col" className="px-1.5 py-2">
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.meals.map((meal) => {
                    const chip = STOCK_CHIP[meal.status] ?? { tone: "neutral" as ChipTone, label: meal.status }
                    const needsStock = meal.status === "OUT" || meal.status === "LOW"
                    return (
                      <tr key={meal.mealId} className="border-t border-[#EEF0F4]">
                        <td className="px-1.5 py-2 font-semibold">
                          {meal.name}
                          {meal.outToday && <span className="ml-2 text-xs font-normal text-[#5B6475]">marked out today</span>}
                        </td>
                        <td className="px-1.5 py-2">
                          <Chip tone={chip.tone}>{chip.label}</Chip>
                        </td>
                        <td className="px-1.5 py-2 text-right font-bold">{meal.unitsAvailable === null ? "–" : formatCount(meal.unitsAvailable)}</td>
                        <td className="px-1.5 py-2 text-[#3B4457]">{meal.limitingIngredient ?? ""}</td>
                        {(canReview || canRequest) && (
                          <td className="whitespace-nowrap px-1.5 py-2 text-right">
                            <span className="inline-flex gap-2">
                              {canReview && (
                                <button type="button" className={outlineButton} onClick={() => setReviewMeal({ id: meal.mealId, name: meal.name })}>
                                  Review<span className="sr-only"> {meal.name}</span>
                                </button>
                              )}
                              {canRequest && (
                                <button
                                  type="button"
                                  className={needsStock ? solidButton : outlineButton}
                                  disabled={loadingRequestFor === meal.mealId}
                                  onClick={() => void openRequest(meal)}
                                >
                                  {loadingRequestFor === meal.mealId ? "Opening…" : "Request stock"}
                                  <span className="sr-only"> for {meal.name}</span>
                                </button>
                              )}
                            </span>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {data.moreCount > 0 && <p className="mt-3 text-[13px] text-[#5B6475]">and {formatCount(data.moreCount)} more</p>}

            <StockReviewPanel
              meal={reviewMeal}
              onOpenChange={(open) => {
                if (open) return
                setReviewMeal(null)
                // The panel can mark a meal out today: bring the card up to date.
                requestRefresh(["light-meal-stock"])
              }}
              onStockChange={() => undefined}
              onRequestSent={refreshAfterRequest}
            />
            {requestReview && (
              <RequestStockDialog
                open={requestOpen}
                onOpenChange={(open) => {
                  setRequestOpen(open)
                  if (!open) setRequestReview(null)
                }}
                review={requestReview}
                onSubmitted={refreshAfterRequest}
              />
            )}
          </>
        )
      }
    </SectionCard>
  )
}
