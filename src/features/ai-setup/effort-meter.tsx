import { cn } from "@/lib/utils"

const EFFORT_LABELS: Record<string, string> = { xhigh: "Extra high" }

export function effortLabel(effort: string) {
  return EFFORT_LABELS[effort] ?? effort[0].toUpperCase() + effort.slice(1)
}

type EffortMeterProps = {
  level: number
  total: number
  className?: string
}

export function EffortMeter({ level, total, className }: EffortMeterProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("flex h-3 shrink-0 items-end gap-[2px]", className)}
    >
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn(
            "w-[2px] rounded-full bg-current transition-opacity",
            index >= level && "opacity-25"
          )}
          style={{ height: `${((index + 2) / (total + 1)) * 100}%` }}
        />
      ))}
    </span>
  )
}
