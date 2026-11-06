const DOTS = [
  [2, 12],
  [7, 12],
  [12, 12],
  [7, 7],
  [12, 7],
  [12, 2],
]

export function DavisMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true" className={className}>
      {DOTS.map(([cx, cy]) => (
        <circle
          key={`${cx}-${cy}`}
          cx={cx}
          cy={cy}
          r="1.75"
          fill="currentColor"
        />
      ))}
    </svg>
  )
}
