import { useId } from "react";
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

export const EXTENSION_FIELD_BYTES = 2048;

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
  return (
    <div className="min-w-0 overflow-auto rounded-xl border" tabIndex={0}>
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/50">
          <tr>
            {block.columns.map((column, i) => (
              <th key={i} className="px-4 py-3 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {block.rows.map((row, i) => (
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
  );
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
            const invalid = invalidFields.has(field.id);
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
                        maxLength={EXTENSION_FIELD_BYTES}
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
                        type={field.kind === "number" ? "number" : "text"}
                        maxLength={EXTENSION_FIELD_BYTES}
                      />
                    )}
                  </>
                )}
                {invalid ? (
                  <p id={errorId} className="text-xs text-destructive">
                    {t("ext.fieldLimit", { bytes: EXTENSION_FIELD_BYTES })}
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
              {group.actions.map((action) => (
                <Button
                  key={action.id}
                  variant={action.primary ? "default" : "outline"}
                  aria-label={action.ariaLabel ?? undefined}
                  className={cn(
                    "h-auto min-h-11 min-w-0 whitespace-normal break-words",
                    LOCKED_CONTROL_CLASS,
                    group.board &&
                      "aspect-square min-h-0 rounded-xl p-0 text-3xl shadow-sm",
                  )}
                  disabled={actionsBlocked || action.disabled}
                  data-operation-locked={
                    blocked && !action.disabled && invalidFields.size === 0
                  }
                  onClick={() => onAction(action.id)}
                >
                  {action.label}
                </Button>
              ))}
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
    <Tabs value={tabs.find((tab) => tab.active)?.id} onValueChange={onAction}>
      <TabsList className="mb-4 grid w-full grid-cols-2 gap-1 bg-muted/50 p-1 group-data-horizontal/tabs:h-auto sm:grid-cols-3 lg:grid-cols-5">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
            disabled={actionsBlocked}
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
