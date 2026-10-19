import { useEffect, useRef, useState } from "react";
import { Loader2Icon, TerminalIcon } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/providers/i18n";
import { invokeGreet, isTauri } from "@/lib/tauri";

const RUST_SNIPPET = `// src-tauri/src/commands.rs
#[tauri::command]
pub fn greet(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("名称不能为空".into());
    }
    Ok(format!("你好，{name}！这条消息来自 Rust。"))
}`;

const TS_SNIPPET = `// lib/tauri.ts —— 所有 IPC 收敛在这里
export async function invokeGreet(name: string): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("greet", { name });
}

// 页面里只调用封装好的函数，并处理它抛出的错误
const message = await invokeGreet("超哥");`;

export default function Bridge() {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function handleInvoke() {
    // 回车和按钮共用入口；React 提交 disabled 之前也只能发出一次调用。
    if (inFlight.current) return;
    if (!isTauri()) {
      toast.error(t("bridge.browserOnly"));
      return;
    }
    inFlight.current = true;
    setPending(true);
    try {
      const message = await invokeGreet(name);
      if (!mounted.current) return;
      setResult(message);
      toast.success(t("bridge.success"));
    } catch (error) {
      if (!mounted.current) return;
      const message = t("bridge.failed", { error: String(error) });
      setResult(message);
      toast.error(message);
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <TerminalIcon className="size-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold tracking-tight">
            {t("bridge.title")}
          </h2>
          <Badge variant="outline" className="font-normal">
            invoke
          </Badge>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("bridge.subtitle")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("bridge.demo")}</CardTitle>
          <CardDescription className="text-xs">
            {t("bridge.demoHint")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void handleInvoke();
            }}
            aria-busy={pending}
          >
            <div className="min-w-48 flex-1 space-y-1.5">
              <Label htmlFor="name" className="text-xs">
                {t("bridge.name")}
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("bridge.namePlaceholder")}
                onKeyDown={(event) => {
                  // 中文输入法确认候选词的 Enter 不应提交表单。
                  if (event.key === "Enter" && event.nativeEvent.isComposing) {
                    event.preventDefault();
                  }
                }}
              />
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : null}
              {t("bridge.call")}
            </Button>
          </form>

          <div
            className="rounded-md border bg-muted/40 px-3 py-2.5"
            role="status"
            aria-live="polite"
          >
            <p className="text-xs text-muted-foreground">
              {t("bridge.result")}
            </p>
            <p className="mt-1 font-mono text-sm">
              {result ?? t("bridge.notCalled")}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-xs font-medium">
              src-tauri/src/commands.rs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md bg-muted/60 p-3 font-mono text-xs leading-relaxed">
              {RUST_SNIPPET}
            </pre>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium">
              {t("bridge.frontend")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md bg-muted/60 p-3 font-mono text-xs leading-relaxed">
              {TS_SNIPPET}
            </pre>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">{t("bridge.note")}</p>
    </div>
  );
}
