import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { CopyIcon, RefreshCwIcon } from "lucide-react";
import { NativePage, ResourceError } from "@/components/native-page";
import { HelpTooltip } from "@/components/help-tooltip";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import { useNativeResource } from "@/hooks/use-native-resource";
import { getDiagnosticsReport } from "@/lib/tauri";
import { copyText } from "@/lib/clipboard";
import { nativeErrorText } from "@/lib/native-error";
import { CodeBlock } from "@/components/code-block";
import { RecoveryContent } from "./recovery";
export default function Diagnostics() {
  const { t } = useI18n();
  const { search } = useLocation();
  const recovery = useRef<HTMLElement>(null);
  const latest = useLatestTranslator();
  const { data, error, loading, reload } =
    useNativeResource(getDiagnosticsReport);
  const [copying, setCopying] = useState(false);
  const running = useRef(false);
  const mounted = useRef(false);
  const notifiedError = useRef<unknown>(null);
  useEffect(() => {
    if (new URLSearchParams(search).get("section") !== "recovery") return;
    recovery.current?.scrollIntoView({ block: "start" });
    recovery.current?.focus({ preventScroll: true });
  }, [search]);
  useEffect(() => {
    if (!error) notifiedError.current = null;
    else if (data && notifiedError.current !== error) {
      notifiedError.current = error;
      toast.error(nativeErrorText(error, latest));
    }
  }, [data, error, latest]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function copy() {
    if (!data || running.current) return;
    running.current = true;
    setCopying(true);
    try {
      await copyText(JSON.stringify(data, null, 2));
      if (mounted.current) toast.success(latest("diagnostics.copied"));
    } catch (reason) {
      if (mounted.current) toast.error(nativeErrorText(reason, latest));
    } finally {
      running.current = false;
      if (mounted.current) setCopying(false);
    }
  }
  return (
    <NativePage
      title={t("diagnostics.title")}
      description={t("diagnostics.description")}
    >
      <section
        id="diagnostics-recovery"
        ref={recovery}
        tabIndex={-1}
        aria-label={t("recovery.title")}
        className="space-y-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RecoveryContent />
      </section>
      <ResourceError error={data ? null : error} retry={() => void reload()} />
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            {t("diagnostics.preview")}
            <HelpTooltip
              label={`${t("diagnostics.preview")} · ${t("title.help")}`}
            >
              {t("diagnostics.logs")}
            </HelpTooltip>
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={loading || copying || !data}
              onClick={() => void copy()}
            >
              <CopyIcon />
              {t("diagnostics.copy")}
            </Button>
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => void reload()}
            >
              <RefreshCwIcon />
              {t("diagnostics.refresh")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <details>
            <summary className="cursor-pointer rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("diagnostics.details")}
            </summary>
            <CodeBlock
              data-testid="diagnostics-report"
              aria-label={t("diagnostics.preview")}
              className="mt-3 h-96 max-h-[60dvh] whitespace-pre-wrap break-words"
              code={data ? JSON.stringify(data, null, 2) : t("common.loading")}
              language={data ? "json" : "text"}
            />
          </details>
        </CardContent>
      </Card>
    </NativePage>
  );
}
