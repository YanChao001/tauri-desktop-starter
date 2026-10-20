// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  archiveDemoRecords,
  createDemoRecords,
  defaultOrder,
  orderSchema,
  orderTotal,
} from "./model";

describe("data studio boundaries", () => {
  it("keeps failed bulk items unchanged and reports successful stable IDs", () => {
    const rows = createDemoRecords(15);
    const protectedRow = rows.find((row) => row.id === 7);
    const result = archiveDemoRecords(rows, [2, 7, 14]);
    expect(result.failed).toEqual([7, 14]);
    expect(result.successful).toEqual([2]);
    expect(result.records.find((row) => row.id === 7)).toBe(protectedRow);
    expect(result.records.find((row) => row.id === 2)?.status).toBe("archived");
    expect(rows.find((row) => row.id === 2)?.status).toBe("active");
  });

  it("validates conditional company and cross-field date rules", () => {
    const result = orderSchema.safeParse({
      ...defaultOrder,
      customer: "Ada",
      email: "ada@example.test",
      kind: "business",
      company: "",
      start: "2026-11-02",
      end: "2026-11-01",
      consent: true,
      lines: [{ description: "Design", quantity: 2, price: 12.5 }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["company"],
          message: "companyRequired",
        }),
        expect.objectContaining({ path: ["end"], message: "dateRange" }),
      ]),
    );
  });

  it("rejects impossible dates and invalid dynamic line items", () => {
    const result = orderSchema.safeParse({
      ...defaultOrder,
      start: "2026-02-30",
      lines: [{ description: "ok", quantity: Number.NaN, price: -1 }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(
      expect.arrayContaining(["start", "lines.0.quantity", "lines.0.price"]),
    );
  });

  it("accepts a complete request and computes its validated line total", () => {
    const value = orderSchema.parse({
      ...defaultOrder,
      customer: "Ada",
      email: "ada@example.test",
      consent: true,
      lines: [
        { description: "Design", quantity: 2, price: 12.5 },
        { description: "Review", quantity: 3, price: 10 },
      ],
    });
    expect(orderTotal(value)).toBe(55);
  });
});
