import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { Translate } from "@/i18n/translate";
import type { MessageKey } from "@/i18n/zh-CN";
import { reportClientError } from "@/lib/report-error";
import { errorMessage } from "@/lib/native-error";
import { useI18n } from "@/providers/i18n";

class PageBoundary extends Component<
  {
    children: ReactNode;
    t: Translate;
    onBack: () => void;
    backLabel: MessageKey;
  },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return {
      error: error instanceof Error ? error : new Error(errorMessage(error)),
    };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError(error, info.componentStack ?? undefined);
  }
  render() {
    if (!this.state.error) return this.props.children;
    const { t, onBack, backLabel } = this.props;
    return (
      <section role="alert" className="rounded-xl border bg-card p-6">
        <h2 className="text-base font-medium">{t("common.renderError")}</h2>
        <p className="mt-2 break-words font-mono text-xs text-muted-foreground">
          {this.state.error.message}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => this.setState({ error: null })}>
            {t("common.retry")}
          </Button>
          <Button variant="outline" onClick={onBack}>
            {t(backLabel)}
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            {t("common.reload")}
          </Button>
        </div>
      </section>
    );
  }
}

/** 页面失败时保留应用外壳、导航和命令面板 */
export function RouteErrorBoundary({
  children,
  onBack,
  backLabel = "common.backHome",
  resetKey,
}: {
  children: ReactNode;
  onBack?: () => void;
  backLabel?: MessageKey;
  resetKey?: string;
}) {
  const { key } = useLocation();
  const navigate = useNavigate();
  const { t } = useI18n();
  return (
    <PageBoundary
      key={resetKey ?? key}
      t={t}
      onBack={onBack ?? (() => navigate("/"))}
      backLabel={backLabel}
    >
      {children}
    </PageBoundary>
  );
}
