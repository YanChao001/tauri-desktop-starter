import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useThemeSwitch } from "@/hooks/use-theme-switch";
import { useI18n } from "@/providers/i18n";

/** 独立的主题切换按钮；圆形扩散效果与标题栏一致。 */
export function ThemeToggle() {
  const { toggle } = useThemeSwitch();
  const { t } = useI18n();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("title.toggleTheme")}
      onClick={(event) => toggle(event)}
    >
      <SunIcon className="size-4 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
      <MoonIcon className="absolute size-4 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
    </Button>
  );
}
