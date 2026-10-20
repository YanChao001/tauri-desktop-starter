// @vitest-environment node
import { describe, expect, it } from "vitest";
import { springCurve, springResponse } from "./physics";

describe("spring response diagram", () => {
  it("starts at rest and converges for under, critical, and over damping", () => {
    for (const damping of [5, 20, 40]) {
      const parameters = { stiffness: 100, damping, mass: 1 };
      expect(springResponse(0, parameters)).toBe(0);
      expect(springResponse(20, parameters)).toBeCloseTo(1, 5);
      expect(springCurve(parameters)).not.toMatch(/NaN|Infinity/);
    }
  });
  it("shows an overshoot only for the playful underdamped response", () => {
    const response = (damping: number) =>
      Array.from({ length: 101 }, (_, index) =>
        springResponse(index / 50, { stiffness: 100, damping, mass: 1 }),
      );
    expect(Math.max(...response(5))).toBeGreaterThan(1.1);
    const slow = response(40);
    expect(
      slow.every((value, index) => index === 0 || value >= slow[index - 1]!),
    ).toBe(true);
    expect(Math.max(...slow)).toBeLessThan(1);
  });
});
