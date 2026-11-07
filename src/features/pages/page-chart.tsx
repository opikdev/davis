import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from "recharts"

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import type { QueryResult } from "@/features/chat"
import type { Block } from "@/features/pages/api"
import { arrangedRows, formatNumber } from "@/features/pages/format"

const LONG_LABEL = 7
const MANY_BARS = 12
const MANY_LINE_LABELS = 12
const MAX_BAR_SIZE = 28
const AXIS_CHAR_WIDTH = 6
const LINE_EDGE_SPACE = 20
const SERIES_COLORS = 5
const axisText = { fontSize: 11, fill: "var(--subtle)" }

type Point = Record<string, string | number>

function namedPoints(values: number[]) {
  const last = values.length - 1
  const highest = values.indexOf(Math.max(...values))
  const lowest = values.indexOf(Math.min(...values))
  return new Set([highest, lowest, last])
}

function series(
  block: Block,
  result: QueryResult
): { points: Point[]; keys: string[] } | undefined {
  const columns = result.columns.map(({ name }) => name)
  const x = columns.indexOf(block.xColumn ?? "")
  const y = columns.indexOf(block.yColumn ?? "")
  const split = columns.indexOf(block.seriesColumn ?? "")
  if (x < 0 || y < 0) return undefined
  const rows = arrangedRows(block, result)

  if (block.view !== "stacked" || split < 0) {
    const points = rows.flatMap((row) => {
      const value = Number(row[y])
      return row[y] === null || Number.isNaN(value)
        ? []
        : [{ label: row[x] ?? "No value", value }]
    })
    return { points, keys: ["value"] }
  }

  const keys = [...new Set(rows.map((row) => row[split] ?? "No value"))]
  const grouped = new Map<string, Point>()
  for (const row of rows) {
    const label = row[x] ?? "No value"
    const point = grouped.get(label) ?? { label }
    point[row[split] ?? "No value"] = Number(row[y])
    grouped.set(label, point)
  }
  return { points: [...grouped.values()], keys }
}

type PageChartProps = {
  block: Block
  result: QueryResult
  onSelect?: (label: string) => void
}

export function PageChart({ block, result, onSelect }: PageChartProps) {
  const data = series(block, result)
  if (!data || data.points.length === 0) {
    return (
      <p className="text-xs text-subtle">
        Choose what this chart shows in its settings.
      </p>
    )
  }
  const { keys } = data
  const format = (value: unknown) =>
    formatNumber(Number(value), block.format, true)
  const values = data.points.map((point) =>
    keys.reduce((total, key) => total + Number(point[key] ?? 0), 0)
  )
  const named = namedPoints(values)
  const points: Point[] = data.points.map((point, index) => ({
    ...point,
    note: named.has(index) ? format(values[index]) : "",
  }))
  const axisWidth =
    (format(Math.max(...values)).length + 1) * AXIS_CHAR_WIDTH + 4
  const config: ChartConfig = Object.fromEntries(
    keys.map((key, index) => [
      key,
      {
        label: key === "value" ? (block.yColumn ?? "Value") : key,
        color: `var(--chart-${(index % SERIES_COLORS) + 1})`,
      },
    ])
  )
  const longest = Math.max(...points.map(({ label }) => String(label).length))
  const liesSideways =
    block.view === "bar" && longest > LONG_LABEL && points.length <= MANY_BARS
  const select = onSelect
    ? (point: { label?: string; payload?: { label?: string } }) => {
        const label = point.payload?.label ?? point.label
        if (label !== undefined) onSelect(label)
      }
    : undefined
  const labels = block.showLabels && points.length <= MANY_LINE_LABELS
  const valueAxis = (
    <YAxis
      tickLine={false}
      axisLine={false}
      tick={axisText}
      width={axisWidth}
      tickFormatter={format}
    />
  )
  const isLine = block.view === "line" || block.view === "area"
  const labelAxis = (
    <XAxis
      dataKey="label"
      tickLine={false}
      axisLine={false}
      tick={axisText}
      minTickGap={16}
      padding={
        isLine ? { left: LINE_EDGE_SPACE, right: LINE_EDGE_SPACE } : undefined
      }
    />
  )
  const tooltip = (
    <ChartTooltip
      cursor={false}
      content={
        <ChartTooltipContent
          formatter={(value, name) => (
            <span className="flex w-full justify-between gap-3">
              <span className="text-muted-foreground">
                {config[String(name)]?.label}
              </span>
              <span className="tabular-nums">{format(value)}</span>
            </span>
          )}
        />
      }
    />
  )
  const grid = <CartesianGrid vertical={false} stroke="var(--border)" />
  const margin = { top: labels ? 16 : 6, right: 8, left: 0, bottom: 0 }
  const label = (
    <LabelList
      position="top"
      className="fill-foreground"
      fontSize={11}
      formatter={format}
    />
  )
  const lineLabel = (
    <LabelList
      dataKey="note"
      position="top"
      className="fill-foreground stroke-background stroke-3 [paint-order:stroke]"
      fontSize={11}
    />
  )

  return (
    <ChartContainer
      config={config}
      className="aspect-auto size-full"
      role="img"
      aria-label={block.title}
    >
      {block.view === "line" ? (
        <LineChart data={points} margin={margin}>
          {grid}
          {labelAxis}
          {valueAxis}
          {tooltip}
          <Line
            dataKey="value"
            type="linear"
            stroke="var(--color-value)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--color-value)" }}
            isAnimationActive={false}
          >
            {labels && lineLabel}
          </Line>
        </LineChart>
      ) : block.view === "area" ? (
        <AreaChart data={points} margin={margin}>
          {grid}
          {labelAxis}
          {valueAxis}
          {tooltip}
          <Area
            dataKey="value"
            type="linear"
            stroke="var(--color-value)"
            fill="var(--color-value)"
            fillOpacity={0.15}
            strokeWidth={2}
            isAnimationActive={false}
          >
            {labels && lineLabel}
          </Area>
        </AreaChart>
      ) : block.view === "scatter" ? (
        <ScatterChart margin={margin}>
          <CartesianGrid stroke="var(--border)" />
          <XAxis
            dataKey="label"
            type="number"
            domain={["auto", "auto"]}
            tickLine={false}
            axisLine={false}
            tick={axisText}
            tickFormatter={format}
          />
          <YAxis
            dataKey="value"
            type="number"
            domain={["auto", "auto"]}
            tickLine={false}
            axisLine={false}
            tick={axisText}
            width={axisWidth}
            tickFormatter={format}
          />
          <Scatter
            data={points.map((point) => ({
              ...point,
              label: Number(point.label),
            }))}
            fill="var(--color-value)"
            isAnimationActive={false}
          />
        </ScatterChart>
      ) : block.view === "stacked" ? (
        <BarChart data={points} margin={margin} barCategoryGap="20%">
          {grid}
          {labelAxis}
          {valueAxis}
          {tooltip}
          <ChartLegend content={<ChartLegendContent />} />
          {keys.map((key, index) => (
            <Bar
              key={key}
              dataKey={key}
              stackId="stack"
              fill={`var(--chart-${(index % SERIES_COLORS) + 1})`}
              maxBarSize={MAX_BAR_SIZE * 2}
              radius={index === keys.length - 1 ? [4, 4, 0, 0] : 0}
              isAnimationActive={false}
              onClick={select}
            />
          ))}
        </BarChart>
      ) : liesSideways ? (
        <BarChart
          data={points}
          layout="vertical"
          barCategoryGap={6}
          margin={{ top: 0, right: labels ? 48 : 8, left: 0, bottom: 0 }}
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
          {tooltip}
          <Bar
            dataKey="value"
            fill="var(--color-value)"
            maxBarSize={MAX_BAR_SIZE}
            radius={4}
            isAnimationActive={false}
            className={onSelect && "cursor-pointer"}
            onClick={select}
          >
            {labels && (
              <LabelList
                position="right"
                className="fill-foreground"
                fontSize={11}
                formatter={format}
              />
            )}
          </Bar>
        </BarChart>
      ) : (
        <BarChart data={points} margin={margin} barCategoryGap="20%">
          {grid}
          {labelAxis}
          {valueAxis}
          {tooltip}
          <Bar
            dataKey="value"
            fill="var(--color-value)"
            maxBarSize={MAX_BAR_SIZE * 2}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
            className={onSelect && "cursor-pointer"}
            onClick={select}
          >
            {labels && label}
          </Bar>
        </BarChart>
      )}
    </ChartContainer>
  )
}
