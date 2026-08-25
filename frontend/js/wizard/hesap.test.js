import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { S } from "../core/state.js";
import { logInterp, lin1, yaldFromArea } from "./hesap.js";

describe("logInterp", () => {
  it("clamps below and above", () => {
    const xs = [1, 10, 100];
    const ys = [10, 100, 1000];
    expect(logInterp(0.5, xs, ys)).toBeCloseTo(10, 5);
    expect(logInterp(200, xs, ys)).toBeCloseTo(1000, 5);
  });
  it("exact points", () => {
    const xs = [1, 10];
    const ys = [10, 100];
    expect(logInterp(1, xs, ys)).toBeCloseTo(10, 5);
    expect(logInterp(10, xs, ys)).toBeCloseTo(100, 5);
  });
  it("interpolates log-log (midpoint geometric)", () => {
    // xs log: 1 and 100, ys log: 10 and 1000, x=10 (geometric midpoint) -> y = sqrt(10*1000)=100
    const xs = [1, 100];
    const ys = [10, 1000];
    expect(logInterp(10, xs, ys)).toBeCloseTo(100, 5);
  });
  it("Snyder Ct-Cp piece: cp 0.15 between 0.1 and 0.2", () => {
    const Cp = [0.1, 0.2, 0.3];
    const Ct = [9.5, 4.6, 3.1];
    const v = logInterp(0.15, Cp, Ct);
    // Should be between 9.5 and 4.6
    expect(v).toBeGreaterThan(4.6);
    expect(v).toBeLessThan(9.5);
  });
});

describe("lin1", () => {
  it("clamps", () => {
    expect(lin1(-1, [0, 10], [0, 100])).toBe(0);
    expect(lin1(20, [0, 10], [0, 100])).toBe(100);
  });
  it("exact and interpolated", () => {
    expect(lin1(0, [0, 10], [0, 100])).toBe(0);
    expect(lin1(10, [0, 10], [0, 100])).toBe(100);
    expect(lin1(5, [0, 10], [0, 100])).toBe(50);
    expect(lin1(2.5, [0, 5, 10], [0, 50, 100])).toBe(25);
  });
});

describe("yaldFromArea", () => {
  beforeAll(() => {
    const p = resolve("data/tables/abak2_yad.json");
    S.abak2 = JSON.parse(readFileSync(p, "utf-8"));
  });
  it("<=25 returns 1.0", () => {
    expect(yaldFromArea(0)).toBeNull(); // A>0 check fails -> null? Actually if A<=0 or !S.abak2 -> null, but 0 is falsy -> null, test 10
    expect(yaldFromArea(10)).toBe(1.0);
    expect(yaldFromArea(25)).toBe(1.0);
    expect(yaldFromArea(25.0)).toBe(1.0);
  });
  it("just above 25 interpolates", () => {
    const v26 = yaldFromArea(26);
    expect(v26).toBeGreaterThan(0.9);
    expect(v26).toBeLessThan(1.0);
  });
  it("known area 100 -> 96.27/100", () => {
    // areas[10]=100, percent[10][4]=96.27
    const v = yaldFromArea(100);
    expect(v).toBeCloseTo(0.9627, 4);
  });
  it("area 50 -> 97.79/100", () => {
    const v = yaldFromArea(50);
    expect(v).toBeCloseTo(0.9779, 4);
  });
  it("large area clamps to last", () => {
    const v = yaldFromArea(5000);
    const last = S.abak2.percent[S.abak2.percent.length - 1][4] / 100;
    expect(v).toBeCloseTo(last, 4);
  });
  it("without abak2 → null", () => {
    const saved = S.abak2;
    S.abak2 = null;
    expect(yaldFromArea(100)).toBeNull();
    S.abak2 = saved;
  });
});
