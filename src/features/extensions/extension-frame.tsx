import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { EllipsisIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/providers/i18n";
import type { ExtensionInfo } from "@/lib/tauri";
import { useExtensionChromeTarget } from "./extension-chrome-slot";
import { useExtensionActivity } from "./extension-activity";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** 通用操作放在宿主菜单，异步工作与对话框由会话持续持有。 */
export function ExtensionFrame({
  item,
  announcement,
  tools,
  triggerRef,
  children,
}: {
  item: ExtensionInfo;
  announcement?: string;
  tools: ReactNode;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const active = useExtensionActivity();
  const activity = useRef(active);
  activity.current = active;
  const chromeTarget = useExtensionChromeTarget();
  const target = active ? chromeTarget : null;
  const [open, setOpen] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const restoringFocus = useRef(false);
  useEffect(() => {
    if (active) return;
    setOpen(false);
    setHintOpen(false);
  }, [active]);
  const toolbar = (
    <TooltipProvider delayDuration={650} skipDelayDuration={0}>
      <Tooltip
        disableHoverableContent
        open={active && hintOpen && !open}
        onOpenChange={(value) => {
          if (!restoringFocus.current && !open) setHintOpen(value);
        }}
      >
        <DropdownMenu
          key={`${item.generation}:${item.package.manifest.id}`}
          modal={false}
          open={active && open}
          onOpenChange={(value) => {
            setOpen(value);
            setHintOpen(false);
          }}
        >
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                ref={triggerRef}
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
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("ext.sessionTools")}</TooltipContent>
          <DropdownMenuContent
            aria-label={t("ext.sessionTools")}
            side={target?.placement === "navigation" ? "right" : "bottom"}
            align={target?.placement === "navigation" ? "start" : "end"}
            collisionPadding={12}
            onCloseAutoFocus={(event) => {
              if (
                !activity.current ||
                document.activeElement?.closest('[role="dialog"]')
              )
                event.preventDefault();
              restoringFocus.current = true;
              queueMicrotask(() => {
                restoringFocus.current = false;
              });
            }}
            className="w-max max-w-[calc(100vw-1.5rem)]"
          >
            {tools}
          </DropdownMenuContent>
        </DropdownMenu>
      </Tooltip>
    </TooltipProvider>
  );
  return (
    <div className="min-w-0">
      {target ? createPortal(toolbar, target.node) : null}
      <span
        role="status"
        aria-label={t("ext.appStatus")}
        aria-live="polite"
        className="sr-only"
      >
        {announcement}
      </span>
      <div data-extension-surface className="min-w-0">
        {children}
      </div>
    </div>
  );
}
