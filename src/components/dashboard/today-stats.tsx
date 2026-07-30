"use client"

import { Bar, BarChart, Line, LineChart, Tooltip, XAxis } from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"

const data = [
  { day: 'Mon', revenue: 45000 },
  { day: 'Tue', revenue: 30000 },
  { day: 'Wed', revenue: 35000 },
  { day: 'Thu', revenue: 42000 },
  { day: 'Fri', revenue: 50000 },
  { day: 'Sat', revenue: 40000 },
  { day: 'Sun', revenue: 55000 },
];

const chartConfig = {
  revenue: {
    label: "Revenue",
    color: "hsl(var(--primary))",
  },
  subscription: {
    label: "Subscriptions",
    color: "hsl(var(--primary))",
  },
} satisfies ChartConfig

const todayOnAverageData = [
  { day: 'Mon', lastWeekSales: 45000, thisWeekSales: 40000 },
  { day: 'Tue', lastWeekSales: 30000, thisWeekSales: 25000 },
  { day: 'Wed', lastWeekSales: 35000, thisWeekSales: 37000 },
  { day: 'Thu', lastWeekSales: 42000, thisWeekSales: 41000 },
  { day: 'Fri', lastWeekSales: 50000, thisWeekSales: 48000 },
  { day: 'Sat', lastWeekSales: 60000, thisWeekSales: 55000 },
  { day: 'Sun', lastWeekSales: 55000, thisWeekSales: 52000 },
];

const monthToMonthData = [
  { month: 'Jul 24', sales: 45000 },
  { month: 'Aug 24', sales: 52000 },
  { month: 'Sep 24', sales: 61000 },
  { month: 'Oct 24', sales: 58000 },
  { month: 'Nov 24', sales: 70000 },
  { month: 'Dec 24', sales: 64000 },
  { month: 'Jan 25', sales: 44000 },
];
 
  const todayOnAverageDataChartConfig = {
    today: {
      label: "Today",
      color: "hsl(var(--primary))",
    },
    average: {
      label: "Average",
      color: "hsl(var(--primary))",
    },
  } satisfies ChartConfig

export function TodayStats() {
  return (
    <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-3">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-normal">Total Sales - Today</CardTitle>
        </CardHeader>
        <CardContent className="pb-0">
          <div className="text-2xl font-bold">R 15,231.89</div>
          <p className="text-xs text-muted-foreground">
            +20.1% from yesterday
          </p>
          <ChartContainer config={chartConfig} className="h-[200px] w-full">
          <LineChart
    data={data}
    margin={{
      top: 5,
      right: 10,
      left: 10,
      bottom: 0,
    }}
  >

    <XAxis dataKey="day" />

    
    {/* Add the Tooltip component here */}
    <Tooltip />
    
    <Line
      type="monotone"
      strokeWidth={2}
      dataKey="revenue"
      stroke="var(--color-revenue)"
      activeDot={{
        r: 6,
      }}
    />
  </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-normal">Average Sales - Month on Month</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">R 44,000</div>
          <p className="text-xs text-muted-foreground">
            -5.1% from last month
          </p>
          <ChartContainer config={chartConfig} className="mt-2 h-[200px] w-full">
          <BarChart
            data={monthToMonthData}
            margin={{
              top: 20,
              right: 30,
              left: 20,
              bottom: 5,
            }}
          >
            <XAxis dataKey="month" />
            
            
            {/* Tooltip to show values on hover */}
            <Tooltip />
            
            <Bar
              dataKey="sales"
              fill="var(--color-subscription)"
              radius={[4, 4, 0, 0]} // Rounded top corners
            />
          </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
            <CardTitle>Consecutive Weeks Sales</CardTitle>
            <CardDescription>
            Total Sales by day.
            </CardDescription>
        </CardHeader>
        <CardContent className="pb-4">
            <ChartContainer config={todayOnAverageDataChartConfig} className="w-full md:h-[200px]">
            <LineChart
              data={todayOnAverageData}
              margin={{
                top: 5,
                right: 10,
                left: 10,
                bottom: 0,
              }}
            >
              <XAxis dataKey="day" />
              <Line
                type="monotone"
                strokeWidth={2}
                dataKey="lastWeekSales"
                stroke="var(--color-average)"
                strokeOpacity={0.5}
                activeDot={{
                  r: 6,
                  fill: "var(--color-average)",
                }}
                name="Last Week Sales:   R " 
              />
              <Line
                type="monotone"
                dataKey="thisWeekSales"
                strokeWidth={2}
                stroke="var(--color-today)"
                activeDot={{
                  r: 8,
                  style: { fill: "var(--color-today)" },
                }}
                name="This Week Sales:   R " 
              />
              <ChartTooltip content={<ChartTooltipContent />} />
            </LineChart>
            </ChartContainer>
        </CardContent>
      </Card>    
    </div>
  )
}