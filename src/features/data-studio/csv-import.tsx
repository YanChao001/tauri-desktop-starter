import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { HelpTooltip } from "@/components/help-tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveTextExport } from "@/lib/tauri";
import { nativeErrorText } from "@/lib/native-error";
import { useI18n } from "@/providers/i18n";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import type { DemoRecord } from "./model";
import {
  CsvError,
  MAX_CSV_BYTES,
  RECORD_FIELDS,
  SAMPLE_CSV,
  guessMapping,
  issuesCsv,
  parseCsv,
  validateImport,
  type CsvTable,
  type FieldMapping,
} from "./csv";

export function CsvImport({
  onImport,
  disabled = false,
}: {
  onImport: (records: DemoRecord[]) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const latest = useLatestTranslator();
  const [source, setSource] = useState("");
  const [table, setTable] = useState<CsvTable | null>(null);
  const [mapping, setMapping] = useState<FieldMapping>({
    name: null,
    email: null,
    team: null,
    status: null,
    budget: null,
  });
  const [partial, setPartial] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const result = useMemo(() => {
    if (!table) return null;
    try {
      return validateImport(table, mapping);
    } catch {
      return null;
    }
  }, [table, mapping]);
  function check(text: string) {
    try {
      const parsed = parseCsv(text);
      setTable(parsed);
      setMapping(guessMapping(parsed.headers));
      setPartial(false);
      setError(null);
    } catch (reason) {
      setTable(null);
      setError(reason);
    }
  }
  async function read(file: File | undefined) {
    if (!file) return;
    const token = ++generation.current;
    setPending(true);
    setTable(null);
    setPartial(false);
    setError(null);
    try {
      if (file.size > MAX_CSV_BYTES) throw new CsvError("size");
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(
          await file.arrayBuffer(),
        );
      } catch {
        throw new CsvError("format");
      }
      if (token !== generation.current) return;
      setSource(text);
      check(text);
    } catch (reason) {
      if (token === generation.current) setError(reason);
    } finally {
      if (token === generation.current) setPending(false);
    }
  }
  async function download(name: string, text: string) {
    const token = generation.current;
    setPending(true);
    setError(null);
    try {
      await saveTextExport(name, text);
    } catch (reason) {
      if (token === generation.current)
        toast.error(nativeErrorText(reason, latest));
    } finally {
      if (token === generation.current) setPending(false);
    }
  }
  const busy = pending || disabled;
  const errorText = error
    ? error instanceof CsvError
      ? t(`csv.error.${error.code}`)
      : nativeErrorText(error, t)
    : null;
  return (
    <details className="app-surface border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        {t("csv.title")}
      </summary>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              generation.current++;
              setSource(SAMPLE_CSV);
              check(SAMPLE_CSV);
            }}
          >
            {t("csv.sample")}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void download("sample.csv", SAMPLE_CSV)}
          >
            {t("csv.downloadSample")}
          </Button>
        </div>
        <div className="space-y-2">
          <Label htmlFor="csv-file">{t("csv.file")}</Label>
          <Input
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(event) => {
              void read(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
        <div className="space-y-2">
          <div className="flex h-6 min-w-0 items-center gap-2">
            <Label htmlFor="csv-source" className="shrink-0">
              {t("csv.source")}
            </Label>
            <HelpTooltip label={t("csv.hint")}>{t("csv.hint")}</HelpTooltip>
            {errorText ? (
              <div role="alert" className="min-w-0 flex-1">
                <TooltipProvider delayDuration={650} skipDelayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        data-surface="transparent"
                        data-variant="ghost"
                        id="csv-source-error"
                        type="button"
                        className="block w-full truncate rounded-sm text-right text-xs text-destructive underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {errorText}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      className="max-w-72 leading-relaxed"
                    >
                      {errorText}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            ) : null}
          </div>
          <Textarea
            id="csv-source"
            value={source}
            rows={5}
            disabled={busy}
            className="font-mono text-xs"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "csv-source-error" : undefined}
            onChange={(event) => {
              setSource(event.target.value);
              setTable(null);
              setError(null);
            }}
          />
          <Button disabled={busy || !source} onClick={() => check(source)}>
            {t("csv.check")}
          </Button>
        </div>
        {table ? (
          <>
            <fieldset className="space-y-3">
              <legend className="flex items-center gap-2 font-medium">
                {t("csv.mapping")}
                <HelpTooltip label={`${t("csv.mapping")} · ${t("title.help")}`}>
                  {t("csv.defaults")}
                </HelpTooltip>
              </legend>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {RECORD_FIELDS.map((field) => (
                  <div key={field} className="space-y-1">
                    <Label htmlFor={`csv-map-${field}`}>
                      {t(`labs.data.${field}`)}
                    </Label>
                    <Select
                      value={
                        mapping[field] === null
                          ? "none"
                          : String(mapping[field])
                      }
                      disabled={busy}
                      onValueChange={(value) => {
                        setMapping((current) => ({
                          ...current,
                          [field]: value === "none" ? null : Number(value),
                        }));
                        setPartial(false);
                      }}
                    >
                      <SelectTrigger id={`csv-map-${field}`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper" align="start">
                        <SelectItem value="none">{t("csv.none")}</SelectItem>
                        {table.headers.map((header, index) => (
                          <SelectItem key={header} value={String(index)}>
                            {header}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </fieldset>
            {result ? (
              <>
                <p role="status" className="h-6 truncate text-sm tabular-nums">
                  {t("csv.summary", {
                    valid: result.records.length,
                    invalid: result.rejected,
                  })}
                </p>
                {result.issues.length ? (
                  <div className="space-y-3 rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-medium">{t("csv.issues")}</h4>
                      <HelpTooltip
                        label={`${t("csv.issues")} · ${t("title.help")}`}
                      >
                        {t("csv.issueHint")}
                      </HelpTooltip>
                    </div>
                    <div className="max-h-48 overflow-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr>
                            <th scope="col">{t("csv.row")}</th>
                            <th scope="col">{t("csv.field")}</th>
                            <th scope="col">{t("csv.value")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.issues.slice(0, 50).map((issue, index) => (
                            <tr key={index}>
                              <td>{issue.row}</td>
                              <td>
                                {issue.field === "row"
                                  ? t("csv.row")
                                  : t(`labs.data.${issue.field}`)}
                              </td>
                              <td className="max-w-48 break-all">
                                {issue.value}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void download(
                          "import-errors.csv",
                          issuesCsv(result.issues),
                        )
                      }
                    >
                      {t("csv.issueExport")}
                    </Button>
                    <Label>
                      <Checkbox
                        checked={partial}
                        disabled={busy}
                        onCheckedChange={(checked) =>
                          setPartial(checked === true)
                        }
                      />
                      {t("csv.partial")}
                    </Label>
                  </div>
                ) : null}
                <Button
                  disabled={
                    busy ||
                    !result.records.length ||
                    (result.rejected > 0 && !partial)
                  }
                  onClick={() => onImport(result.records)}
                >
                  {t("csv.apply")}
                </Button>
              </>
            ) : (
              <p
                role="alert"
                className="h-10 overflow-auto text-sm text-destructive"
              >
                {t("csv.error.mapping")}
              </p>
            )}
            <div
              className="max-h-80 overflow-auto rounded-md border"
              tabIndex={0}
              role="region"
              aria-label={t("csv.preview")}
            >
              <table className="min-w-full text-left text-xs">
                <caption className="p-2 text-left">{t("csv.preview")}</caption>
                <thead>
                  <tr>
                    {table.headers.map((header) => (
                      <th
                        key={header}
                        scope="col"
                        data-surface="reading"
                        className="whitespace-nowrap p-2"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.slice(0, 20).map((row, index) => (
                    <tr key={index}>
                      {row.map((value, column) => (
                        <td
                          key={column}
                          className="max-w-64 break-words border-t p-2"
                        >
                          {value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </details>
  );
}
