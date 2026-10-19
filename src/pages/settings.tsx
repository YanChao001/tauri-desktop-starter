import { useEffect, useState } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getAppInfo, isTauri, openExternal } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const THEMES = [
  { value: "light", label: "浅色", icon: SunIcon },
  { value: "dark", label: "深色", icon: MoonIcon },
  { value: "system", label: "跟随系统", icon: MonitorIcon },
] as const;

const LINKS = [
  { label: "Tauri 官方文档", url: "https://v2.tauri.app/" },
  { label: "shadcn/ui 组件库", url: "https://ui.shadcn.com/" },
  { label: "Tailwind CSS", url: "https://tailwindcss.com/" },
];

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const [version, setVersion] = useState("—");
  const [tauriVersion, setTauriVersion] = useState("—");

  useEffect(() => {
    if (!isTauri) return;
    void (async () => {
      try {
        const info = await getAppInfo();
        setVersion(info.version);
        setTauriVersion(info.tauriVersion);
      } catch (error) {
        console.error("读取版本信息失败", error);
      }
    })();
  }, []);

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <h2 className="text-base font-medium">设置</h2>
        <p className="text-sm text-muted-foreground">
          这里演示了主题切换与运行时信息的读取方式，业务设置项可以按同样结构往下加。
        </p>
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-sm">外观</CardTitle>
          <CardDescription className="text-xs">
            主题通过 CSS 变量生效，切换时不刷新页面。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map((item) => {
              const active = theme === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setTheme(item.value)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border px-3 py-4 text-xs transition-colors",
                    active
                      ? "border-primary/60 bg-muted/60 font-medium"
                      : "text-muted-foreground hover:bg-muted/40",
                  )}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-sm">运行时信息</CardTitle>
          <CardDescription className="text-xs">
            这些值来自 Rust 侧，浏览器预览时不可用。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <Row label="应用版本" value={version} />
          <Separator />
          <Row label="Tauri 版本" value={tauriVersion} />
          <Separator />
          <Row
            label="运行环境"
            value={isTauri ? "原生窗口" : "浏览器预览"}
            badge
          />
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-sm">相关链接</CardTitle>
          <CardDescription className="text-xs">
            点击后由系统默认浏览器打开，不会在应用内跳转。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {LINKS.map((link) => (
            <button
              key={link.url}
              type="button"
              onClick={() => void openExternal(link.url)}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/60"
            >
              <span>{link.label}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {new URL(link.url).host}
              </span>
            </button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

type RowProps = {
  label: string;
  value: string;
  badge?: boolean;
};

function Row({ label, value, badge = false }: RowProps) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {badge ? (
        <Badge variant="secondary" className="font-normal">
          {value}
        </Badge>
      ) : (
        <span className="font-mono text-xs">{value}</span>
      )}
    </div>
  );
}
