import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CopyIcon, RefreshCwIcon } from "lucide-react";
import { NativePage, ResourceError } from "@/components/native-page";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import { useNativeResource } from "@/hooks/use-native-resource";
import { getDiagnosticsReport } from "@/lib/tauri";
import { copyText } from "@/lib/clipboard";
import { nativeErrorText } from "@/lib/native-error";
import { CodeBlock } from "@/components/code-block";
export default function Diagnostics() {
  const { t } = useI18n();
  const latest = useLatestTranslator();
  const { data, error, loading, reload } =
    useNativeResource(getDiagnosticsReport);
  const [copying, setCopying] = useState(false);
  const running = useRef(false);
  const mounted = useRef(false);
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
      <ResourceError error={error} retry={() => void reload()} />
      <div className="flex gap-2">
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
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("diagnostics.preview")}</CardTitle>
          <CardDescription>{t("diagnostics.logs")}</CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock
            data-testid="diagnostics-report"
            aria-label={t("diagnostics.preview")}
            className="max-h-[32rem] whitespace-pre-wrap break-words"
            code={data ? JSON.stringify(data, null, 2) : t("common.loading")}
            language={data ? "json" : "text"}
          />
        </CardContent>
      </Card>
    </NativePage>
  );
}
