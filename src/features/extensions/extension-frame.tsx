import { useId, useState, type ReactNode } from "react";
import { EllipsisIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useI18n } from "@/providers/i18n";
import type { ExtensionInfo } from "@/lib/tauri";
import { ExtensionIcon } from "./extension-icon";

/** 嵌入和独立窗口共用宿主工具栏，业务内容单独占据 surface。 */
export function ExtensionFrame({
  item,
  feedback,
  tools,
  children,
}: {
  item: ExtensionInfo;
  feedback: ReactNode;
  tools: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const label = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 space-y-3">
      <header className="flex h-9 min-w-0 items-center gap-2 border-b">
        <ExtensionIcon
          name={item.package.manifest.icon}
          className="size-4 shrink-0 text-muted-foreground"
        />
        <h1
          className="min-w-0 flex-1 truncate text-sm font-medium"
          title={item.package.manifest.name}
        >
          {item.package.manifest.name}
        </h1>
        {feedback}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("ext.sessionTools")}
              title={t("ext.sessionTools")}
            >
              <EllipsisIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            role="region"
            aria-labelledby={label}
            align="end"
            collisionPadding={12}
            className="max-h-[80dvh] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto p-4"
          >
            <PopoverHeader>
              <PopoverTitle id={label}>{t("ext.sessionTools")}</PopoverTitle>
              <PopoverDescription>{t("ext.appSessionHint")}</PopoverDescription>
            </PopoverHeader>
            <div className="space-y-4">{tools}</div>
          </PopoverContent>
        </Popover>
      </header>
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
