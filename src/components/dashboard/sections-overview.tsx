"use client"

import Link from "next/link"
import { Skeleton } from "@/components/ui/skeleton"
import { useDashboardSection } from "@/hooks/use-dashboard-section"
import {
  actionHref,
  formatCount,
  formatDelta,
  formatMinutes,
  formatRand,
  type AttentionData,
  type LayoutSection,
  type NowData,
  type Severity,
  type StationNow,
  type TodayData,
  type TodayTile,
  type Tone,
} from "@/lib/dashboard"
import { cn } from "@/lib/utils"
import { Chip, EmptyText, SectionCard, SectionError, UpdatingNote, cardClass, type ChipTone } from "./dashboard-ui"

// ---- Needs attention ----

const SEVERITY_DOT: Record<Severity, string> = {
  RED: "#B42318",
  AMBER: "#C77700",
  BLUE: "#2455D6",
  NEUTRAL: "#5B6475",
}

const SEVERITY_CHIP: Record<Severity, ChipTone> = { RED: "red", AMBER: "amber", BLUE: "blue", NEUTRAL: "neutral" }

const SEVERITY_WORD: Record<Severity, string> = { RED: "Urgent", AMBER: "Warning", BLUE: "To do", NEUTRAL: "For information" }

export function AttentionSection({ section }: { section: LayoutSection }) {
  const state = useDashboardSection<AttentionData>(section, { params: {} })
  const data = state.envelope?.data
  const total = data ? data.items.length + (data.moreCount ?? 0) : 0

  return (
    <SectionCard
      section={section}
      state={state}
      titleAdornment={
        <Chip tone={total > 0 ? "red" : "neutral"} className="rounded-full">
          <span className="sr-only">Items: </span>
          {formatCount(total)}
        </Chip>
      }
    >
      {({ data }) =>
        data.items.length === 0 ? (
          <EmptyText>Nothing needs your attention.</EmptyText>
        ) : (
          <>
            <ul>
              {data.items.map((item, index) => (
                <li key={`${item.key}-${index}`} className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-[#EEF0F4] py-3.5 last:pb-0">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 flex-none rounded-full"
                    style={{ background: SEVERITY_DOT[item.severity] ?? SEVERITY_DOT.NEUTRAL }}
                  />
                  <div className="min-w-0 flex-[1_1_280px]">
                    <div className="text-sm font-bold">
                      <span className="sr-only">{SEVERITY_WORD[item.severity] ?? ""}: </span>
                      {item.title}{" "}
                      <Chip tone={SEVERITY_CHIP[item.severity] ?? "neutral"} className="ml-1.5 align-middle">
                        {item.tag}
                      </Chip>
                    </div>
                    {item.detail && <div className="text-[13px] text-[#5B6475]">{item.detail}</div>}
                  </div>
                  {item.action && (
                    <Link
                      href={actionHref(item.action.path)}
                      className="inline-flex min-h-[44px] items-center rounded-lg border border-[#C9D3EC] px-3.5 text-[13px] font-semibold text-[#1B3FA8] hover:bg-[#F5F7FD]"
                    >
                      {item.action.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            {data.moreCount > 0 && (
              <p className="mt-3 text-[13px] text-[#5B6475]">and {formatCount(data.moreCount)} more</p>
            )}
          </>
        )
      }
    </SectionCard>
  )
}

// ---- Right now ----

function StationRow({ name, station }: { name: string; station: StationNow }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-[#EEF0F4] py-3.5">
      <div>
        <div className="text-sm font-bold">{name}</div>
        <div className="text-[13px] text-[#5B6475]">
          {formatCount(station.pending)} pending · {formatCount(station.inProgress)} in progress
        </div>
        <div className="text-[13px] text-[#5B6475]">
          {station.longestWaitMinutes === null ? "Nothing open" : `Longest wait ${formatMinutes(station.longestWaitMinutes)}`}
        </div>
      </div>
      <div className="text-[28px] font-bold">
        {formatCount(station.open)} <span className="text-[13px] font-semibold text-[#5B6475]">open</span>
      </div>
    </div>
  )
}

export function NowSection({ section }: { section: LayoutSection }) {
  const state = useDashboardSection<NowData>(section, { params: {} })

  return (
    <SectionCard section={section} state={state}>
      {({ data }) => (
        <div>
          <StationRow name="Kitchen" station={data.kitchen} />
          {data.bar && <StationRow name="Bar" station={data.bar} />}
          <div className="flex items-center justify-between gap-3 border-t border-[#EEF0F4] py-3.5">
            <div>
              <div className="text-sm font-bold">Ready to collect</div>
              <div className="text-[13px] text-[#5B6475]">
                {data.readyToCollect.oldestMinutes === null
                  ? "Nothing waiting"
                  : `Oldest waiting ${formatMinutes(data.readyToCollect.oldestMinutes)}`}
              </div>
            </div>
            <div className="text-[28px] font-bold">{formatCount(data.readyToCollect.count)}</div>
          </div>
          {/* Absent: no cash permission, so no row at all. null: no shift open. */}
          {"onTheTill" in data && data.onTheTill !== undefined && (
            <div className="border-t border-[#EEF0F4] pt-3.5">
              <div className="text-sm font-bold">On the till</div>
              {data.onTheTill === null ? (
                <div className="text-[13px] text-[#5B6475]">No shift open</div>
              ) : (
                <>
                  <div className="text-[13px] text-[#5B6475]">
                    {data.onTheTill.owner} since {data.onTheTill.since}
                  </div>
                  <div className="text-[13px] text-[#5B6475]">Expected cash {formatRand(data.onTheTill.expectedCash)}</div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  )
}

// ---- Today tiles ----

const TONE_CHIP: Record<Tone, ChipTone> = { POSITIVE: "teal", WATCH: "amber", NEUTRAL: "neutral" }

// The first three tiles compare with the same weekday last week; the others carry a description.
const COMPARISON_TILES = new Set(["netSales", "orders", "averageOrder"])

function TileCard({ tile }: { tile: TodayTile }) {
  const tone = TONE_CHIP[tile.tone] ?? "neutral"
  const comparison = COMPARISON_TILES.has(tile.key)
  return (
    <div className={cn(cardClass, "flex-[1_1_170px] p-[18px]")}>
      <div className="text-[13px] text-[#5B6475]">{tile.label}</div>
      <div className="mb-2 mt-1.5 text-[28px] font-bold">{tile.type === "MONEY" ? formatRand(tile.value) : formatCount(tile.value)}</div>
      {comparison ? (
        tile.delta === null ? (
          <span className="text-xs text-[#5B6475]">No comparison yet</span>
        ) : (
          <span className="flex flex-wrap items-center gap-1.5">
            <Chip tone={tone}>{formatDelta(tile.delta)}</Chip>
            {tile.secondary && <span className="text-xs text-[#5B6475]">{tile.secondary}</span>}
          </span>
        )
      ) : (
        <span className="flex flex-wrap items-center gap-1.5">
          {tile.delta !== null && <Chip tone={tone}>{formatDelta(tile.delta)}</Chip>}
          {tile.secondary && <Chip tone={tone} className="whitespace-normal">{tile.secondary}</Chip>}
        </span>
      )}
    </div>
  )
}

export function TodaySection({ section }: { section: LayoutSection }) {
  const state = useDashboardSection<TodayData>(section, { params: {} })
  const { envelope, loading, updating, error, retry } = state
  const headingId = `dash-${section.key}-title`

  // No card frame: the tiles are cards themselves, in a row of their own.
  return (
    <section aria-labelledby={headingId} aria-busy={loading || updating} className="min-w-0 basis-full">
      <h2 id={headingId} className="sr-only">
        {section.title}
      </h2>
      {updating && (
        <div className="mb-2">
          <UpdatingNote show />
        </div>
      )}
      {loading ? (
        <div className="flex flex-wrap gap-3.5">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className={cn(cardClass, "flex-[1_1_170px] space-y-2 p-[18px]")}>
              <Skeleton className="h-3 w-1/2 bg-[#EEF0F4]" />
              <Skeleton className="h-8 w-3/4 bg-[#EEF0F4]" />
              <Skeleton className="h-4 w-2/3 bg-[#EEF0F4]" />
            </div>
          ))}
        </div>
      ) : envelope ? (
        <div className="flex flex-wrap gap-3.5">
          {envelope.data.tiles.map((tile) => (
            <TileCard key={tile.key} tile={tile} />
          ))}
        </div>
      ) : null}
      {error && !loading && (
        <div className={cn(!envelope && cardClass)}>
          {!envelope && <p className="text-base font-bold">{section.title}</p>}
          <SectionError message={error} onRetry={retry} />
        </div>
      )}
    </section>
  )
}
