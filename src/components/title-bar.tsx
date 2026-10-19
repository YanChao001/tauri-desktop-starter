import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  DropdownMenuItem,
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
import {
  closeWindow,
  isTauri,
  isWindowMaximized,
  minimizeWindow,
  onWindowResized,
  openExternal,
  toggleMaximizeWindow,
} from "@/lib/tauri";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

const DOCS_URL = "https://v2.tauri.app/";
const REPO_URL = "https://github.com/YanChao001/tauri-desktop-starter";

/**
 * 自绘标题栏：菜单、拖拽区域与窗口按钮。
 *
 * Windows / Linux 用右侧的自绘按钮；macOS 由平台配置保留系统红绿灯，
 * 这里只负责给红绿灯让出位置（见 src-tauri/tauri.macos.conf.json）。
 */
export function TitleBar() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const { theme, setTheme, toggle } = useThemeSwitch();
  const mac = isMacOS();

  const native = useMemo(() => typeof window !== "undefined" && isTauri(), []);
  const [maximized, setMaximized] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    async function syncMaximized() {
      try {
        const value = await isWindowMaximized();
        if (!cancelled) setMaximized(value);
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

  function run(action: () => Promise<void>) {
    void action().catch((error) => toast.error(String(error)));
  }

  async function handleCopyLink() {
    try {
      await copyText(window.location.href);
      toast.success(t("common.copied"));
    } catch {
      toast.error(t("common.copyFailed"));
    }
  }

  async function handleOpen(url: string) {
    try {
      await openExternal(url);
    } catch (error) {
      console.error("打开外链失败", error);
      toast.error(t("common.openFailed"));
    }
  }

  function handleSelectAll() {
    document.execCommand("selectAll");
  }

  return (
    <div
      data-tauri-drag-region
      className="flex h-10 shrink-0 select-none items-stretch border-b bg-background/80 backdrop-blur"
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 pl-3",
          mac && "pl-[78px]",
        )}
      >
        <div className="flex size-6 items-center justify-center rounded-md bg-primary text-[10px] font-semibold text-primary-foreground">
          TS
        </div>
        <span className="hidden truncate text-xs font-medium sm:inline">
          {t("app.name")}
        </span>

        {settings.menuBar ? (
          <nav className="ml-1 flex items-center" aria-label={t("app.name")}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  {t("title.file")}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                <DropdownMenuItem onSelect={() => navigate("/settings")}>
                  <SettingsIcon />
                  {t("title.settings")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => window.location.reload()}>
                  <RefreshCwIcon />
                  {t("title.reload")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!native}
                  onSelect={() => run(closeWindow)}
                >
                  <XIcon />
                  {t("title.quit")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  {t("title.edit")}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem onSelect={() => void handleCopyLink()}>
                  <CopyIcon />
                  {t("title.copyLink")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleSelectAll}>
                  <CheckIcon />
                  {t("title.selectAll")}
                </DropdownMenuItem>
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
                  onValueChange={setTheme}
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
                  onCheckedChange={(checked) => update({ menuBar: checked })}
                >
                  {t("title.toggleMenu")}
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  {t("title.help")}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem onSelect={() => void handleOpen(DOCS_URL)}>
                  <InfoIcon />
                  {t("title.docs")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void handleOpen(REPO_URL)}>
                  <Code2Icon />
                  {t("title.repo")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setAboutOpen(true)}>
                  {t("title.about")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
        ) : null}
      </div>

      <div data-tauri-drag-region className="min-w-8 flex-1" />

      <div className="flex items-stretch">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-10 rounded-none"
              aria-label={t("title.toggleTheme")}
              onClick={(event) => toggle(event)}
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
                  onClick={() => run(minimizeWindow)}
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
                  onClick={() =>
                    run(async () => {
                      setMaximized(await toggleMaximizeWindow());
                    })
                  }
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
              onClick={() => run(closeWindow)}
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("title.aboutTitle")}</DialogTitle>
            <DialogDescription>{t("title.aboutBody")}</DialogDescription>
          </DialogHeader>
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
