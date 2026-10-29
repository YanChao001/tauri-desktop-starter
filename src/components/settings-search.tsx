import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  focusSetting,
  searchSettings,
  SETTINGS_SEARCH_ENTRIES,
} from "@/commands/settings-search";
import { useI18n } from "@/providers/i18n";

export function SettingsSearch() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [params] = useSearchParams();
  const { key: locationKey } = useLocation();
  const results = useMemo(() => searchSettings(query, t), [query, t]);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const resultList = useRef<HTMLUListElement>(null);
  const requested = params.get("focus");
  const section = params.get("section");
  useEffect(() => {
    const entry = SETTINGS_SEARCH_ENTRIES.find((item) => item.id === requested);
    if (entry) focusSetting(entry.anchor);
    else if (section === "desktop") focusSetting("settings-desktop");
    else if (section === "updates") focusSetting("settings-updates");
  }, [requested, section, locationKey]);
  function chooseSetting(target: string) {
    focusSetting(target);
    setQuery("");
  }

  return (
    <Popover
      modal={false}
      open={Boolean(query.trim())}
      onOpenChange={(open) => {
        if (!open) setQuery("");
      }}
    >
      <PopoverAnchor asChild>
        <div ref={anchor} className="relative">
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            ref={input}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t("settings.search")}
            aria-describedby={query.trim() ? id : undefined}
            placeholder={t("settings.searchPlaceholder")}
            className="pl-9"
            onKeyDown={(event) => {
              if (
                event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === 229
              )
                return;
              if (event.key === "Enter" && results[0]) {
                event.preventDefault();
                chooseSetting(results[0].anchor);
              }
              if (event.key === "ArrowDown" && results.length) {
                event.preventDefault();
                resultList.current
                  ?.querySelector<HTMLButtonElement>("button")
                  ?.focus();
              }
              if (event.key === "Escape") setQuery("");
            }}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        aria-label={t("settings.search")}
        className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] gap-1 p-2"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (
            event.target instanceof Node &&
            anchor.current?.contains(event.target)
          )
            event.preventDefault();
        }}
        onEscapeKeyDown={() => {
          setQuery("");
          input.current?.focus({ preventScroll: true });
        }}
      >
        <p
          id={id}
          role="status"
          className="px-2 py-1 text-xs text-muted-foreground"
        >
          {results.length
            ? t("settings.searchResults", { count: results.length })
            : t("settings.searchEmpty")}
        </p>
        <ul ref={resultList} className="max-h-60 overflow-y-auto">
          {results.map((entry) => (
            <li key={entry.id}>
              <Button
                variant="ghost"
                className="h-auto w-full justify-start whitespace-normal px-2 py-2 text-left"
                onClick={() => chooseSetting(entry.anchor)}
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate">{t(entry.labelKey)}</span>
                  {entry.descriptionKey ? (
                    <span className="line-clamp-2 text-xs font-normal text-muted-foreground">
                      {t(entry.descriptionKey)}
                    </span>
                  ) : null}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
