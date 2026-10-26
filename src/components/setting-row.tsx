import { useId, type ReactNode } from "react";
import { HelpTooltip } from "@/components/help-tooltip";
import { useI18n } from "@/providers/i18n";

/** 偏好与桌面控制共用标签、说明和尾部操作的布局。 */
export function SettingRow({
  id,
  label,
  hint,
  helpLabel,
  children,
}: {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  helpLabel?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const labelId = useId();
  const tooltipLabel =
    helpLabel ??
    (typeof label === "string"
      ? t("common.helpFor", { name: label })
      : t("title.help"));
  return (
    <div
      id={id}
      tabIndex={id ? -1 : undefined}
      className="settings-row rounded-md py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <div id={labelId} className="min-w-0 text-sm font-medium">
          {label}
        </div>
        {hint ? (
          <HelpTooltip
            label={tooltipLabel}
            aria-labelledby={
              !helpLabel && typeof label !== "string" ? labelId : undefined
            }
            className="shrink-0"
          >
            {hint}
          </HelpTooltip>
        ) : null}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}
