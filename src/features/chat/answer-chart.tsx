import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import type { TableAnswer } from "@/features/chat/api"

const LONG_LABEL = 7
const MANY_BARS = 12

const compactNumber = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
})

function chartPoints({ chart, result }: TableAnswer) {
  if (!chart || !result) return []
  const xIndex = result.columns.findIndex(({ name }) => name === chart.x)
  const yIndex = result.columns.findIndex(({ name }) => name === chart.y)
  if (xIndex < 0 || yIndex < 0) return []

  return result.rows.flatMap((row) => {
    const value = Number(row[yIndex])
    return row[yIndex] === null || Number.isNaN(value)
      ? []
      : [{ label: row[xIndex] ?? "null", value }]
  })
}

export function AnswerChart({ answer }: { answer: TableAnswer }) {
  const { chart } = answer
  const points = chartPoints(answer)
  if (!chart || points.length < 2) return null

  const config = {
    value: { label: chart.y, color: "var(--chart-1)" },
  } satisfies ChartConfig
  const longest = Math.max(...points.map(({ label }) => label.length))
  const liesSideways =
    chart.kind === "bar" && longest > LONG_LABEL && points.length <= MANY_BARS
  const height = liesSideways ? Math.max(points.length * 24, 96) : 148
  const axisText = { fontSize: 11, fill: "var(--subtle)" }

  return (
    <ChartContainer
      config={config}
      className="aspect-auto w-full"
      style={{ height }}
      role="img"
      aria-label={`${chart.y} by ${chart.x}`}
    >
      {chart.kind === "line" ? (
        <LineChart data={points} margin={{ top: 6, right: 6, left: -18 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={axisText}
            minTickGap={24}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={axisText}
            tickFormatter={compactNumber.format}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line
            dataKey="value"
            type="monotone"
            stroke="var(--color-value)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      ) : liesSideways ? (
        <BarChart
          data={points}
          layout="vertical"
          barCategoryGap={4}
          margin={{ top: 0, right: 6, left: 0, bottom: 0 }}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={92}
            tickLine={false}
            axisLine={false}
            tick={axisText}
          />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <Bar
            dataKey="value"
            fill="var(--color-value)"
            radius={4}
            isAnimationActive={false}
          />
        </BarChart>
      ) : (
        <BarChart
          data={points}
          barCategoryGap="16%"
          margin={{ top: 6, right: 6, left: -18 }}
        >
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={axisText}
            minTickGap={8}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={axisText}
            tickFormatter={compactNumber.format}
          />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <Bar
            dataKey="value"
            fill="var(--color-value)"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      )}
    </ChartContainer>
  )
}
