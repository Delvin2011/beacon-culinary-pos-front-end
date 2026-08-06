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
import { formatZarCurrency } from "@/lib/utils"

// Daily revenue for the current week (R)
const data = [
  { day: 'Mon', revenue: 3820 },
  { day: 'Tue', revenue: 4150 },
  { day: 'Wed', revenue: 3970 },
  { day: 'Thu', revenue: 4380 },
  { day: 'Fri', revenue: 5210 },
  { day: 'Sat', revenue: 2640 },
  { day: 'Sun', revenue: 1890 },
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

// Week-on-week revenue comparison (R)
const todayOnAverageData = [
  { day: 'Mon', lastWeekSales: 3650, thisWeekSales: 3820 },
  { day: 'Tue', lastWeekSales: 3900, thisWeekSales: 4150 },
  { day: 'Wed', lastWeekSales: 4100, thisWeekSales: 3970 },
  { day: 'Thu', lastWeekSales: 4200, thisWeekSales: 4380 },
  { day: 'Fri', lastWeekSales: 4950, thisWeekSales: 5210 },
  { day: 'Sat', lastWeekSales: 2800, thisWeekSales: 2640 },
  { day: 'Sun', lastWeekSales: 2100, thisWeekSales: 1890 },
];

// Monthly canteen revenue (R)
const monthToMonthData = [
  { month: 'Feb 25', sales: 78400 },
  { month: 'Mar 25', sales: 85200 },
  { month: 'Apr 25', sales: 79600 },
  { month: 'May 25', sales: 91300 },
  { month: 'Jun 25', sales: 88700 },
  { month: 'Jul 25', sales: 94500 },
  { month: 'Aug 25', sales: 84200 },
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
          <div className="text-2xl font-bold">{formatZarCurrency(5210)}</div>
          <p className="text-xs text-muted-foreground">
            +5.3% from yesterday
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
          <CardTitle className="text-sm font-normal">Monthly Revenue Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatZarCurrency(87300)}</div>
          <p className="text-xs text-muted-foreground">
            +7.4% from last month
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
            <CardTitle>Week-on-Week Revenue</CardTitle>
            <CardDescription>
              This week vs last week — daily canteen revenue (R)
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
                name="Last Week Sales (R)" 
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
                name="This Week Sales (R)" 
              />
              <ChartTooltip content={<ChartTooltipContent />} />
            </LineChart>
            </ChartContainer>
        </CardContent>
      </Card>    
    </div>
  )
}