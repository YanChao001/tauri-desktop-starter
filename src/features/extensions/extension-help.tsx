import { HelpTooltip } from "@/components/help-tooltip";
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
    <HelpTooltip
      label={t("ext.tools.help", { name: label })}
      data-extension-help
    >
      {children}
    </HelpTooltip>
  );
}
