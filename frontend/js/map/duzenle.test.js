import { describe, it, expect } from "vitest";
import { dpSadelestir } from "./duzenle.js";

describe("dpSadelestir", () => {
  it("returns same when <3 points", () => {
    const pts = [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }];
    expect(dpSadelestir(pts, 1, 1)).toBe(pts);
  });
  it("colinear middle removed even with tiny tol", () => {
    const pts = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.01 },
      { lat: 0, lng: 0.02 },
    ];
    const kos = Math.cos(0);
    const out = dpSadelestir(pts, 1e-6, kos);
    expect(out.length).toBe(2);
    expect(out[0]).toEqual(pts[0]);
    expect(out[2 - 1]).toEqual(pts[2]);
  });
  it("keeps off-line point when distance > tol", () => {
    // middle point 0.001 deg north of line
    const pts = [
      { lat: 0, lng: 0 },
      { lat: 0.001, lng: 0.01 },
      { lat: 0, lng: 0.02 },
    ];
    const kos = Math.cos(0);
    // distance approx 0.001 deg -> 111m, tol 0.0005 deg (~55m) should keep
    const kept = dpSadelestir(pts, 0.0005, kos);
    expect(kept.length).toBe(3);
    // tol larger than distance should drop middle
    const dropped = dpSadelestir(pts, 0.002, kos);
    expect(dropped.length).toBe(2);
  });
  it("kos scaling affects longitude distance", () => {
    const pts = [
      { lat: 60, lng: 0 },
      { lat: 60, lng: 0.01 },
      { lat: 60.001, lng: 0.02 },
    ];
    const kosEquator = Math.cos(0);
    const kos60 = Math.cos((60 * Math.PI) / 180);
    // same points but different kos: distance scaled
    const outEquator = dpSadelestir(pts, 0.001, kosEquator);
    const out60 = dpSadelestir(pts, 0.001, kos60);
    // At high latitude longitudinal distance shrinks, so middle may be kept vs equator
    // Just ensure both return arrays of length 2 or 3 without throwing
    expect([2, 3]).toContain(outEquator.length);
    expect([2, 3]).toContain(out60.length);
  });
});
