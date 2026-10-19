import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

/**
 * 渲染层兜底。
 *
 * 桌面应用崩在 React 里比崩在网页里更难查：窗口默认是隐藏的，
 * 出错时用户只会看到 Rust 兜底线程在 3 秒后弹出的空白窗口，没有任何线索。
 * 这里至少留下错误文本、控制台堆栈和一次重试入口。
 *
 * React 的错误边界只能用类组件实现，这是规范里对 class 的唯一例外。
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("界面渲染失败", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background p-8 text-center text-foreground">
        <p className="text-sm font-medium">界面出错了</p>
        <p className="max-w-md font-mono text-xs break-words text-muted-foreground">
          {error.message}
        </p>
        <Button size="sm" onClick={() => window.location.reload()}>
          重新加载
        </Button>
      </div>
    );
  }
}
