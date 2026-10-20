import { useEffect, useMemo, useState } from "react";
import {
  CheckIcon,
  Code2Icon,
  CopyIcon,
  InfoIcon,
  Maximize2Icon,
  MinusIcon,
  MonitorIcon,
  MoonIcon,
  RefreshCwIcon,
  SettingsIcon,
  SunIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { APP_CONFIG } from "@/config/app";
import appIcon from "../../resources/branding/app-icon.svg";
import { CommandMenuItem } from "@/components/command-menu-item";
import { Button } from "@/components/ui/button";
import { LanguageSwitch } from "@/components/language-switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useThemeSwitch } from "@/hooks/use-theme-switch";
import { useI18n } from "@/providers/i18n";
import { isMacOS } from "@/lib/platform";
import { useSettings } from "@/providers/settings";
import { useCommands } from "@/providers/commands";
import { formatShortcut } from "@/commands/shortcuts";
import { isTauri, isWindowMaximized, onWindowResized } from "@/lib/tauri";
import { cn } from "@/lib/utils";

/**
 * 自绘标题栏：菜单、拖拽区域与窗口按钮。
 *
 * Windows / Linux 用右侧的自绘按钮；macOS 由平台配置保留系统红绿灯，
 * 这里只负责给红绿灯让出位置（见 src-tauri/tauri.macos.conf.json）。
 */
export function TitleBar() {
  const { t } = useI18n();
  const { settings } = useSettings();
  const { theme } = useThemeSwitch();
  const { execute, aboutOpen, setAboutOpen } = useCommands();
  const mac = isMacOS();

  const native = useMemo(() => typeof window !== "undefined" && isTauri(), []);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    let request = 0;

    async function syncMaximized() {
      const current = ++request;
      try {
        const value = await isWindowMaximized();
        if (!cancelled && current === request) setMaximized(value);
      } catch (error) {
        console.warn("读取窗口状态失败", error);
      }
    }

    void syncMaximized();
    void onWindowResized(() => {
      void syncMaximized();
    })
      .then((stop) => {
        // 订阅注册是异步的，StrictMode 的清理可能先于它完成
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch((error: unknown) => {
        console.warn("监听窗口状态失败", error);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [native]);

  return (
    <div
      data-tauri-drag-region
      className="app-title-bar flex h-10 shrink-0 select-none items-stretch border-b bg-background/80 backdrop-blur"
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 pl-3",
          mac && "pl-[78px]",
        )}
      >
        <img
          src={appIcon}
          alt={APP_CONFIG.name}
          width={24}
          height={24}
          draggable={false}
          data-tauri-drag-region
          className="size-6 shrink-0"
        />

        {settings.menuBar ? (
          <nav className="ml-1 flex items-center" aria-label={APP_CONFIG.name}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  {t("title.file")}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                <CommandMenuItem id="open-settings" icon={SettingsIcon} />
                <DropdownMenuSeparator />
                <CommandMenuItem id="reload" icon={RefreshCwIcon} />
                <CommandMenuItem id="quit" icon={XIcon} />
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  {t("title.edit")}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <CommandMenuItem id="copy-link" icon={CopyIcon} />
                <CommandMenuItem id="select-all" icon={CheckIcon} />
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  {t("title.view")}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuLabel>{t("settings.theme")}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={theme ?? "system"}
                  onValueChange={(value) => void execute(`theme-${value}`)}
                >
                  <DropdownMenuRadioItem value="light">
                    <SunIcon />
                    {t("title.light")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">
                    <MoonIcon />
                    {t("title.dark")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system">
                    <MonitorIcon />
                    {t("title.system")}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={settings.menuBar}
                  onCheckedChange={() => void execute("toggle-menu")}
                >
                  {t("title.toggleMenu")}
                </DropdownMenuCheckboxItem>
                <CommandMenuItem id="toggle-sidebar" />
                <CommandMenuItem id="command-palette" icon={SearchIcon} />
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  {t("title.help")}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <CommandMenuItem id="open-docs" icon={InfoIcon} />
                <CommandMenuItem id="open-repo" icon={Code2Icon} />
                <DropdownMenuSeparator />
                <CommandMenuItem id="check-updates" />
                <CommandMenuItem id="copy-diagnostics" />
                <CommandMenuItem id="about" />
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
        ) : null}
      </div>

      <div data-tauri-drag-region className="min-w-8 flex-1" />

      <div className="flex items-stretch">
        <Button
          variant="ghost"
          size="icon"
          className="size-10 rounded-none"
          aria-label={t("commands.open")}
          title={formatShortcut({ key: "k", primary: true })}
          onClick={() => void execute("command-palette")}
        >
          <SearchIcon className="size-4" />
        </Button>
        <LanguageSwitch compact className="my-auto" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-10 rounded-none"
              aria-label={t("title.toggleTheme")}
              onClick={(event) =>
                void execute("toggle-theme", {
                  point: { clientX: event.clientX, clientY: event.clientY },
                })
              }
            >
              <SunIcon className="size-4 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
              <MoonIcon className="absolute size-4 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t("title.toggleTheme")}
          </TooltipContent>
        </Tooltip>

        {native && !mac ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t("title.minimize")}
                  onClick={() => void execute("minimize-window")}
                  className="flex w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <MinusIcon className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t("title.minimize")}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={
                    maximized ? t("title.restore") : t("title.maximize")
                  }
                  onClick={() => void execute("toggle-maximize")}
                  className="flex w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Maximize2Icon className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {maximized ? t("title.restore") : t("title.maximize")}
              </TooltipContent>
            </Tooltip>
            <button
              type="button"
              aria-label={t("title.close")}
              onClick={() => void execute("close-window")}
              className="flex w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-white"
            >
              <XIcon className="size-4" />
            </button>
          </>
        ) : !native ? (
          <span className="my-auto mr-2 rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
            {t("app.preview")}
          </span>
        ) : null}
      </div>

      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent className="sm:max-w-md" closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>
              {t("title.about")} {APP_CONFIG.name}
            </DialogTitle>
            <DialogDescription>
              {settings.appMode === "demo"
                ? t("title.aboutBody")
                : APP_CONFIG.name}
            </DialogDescription>
          </DialogHeader>
          {settings.appMode === "demo" ? (
            <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
              {[
                "Tauri 2",
                "React 19",
                "TypeScript 6",
                "Tailwind 4",
                "shadcn/ui",
              ].map((item) => (
                <span key={item} className="rounded-full border px-2 py-0.5">
                  {item}
                </span>
              ))}
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setAboutOpen(false)}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
