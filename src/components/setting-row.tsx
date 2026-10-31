import { useId, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { HelpTooltip } from "@/components/help-tooltip";
import { useI18n } from "@/providers/i18n";

type SettingLabelProps = {
  icon?: LucideIcon;
  label: ReactNode;
  hint?: ReactNode;
  helpLabel?: string;
};

/** 设置行与独立选项组共用图标、文字和补充说明的起点。 */
export function SettingLabel({
  icon: Icon,
  label,
  hint,
  helpLabel,
}: SettingLabelProps) {
  const { t } = useI18n();
  const labelId = useId();
  const tooltipLabel =
    helpLabel ??
    (typeof label === "string"
      ? t("common.helpFor", { name: label })
      : t("title.help"));
  return (
    <div className="flex min-w-0 items-center gap-2">
      {Icon ? (
        <Icon
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      ) : null}
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
  );
}

/** 偏好与桌面控制共用标签、说明和尾部操作的布局。 */
export function SettingRow({
  id,
  icon,
  label,
  hint,
  helpLabel,
  children,
}: SettingLabelProps & {
  id?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      tabIndex={id ? -1 : undefined}
      className="settings-row rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <SettingLabel
        icon={icon}
        label={label}
        hint={hint}
        helpLabel={helpLabel}
      />
      <div className="settings-row-control">{children}</div>
    </div>
  );
}
