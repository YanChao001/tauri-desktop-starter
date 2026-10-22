import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2Icon, TerminalIcon } from "lucide-react";
import { toast } from "sonner";
import { CodeBlock } from "@/components/code-block";
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
import { nativeErrorText } from "@/lib/native-error";
import type { Language } from "@/i18n/registry";

const RUST_SNIPPET = `// src-tauri/src/commands.rs
#[tauri::command]
#[specta::specta]
pub fn greet(name: &str, language: Option<&str>) -> NativeResult<String> {
    bounded_text(name, 800, "Name")?;
    if name.chars().count() > 200 {
        return Err(NativeError::new(ErrorCode::InputTooLong, "Name exceeds 200 characters"));
    }
    if let Some(language) = language {
        bounded_text(language, 32, "Language")?;
    }
    let name = name.trim();
    let english = language == Some("en");
    if name.is_empty() {
        return Err(NativeError::new(ErrorCode::NameRequired,
            if english { "Name cannot be empty" } else { "名称不能为空" }));
    }
    Ok(if english {
        format!("Hello, {name}! This message comes from Rust.")
    } else {
        format!("你好，{name}！这条消息来自 Rust。")
    })
}`;

const TS_SNIPPET = `// pnpm bindings:generate 导出 Rust 数据类型和命令
// lib/tauri.ts：所有渲染进程 IPC 均通过此门面调用
export async function invokeGreet(
  name: string, language: Language = "zh",
): Promise<string> {
  const result = await commands.greet(name, language);
  if (result.status === "error") throw new NativeBridgeError(result.error);
  return result.data;
}

// pages/bridge.tsx
const { language } = useI18n();
const message = await invokeGreet("Ada", language);`;

export default function Bridge() {
  const { t, language } = useI18n();
  const [name, setName] = useState("");
  const [result, setResult] = useState<{
    message: string;
    language: Language;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const currentLanguage = useRef(language);

  useLayoutEffect(() => {
    currentLanguage.current = language;
  }, [language]);

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
      const message = await invokeGreet(name, language);
      if (!mounted.current || currentLanguage.current !== language) return;
      setResult({ message, language });
      toast.success(t("bridge.success"));
    } catch (error) {
      if (!mounted.current || currentLanguage.current !== language) return;
      const message = t("bridge.failed", { error: nativeErrorText(error, t) });
      setResult({ message, language });
      toast.error(message);
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <div className="studio-page">
      <div className="studio-intro">
        <span className="studio-eyebrow">{t("studio.bridgeEyebrow")}</span>
        <div className="flex items-center gap-2">
          <TerminalIcon className="size-4 text-muted-foreground" />
          <h2>{t("bridge.title")}</h2>
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
                maxLength={200}
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
              {result?.language === language
                ? result.message
                : t("bridge.notCalled")}
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
            <CodeBlock
              code={RUST_SNIPPET}
              language="rust"
              aria-label="src-tauri/src/commands.rs"
              className="p-3"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium">
              {t("bridge.frontend")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CodeBlock
              code={TS_SNIPPET}
              language="typescript"
              className="p-3"
            />
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">{t("bridge.note")}</p>
    </div>
  );
}
