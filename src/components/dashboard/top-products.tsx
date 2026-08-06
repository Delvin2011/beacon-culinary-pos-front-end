"use client"

import * as React from "react"
import { TrendingUp } from "lucide-react"
import { Label, Pie, PieChart } from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
// Portions sold per meal option this month (dummy data)
const chartData = [
  { meal: "Chicken & Rice",      portions: 412, fill: "var(--color-chrome)" },
  { meal: "Beef Stew & Pap",     portions: 387, fill: "var(--color-safari)" },
  { meal: "Vegetable Curry",     portions: 298, fill: "var(--color-firefox)" },
  { meal: "Grilled Fish & Veg",  portions: 241, fill: "var(--color-edge)" },
  { meal: "Pork Chop & Potatoes",portions: 195, fill: "var(--color-other)" },
]

const chartConfig = {
  portions: {
    label: "Portions",
  },
  chrome: {
    label: "Chicken & Rice",
    color: "hsl(var(--chart-1))",
  },
  safari: {
    label: "Beef Stew & Pap",
    color: "hsl(var(--chart-2))",
  },
  firefox: {
    label: "Vegetable Curry",
    color: "hsl(var(--chart-3))",
  },
  edge: {
    label: "Grilled Fish & Veg",
    color: "hsl(var(--chart-4))",
  },
  other: {
    label: "Pork Chop & Potatoes",
    color: "hsl(var(--chart-5))",
  },
} satisfies ChartConfig

export function TopProducts() {
  const totalPortions = React.useMemo(() => {
    return chartData.reduce((acc, curr) => acc + curr.portions, 0)
  }, [])

  return (
    <Card className="flex flex-col">
      <CardHeader className="items-center pb-0">
        <CardTitle>Top Meal Options</CardTitle>
        <CardDescription>Portions sold — month-to-date</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        <ChartContainer
          config={chartConfig}
          className="mx-auto aspect-square max-h-[250px]"
        >
          <PieChart>
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Pie
              data={chartData}
              dataKey="portions"
              nameKey="meal"
              innerRadius={60}
              strokeWidth={5}
            >
              <Label
                content={({ viewBox }) => {
                  if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={viewBox.cy}
                          className="fill-foreground text-3xl font-bold"
                        >
                          {totalPortions.toLocaleString()}
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy || 0) + 24}
                          className="fill-muted-foreground"
                        >
                          Portions
                        </tspan>
                      </text>
                    )
                  }
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className="flex-col gap-2 text-sm">
        <div className="flex items-center gap-2 font-medium leading-none">
          Trending up by 8.4% this month <TrendingUp className="h-4 w-4" />
        </div>
        <div className="leading-none text-muted-foreground">
          Top 5 meals by portions served this month
        </div>
      </CardFooter>
    </Card>
  )
}
