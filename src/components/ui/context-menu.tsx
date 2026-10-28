import * as React from "react"
import { ContextMenu as Primitive } from "radix-ui"
import { cn } from "cn"

const ContextMenu = Primitive.Root
const ContextMenuTrigger = Primitive.Trigger

function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        data-slot="context-menu-content"
        className={cn(
          "z-50 min-w-44 rounded-lg border bg-(--surface-popover) backdrop-blur-(--surface-popup-blur) p-1 text-popover-foreground shadow-md outline-none",
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  )
}

function ContextMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      data-slot="context-menu-item"
      className={cn(
        "flex cursor-default items-center gap-2 rounded-md px-2 py-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  )
}

export { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem }
