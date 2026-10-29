import type { ComponentProps, ReactNode } from "react";
import { CircleHelpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** 补充说明按需显示；触发按钮同时支持指针悬停与键盘聚焦。 */
export function HelpTooltip({
  label,
  children,
  className,
  ...props
}: Omit<
  ComponentProps<typeof Button>,
  "children" | "aria-label" | "variant" | "size"
> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <TooltipProvider delayDuration={650} skipDelayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            {...props}
            type="button"
            variant="ghost"
            size="icon-xs"
            className={className}
            aria-label={label}
          >
            <CircleHelpIcon
              className="size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          collisionPadding={8}
          className="max-h-[min(18rem,var(--radix-tooltip-content-available-height))] max-w-[min(18rem,var(--radix-tooltip-content-available-width))] overflow-auto break-words leading-relaxed"
        >
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
