import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { saveTextExport } from "@/lib/tauri";
import { nativeErrorText } from "@/lib/native-error";
import { useI18n } from "@/providers/i18n";
import { SAMPLE_CSV } from "@/features/data-studio/csv";

const ORIGINAL =
  "Project notes\nOwner: Lin\nStatus: Draft\nNext: Review the proposal\n";
const CHANGED =
  "Project notes\nOwner: Alex\nStatus: Reviewed\nNext: Schedule a meeting\n";

export function JourneySamples({ path }: { path: string }) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  if (!["/data-studio", "/workbench", "/database", "/tasks"].includes(path))
    return null;
  async function download(name: string, text: string) {
    setPending(true);
    setError(null);
    try {
      await saveTextExport(name, text);
    } catch (reason) {
      if (mounted.current) setError(reason);
    } finally {
      if (mounted.current) setPending(false);
    }
  }
  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      <p className="text-xs text-muted-foreground">
        {t(
          path === "/data-studio"
            ? "samples.csvHint"
            : path === "/tasks"
              ? "samples.tasksHint"
              : "samples.textHint",
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {path === "/data-studio" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => void download("sample.csv", SAMPLE_CSV)}
          >
            {t("csv.downloadSample")}
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => void download("workflow-original.txt", ORIGINAL)}
            >
              {t("samples.original")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => void download("workflow-changed.txt", CHANGED)}
            >
              {t("samples.changed")}
            </Button>
          </>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {nativeErrorText(error, t)}
        </p>
      ) : null}
    </div>
  );
}
