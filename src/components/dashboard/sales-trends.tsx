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
// Daily portions sold by meal period over 3 months (dummy data)
const chartData = [
  { date: "2025-05-01", breakfast: 48, lunch: 112 },
  { date: "2025-05-02", breakfast: 52, lunch: 98 },
  { date: "2025-05-05", breakfast: 61, lunch: 130 },
  { date: "2025-05-06", breakfast: 55, lunch: 121 },
  { date: "2025-05-07", breakfast: 49, lunch: 108 },
  { date: "2025-05-08", breakfast: 63, lunch: 135 },
  { date: "2025-05-09", breakfast: 44, lunch: 97 },
  { date: "2025-05-12", breakfast: 70, lunch: 142 },
  { date: "2025-05-13", breakfast: 58, lunch: 119 },
  { date: "2025-05-14", breakfast: 53, lunch: 125 },
  { date: "2025-05-15", breakfast: 67, lunch: 138 },
  { date: "2025-05-16", breakfast: 41, lunch: 90 },
  { date: "2025-05-19", breakfast: 72, lunch: 148 },
  { date: "2025-05-20", breakfast: 60, lunch: 129 },
  { date: "2025-05-21", breakfast: 55, lunch: 118 },
  { date: "2025-05-22", breakfast: 68, lunch: 143 },
  { date: "2025-05-23", breakfast: 50, lunch: 103 },
  { date: "2025-05-26", breakfast: 74, lunch: 151 },
  { date: "2025-05-27", breakfast: 62, lunch: 133 },
  { date: "2025-05-28", breakfast: 57, lunch: 122 },
  { date: "2025-05-29", breakfast: 69, lunch: 140 },
  { date: "2025-05-30", breakfast: 45, lunch: 95 },
  { date: "2025-06-02", breakfast: 76, lunch: 155 },
  { date: "2025-06-03", breakfast: 64, lunch: 136 },
  { date: "2025-06-04", breakfast: 59, lunch: 126 },
  { date: "2025-06-05", breakfast: 71, lunch: 145 },
  { date: "2025-06-06", breakfast: 47, lunch: 100 },
  { date: "2025-06-09", breakfast: 78, lunch: 158 },
  { date: "2025-06-10", breakfast: 66, lunch: 139 },
  { date: "2025-06-11", breakfast: 61, lunch: 128 },
  { date: "2025-06-12", breakfast: 73, lunch: 149 },
  { date: "2025-06-13", breakfast: 49, lunch: 104 },
  { date: "2025-06-16", breakfast: 80, lunch: 162 },
  { date: "2025-06-17", breakfast: 68, lunch: 142 },
  { date: "2025-06-18", breakfast: 63, lunch: 131 },
  { date: "2025-06-19", breakfast: 75, lunch: 152 },
  { date: "2025-06-20", breakfast: 51, lunch: 107 },
  { date: "2025-06-23", breakfast: 82, lunch: 165 },
  { date: "2025-06-24", breakfast: 70, lunch: 145 },
  { date: "2025-06-25", breakfast: 65, lunch: 134 },
  { date: "2025-06-26", breakfast: 77, lunch: 156 },
  { date: "2025-06-27", breakfast: 53, lunch: 110 },
  { date: "2025-06-30", breakfast: 84, lunch: 168 },
  { date: "2025-07-01", breakfast: 72, lunch: 148 },
  { date: "2025-07-02", breakfast: 67, lunch: 137 },
  { date: "2025-07-03", breakfast: 79, lunch: 159 },
  { date: "2025-07-04", breakfast: 55, lunch: 113 },
  { date: "2025-07-07", breakfast: 86, lunch: 171 },
  { date: "2025-07-08", breakfast: 74, lunch: 151 },
  { date: "2025-07-09", breakfast: 69, lunch: 140 },
  { date: "2025-07-10", breakfast: 81, lunch: 163 },
  { date: "2025-07-11", breakfast: 57, lunch: 116 },
  { date: "2025-07-14", breakfast: 88, lunch: 174 },
  { date: "2025-07-15", breakfast: 76, lunch: 154 },
  { date: "2025-07-16", breakfast: 71, lunch: 143 },
  { date: "2025-07-17", breakfast: 83, lunch: 166 },
  { date: "2025-07-18", breakfast: 59, lunch: 119 },
  { date: "2025-07-21", breakfast: 90, lunch: 177 },
  { date: "2025-07-22", breakfast: 78, lunch: 157 },
  { date: "2025-07-23", breakfast: 73, lunch: 146 },
  { date: "2025-07-24", breakfast: 85, lunch: 169 },
  { date: "2025-07-25", breakfast: 61, lunch: 122 },
  { date: "2025-07-28", breakfast: 92, lunch: 180 },
  { date: "2025-07-29", breakfast: 80, lunch: 160 },
  { date: "2025-07-30", breakfast: 75, lunch: 149 },
]

const chartConfig = {
  portions: {
    label: "Portions",
  },
  breakfast: {
    label: "Breakfast",
    color: "hsl(var(--chart-1))",
  },
  lunch: {
    label: "Lunch",
    color: "hsl(var(--chart-2))",
  },
} satisfies ChartConfig

export function SalesTrends() {
  const [timeRange, setTimeRange] = React.useState("90d")

  const filteredData = chartData.filter((item) => {
    const date = new Date(item.date)
    const referenceDate = new Date("2025-07-30")
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
          <CardTitle>Portions Served by Meal Period</CardTitle>
          <CardDescription>
            Breakfast vs Lunch portions served per day
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
              <linearGradient id="fillbreakfast" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-breakfast)"
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-breakfast)"
                  stopOpacity={0.1}
                />
              </linearGradient>
              <linearGradient id="filllunch" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-lunch)"
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-lunch)"
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
              dataKey="lunch"
              type="natural"
              fill="url(#filllunch)"
              stroke="var(--color-lunch)"
              stackId="a"
            />
            <Area
              dataKey="breakfast"
              type="natural"
              fill="url(#fillbreakfast)"
              stroke="var(--color-breakfast)"
              stackId="a"
            />
            <ChartLegend content={<ChartLegendContent />} />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
