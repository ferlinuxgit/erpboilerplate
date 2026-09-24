import { describe, expect, it } from "vitest";

import { bandScale, formatCompactMoney, labelStride, linearScale, niceStep } from "@/components/charts/scale";

describe("chart scales", () => {
  it("rounds steps to 1, 2, 2.5 or 5 × 10^n", () => {
    expect(niceStep(0.8)).toBe(1);
    expect(niceStep(1.7)).toBe(2);
    expect(niceStep(2.2)).toBe(2.5);
    expect(niceStep(3.1)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(2600)).toBe(5000);
    expect(niceStep(0)).toBe(1);
  });

  it("always includes zero and produces round ticks", () => {
    const scale = linearScale([1200, 8700, 4300], 200, 0, 4);
    expect(scale.min).toBe(0);
    expect(scale.max).toBe(10000);
    expect(scale.ticks).toEqual([0, 2500, 5000, 7500, 10000]);
    expect(scale.map(0)).toBe(200);
    expect(scale.map(10000)).toBe(0);
    expect(scale.map(5000)).toBe(100);
  });

  it("handles negative balances and flat or empty series", () => {
    const negative = linearScale([-1500, 3200], 100, 0, 4);
    expect(negative.min).toBeLessThan(0);
    expect(negative.ticks).toContain(0);
    expect(negative.map(0)).toBeGreaterThan(0);
    expect(negative.map(0)).toBeLessThan(100);

    const flat = linearScale([0, 0], 100, 0);
    expect(flat.max).toBeGreaterThan(flat.min);
    expect(linearScale([], 100, 0).ticks).toContain(0);
  });

  it("avoids floating point noise in tick labels", () => {
    expect(linearScale([0.3], 100, 0, 3).ticks).toEqual([0, 0.1, 0.2, 0.3]);
  });

  it("splits a band into equal slots", () => {
    const band = bandScale(4, 0, 400, 0.2);
    expect(band.slot).toBe(100);
    expect(band.bandwidth).toBe(80);
    expect(band.x(1)).toBe(110);
    expect(band.center(3)).toBe(350);
  });

  it("thins x labels on narrow charts", () => {
    expect(labelStride(12, 600)).toBe(1);
    expect(labelStride(12, 260)).toBe(3);
  });

  it("formats compact euros for axes", () => {
    expect(formatCompactMoney(12000)).toMatch(/12\s?mil\s?€/);
    expect(formatCompactMoney(0)).toMatch(/0\s?€/);
  });
});
