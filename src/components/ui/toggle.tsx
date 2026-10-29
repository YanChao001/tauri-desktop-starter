"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Toggle as TogglePrimitive } from "radix-ui"

const toggleVariants = cva(
  "ui-toggle group/toggle [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: { default: "ui-toggle-default", outline: "ui-toggle-outline" },
      size: {
        default: "ui-toggle-size-default",
        sm: "ui-toggle-size-sm [&_svg:not([class*='size-'])]:size-3.5",
        lg: "ui-toggle-size-lg",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
