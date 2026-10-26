import { InfoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/providers/i18n";

export function ExtensionHelp({
  label,
  children,
}: {
  label: string;
  children: string;
}) {
  const { t } = useI18n();
  return (
    <TooltipProvider delayDuration={650} skipDelayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-extension-help
            aria-label={t("ext.tools.help", { name: label })}
          >
            <InfoIcon className="size-3.5 text-muted-foreground" />
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          collisionPadding={8}
          className="max-w-[min(18rem,var(--radix-tooltip-content-available-width))] leading-relaxed"
        >
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
