import { LanguagesIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getLocale, isLanguage, LANGUAGES, LOCALES } from "@/i18n/registry";
import { cn } from "@/lib/utils";
import { useI18n } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";

type LanguageSwitchProps = {
  compact?: boolean;
  className?: string;
};

/** 标题栏与设置页共用注册表和持久化入口。 */
export function LanguageSwitch({
  compact = false,
  className,
}: LanguageSwitchProps) {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const locale = getLocale(settings.language);
  const trigger = (
    <SelectTrigger
      size="sm"
      aria-label={t("common.language")}
      aria-description={locale.nativeName}
      className={cn(
        "w-40",
        compact &&
          "app-title-language h-8 w-22 gap-1.5 border-0 bg-transparent px-2 text-[13px] shadow-none",
        className,
      )}
    >
      {compact ? (
        <LanguagesIcon className="size-3.5" aria-hidden="true" />
      ) : null}
      <SelectValue>
        {compact ? locale.shortLabel : locale.nativeName}
      </SelectValue>
    </SelectTrigger>
  );

  return (
    <Select
      value={settings.language}
      onValueChange={(value) => {
        if (isLanguage(value)) update({ language: value });
      }}
    >
      {compact ? (
        <Tooltip disableHoverableContent>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="bottom">
            {t("common.language")} · {locale.nativeName}
          </TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <SelectContent position="popper" align="end">
        {LANGUAGES.map((language) => (
          <SelectItem
            key={language}
            value={language}
            lang={LOCALES[language].documentLang}
            textValue={LOCALES[language].nativeName}
          >
            {LOCALES[language].nativeName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
