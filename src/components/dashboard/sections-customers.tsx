"use client"

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useDashboardSection } from "@/hooks/use-dashboard-section"
import {
  formatCount,
  formatDecimal,
  formatMinutes,
  formatPercent,
  formatRand,
  formatShortDay,
  paymentMethodLabel,
  type AccountCustomersData,
  type BasketData,
  type DashboardRange,
  type LayoutSection,
  type PaymentMixData,
  type WaitingData,
} from "@/lib/dashboard"
import { DASH, EmptyText, ReportLinkButton, ScaledBar, SectionCard } from "./dashboard-ui"

// ---- How customers pay ----

const METHOD_COLOURS: Record<string, string> = { CASH: "#2455D6", CARD: "#A9BEF2", ACCOUNT: "#E8A33D" }

function methodColour(method: string): string {
  return METHOD_COLOURS[method.toUpperCase()] ?? DASH.muted
}

export function PaymentMixSection({ section, range }: { section: LayoutSection; range?: DashboardRange }) {
  const state = useDashboardSection<PaymentMixData>(section, { params: { range } })

  return (
    <SectionCard
      section={section}
      state={state}
      subtitle="Share of money collected"
      skeletonHeight="h-24"
    >
      {({ data, reportLink }) =>
        data.methods.length === 0 ? (
          <EmptyText>Nothing collected in this range</EmptyText>
        ) : (
          <>
            <div
              role="img"
              aria-label={`Share of money collected, ${formatRand(data.total)}: ${data.methods
                .map((method) => `${paymentMethodLabel(method.method)} ${formatPercent(method.percent)}, ${formatRand(method.amount)}`)
                .join("; ")}.`}
              className="mt-2 flex h-[22px] overflow-hidden rounded-md bg-[#EEF0F4]"
            >
              {data.methods.map((method) => (
                <div key={method.method} style={{ width: `${Math.max(0, method.percent)}%`, background: methodColour(method.method) }} />
              ))}
            </div>
            <ul className="mt-3.5 flex flex-col gap-2 text-[13px]">
              {data.methods.map((method) => (
                <li key={method.method} className="flex justify-between gap-2">
                  <span>
                    <span aria-hidden="true" className="mr-2 inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: methodColour(method.method) }} />
                    {paymentMethodLabel(method.method)}
                  </span>
                  <span className="whitespace-nowrap">
                    <b>{formatPercent(method.percent)}</b> · {formatRand(method.amount)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-[#EEF0F4] pt-2.5 text-[13px] text-[#5B6475]">{formatRand(data.total)} collected</p>
            <ReportLinkButton link={reportLink} label="View report" />
          </>
        )
      }
    </SectionCard>
  )
}

// ---- The basket ----

export function BasketSection({ section, range }: { section: LayoutSection; range?: DashboardRange }) {
  const state = useDashboardSection<BasketData>(section, { params: { range } })

  return (
    <SectionCard section={section} state={state} subtitle="Average order" skeletonHeight="h-24">
      {({ data, reportLink }) => {
        const last = data.series[data.series.length - 1]
        return (
          <>
            <div className="text-[28px] font-bold">{formatRand(data.averageOrder)}</div>
            {data.series.length > 0 && (
              <>
                <div
                  role="img"
                  aria-label={`Average order over the last 7 trading days: ${data.series
                    .map((point) => `${formatShortDay(point.day)} ${formatRand(point.value)}`)
                    .join(", ")}.`}
                  className="my-1.5"
                >
                  <ResponsiveContainer width="100%" height={64}>
                    <LineChart data={data.series} margin={{ top: 6, right: 6, bottom: 2, left: 6 }}>
                      <XAxis dataKey="day" hide />
                      <YAxis hide domain={["dataMin", "dataMax"]} />
                      <Tooltip
                        formatter={(value: number) => [formatRand(value), "Average order"]}
                        labelFormatter={(day: string) => formatShortDay(day)}
                        contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: DASH.border }}
                      />
                      <Line
                        dataKey="value"
                        stroke={DASH.accent}
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        isAnimationActive={false}
                        dot={(props: { cx?: number; cy?: number; index?: number }) =>
                          props.index === data.series.length - 1 && last ? (
                            <circle key="last" cx={props.cx} cy={props.cy} r={4} fill={DASH.accent} />
                          ) : (
                            <g key={`dot-${props.index}`} />
                          )
                        }
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-[#5B6475]">Last 7 trading days</p>
              </>
            )}
            <ul className="mt-2 flex flex-col gap-1.5 text-[13px] text-[#3B4457]">
              {data.itemsPerOrder !== null && (
                <li>
                  <b>{formatDecimal(data.itemsPerOrder, 1)}</b> items per order
                </li>
              )}
              {data.extrasAttachPercent !== null && (
                <li>
                  Extras on <b>{formatPercent(data.extrasAttachPercent)}</b> of meal orders
                </li>
              )}
            </ul>
            <ReportLinkButton link={reportLink} label="View report" />
          </>
        )
      }}
    </SectionCard>
  )
}

// ---- Waiting ----

function WaitRow({ label, minutes }: { label: string; minutes: number | null }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-t border-[#EEF0F4] py-3 text-sm">
      <span>{label}</span>
      <b className="text-xl">{minutes === null ? "–" : formatMinutes(minutes)}</b>
    </div>
  )
}

export function WaitingSection({ section }: { section: LayoutSection }) {
  const state = useDashboardSection<WaitingData>(section, { params: {} })

  return (
    <SectionCard section={section} state={state} subtitle="Median times today" skeletonHeight="h-24">
      {({ data, reportLink }) =>
        data.kitchenMedianMinutes === null && data.barMedianMinutes === null && data.collectMedianMinutes === null ? (
          <EmptyText>No orders through the kitchen yet today</EmptyText>
        ) : (
          <>
            <WaitRow label="Paid to ready, kitchen" minutes={data.kitchenMedianMinutes} />
            {data.barMedianMinutes !== null && <WaitRow label="Paid to ready, bar" minutes={data.barMedianMinutes} />}
            <WaitRow label="Ready to collected" minutes={data.collectMedianMinutes} />
            {data.longest && (
              <div className="border-t border-[#EEF0F4] pt-3 text-[13px] text-[#5B6475]">
                Longest wait today: {formatCount(data.longest.minutes)} min at {data.longest.at}
              </div>
            )}
            <ReportLinkButton link={reportLink} label="View report" />
          </>
        )
      }
    </SectionCard>
  )
}

// ---- Account customers ----

export function AccountCustomersSection({ section, range }: { section: LayoutSection; range?: DashboardRange }) {
  const state = useDashboardSection<AccountCustomersData>(section, { params: { range } })

  return (
    <SectionCard section={section} state={state} subtitle="Top spend" skeletonHeight="h-24">
      {({ data, reportLink }) => {
        if (data.accounts.length === 0) return <EmptyText>No account orders in this range</EmptyText>
        const max = data.accounts.reduce((largest, account) => Math.max(largest, account.amount), 0)
        return (
          <>
            {data.accounts.map((account) => (
              <div key={account.accountId} className="mb-3">
                <div className="mb-1.5 flex justify-between gap-2 text-sm">
                  <b>{account.name}</b>
                  <span>{formatRand(account.amount)}</span>
                </div>
                <ScaledBar value={account.amount} max={max} color="#E8A33D" />
              </div>
            ))}
            <div className="border-t border-[#EEF0F4] pt-2.5 text-[13px] text-[#5B6475]">
              {formatRand(data.total)} on {formatCount(data.orders)} {data.orders === 1 ? "order" : "orders"}
            </div>
            <ReportLinkButton link={reportLink} label="View report" />
          </>
        )
      }}
    </SectionCard>
  )
}
