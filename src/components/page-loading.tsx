import type { ComponentProps } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/providers/i18n";
import { cn } from "@/lib/utils";

/** 路由模块与扩展初始化共用同一组尺寸，不按预计业务内容预留大面板。 */
export function PageLoading({ className, ...props }: ComponentProps<"div">) {
  const { t } = useI18n();
  return (
    <div
      {...props}
      role="status"
      aria-label={t("common.loading")}
      className={cn("space-y-3", className)}
      data-page-loading
    >
      <span className="sr-only">{t("common.loading")}</span>
      <Skeleton aria-hidden="true" className="h-7 w-40" />
      <Skeleton aria-hidden="true" className="h-4 w-2/3" />
      <Skeleton aria-hidden="true" className="h-48 w-full" />
    </div>
  );
}
