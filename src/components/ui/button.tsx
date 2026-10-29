import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "ui-button group/button [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "ui-button-default",
        outline: "ui-button-outline",
        secondary: "ui-button-secondary",
        ghost: "ui-button-ghost",
        destructive: "ui-button-destructive",
        link: "ui-button-link",
      },
      size: {
        default: "ui-button-size-default",
        xs: "ui-button-size-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "ui-button-size-sm [&_svg:not([class*='size-'])]:size-3.5",
        lg: "ui-button-size-lg",
        icon: "ui-button-size-icon",
        "icon-xs": "ui-button-size-icon-xs [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "ui-button-size-icon-sm [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "ui-button-size-icon-lg",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
