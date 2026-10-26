import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/providers/i18n";

export function ExtensionLoading() {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-label={t("common.loading")}
      className="min-h-64 space-y-4"
      data-extension-loading
    >
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <Skeleton className="min-h-56" />
        <Skeleton className="min-h-56" />
      </div>
      <span className="sr-only">{t("common.loading")}</span>
    </div>
  );
}
