import { describe, it, expect, beforeEach } from "vitest";
import { S } from "../core/state.js";
import { rainRange, oetSec } from "./rain.js";

describe("rainRange", () => {
  beforeEach(() => {
    S.thiessen = [];
    S.rainValues = {};
    S.rainColorCol = 5;
  });
  it("null when no thiessen or no values", () => {
    expect(rainRange()).toBeNull();
    S.thiessen = [{ name: "A", agirlik: 0.6 }];
    S.rainValues = {};
    expect(rainRange()).toBeNull();
  });
  it("ignores agirlik 0 and null values", () => {
    S.thiessen = [
      { name: "A", agirlik: 0.6 },
      { name: "B", agirlik: 0.4 },
      { name: "C", agirlik: 0 },
    ];
    S.rainValues = {
      A: [10, 20, 30, 40, 50, 60, 70],
      B: [15, 25, 35, 45, 55, 65, 75],
      C: [999, 999, 999, 999, 999, 999, 999],
    };
    S.rainColorCol = 5; // P100
    const r = rainRange();
    expect(r).toEqual({ min: 60, max: 65, n: 2, col: 5 });
  });
  it("uses rainColorCol or default 5", () => {
    S.thiessen = [{ name: "A", agirlik: 1 }];
    S.rainValues = { A: [1, 2, 3, 4, 5, 6, 7] };
    S.rainColorCol = 0;
    expect(rainRange()).toEqual({ min: 1, max: 1, n: 1, col: 0 });
    S.rainColorCol = undefined;
    // default ?? 5
    expect(rainRange()).toEqual({ min: 6, max: 6, n: 1, col: 5 });
  });
  it("filters NaN and null", () => {
    S.thiessen = [
      { name: "A", agirlik: 0.5 },
      { name: "B", agirlik: 0.5 },
    ];
    S.rainValues = {
      A: [null, null, null, null, null, null, null],
      B: [10, 20, 30, 40, 50, 60, 70],
    };
    S.rainColorCol = 5;
    const r = rainRange();
    expect(r).toEqual({ min: 60, max: 60, n: 1, col: 5 });
  });
  it("handles all equal values", () => {
    S.thiessen = [
      { name: "A", agirlik: 0.5 },
      { name: "B", agirlik: 0.5 },
    ];
    S.rainValues = {
      A: [0, 0, 0, 0, 0, 0, 100],
      B: [0, 0, 0, 0, 0, 0, 100],
    };
    S.rainColorCol = 5;
    const r = rainRange();
    expect(r.min).toBe(0);
    expect(r.max).toBe(0);
  });
});

describe("oetSec", () => {
  it("elle boş ise ağırlıklı döner", () => {
    expect(oetSec("", 123.45)).toBe(123.45);
    expect(oetSec("", null)).toBe(null);
  });
  it("elle dolu ise elle değer döner (string)", () => {
    expect(oetSec("200", 123.45)).toBe(200);
    expect(oetSec(" 200 ", 123.45)).toBe(200);
  });
  it("elle 0 ise 0 döner (ağırlıklı değil)", () => {
    expect(oetSec("0", 100)).toBe(0);
  });
});
