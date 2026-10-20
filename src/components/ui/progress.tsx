import * as React from "react"
import { cn } from "cn"
import { Progress as ProgressPrimitive } from "radix-ui"

function Progress({
  className,
  value,
  max = 100,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const maximum = Number.isFinite(max) && max > 0 ? max : 100
  const current =
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum
      ? value
      : null

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={current}
      max={maximum}
      className={cn(
        "relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="size-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(-${100 - ((current ?? 0) / maximum) * 100}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
