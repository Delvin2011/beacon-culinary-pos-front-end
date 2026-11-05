"use client"

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { useDashboardSection } from "@/hooks/use-dashboard-section"
import {
  formatCount,
  formatDecimal,
  formatHour,
  formatPercent,
  formatRand,
  formatRandShort,
  formatShortDay,
  jhbHourOf,
  type BusyHoursData,
  type DashboardRange,
  type HeatmapData,
  type LayoutSection,
  type SalesMixData,
  type SalesTrendData,
} from "@/lib/dashboard"
import { DASH, EmptyText, ReportLinkButton, SectionCard } from "./dashboard-ui"

const AXIS_TICK = { fontSize: 12, fill: DASH.muted }

// ---- Net sales trend ----

type TrendRow = SalesTrendData["days"][number]

// The amber "same weekday last week" mark: a short line across the top of an invisible bar on a twin axis, so it
// lines up with the net sales bar of the same day at any width.
function CompareMark(props: { x?: number; y?: number; width?: number; payload?: TrendRow }) {
  const { x = 0, y = 0, width = 0, payload } = props
  if (!payload || payload.compare === null || payload.compare === undefined) return <g />
  return <line x1={x - 6} x2={x + width + 6} y1={y} y2={y} stroke={DASH.amber} strokeWidth={3} strokeLinecap="round" />
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: TrendRow }> }) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  return (
    <div className="rounded-lg border border-[#E3E6EB] bg-white px-3 py-2 text-xs shadow-sm">
      <div className="font-bold">{row.label}</div>
      <div>Net sales {formatRand(row.netSales)}</div>
      {row.compare !== null && <div className="text-[#8A4B00]">Same weekday last week {formatRand(row.compare)}</div>}
    </div>
  )
}

function trendSummary(days: TrendRow[]): string {
  const parts = days.map(
    (day) => `${day.label}${day.isToday ? " (today)" : ""} ${formatRand(day.netSales)}${day.compare !== null ? `, last week ${formatRand(day.compare)}` : ""}`,
  )
  return `Net sales per trading day. ${parts.join("; ")}.`
}

export function SalesTrendSection({ section, range }: { section: LayoutSection; range?: DashboardRange }) {
  const state = useDashboardSection<SalesTrendData>(section, { params: { range } })

  return (
    <SectionCard
      section={section}
      state={state}
      skeletonHeight="h-56"
      subtitle="Bars: net sales. Amber mark: the same weekday last week."
      headerExtra={<ReportLinkButton link={state.envelope?.reportLink} label="View Sales Summary" />}
    >
      {({ data }) =>
        data.days.length === 0 ? (
          <EmptyText>No trading days yet</EmptyText>
        ) : (
          <div role="img" aria-label={trendSummary(data.days)}>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={data.days} margin={{ top: 24, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
                <CartesianGrid vertical={false} stroke={DASH.grid} />
                <XAxis
                  xAxisId="bars"
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  tick={(props: { x: number; y: number; payload: { value: string; index: number } }) => {
                    const today = data.days[props.payload.index]?.isToday
                    return (
                      <text x={props.x} y={props.y + 12} textAnchor="middle" fontSize={12} fontWeight={today ? 700 : 400} fill={today ? DASH.ink : DASH.muted}>
                        {props.payload.value}
                      </text>
                    )
                  }}
                />
                <XAxis xAxisId="marks" dataKey="label" hide />
                <YAxis tickFormatter={formatRandShort} axisLine={false} tickLine={false} tick={AXIS_TICK} width={56} />
                <Tooltip content={<TrendTooltip />} cursor={{ fill: "rgba(36,85,214,0.06)" }} />
                <Bar xAxisId="bars" dataKey="netSales" maxBarSize={44} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {data.days.map((day) => (
                    <Cell key={day.day} fill={day.isToday ? DASH.accent : DASH.accentLight} />
                  ))}
                  <LabelList
                    dataKey="netSales"
                    content={(props) => {
                      const { x = 0, y = 0, width = 0, index = -1 } = props as { x?: number; y?: number; width?: number; index?: number }
                      const day = data.days[index]
                      if (!day?.isToday) return null
                      return (
                        <text x={Number(x) + Number(width) / 2} y={Number(y) - 8} textAnchor="middle" fontSize={13} fontWeight={700} fill={DASH.ink}>
                          {formatRand(day.netSales)}
                        </text>
                      )
                    }}
                  />
                </Bar>
                <Bar
                  xAxisId="marks"
                  dataKey="compare"
                  maxBarSize={44}
                  fill="transparent"
                  isAnimationActive={false}
                  shape={(props: unknown) => <CompareMark {...(props as object)} />}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )
      }
    </SectionCard>
  )
}

// ---- Where sales come from ----

// A fixed colour per group key, so a group keeps its colour whatever the range.
const MIX_COLOURS: Record<string, string> = {
  BREAKFAST: "#A9BEF2",
  LUNCH: "#2455D6",
  LIGHT_MEALS: "#E8A33D",
  BEVERAGES: "#0F5F57",
}
const EXTRA_MIX_COLOURS = ["#6E5BB8", "#1B3FA8", "#8FB8B0", "#B85C38", "#5B6475"]

export function mixColour(key: string): string {
  if (MIX_COLOURS[key]) return MIX_COLOURS[key]
  let hash = 0
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return EXTRA_MIX_COLOURS[hash % EXTRA_MIX_COLOURS.length]
}

export function SalesMixSection({ section, range }: { section: LayoutSection; range?: DashboardRange }) {
  const state = useDashboardSection<SalesMixData>(section, { params: { range } })
  const basis = state.envelope?.data.basis

  return (
    <SectionCard
      section={section}
      state={state}
      subtitle={basis === "BEFORE_DISCOUNTS" ? "Before discounts" : undefined}
      headerExtra={<ReportLinkButton link={state.envelope?.reportLink} label="View report" />}
    >
      {({ data }) =>
        data.groups.length === 0 ? (
          <EmptyText>No sales in this range</EmptyText>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <div
              role="img"
              aria-label={`Sales by source, total ${formatRand(data.total)}: ${data.groups
                .map((group) => `${group.label} ${formatPercent(group.percent)}, ${formatRand(group.amount)}`)
                .join("; ")}.`}
              className="relative h-[170px] min-w-[150px] max-w-[170px] flex-[1_1_150px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.groups}
                    dataKey="amount"
                    nameKey="label"
                    innerRadius="62%"
                    outerRadius="95%"
                    startAngle={90}
                    endAngle={-270}
                    stroke="#FFFFFF"
                    strokeWidth={1}
                    isAnimationActive={false}
                  >
                    {data.groups.map((group) => (
                      <Cell key={group.key} fill={mixColour(group.key)} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-[15px] font-bold leading-tight">{formatRand(data.total)}</span>
                <span className="text-[11px] text-[#5B6475]">total</span>
              </div>
            </div>
            <ul className="flex min-w-0 flex-[1_1_200px] flex-col gap-2.5 text-[13px]">
              {data.groups.map((group) => (
                <li key={group.key} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
                  <span className="whitespace-nowrap">
                    <span aria-hidden="true" className="mr-2 inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: mixColour(group.key) }} />
                    {group.label}
                  </span>
                  <span className="whitespace-nowrap font-bold">
                    {formatPercent(group.percent)} · {formatRand(group.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )
      }
    </SectionCard>
  )
}

// ---- Busy hours ----

type BusyRow = BusyHoursData["hours"][number]

function BusyTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: BusyRow }> }) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  return (
    <div className="rounded-lg border border-[#E3E6EB] bg-white px-3 py-2 text-xs shadow-sm">
      <div className="font-bold">{formatHour(row.hour)}</div>
      <div>Today {formatCount(row.today)}</div>
      {row.typical !== null && <div className="text-[#8A4B00]">Typical {formatDecimal(row.typical, 1)}</div>}
    </div>
  )
}

export function BusyHoursSection({ section }: { section: LayoutSection }) {
  const state = useDashboardSection<BusyHoursData>(section, { params: {} })
  const envelope = state.envelope
  const hasTypical = !!envelope?.data.hours.some((hour) => hour.typical !== null)
  const currentHour = envelope ? jhbHourOf(envelope.asOf) : null
  const running = envelope && currentHour !== null && envelope.data.hours.some((hour) => hour.hour === currentHour) ? currentHour : null

  const subtitle = envelope ? (
    <>
      Orders per hour. Blue bars: today{running !== null ? ` (${formatHour(running)} is still running)` : ""}.
      {hasTypical && envelope.data.typicalBasis && (
        <>
          {" "}
          <span className="text-[#8A4B00]">Amber line: {envelope.data.typicalBasis}.</span>
        </>
      )}
    </>
  ) : undefined

  return (
    <SectionCard section={section} state={state} subtitle={subtitle} skeletonHeight="h-56">
      {({ data, asOf }) => {
        const peak = data.peak
        const summary = [
          `Orders per hour today${hasTypical && data.typicalBasis ? ` against ${data.typicalBasis.toLowerCase()}` : ""}.`,
          peak ? `Peak ${formatHour(peak.hour)} with ${formatCount(peak.orders)} orders.` : "No orders yet.",
          data.hours
            .map((row) => `${formatHour(row.hour)} ${formatCount(row.today)}${row.typical !== null ? ` (typical ${formatDecimal(row.typical, 1)})` : ""}`)
            .join(", "),
        ].join(" ")
        const runningHour = jhbHourOf(asOf)
        return (
          <div role="img" aria-label={summary}>
            <ResponsiveContainer width="100%" height={230}>
              <ComposedChart data={data.hours} margin={{ top: 26, right: 8, bottom: 0, left: -8 }} barCategoryGap="30%">
                <CartesianGrid vertical={false} stroke={DASH.grid} />
                <XAxis
                  dataKey="hour"
                  tickFormatter={(hour: number) => formatHour(hour)}
                  axisLine={false}
                  tickLine={false}
                  tick={{ ...AXIS_TICK, fontSize: 11 }}
                  interval="preserveStartEnd"
                  minTickGap={4}
                />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={AXIS_TICK} width={40} />
                <Tooltip content={<BusyTooltip />} cursor={{ fill: "rgba(36,85,214,0.06)" }} />
                <Bar dataKey="today" maxBarSize={28} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {data.hours.map((row) => (
                    <Cell key={row.hour} fill={row.hour === runningHour ? DASH.accentLight : DASH.accent} />
                  ))}
                  <LabelList
                    dataKey="today"
                    content={(props) => {
                      const { x = 0, y = 0, width = 0, index = -1 } = props as { x?: number; y?: number; width?: number; index?: number }
                      const row = data.hours[index]
                      if (!row) return null
                      const isPeak = peak !== null && row.hour === peak.hour
                      const isRunning = row.hour === runningHour
                      if (!isPeak && !isRunning) return null
                      const label = [isPeak ? `Peak ${formatHour(row.hour)} · ${formatCount(peak.orders)}` : null, isRunning ? "still running" : null]
                        .filter(Boolean)
                        .join(" · ")
                      // Keep the label inside the chart on the first and last bars.
                      const edge = index === 0 ? "start" : index === data.hours.length - 1 ? "end" : "middle"
                      const anchorX = edge === "start" ? Number(x) : edge === "end" ? Number(x) + Number(width) : Number(x) + Number(width) / 2
                      return (
                        <text x={anchorX} y={Number(y) - 8} textAnchor={edge} fontSize={12} fontWeight={700} fill={DASH.ink}>
                          {label}
                        </text>
                      )
                    }}
                  />
                </Bar>
                {hasTypical && (
                  <Line
                    dataKey="typical"
                    type="linear"
                    stroke={DASH.amber}
                    strokeWidth={2.5}
                    dot={{ r: 3.5, fill: "#FFFFFF", stroke: DASH.amber, strokeWidth: 2 }}
                    activeDot={{ r: 4.5, fill: "#FFFFFF", stroke: DASH.amber, strokeWidth: 2 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )
      }}
    </SectionCard>
  )
}

// ---- When customers come ----

function cellTint(value: number, max: number): string {
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return `rgba(36,85,214,${(0.06 + share * 0.56).toFixed(3)})`
}

export function HeatmapSection({ section }: { section: LayoutSection }) {
  const state = useDashboardSection<HeatmapData>(section, { params: {} })
  const data = state.envelope?.data

  return (
    <SectionCard
      section={section}
      state={state}
      subtitle={data && data.rows.length > 0 ? `Average orders, ${formatShortDay(data.from)}–${formatShortDay(data.to)}` : undefined}
    >
      {({ data }) =>
        data.rows.length === 0 ? (
          <EmptyText>Not enough history yet</EmptyText>
        ) : (
          <>
            <div className="overflow-x-auto">
              <div
                role="table"
                aria-label={`Average orders per hour by weekday, ${formatShortDay(data.from)} to ${formatShortDay(data.to)}`}
                className="grid min-w-[420px] items-stretch gap-1 text-xs"
                style={{ gridTemplateColumns: `44px repeat(${data.hours.length}, minmax(28px, 1fr))` }}
              >
                <div role="row" className="contents">
                  <div role="columnheader" aria-label="Weekday" />
                  {data.hours.map((hour) => (
                    <div key={hour} role="columnheader" aria-label={formatHour(hour)} className="pb-0.5 text-center text-[#5B6475]">
                      {String(hour).padStart(2, "0")}
                    </div>
                  ))}
                </div>
                {data.rows.map((row) => (
                  <div key={row.weekday} role="row" className="contents">
                    <div role="rowheader" className="flex items-center font-semibold text-[#3B4457]">
                      {row.label}
                    </div>
                    {data.hours.map((hour, index) => {
                      const value = row.cells[index] ?? 0
                      return (
                        <div
                          key={hour}
                          role="cell"
                          className="flex min-h-9 items-center justify-center rounded-md text-[#172033]"
                          style={{ background: cellTint(value, data.max) }}
                        >
                          {formatCount(value)}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div aria-hidden="true" className="mt-3 flex items-center gap-2 text-xs text-[#5B6475]">
              <span>Fewer orders</span>
              {[0.15, 0.4, 0.65, 1].map((share) => (
                <span key={share} className="h-3 w-[22px] rounded-[3px]" style={{ background: cellTint(share, 1) }} />
              ))}
              <span>More orders</span>
            </div>
          </>
        )
      }
    </SectionCard>
  )
}
