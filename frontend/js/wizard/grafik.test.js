import { describe, it, expect } from "vitest";
import { cmpInterp } from "./grafik.js";

describe("cmpInterp", () => {
  it("empty points → null", () => {
    expect(cmpInterp([], 0)).toBeNull();
  });
  it("outside interval → null", () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 10 }];
    expect(cmpInterp(pts, -0.1)).toBeNull();
    expect(cmpInterp(pts, 1.1)).toBeNull();
  });
  it("exact points", () => {
    const pts = [{ x: 0, y: 5 }, { x: 1, y: 10 }, { x: 2, y: 20 }];
    expect(cmpInterp(pts, 0)).toBe(5);
    expect(cmpInterp(pts, 1)).toBe(10);
    expect(cmpInterp(pts, 2)).toBe(20);
  });
  it("linear interpolation", () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 10 }, { x: 2, y: 20 }];
    expect(cmpInterp(pts, 0.5)).toBe(5);
    expect(cmpInterp(pts, 1.5)).toBe(15);
  });
  it("vertical segment same x returns y", () => {
    const pts = [{ x: 1, y: 5 }, { x: 1, y: 10 }];
    expect(cmpInterp(pts, 1)).toBe(10);
  });
  it("tolerance 1e-9 at boundaries", () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 10 }];
    expect(cmpInterp(pts, 1 + 1e-10)).toBeCloseTo(10, 7);
    expect(cmpInterp(pts, 0 - 1e-10)).toBeCloseTo(0, 7);
  });
});
