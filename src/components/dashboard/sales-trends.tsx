"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
const chartData = [
  { date: "2024-11-01", petrol: 222, diesel: 150 },
  { date: "2024-11-02", petrol: 97, diesel: 180 },
  { date: "2024-11-03", petrol: 167, diesel: 120 },
  { date: "2024-11-04", petrol: 242, diesel: 260 },
  { date: "2024-11-05", petrol: 373, diesel: 290 },
  { date: "2024-11-06", petrol: 301, diesel: 340 },
  { date: "2024-11-07", petrol: 245, diesel: 180 },
  { date: "2024-11-08", petrol: 409, diesel: 320 },
  { date: "2024-11-09", petrol: 59, diesel: 110 },
  { date: "2024-11-10", petrol: 261, diesel: 190 },
  { date: "2024-11-11", petrol: 327, diesel: 350 },
  { date: "2024-11-12", petrol: 292, diesel: 210 },
  { date: "2024-11-13", petrol: 342, diesel: 380 },
  { date: "2024-11-14", petrol: 137, diesel: 220 },
  { date: "2024-11-15", petrol: 120, diesel: 170 },
  { date: "2024-11-16", petrol: 138, diesel: 190 },
  { date: "2024-11-17", petrol: 446, diesel: 360 },
  { date: "2024-11-18", petrol: 364, diesel: 410 },
  { date: "2024-11-19", petrol: 243, diesel: 180 },
  { date: "2024-11-20", petrol: 89, diesel: 150 },
  { date: "2024-11-21", petrol: 137, diesel: 200 },
  { date: "2024-11-22", petrol: 224, diesel: 170 },
  { date: "2024-11-23", petrol: 138, diesel: 230 },
  { date: "2024-11-24", petrol: 387, diesel: 290 },
  { date: "2024-11-25", petrol: 215, diesel: 250 },
  { date: "2024-11-26", petrol: 75, diesel: 130 },
  { date: "2024-11-27", petrol: 383, diesel: 420 },
  { date: "2024-11-28", petrol: 122, diesel: 180 },
  { date: "2024-11-29", petrol: 315, diesel: 240 },
  { date: "2024-11-30", petrol: 454, diesel: 380 },
  { date: "2024-12-01", petrol: 165, diesel: 220 },
  { date: "2024-12-02", petrol: 293, diesel: 310 },
  { date: "2024-12-03", petrol: 247, diesel: 190 },
  { date: "2024-12-04", petrol: 385, diesel: 420 },
  { date: "2024-12-05", petrol: 481, diesel: 390 },
  { date: "2024-12-06", petrol: 498, diesel: 520 },
  { date: "2024-12-07", petrol: 388, diesel: 300 },
  { date: "2024-12-08", petrol: 149, diesel: 210 },
  { date: "2024-12-09", petrol: 227, diesel: 180 },
  { date: "2024-12-10", petrol: 293, diesel: 330 },
  { date: "2024-12-11", petrol: 335, diesel: 270 },
  { date: "2024-12-12", petrol: 197, diesel: 240 },
  { date: "2024-12-13", petrol: 197, diesel: 160 },
  { date: "2024-12-14", petrol: 448, diesel: 490 },
  { date: "2024-12-15", petrol: 473, diesel: 380 },
  { date: "2024-12-16", petrol: 338, diesel: 400 },
  { date: "2024-12-17", petrol: 499, diesel: 420 },
  { date: "2024-12-18", petrol: 315, diesel: 350 },
  { date: "2024-12-19", petrol: 235, diesel: 180 },
  { date: "2024-12-20", petrol: 177, diesel: 230 },
  { date: "2024-12-21", petrol: 82, diesel: 140 },
  { date: "2024-12-22", petrol: 81, diesel: 120 },
  { date: "2024-12-23", petrol: 252, diesel: 290 },
  { date: "2024-12-24", petrol: 294, diesel: 220 },
  { date: "2024-12-25", petrol: 201, diesel: 250 },
  { date: "2024-12-26", petrol: 213, diesel: 170 },
  { date: "2024-12-27", petrol: 420, diesel: 460 },
  { date: "2024-12-28", petrol: 233, diesel: 190 },
  { date: "2024-12-29", petrol: 78, diesel: 130 },
  { date: "2024-12-30", petrol: 340, diesel: 280 },
  { date: "2024-12-31", petrol: 178, diesel: 230 },
  { date: "2025-01-01", petrol: 178, diesel: 200 },
  { date: "2025-01-02", petrol: 470, diesel: 410 },
  { date: "2025-01-03", petrol: 103, diesel: 160 },
  { date: "2025-01-04", petrol: 439, diesel: 380 },
  { date: "2025-01-05", petrol: 88, diesel: 140 },
  { date: "2025-01-06", petrol: 294, diesel: 250 },
  { date: "2025-01-07", petrol: 323, diesel: 370 },
  { date: "2025-01-08", petrol: 385, diesel: 320 },
  { date: "2025-01-09", petrol: 438, diesel: 480 },
  { date: "2025-01-10", petrol: 155, diesel: 200 },
  { date: "2025-01-11", petrol: 92, diesel: 150 },
  { date: "2025-01-12", petrol: 492, diesel: 420 },
  { date: "2025-01-13", petrol: 81, diesel: 130 },
  { date: "2025-01-14", petrol: 426, diesel: 380 },
  { date: "2025-01-15", petrol: 307, diesel: 350 },
  { date: "2025-01-16", petrol: 371, diesel: 310 },
  { date: "2025-01-17", petrol: 475, diesel: 520 },
  { date: "2025-01-18", petrol: 107, diesel: 170 },
  { date: "2025-01-19", petrol: 341, diesel: 290 },
  { date: "2025-01-20", petrol: 408, diesel: 450 },
  { date: "2025-01-21", petrol: 169, diesel: 210 },
  { date: "2025-01-22", petrol: 317, diesel: 270 },
  { date: "2025-01-23", petrol: 480, diesel: 530 },
  { date: "2025-01-24", petrol: 132, diesel: 180 },
  { date: "2025-01-25", petrol: 141, diesel: 190 },
  { date: "2025-01-26", petrol: 434, diesel: 380 },
  { date: "2025-01-27", petrol: 448, diesel: 490 },
  { date: "2025-01-28", petrol: 149, diesel: 200 },
  { date: "2025-01-29", petrol: 103, diesel: 160 },
  { date: "2025-01-30", petrol: 446, diesel: 400 },
]

const chartConfig = {
  visitors: {
    label: "Visitors",
  },
  petrol: {
    label: "petrol",
    color: "hsl(var(--chart-1))",
  },
  diesel: {
    label: "diesel",
    color: "hsl(var(--chart-2))",
  },
} satisfies ChartConfig

export function SalesTrends() {
  const [timeRange, setTimeRange] = React.useState("90d")

  const filteredData = chartData.filter((item) => {
    const date = new Date(item.date)
    const referenceDate = new Date("2025-01-30")
    let daysToSubtract = 90
    if (timeRange === "30d") {
      daysToSubtract = 30
    } else if (timeRange === "7d") {
      daysToSubtract = 7
    }
    const startDate = new Date(referenceDate)
    startDate.setDate(startDate.getDate() - daysToSubtract)
    return date >= startDate
  })

  return (
    <Card>
      <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
        <div className="grid flex-1 gap-1 text-center sm:text-left">
          <CardTitle>Fuel Sold by Type</CardTitle>
          <CardDescription>
            Showing total litres by day sold for the last 3 months
          </CardDescription>
        </div>
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger
            className="w-[160px] rounded-lg sm:ml-auto"
            aria-label="Select a value"
          >
            <SelectValue placeholder="Last 3 months" />
          </SelectTrigger>
          <SelectContent className="rounded-xl">
            <SelectItem value="90d" className="rounded-lg">
              Last 3 months
            </SelectItem>
            <SelectItem value="30d" className="rounded-lg">
              Last 30 days
            </SelectItem>
            <SelectItem value="7d" className="rounded-lg">
              Last 7 days
            </SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[250px] w-full"
        >
          <AreaChart data={filteredData}>
            <defs>
              <linearGradient id="fillpetrol" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-petrol)"
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-petrol)"
                  stopOpacity={0.1}
                />
              </linearGradient>
              <linearGradient id="filldiesel" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-diesel)"
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-diesel)"
                  stopOpacity={0.1}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value) => {
                const date = new Date(value)
                return date.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })
              }}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => {
                    return new Date(value).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  }}
                  indicator="dot"
                />
              }
            />
            <Area
              dataKey="diesel"
              type="natural"
              fill="url(#filldiesel)"
              stroke="var(--color-diesel)"
              stackId="a"
            />
            <Area
              dataKey="petrol"
              type="natural"
              fill="url(#fillpetrol)"
              stroke="var(--color-petrol)"
              stackId="a"
            />
            <ChartLegend content={<ChartLegendContent />} />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
