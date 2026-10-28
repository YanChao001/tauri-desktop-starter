import * as React from "react"
import { cn } from "cn"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { I18nContext } from "@/providers/i18n-context"
import { XIcon } from "lucide-react"

const DialogModalContext = React.createContext(true)

function focusDialogTarget(target: Element | null) {
  if (
    !(target instanceof HTMLElement) || target === document.body ||
    !target.isConnected || target.matches(":disabled") ||
    target.closest("[hidden], [inert], [data-slot=dialog-content][data-state=closed]")
  ) return false
  target.focus({ preventScroll: true })
  return document.activeElement === target
}

function Dialog({
  modal = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return (
    <DialogModalContext.Provider value={modal}>
      <DialogPrimitive.Root data-slot="dialog" modal={modal} {...props} />
    </DialogModalContext.Provider>
  )
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  closeLabel,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  closeLabel?: string
}) {
  const modal = React.useContext(DialogModalContext)
  const i18n = React.useContext(I18nContext)
  const returnFocus = React.useRef<HTMLElement[]>([])
  const interactedOutside = React.useRef(false)
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl bg-(--surface-dialog) backdrop-blur-(--surface-popup-blur) p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
        onOpenAutoFocus={(event) => {
          // 受控弹窗可能没有 DialogTrigger；在焦点进入弹窗前保存操作位置。
          returnFocus.current = []
          interactedOutside.current = false
          let target = document.activeElement
          while (target instanceof HTMLElement && target !== document.body) {
            if (target.tagName !== "MAIN" && (target === document.activeElement || target.hasAttribute("tabindex"))) {
              returnFocus.current.push(target)
            }
            target = target.parentElement
          }
          onOpenAutoFocus?.(event)
        }}
        onInteractOutside={(event) => {
          onInteractOutside?.(event)
          if (!event.defaultPrevented) interactedOutside.current = true
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event)
          // 非模态弹窗保留 Radix 对外部点击的焦点处理；显式恢复回调始终优先。
          if (event.defaultPrevented || (!modal && interactedOutside.current)) return
          for (const target of returnFocus.current) {
            if (focusDialogTarget(target)) {
              event.preventDefault()
              break
            }
          }
          // 嵌套弹窗可能同时关闭，不覆盖外层已经恢复的有效位置。
          if (!event.defaultPrevented && (
            focusDialogTarget(document.activeElement) ||
            focusDialogTarget(document.querySelector("main[tabindex]"))
          )) event.preventDefault()
          returnFocus.current = []
        }}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-2 right-2"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="sr-only">{closeLabel ?? i18n?.t("common.close") ?? "Close"}</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  closeLabel,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
  closeLabel?: string
}) {
  const i18n = React.useContext(I18nContext)
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">{closeLabel ?? i18n?.t("common.close") ?? "Close"}</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
