import { getLocale } from "@/i18n/registry";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { TriangleAlertIcon } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Controller,
  useFieldArray,
  useForm,
  type FieldPath,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useI18n, type DictKey } from "@/providers/i18n";
import {
  defaultOrder,
  orderSchema,
  orderTotal,
  type OrderValues,
} from "./model";

const errorKeys: Record<string, DictKey> = {
  required: "labs.form.required",
  invalidEmail: "labs.form.invalidEmail",
  companyRequired: "labs.form.companyRequired",
  invalidDate: "labs.form.invalidDate",
  dateRange: "labs.form.dateRange",
  invalidNumber: "labs.form.invalidNumber",
  consentRequired: "labs.form.consentRequired",
  lineLimit: "labs.form.lineLimit",
};
const fieldId = (path: string) => `order-${path.replaceAll(".", "-")}`;

export function OrderForm() {
  const { t, language } = useI18n();
  const form = useForm<OrderValues>({
    resolver: zodResolver(orderSchema),
    defaultValues: defaultOrder,
    shouldFocusError: true,
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lines",
  });
  const kind = form.watch("kind");
  const [fail, setFail] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const summaryFocusTarget = useRef<FieldPath<OrderValues> | null>(null);
  const errors = form.formState.errors;
  const summary: {
    name: FieldPath<OrderValues>;
    label: string;
    message: string;
  }[] = [];
  function addError(
    name: FieldPath<OrderValues>,
    label: string,
    message?: string,
  ) {
    if (message) summary.push({ name, label, message });
  }
  addError("customer", t("labs.form.customer"), errors.customer?.message);
  addError("email", t("labs.data.email"), errors.email?.message);
  addError("company", t("labs.form.company"), errors.company?.message);
  addError("start", t("labs.form.start"), errors.start?.message);
  addError("end", t("labs.form.end"), errors.end?.message);
  addError("consent", t("labs.form.consent"), errors.consent?.message);
  fields.forEach((_, index) => {
    const prefix = t("labs.form.line", { number: index + 1 });
    addError(
      `lines.${index}.description`,
      `${prefix} · ${t("labs.form.description")}`,
      errors.lines?.[index]?.description?.message,
    );
    addError(
      `lines.${index}.quantity`,
      `${prefix} · ${t("labs.form.quantity")}`,
      errors.lines?.[index]?.quantity?.message,
    );
    addError(
      `lines.${index}.price`,
      `${prefix} · ${t("labs.form.price")}`,
      errors.lines?.[index]?.price?.message,
    );
  });
  const message = (code: string | undefined) =>
    code ? t(errorKeys[code] ?? "labs.form.required") : null;
  function errorFor(name: string, code?: string) {
    const text = message(code);
    if (!text) return null;
    return (
      <TooltipProvider delayDuration={650} skipDelayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              data-surface="transparent"
              data-variant="ghost"
              type="button"
              id={`${fieldId(name)}-error`}
              className="min-w-0 flex-1 truncate rounded-sm text-right text-xs text-destructive underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {text}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-72 leading-relaxed">
            {text}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  function fieldLabel(name: string, label: string, code?: string) {
    return (
      <div className="flex h-5 min-w-0 items-center gap-2">
        <Label htmlFor={fieldId(name)} className="shrink-0">
          {label}
        </Label>
        {errorFor(name, code)}
      </div>
    );
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex min-h-9 items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <CardTitle className="min-w-0 truncate">
              {t("labs.form.title")}
            </CardTitle>
          </div>
          {summary.length ? (
            <div role="alert" className="shrink-0">
              <Popover
                open={summaryOpen}
                onOpenChange={(open) => {
                  if (open) summaryFocusTarget.current = null;
                  setSummaryOpen(open);
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                  >
                    <TriangleAlertIcon className="size-4" aria-hidden="true" />
                    <span className="tabular-nums" aria-hidden="true">
                      {summary.length}
                    </span>
                    <span className="sr-only">
                      {t("labs.form.errors")} ({summary.length})
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="max-h-64 overflow-auto text-sm"
                  align="end"
                  onCloseAutoFocus={(event) => {
                    const target = summaryFocusTarget.current;
                    summaryFocusTarget.current = null;
                    if (target) {
                      event.preventDefault();
                      form.setFocus(target);
                    }
                  }}
                >
                  <ul className="list-disc space-y-1 pl-5">
                    {summary.map((item) => (
                      <li key={item.name}>
                        <a
                          href={`#${fieldId(item.name)}`}
                          className="text-primary underline"
                          onClick={(event) => {
                            event.preventDefault();
                            summaryFocusTarget.current = item.name;
                            setSummaryOpen(false);
                          }}
                        >
                          {item.label}: {message(item.message)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="@container/order-fields">
        <form
          className="space-y-4"
          noValidate
          onSubmit={form.handleSubmit(async (values) => {
            // 本地异步提交示例；没有远端 API 或数据持久化。
            await Promise.resolve();
            if (fail) {
              toast.error(t("labs.form.failed"));
              return;
            }
            toast.success(
              t("labs.form.success", {
                count: values.lines.length,
                total: new Intl.NumberFormat(getLocale(language).documentLang, {
                  maximumFractionDigits: 2,
                }).format(orderTotal(values)),
              }),
            );
          })}
          aria-busy={form.formState.isSubmitting}
        >
          <div className="grid gap-3 @min-[20rem]/order-fields:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              {fieldLabel(
                "customer",
                t("labs.form.customer"),
                errors.customer?.message,
              )}
              <Input
                id="order-customer"
                maxLength={100}
                autoComplete="name"
                {...form.register("customer")}
                aria-invalid={!!errors.customer}
                aria-describedby={
                  errors.customer ? "order-customer-error" : undefined
                }
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              {fieldLabel("email", t("labs.data.email"), errors.email?.message)}
              <Input
                id="order-email"
                type="email"
                autoComplete="email"
                {...form.register("email")}
                aria-invalid={!!errors.email}
                aria-describedby={
                  errors.email ? "order-email-error" : undefined
                }
              />
            </div>
          </div>
          <div className="grid gap-3 @min-[20rem]/order-fields:grid-cols-2 @min-[38rem]/order-fields:grid-cols-3">
            <div className="min-w-0 space-y-1.5 @min-[20rem]/order-fields:col-span-2 @min-[38rem]/order-fields:col-span-1">
              {fieldLabel("kind", t("labs.form.kind"))}
              <Controller
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <Select
                    name={field.name}
                    value={field.value}
                    onValueChange={(value) => {
                      field.onChange(value);
                      form.clearErrors("company");
                    }}
                  >
                    <SelectTrigger
                      id="order-kind"
                      className="w-full"
                      ref={field.ref}
                      onBlur={field.onBlur}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" align="start">
                      <SelectItem value="personal">
                        {t("labs.form.personal")}
                      </SelectItem>
                      <SelectItem value="business">
                        {t("labs.form.business")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              {fieldLabel("start", t("labs.form.start"), errors.start?.message)}
              <Input
                id="order-start"
                type="date"
                {...form.register("start")}
                aria-invalid={!!errors.start}
                aria-describedby={
                  errors.start ? "order-start-error" : undefined
                }
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              {fieldLabel("end", t("labs.form.end"), errors.end?.message)}
              <Input
                id="order-end"
                type="date"
                {...form.register("end")}
                aria-invalid={!!errors.end}
                aria-describedby={errors.end ? "order-end-error" : undefined}
              />
            </div>
          </div>
          {kind === "business" ? (
            <div className="min-w-0 space-y-1.5">
              {fieldLabel(
                "company",
                t("labs.form.company"),
                errors.company?.message,
              )}
              <Input
                id="order-company"
                maxLength={100}
                autoComplete="organization"
                {...form.register("company")}
                aria-invalid={!!errors.company}
                aria-describedby={
                  errors.company ? "order-company-error" : undefined
                }
              />
            </div>
          ) : null}
          <div
            className="space-y-3"
            role="group"
            aria-label={t("labs.form.lines")}
          >
            {fields.map((field, index) => (
              <fieldset
                key={field.id}
                className="@container/order-line min-w-0 rounded-md border p-3"
              >
                <legend className="text-sm font-medium">
                  {t("labs.form.line", { number: index + 1 })}
                </legend>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3 @min-[34rem]/order-line:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <div className="col-span-full min-w-0 space-y-1.5 @min-[34rem]/order-line:col-span-1">
                    {fieldLabel(
                      `lines.${index}.description`,
                      t("labs.form.description"),
                      errors.lines?.[index]?.description?.message,
                    )}
                    <Input
                      id={fieldId(`lines.${index}.description`)}
                      maxLength={200}
                      {...form.register(`lines.${index}.description`)}
                      aria-invalid={!!errors.lines?.[index]?.description}
                      aria-describedby={
                        errors.lines?.[index]?.description
                          ? `${fieldId(`lines.${index}.description`)}-error`
                          : undefined
                      }
                    />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    {fieldLabel(
                      `lines.${index}.quantity`,
                      t("labs.form.quantity"),
                      errors.lines?.[index]?.quantity?.message,
                    )}
                    <Input
                      id={fieldId(`lines.${index}.quantity`)}
                      type="number"
                      min={1}
                      max={1000}
                      {...form.register(`lines.${index}.quantity`, {
                        valueAsNumber: true,
                      })}
                      aria-invalid={!!errors.lines?.[index]?.quantity}
                      aria-describedby={
                        errors.lines?.[index]?.quantity
                          ? `${fieldId(`lines.${index}.quantity`)}-error`
                          : undefined
                      }
                    />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    {fieldLabel(
                      `lines.${index}.price`,
                      t("labs.form.price"),
                      errors.lines?.[index]?.price?.message,
                    )}
                    <Input
                      id={fieldId(`lines.${index}.price`)}
                      type="number"
                      min={0}
                      max={1000000}
                      step="0.01"
                      {...form.register(`lines.${index}.price`, {
                        valueAsNumber: true,
                      })}
                      aria-invalid={!!errors.lines?.[index]?.price}
                      aria-describedby={
                        errors.lines?.[index]?.price
                          ? `${fieldId(`lines.${index}.price`)}-error`
                          : undefined
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="self-end"
                    disabled={fields.length === 1}
                    aria-label={t("labs.form.removeLine", {
                      number: index + 1,
                    })}
                    onClick={() => remove(index)}
                  >
                    −
                  </Button>
                </div>
              </fieldset>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={fields.length >= 10}
              onClick={() => append({ description: "", quantity: 1, price: 0 })}
            >
              {t("labs.form.addLine")}
            </Button>
          </div>
          <div className="space-y-2">
            <div className="flex min-h-5 min-w-0 items-center gap-2">
              <label className="flex shrink-0 items-center gap-2 text-sm">
                <Controller
                  name="consent"
                  control={form.control}
                  render={({ field }) => (
                    <Checkbox
                      id="order-consent"
                      name={field.name}
                      ref={field.ref}
                      checked={field.value}
                      onBlur={field.onBlur}
                      onCheckedChange={(checked) =>
                        field.onChange(checked === true)
                      }
                      aria-invalid={!!errors.consent}
                      aria-describedby={
                        errors.consent ? "order-consent-error" : undefined
                      }
                    />
                  )}
                />
                {t("labs.form.consent")}
              </label>
              {errorFor("consent", errors.consent?.message)}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={fail}
                onCheckedChange={(checked) => setFail(checked === true)}
              />
              {t("labs.form.simulateFailure")}
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t("labs.form.submit")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={form.formState.isSubmitting}
              onClick={() => {
                form.reset(defaultOrder);
              }}
            >
              {t("labs.reset")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
