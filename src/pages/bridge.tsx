import { useState } from "react";
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
  const [name, setName] = useState("超哥");
  const [result, setResult] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleInvoke() {
    if (!isTauri()) {
      toast.error("浏览器预览模式下无法调用，请用 pnpm app:dev 启动");
      return;
    }
    setPending(true);
    try {
      const message = await invokeGreet(name);
      setResult(message);
      toast.success("Rust 命令执行成功");
    } catch (error) {
      setResult(null);
      toast.error(`调用失败：${String(error)}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <TerminalIcon className="size-4 text-muted-foreground" />
          <h2 className="text-base font-medium">前端 ↔ Rust 通信</h2>
          <Badge variant="outline" className="font-normal">
            invoke
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          前端通过 <code className="font-mono text-xs">invoke</code> 调用 Rust
          命令，返回值自动序列化为 TypeScript 类型。这是所有系统能力的入口。
        </p>
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-sm">调用示例</CardTitle>
          <CardDescription className="text-xs">
            修改参数后点按钮。名称留空会命中 Rust 侧的校验，用来演示错误如何跨
            IPC 传回前端。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1 space-y-1.5">
              <Label htmlFor="name" className="text-xs">
                名称
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="输入一个名字"
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleInvoke();
                }}
              />
            </div>
            <Button onClick={() => void handleInvoke()} disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : null}
              调用 greet
            </Button>
          </div>

          <div className="rounded-md border bg-muted/40 px-3 py-2.5">
            <p className="text-xs text-muted-foreground">返回结果</p>
            <p className="mt-1 font-mono text-sm">{result ?? "尚未调用"}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-xs font-medium">
              src-tauri/src/lib.rs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md bg-muted/60 p-3 font-mono text-xs leading-relaxed">
              {RUST_SNIPPET}
            </pre>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-xs font-medium">前端调用</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md bg-muted/60 p-3 font-mono text-xs leading-relaxed">
              {TS_SNIPPET}
            </pre>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        新增命令时记得把它注册进{" "}
        <code className="font-mono">invoke_handler</code>，否则前端调用会报
        “command not found”。
      </p>
    </div>
  );
}
