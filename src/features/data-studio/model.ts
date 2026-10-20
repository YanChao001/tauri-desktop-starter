import { z } from "zod";

export type DemoRecord = {
  id: number;
  name: string;
  email: string;
  team: "design" | "engineering" | "operations";
  status: "active" | "archived";
  budget: number;
};

export function createDemoRecords(count = 10000): DemoRecord[] {
  const teams = ["design", "engineering", "operations"] as const;
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `Demo ${String(index + 1).padStart(5, "0")}`,
    email: `person${index + 1}@example.test`,
    team: teams[index % teams.length] ?? "design",
    status: index % 5 === 0 ? "archived" : "active",
    budget: 100 + ((index * 137) % 50000),
  }));
}

/** 演示规则刻意产生部分失败，成功项变更，失败项保留原样。 */
export function archiveDemoRecords(records: DemoRecord[], ids: number[]) {
  const selected = new Set(ids);
  const failed = ids.filter((id) => id % 7 === 0);
  const rejected = new Set(failed);
  const existing = new Set(records.map((record) => record.id));
  const successful = ids.filter((id) => existing.has(id) && !rejected.has(id));
  return {
    records: records.map((record) =>
      selected.has(record.id) && !rejected.has(record.id)
        ? { ...record, status: "archived" as const }
        : record,
    ),
    failed,
    successful,
  };
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export const orderSchema = z
  .object({
    customer: z.string().trim().min(2, "required").max(100, "required"),
    email: z.email("invalidEmail"),
    kind: z.enum(["personal", "business"]),
    company: z.string().trim().max(100, "required"),
    start: z.string().refine(validDate, "invalidDate"),
    end: z.string().refine(validDate, "invalidDate"),
    lines: z
      .array(
        z.object({
          description: z
            .string()
            .trim()
            .min(2, "required")
            .max(200, "required"),
          quantity: z
            .number({ error: "invalidNumber" })
            .int("invalidNumber")
            .min(1, "invalidNumber")
            .max(1000, "invalidNumber"),
          price: z
            .number({ error: "invalidNumber" })
            .min(0, "invalidNumber")
            .max(1000000, "invalidNumber"),
        }),
      )
      .min(1, "lineLimit")
      .max(10, "lineLimit"),
    consent: z.boolean().refine((value) => value, "consentRequired"),
  })
  .superRefine((value, context) => {
    if (value.kind === "business" && value.company.length < 2)
      context.addIssue({
        code: "custom",
        path: ["company"],
        message: "companyRequired",
      });
    if (
      validDate(value.start) &&
      validDate(value.end) &&
      value.end < value.start
    )
      context.addIssue({ code: "custom", path: ["end"], message: "dateRange" });
  });

export type OrderValues = z.infer<typeof orderSchema>;
export const defaultOrder: OrderValues = {
  customer: "",
  email: "",
  kind: "personal",
  company: "",
  start: "2026-11-01",
  end: "2026-11-02",
  lines: [{ description: "", quantity: 1, price: 100 }],
  consent: false,
};

export function orderTotal(order: OrderValues) {
  return order.lines.reduce(
    (total, line) => total + line.quantity * line.price,
    0,
  );
}
