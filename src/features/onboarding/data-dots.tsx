const COLUMN_HEIGHTS = [
  1, 1, 2, 1, 2, 3, 2, 3, 2, 3, 4, 3, 4, 5, 4, 3, 4, 5, 6, 5, 4, 5, 6, 7, 6, 5,
  6, 7, 8, 7,
]
const ROWS = 8
const GAP = 8
const RADIUS = 1.5
const COLUMN_DELAY_MS = 28
const ROW_DELAY_MS = 40

export function DataDots() {
  const dots = COLUMN_HEIGHTS.flatMap((height, column) =>
    Array.from({ length: ROWS }, (_, row) => ({
      column,
      row,
      isCharted: ROWS - row <= height,
    }))
  )

  return (
    <svg
      viewBox={`0 0 ${COLUMN_HEIGHTS.length * GAP} ${ROWS * GAP}`}
      aria-hidden="true"
      className="w-full text-foreground"
    >
      {dots.map(({ column, row, isCharted }) => (
        <circle
          key={`${column}-${row}`}
          cx={column * GAP + GAP / 2}
          cy={row * GAP + GAP / 2}
          r={RADIUS}
          fill="currentColor"
          opacity={isCharted ? 0.7 : 0.1}
          className={
            isCharted
              ? "origin-center animate-chart-dot [transform-box:fill-box]"
              : undefined
          }
          style={
            isCharted
              ? {
                  animationDelay: `${column * COLUMN_DELAY_MS + (ROWS - row) * ROW_DELAY_MS}ms`,
                }
              : undefined
          }
        />
      ))}
    </svg>
  )
}
