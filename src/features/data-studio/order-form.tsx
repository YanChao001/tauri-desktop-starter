import { useState } from "react";
import {
  Controller,
  useFieldArray,
  useForm,
  type FieldPath,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [serverError, setServerError] = useState(false);
  const [submitted, setSubmitted] = useState<{
    count: number;
    total: number;
  } | null>(null);
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
    return code ? (
      <p id={`${fieldId(name)}-error`} className="text-xs text-destructive">
        {message(code)}
      </p>
    ) : null;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("labs.form.title")}</CardTitle>
        <CardDescription>{t("labs.form.hint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          noValidate
          onSubmit={form.handleSubmit(async (values) => {
            setSubmitted(null);
            setServerError(false);
            // 本地异步提交示例；没有远端 API 或数据持久化。
            await Promise.resolve();
            if (fail) {
              setServerError(true);
              return;
            }
            setSubmitted({
              count: values.lines.length,
              total: orderTotal(values),
            });
          })}
          aria-busy={form.formState.isSubmitting}
        >
          {summary.length ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 p-3 text-sm"
            >
              <h3 className="font-medium">{t("labs.form.errors")}</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {summary.map((item) => (
                  <li key={item.name}>
                    <a
                      href={`#${fieldId(item.name)}`}
                      className="text-primary underline"
                      onClick={(event) => {
                        event.preventDefault();
                        form.setFocus(item.name);
                      }}
                    >
                      {item.label}: {message(item.message)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="order-customer">{t("labs.form.customer")}</Label>
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
              {errorFor("customer", errors.customer?.message)}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="order-email">{t("labs.data.email")}</Label>
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
              {errorFor("email", errors.email?.message)}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="order-kind">{t("labs.form.kind")}</Label>
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
            {kind === "business" ? (
              <div className="space-y-1.5">
                <Label htmlFor="order-company">{t("labs.form.company")}</Label>
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
                {errorFor("company", errors.company?.message)}
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="order-start">{t("labs.form.start")}</Label>
              <Input
                id="order-start"
                type="date"
                {...form.register("start")}
                aria-invalid={!!errors.start}
                aria-describedby={
                  errors.start ? "order-start-error" : undefined
                }
              />
              {errorFor("start", errors.start?.message)}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="order-end">{t("labs.form.end")}</Label>
              <Input
                id="order-end"
                type="date"
                {...form.register("end")}
                aria-invalid={!!errors.end}
                aria-describedby={errors.end ? "order-end-error" : undefined}
              />
              {errorFor("end", errors.end?.message)}
            </div>
          </div>
          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-medium">
              {t("labs.form.lines")}
            </legend>
            {fields.map((field, index) => (
              <fieldset key={field.id} className="rounded-md border p-3">
                <legend className="px-1 text-xs text-muted-foreground">
                  {t("labs.form.line", { number: index + 1 })}
                </legend>
                <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <div className="space-y-1.5">
                    <Label htmlFor={fieldId(`lines.${index}.description`)}>
                      {t("labs.form.description")}
                    </Label>
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
                    {errorFor(
                      `lines.${index}.description`,
                      errors.lines?.[index]?.description?.message,
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={fieldId(`lines.${index}.quantity`)}>
                      {t("labs.form.quantity")}
                    </Label>
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
                    {errorFor(
                      `lines.${index}.quantity`,
                      errors.lines?.[index]?.quantity?.message,
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={fieldId(`lines.${index}.price`)}>
                      {t("labs.form.price")}
                    </Label>
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
                    {errorFor(
                      `lines.${index}.price`,
                      errors.lines?.[index]?.price?.message,
                    )}
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
          </fieldset>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
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
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={fail}
                onCheckedChange={(checked) => setFail(checked === true)}
              />
              {t("labs.form.simulateFailure")}
            </label>
          </div>
          {serverError ? (
            <p role="alert" className="rounded-md bg-muted p-3 text-sm">
              {t("labs.form.failed")}
            </p>
          ) : null}
          {submitted ? (
            <p role="status" className="rounded-md bg-primary/10 p-3 text-sm">
              {t("labs.form.success", {
                count: submitted.count,
                total: new Intl.NumberFormat(
                  language === "zh" ? "zh-CN" : "en",
                  { maximumFractionDigits: 2 },
                ).format(submitted.total),
              })}
            </p>
          ) : null}
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
                setSubmitted(null);
                setServerError(false);
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
