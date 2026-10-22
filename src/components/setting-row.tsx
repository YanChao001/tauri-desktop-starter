import type { ReactNode } from "react";

/** 偏好与桌面控制共用标签、说明和尾部操作的布局。 */
export function SettingRow({
  id,
  label,
  hint,
  children,
}: {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      tabIndex={id ? -1 : undefined}
      className="settings-row rounded-md py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="min-w-0 space-y-1.5">
        <div className="text-sm font-medium">{label}</div>
        {hint ? (
          <div className="text-xs leading-relaxed text-muted-foreground">
            {hint}
          </div>
        ) : null}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}
