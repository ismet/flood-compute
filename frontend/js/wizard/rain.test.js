import { describe, it, expect, beforeEach } from "vitest";
import { S } from "../core/state.js";
import { istasyonYagisAnahtari } from "../core/format.js";
import { rainRange, rainColor, oetSec, RAIN_BLUES } from "./rain.js";

const anahtar = (s) => istasyonYagisAnahtari(s);

describe("rainRange", () => {
  beforeEach(() => {
    S.thiessen = [];
    S.rainValues = {};
    S.rainColorCol = 5;
  });
  it("null when no thiessen or no values", () => {
    expect(rainRange()).toBeNull();
    S.thiessen = [{ name: "A", kod: "1", lat: 39, lon: 32, agirlik: 0.6 }];
    S.rainValues = {};
    expect(rainRange()).toBeNull();
  });
  it("ignores agirlik 0 and null values", () => {
    S.thiessen = [
      { name: "A", kod: "1", lat: 39, lon: 32, agirlik: 0.6 },
      { name: "B", kod: "2", lat: 40, lon: 33, agirlik: 0.4 },
      { name: "C", kod: "3", lat: 41, lon: 34, agirlik: 0 },
    ];
    S.rainValues = {
      [anahtar(S.thiessen[0])]: [10, 20, 30, 40, 50, 60, 70],
      [anahtar(S.thiessen[1])]: [15, 25, 35, 45, 55, 65, 75],
      [anahtar(S.thiessen[2])]: [999, 999, 999, 999, 999, 999, 999],
    };
    S.rainColorCol = 5; // P100
    const r = rainRange();
    expect(r).toEqual({ min: 60, max: 65, n: 2, col: 5 });
  });
  it("uses rainColorCol or default 5", () => {
    S.thiessen = [{ name: "A", kod: "1", lat: 39, lon: 32, agirlik: 1 }];
    S.rainValues = { [anahtar(S.thiessen[0])]: [1, 2, 3, 4, 5, 6, 7] };
    S.rainColorCol = 0;
    expect(rainRange()).toEqual({ min: 1, max: 1, n: 1, col: 0 });
    S.rainColorCol = undefined;
    // default ?? 5
    expect(rainRange()).toEqual({ min: 6, max: 6, n: 1, col: 5 });
  });
  it("filters NaN and null", () => {
    S.thiessen = [
      { name: "A", kod: "1", lat: 39, lon: 32, agirlik: 0.5 },
      { name: "B", kod: "2", lat: 40, lon: 33, agirlik: 0.5 },
    ];
    S.rainValues = {
      [anahtar(S.thiessen[0])]: [null, null, null, null, null, null, null],
      [anahtar(S.thiessen[1])]: [10, 20, 30, 40, 50, 60, 70],
    };
    S.rainColorCol = 5;
    const r = rainRange();
    expect(r).toEqual({ min: 60, max: 60, n: 1, col: 5 });
  });
  it("handles all equal values", () => {
    S.thiessen = [
      { name: "A", kod: "1", lat: 39, lon: 32, agirlik: 0.5 },
      { name: "B", kod: "2", lat: 40, lon: 33, agirlik: 0.5 },
    ];
    S.rainValues = {
      [anahtar(S.thiessen[0])]: [0, 0, 0, 0, 0, 0, 100],
      [anahtar(S.thiessen[1])]: [0, 0, 0, 0, 0, 0, 100],
    };
    S.rainColorCol = 5;
    const r = rainRange();
    expect(r.min).toBe(0);
    expect(r.max).toBe(0);
  });
  it("aynı adlı istasyonları kanonik anahtarla ayrı renklendirir", () => {
    const a = { name: "MERKEZ", kod: "100", lat: 39, lon: 32, agirlik: 0.5 };
    const b = { name: "MERKEZ", kod: "200", lat: 40, lon: 33, agirlik: 0.5 };
    S.thiessen = [a, b];
    S.rainValues = {
      [anahtar(a)]: [0, 0, 0, 0, 0, 10, 0],
      [anahtar(b)]: [0, 0, 0, 0, 0, 100, 0],
    };
    expect(rainColor(a)).toBe(RAIN_BLUES[0]);
    expect(rainColor(b)).toBe(RAIN_BLUES.at(-1));
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
