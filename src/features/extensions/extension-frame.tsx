import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EllipsisIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useI18n } from "@/providers/i18n";
import type { ExtensionInfo } from "@/lib/tauri";
import { useExtensionChromeTarget } from "./extension-chrome-slot";
import { ExtensionHelp } from "./extension-help";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** 嵌入和独立窗口共用宿主工具栏，业务内容单独占据 surface。 */
export function ExtensionFrame({
  item,
  feedback,
  announcement,
  tools,
  children,
}: {
  item: ExtensionInfo;
  feedback: ReactNode;
  announcement?: string;
  tools: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const label = useId();
  const target = useExtensionChromeTarget();
  const [open, setOpen] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const restoringFocus = useRef(false);
  const toolbar = (
    <>
      <TooltipProvider delayDuration={650} skipDelayDuration={0}>
        <Tooltip
          open={hintOpen && !open}
          onOpenChange={(value) => {
            if (!restoringFocus.current && !open) setHintOpen(value);
          }}
        >
          <Popover
            key={`${item.generation}:${item.package.manifest.id}`}
            open={open}
            onOpenChange={(value) => {
              setOpen(value);
              setHintOpen(false);
            }}
          >
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size={target?.placement === "titlebar" ? "icon" : "icon-sm"}
                  className={
                    target?.placement === "titlebar"
                      ? "size-10 rounded-none"
                      : undefined
                  }
                  aria-label={t("ext.sessionTools")}
                >
                  <EllipsisIcon />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t("ext.sessionTools")}
            </TooltipContent>
            <PopoverContent
              role="region"
              aria-labelledby={label}
              align="end"
              collisionPadding={12}
              onOpenAutoFocus={(event) => {
                if (!(event.target instanceof HTMLElement)) return;
                const action = event.target.querySelector<HTMLElement>(
                  "button:not([data-extension-help]):not(:disabled),input:not(:disabled),summary",
                );
                if (action) {
                  event.preventDefault();
                  action.focus();
                }
              }}
              onCloseAutoFocus={() => {
                restoringFocus.current = true;
                queueMicrotask(() => {
                  restoringFocus.current = false;
                });
              }}
              className="max-h-[80dvh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto p-3"
            >
              <PopoverHeader className="flex-row items-center justify-between space-y-0">
                <PopoverTitle id={label}>{t("ext.sessionTools")}</PopoverTitle>
                <ExtensionHelp label={t("ext.sessionTools")}>
                  {t("ext.appSessionHint")}
                </ExtensionHelp>
              </PopoverHeader>
              {feedback}
              <div className="space-y-3">{tools}</div>
            </PopoverContent>
          </Popover>
        </Tooltip>
      </TooltipProvider>
    </>
  );
  return (
    <div className="min-w-0">
      {target ? createPortal(toolbar, target.node) : null}
      {target && !open ? (
        <span
          role="status"
          aria-label={t("ext.appStatus")}
          aria-live="polite"
          className="sr-only"
        >
          {announcement}
        </span>
      ) : null}
      <div data-extension-surface className="min-w-0">
        {children}
      </div>
    </div>
  );
}

export function ExtensionToolGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-2 border-t pt-3">
      <h3 id={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </h3>
      {children}
    </section>
  );
}
