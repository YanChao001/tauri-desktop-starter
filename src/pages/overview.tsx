import {
  ArrowRightIcon,
  BoxesIcon,
  CheckIcon,
  CopyIcon,
  PaletteIcon,
  ShieldCheckIcon,
  ZapIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const FEATURES = [
  {
    icon: ZapIcon,
    title: "启动不闪白屏",
    description: "窗口默认隐藏，首帧渲染完成后再显示，Rust 侧还有 3 秒兜底。",
  },
  {
    icon: PaletteIcon,
    title: "主题开箱可用",
    description: "浅色 / 深色 / 跟随系统三态，基于 CSS 变量，无闪烁切换。",
  },
  {
    icon: ShieldCheckIcon,
    title: "外链不劫持",
    description: "页面里的 http 链接一律交给系统浏览器，不在 WebView 内跳走。",
  },
  {
    icon: BoxesIcon,
    title: "体积已压过",
    description:
      "release 档开启 LTO、strip、单 codegen unit，安装包维持在个位数 MB。",
  },
];

const COMMANDS = [
  { command: "pnpm install", hint: "安装依赖" },
  { command: "pnpm app:dev", hint: "开发模式（热更新）" },
  { command: "pnpm app:build", hint: "出安装包" },
];

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("已复制到剪贴板");
  } catch {
    toast.error("复制失败，请手动选择文本");
  }
}

export default function Overview() {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {["Tauri 2", "React 19", "Vite 8", "Tailwind 4", "shadcn/ui"].map(
            (item) => (
              <Badge key={item} variant="secondary" className="font-normal">
                {item}
              </Badge>
            ),
          )}
        </div>
        <h2 className="text-2xl font-medium tracking-tight">
          桌面应用基座已就绪
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          这是一个可直接复用的 Tauri 桌面工程：前端负责界面，Rust
          负责系统能力，两边通过类型化的 IPC
          通信。把它复制一份、改掉名字，就能开始写业务。
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button asChild>
            <Link to="/bridge">
              试一试 Rust 调用
              <ArrowRightIcon />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <a href="https://v2.tauri.app/" target="_blank" rel="noreferrer">
              阅读 Tauri 文档
            </a>
          </Button>
        </div>
      </section>

      <Separator />

      <section className="grid gap-3 sm:grid-cols-2">
        {FEATURES.map((feature) => (
          <Card key={feature.title} className="shadow-none">
            <CardHeader className="gap-1.5">
              <div className="flex size-7 items-center justify-center rounded-md bg-muted">
                <feature.icon className="size-4 text-muted-foreground" />
              </div>
              <CardTitle className="text-sm">{feature.title}</CardTitle>
              <CardDescription className="text-xs leading-relaxed">
                {feature.description}
              </CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>

      <section>
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-sm">三条命令</CardTitle>
            <CardDescription className="text-xs">
              从安装依赖到产出安装包，只需要这些。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {COMMANDS.map((item) => (
              <div
                key={item.command}
                className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <CheckIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <code className="truncate font-mono text-xs">
                    {item.command}
                  </code>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {item.hint}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`复制 ${item.command}`}
                    onClick={() => void copyText(item.command)}
                  >
                    <CopyIcon />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
