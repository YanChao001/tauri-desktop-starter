import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpenIcon,
  CommandIcon,
  CopyIcon,
  MonitorIcon,
  MoonIcon,
  PanelLeftIcon,
  SettingsIcon,
  SunIcon,
} from "lucide-react";
import { toast } from "sonner";
import { APP_CONFIG } from "@/config/app";
import {
  commandAvailable,
  type AppCommand,
  type CommandInvocation,
} from "@/commands/types";
import { matchesShortcut } from "@/commands/shortcuts";
import { SETTINGS_SEARCH_ENTRIES } from "@/commands/settings-search";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import { useThemeSwitch } from "@/hooks/use-theme-switch";
import { copyText } from "@/lib/clipboard";
import { nativeErrorText } from "@/lib/native-error";
import {
  closeWindow,
  isTauri,
  minimizeWindow,
  openExternal,
  quitApp,
  toggleMaximizeWindow,
} from "@/lib/tauri";
import { useSettings } from "@/providers/settings";
import { APP_ROUTES } from "@/routes";

type CommandsContextValue = {
  commands: AppCommand[];
  execute: (id: string, invocation?: CommandInvocation) => Promise<boolean>;
  register: (commands: readonly AppCommand[]) => () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  aboutOpen: boolean;
  setAboutOpen: (open: boolean) => void;
};

const CommandsContext = createContext<CommandsContextValue | null>(null);

export function CommandsProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { settings, update } = useSettings();
  const { resolvedTheme, setTheme, toggle } = useThemeSwitch();
  const themeToggle = useRef(toggle);
  useLayoutEffect(() => {
    themeToggle.current = toggle;
  }, [toggle]);
  const t = useLatestTranslator();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [extensions, setExtensions] = useState<
    Map<symbol, readonly AppCommand[]>
  >(() => new Map());
  const running = useRef(new Set<string>());

  const builtins = useMemo<AppCommand[]>(
    () => [
      ...APP_ROUTES.filter(
        (route) =>
          route.path !== "/settings" &&
          (settings.appMode !== "minimal" || !route.demoOnly),
      ).map((route) => ({
        id: `navigate:${route.path}`,
        labelKey: route.labelKey,
        group: "navigation" as const,
        icon: route.icon,
        keywords: [route.path],
        run: () => navigate(route.path),
      })),
      {
        id: "command-palette",
        labelKey: "commands.open",
        group: "navigation",
        icon: CommandIcon,
        shortcuts: [{ key: "k", primary: true, allowInEditable: true }],
        run: () => setPaletteOpen((open) => !open),
      },
      ...SETTINGS_SEARCH_ENTRIES.map((entry) => ({
        id: `settings:${entry.id}`,
        labelKey: entry.labelKey,
        group: "appearance" as const,
        icon: SettingsIcon,
        keywords: [...entry.keywords],
        keywordKeys: entry.searchKeys,
        run: () => navigate(`/settings?focus=${encodeURIComponent(entry.id)}`),
      })),
      {
        id: "open-settings",
        labelKey: "title.settings",
        group: "navigation",
        icon: SettingsIcon,
        shortcuts: [{ key: ",", primary: true }],
        run: () => navigate("/settings"),
      },
      {
        id: "toggle-sidebar",
        labelKey: "layout.toggleSidebar",
        group: "appearance",
        icon: PanelLeftIcon,
        shortcuts: [{ key: "b", primary: true }],
        run: () => update({ sidebarCollapsed: !settings.sidebarCollapsed }),
      },
      {
        id: "toggle-menu",
        labelKey: "title.toggleMenu",
        group: "appearance",
        run: () => update({ menuBar: !settings.menuBar }),
      },
      {
        id: "toggle-theme",
        labelKey: "title.toggleTheme",
        group: "appearance",
        run: (invocation) => {
          if (invocation?.point) themeToggle.current(invocation.point);
          else setTheme(resolvedTheme === "dark" ? "light" : "dark");
        },
      },
      ...(["light", "dark", "system"] as const).map((theme) => ({
        id: `theme-${theme}`,
        labelKey: `title.${theme}` as const,
        group: "appearance" as const,
        icon:
          theme === "light"
            ? SunIcon
            : theme === "dark"
              ? MoonIcon
              : MonitorIcon,
        run: () => setTheme(theme),
      })),
      {
        id: "reload",
        labelKey: "title.reload",
        group: "window",
        shortcuts: [{ key: "r", primary: true }],
        run: () => window.location.reload(),
      },
      {
        id: "minimize-window",
        labelKey: "title.minimize",
        group: "window",
        available: isTauri,
        run: minimizeWindow,
      },
      {
        id: "toggle-maximize",
        labelKey: "title.maximize",
        group: "window",
        available: isTauri,
        run: toggleMaximizeWindow,
      },
      {
        id: "close-window",
        labelKey: "title.close",
        group: "window",
        available: isTauri,
        run: closeWindow,
      },
      {
        id: "quit",
        labelKey: "title.quit",
        group: "window",
        available: isTauri,
        run: quitApp,
      },
      {
        id: "copy-link",
        labelKey: "title.copyLink",
        group: "help",
        icon: CopyIcon,
        run: async () => {
          await copyText(window.location.href);
          toast.success(t("common.copied"));
        },
      },
      {
        id: "select-all",
        labelKey: "title.selectAll",
        group: "help",
        run: () => {
          const active = document.activeElement;
          if (
            active instanceof HTMLInputElement ||
            active instanceof HTMLTextAreaElement
          )
            active.select();
          else document.execCommand("selectAll");
        },
      },
      {
        id: "open-docs",
        labelKey: "title.docs",
        group: "help",
        icon: BookOpenIcon,
        run: () => openExternal(APP_CONFIG.docsUrl),
      },
      {
        id: "open-repo",
        labelKey: "title.repo",
        group: "help",
        run: () => openExternal(APP_CONFIG.repositoryUrl),
      },
      {
        id: "about",
        labelKey: "title.about",
        group: "help",
        run: () => setAboutOpen(true),
      },
      {
        id: "open-desktop",
        labelKey: "commands.openDesktop",
        group: "tools",
        run: () => navigate("/desktop"),
      },
      {
        id: "open-window",
        labelKey: "commands.openWindow",
        group: "tools",
        run: () => navigate("/desktop"),
      },
      {
        id: "open-database",
        labelKey: "commands.openDatabase",
        group: "tools",
        run: () => navigate("/database"),
      },
      {
        id: "check-updates",
        labelKey: "commands.checkUpdates",
        group: "tools",
        run: () => navigate("/updates"),
      },
      {
        id: "copy-diagnostics",
        labelKey: "commands.copyDiagnostics",
        group: "tools",
        available: () => false,
        run: () => {},
      },
    ],
    [
      navigate,
      resolvedTheme,
      setTheme,
      settings.appMode,
      settings.menuBar,
      settings.sidebarCollapsed,
      t,
      update,
    ],
  );

  const commands = useMemo(() => {
    const result = new Map(builtins.map((command) => [command.id, command]));
    for (const registration of extensions.values())
      for (const command of registration) result.set(command.id, command);
    return [...result.values()];
  }, [builtins, extensions]);

  const register = useCallback((items: readonly AppCommand[]) => {
    const token = Symbol("commands");
    setExtensions((current) => new Map(current).set(token, items));
    return () => {
      setExtensions((current) => {
        const next = new Map(current);
        next.delete(token);
        return next;
      });
    };
  }, []);

  const execute = useCallback(
    async (id: string, invocation?: CommandInvocation) => {
      const command = commands.find((item) => item.id === id);
      if (!command || !commandAvailable(command) || running.current.has(id))
        return false;
      running.current.add(id);
      try {
        await command.run(invocation);
        return true;
      } catch (error) {
        toast.error(nativeErrorText(error, t));
        return false;
      } finally {
        running.current.delete(id);
      }
    },
    [commands, t],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = commands.find(
        (item) =>
          commandAvailable(item) &&
          item.shortcuts?.some((shortcut) => matchesShortcut(event, shortcut)),
      );
      if (!command) return;
      event.preventDefault();
      void execute(command.id);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [commands, execute]);

  const value = useMemo(
    () => ({
      commands,
      execute,
      register,
      paletteOpen,
      setPaletteOpen,
      aboutOpen,
      setAboutOpen,
    }),
    [commands, execute, register, paletteOpen, aboutOpen],
  );
  return (
    <CommandsContext.Provider value={value}>
      {children}
    </CommandsContext.Provider>
  );
}

export function useCommands() {
  const value = useContext(CommandsContext);
  if (!value) throw new Error("useCommands requires CommandsProvider");
  return value;
}

/** Register a memoized array; cleanup restores any commands overridden by this feature. */
export function useRegisterCommands(commands: readonly AppCommand[]) {
  const { register } = useCommands();
  useEffect(() => register(commands), [commands, register]);
}
