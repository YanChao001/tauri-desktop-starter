import { lazy, Suspense, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SafeMarkdown } from "@/components/safe-markdown";
import type { ExtensionView as View, ExtensionViewBlock } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useI18n } from "@/providers/i18n";
import { LOCKED_CONTROL_CLASS, LOCKED_INPUT_CLASS } from "./control-styles";

export const EXTENSION_FIELD_BYTES = 64 * 1024;
export const EXTENSION_FORM_BYTES = 1024 * 1024;
export function extensionFieldBytes(field: View["fields"][number]): number {
  return field.maxBytes ?? EXTENSION_FIELD_BYTES;
}
const ExtensionChart = lazy(() =>
  import("./extension-chart").then((module) => ({
    default: module.ExtensionChart,
  })),
);

function ViewTable({
  columns,
  rows,
  label,
}: {
  columns: string[];
  rows: string[][];
  label?: string;
}) {
  const { t } = useI18n();
  const [requestedPage, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  const page = Math.min(requestedPage, pages - 1);
  return (
    <div className="min-w-0 space-y-2">
      <div
        className="min-w-0 overflow-auto rounded-xl border"
        tabIndex={0}
        aria-label={label ?? columns.join(" / ")}
      >
        <table className="w-full text-left text-sm">
          {label ? <caption className="sr-only">{label}</caption> : null}
          <thead className="bg-muted/50">
            <tr>
              {columns.map((column, i) => (
                <th scope="col" key={i} className="px-4 py-3 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.slice(page * 50, (page + 1) * 50).map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className="max-w-80 break-words px-4 py-3 align-top"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {t("data.pageCount", {
              from: page * 50 + 1,
              to: Math.min((page + 1) * 50, rows.length),
              total: rows.length,
            })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            {t("data.previous")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page === pages - 1}
            onClick={() => setPage(page + 1)}
          >
            {t("data.next")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ViewBlock({ block }: { block: ExtensionViewBlock }) {
  if (block.kind === "markdown")
    return (
      <div className="min-w-0 rounded-xl border bg-card p-5">
        <SafeMarkdown content={block.text} />
      </div>
    );
  if (block.kind === "metrics")
    return (
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {block.items.map((metric, i) => (
          <div key={i} className="min-w-0 rounded-xl border bg-card p-4">
            <dt className="text-xs text-muted-foreground">{metric.label}</dt>
            <dd className="mt-2 break-words text-xl font-semibold tracking-tight">
              {metric.value}
            </dd>
          </div>
        ))}
      </dl>
    );
  if (block.kind === "progress") {
    if (block.value === null || block.max === null) return null;
    return (
      <div className="space-y-2 rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span>{block.label}</span>
          <span className="text-muted-foreground">
            {Math.round((block.value / block.max) * 100)}%
          </span>
        </div>
        <progress
          aria-label={block.label}
          value={block.value}
          max={block.max}
          className="h-2 w-full accent-primary"
        />
      </div>
    );
  }
  if (block.kind === "image")
    return (
      <figure className="overflow-hidden rounded-xl border bg-card p-3">
        <img
          src={block.src}
          alt={block.alt}
          loading="lazy"
          className="mx-auto h-auto max-h-[36rem] max-w-full object-contain"
        />
      </figure>
    );
  if (block.kind === "chart")
    return (
      <div className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
        <Suspense
          fallback={
            <p className="text-sm text-muted-foreground">{block.label}</p>
          }
        >
          <ExtensionChart block={block} />
        </Suspense>
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            {block.label}
          </summary>
          <div className="mt-3">
            <ViewTable
              label={block.label}
              columns={[
                block.label,
                ...block.series.map((series) => series.label),
              ]}
              rows={block.labels.map((label, index) => [
                label,
                ...block.series.map((series) => String(series.values[index])),
              ])}
            />
          </div>
        </details>
      </div>
    );
  return <ViewTable columns={block.columns} rows={block.rows} />;
}

/** Every layout is protocol data. No extension IDs or application algorithms here. */
export function ExtensionView({
  view,
  fields,
  blocked,
  invalidFields,
  onField,
  onAction,
}: {
  view: View;
  fields: Record<string, string>;
  blocked: boolean;
  invalidFields: ReadonlySet<string>;
  onField: (id: string, value: string) => void;
  onAction: (action: string) => void;
}) {
  const id = useId();
  const { t } = useI18n();
  const actionsBlocked = blocked || invalidFields.size > 0;
  const controls = view.fields.length > 0 || view.groups.length > 0;
  const body = (
    <div
      className={cn(
        "grid min-w-0 gap-6",
        controls && (view.blocks?.length ?? 0) > 0 && "lg:grid-cols-2",
      )}
    >
      {controls ? (
        <div className="min-w-0 space-y-4">
          {view.fields.map((field) => {
            const fieldId = `${id}-${field.id}`;
            const value = fields[field.id] ?? "";
            const byteLimit = extensionFieldBytes(field);
            const fieldError = view.errors?.[field.id];
            const invalid = invalidFields.has(field.id) || Boolean(fieldError);
            const errorId = `${fieldId}-error`;
            const props = {
              id: fieldId,
              value,
              disabled: blocked,
              "data-operation-locked": blocked,
              className: LOCKED_INPUT_CLASS,
              "aria-invalid": invalid,
              "aria-describedby": invalid ? errorId : undefined,
              onChange: (
                event: React.ChangeEvent<
                  HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
                >,
              ) => onField(field.id, event.target.value),
            };
            return (
              <div key={field.id} className="space-y-2">
                {field.kind === "checkbox" ? (
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id={fieldId}
                      checked={value === "true"}
                      aria-invalid={invalid}
                      aria-describedby={invalid ? errorId : undefined}
                      disabled={blocked}
                      data-operation-locked={blocked}
                      className={LOCKED_CONTROL_CLASS}
                      onCheckedChange={(checked) =>
                        onField(field.id, String(checked === true))
                      }
                    />
                    <Label
                      htmlFor={fieldId}
                      data-operation-locked={blocked}
                      className="leading-relaxed data-[operation-locked=true]:peer-disabled:opacity-100"
                    >
                      {field.label}
                    </Label>
                  </div>
                ) : (
                  <>
                    <Label htmlFor={fieldId}>{field.label}</Label>
                    {field.kind === "textarea" ? (
                      <Textarea
                        {...props}
                        className={cn(
                          "min-h-40 resize-y font-mono text-sm",
                          LOCKED_INPUT_CLASS,
                        )}
                      />
                    ) : field.kind === "select" ? (
                      <Select
                        value={`option:${value}`}
                        disabled={blocked}
                        onValueChange={(next) =>
                          onField(field.id, next.slice("option:".length))
                        }
                      >
                        <SelectTrigger
                          id={fieldId}
                          aria-invalid={invalid}
                          aria-describedby={invalid ? errorId : undefined}
                          data-operation-locked={blocked}
                          className={cn("w-full", LOCKED_CONTROL_CLASS)}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          {field.options?.map((option) => (
                            <SelectItem
                              key={option.value}
                              value={`option:${option.value}`}
                            >
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        {...props}
                        type={
                          field.kind === "number"
                            ? "number"
                            : field.kind === "date"
                              ? "date"
                              : "text"
                        }
                      />
                    )}
                  </>
                )}
                {invalid ? (
                  <p id={errorId} className="text-xs text-destructive">
                    {invalidFields.has(field.id)
                      ? t("ext.fieldLimit", { bytes: byteLimit })
                      : fieldError}
                  </p>
                ) : null}
              </div>
            );
          })}
          {view.groups.map((group, index) => (
            <div
              key={index}
              className={cn(
                "grid gap-2",
                group.board &&
                  "mx-auto w-full max-w-[22rem] rounded-2xl border bg-muted/30 p-3",
              )}
              style={{
                gridTemplateColumns: `repeat(${group.columns}, minmax(0, 1fr))`,
              }}
            >
              {group.actions.map((action) =>
                group.board && action.disabled ? (
                  <span
                    key={action.id}
                    role={action.ariaLabel ? "group" : undefined}
                    aria-label={action.ariaLabel ?? undefined}
                    className={cn(
                      "flex aspect-square min-w-0 items-center justify-center rounded-xl border bg-card p-0 text-center font-semibold leading-none text-card-foreground",
                      group.columns >= 6 || action.label.length >= 5
                        ? "text-sm"
                        : action.label.length >= 3
                          ? "text-xl"
                          : "text-3xl",
                    )}
                  >
                    {action.label}
                  </span>
                ) : (
                  <Button
                    key={action.id}
                    variant={action.primary ? "default" : "outline"}
                    aria-label={action.ariaLabel ?? undefined}
                    className={cn(
                      "h-auto min-h-11 min-w-0 whitespace-normal break-words",
                      LOCKED_CONTROL_CLASS,
                      group.board &&
                        "aspect-square min-h-0 rounded-xl p-0 leading-none shadow-sm disabled:opacity-100",
                      group.board &&
                        (group.columns >= 6 || action.label.length >= 5
                          ? "text-sm"
                          : action.label.length >= 3
                            ? "text-xl"
                            : "text-3xl"),
                    )}
                    disabled={invalidFields.size > 0 || action.disabled}
                    aria-disabled={actionsBlocked || action.disabled}
                    data-operation-locked={
                      blocked && !action.disabled && invalidFields.size === 0
                    }
                    onClick={() => {
                      if (!actionsBlocked && !action.disabled)
                        onAction(action.id);
                    }}
                  >
                    {action.label}
                  </Button>
                ),
              )}
            </div>
          ))}
        </div>
      ) : null}
      {(view.blocks?.length ?? 0) > 0 ? (
        <div className="min-w-0 space-y-4">
          {view.blocks?.map((block, i) => (
            <ViewBlock key={i} block={block} />
          ))}
        </div>
      ) : null}
    </div>
  );
  const tabs = view.tabs ?? [];
  if (!tabs.length) return body;
  return (
    <Tabs
      value={tabs.find((tab) => tab.active)?.id}
      onValueChange={(action) => {
        if (!actionsBlocked) onAction(action);
      }}
    >
      <TabsList
        className="mb-4 grid w-full gap-1 bg-muted/50 p-1 group-data-horizontal/tabs:h-auto"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 8rem), 1fr))",
        }}
      >
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
            disabled={invalidFields.size > 0}
            aria-disabled={actionsBlocked}
            data-operation-locked={blocked && invalidFields.size === 0}
            className={cn(
              "h-auto min-h-9 min-w-0 whitespace-normal",
              LOCKED_CONTROL_CLASS,
            )}
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {/* 保持面板在同一次提交中切换，避免内容短暂消失让滚动位置被压回顶部。 */}
      {tabs.map((tab) => (
        <TabsContent
          key={tab.id}
          value={tab.id}
          forceMount
          hidden={!tab.active}
          className="min-w-0"
        >
          {tab.active ? body : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}
