import { describe, it, expect } from "vitest";
import { fmt, _esc, mgmNorm, stKey, istasyonYagisAnahtari } from "./format.js";

describe("fmt", () => {
  it("null/undefined/NaN → em dash", () => {
    expect(fmt(null)).toBe("—");
    expect(fmt(undefined)).toBe("—");
    expect(fmt(NaN)).toBe("—");
    expect(fmt("abc")).toBe("—");
  });
  it("numeric formatting with default 2 decimals", () => {
    expect(fmt(1.2345)).toBe("1.23");
    expect(fmt(1.2, 1)).toBe("1.2");
    expect(fmt(5, 0)).toBe("5");
    expect(fmt("3.1415", 3)).toBe("3.142");
  });
  it("zero and negative", () => {
    expect(fmt(0)).toBe("0.00");
    expect(fmt(-1.5, 1)).toBe("-1.5");
  });
});

describe("_esc", () => {
  it("escapes html specials", () => {
    expect(_esc("<img src=x onerror=alert(1)>")).toBe("&lt;img src=x onerror=alert(1)&gt;");
    expect(_esc("A & B \"c\" 'd'")).toBe("A &amp; B &quot;c&quot; &#x27;d&#x27;");
  });
  it("null/undefined → empty", () => {
    expect(_esc(null)).toBe("");
    expect(_esc(undefined)).toBe("");
    expect(_esc(0)).toBe("0");
  });
});

describe("mgmNorm", () => {
  it("uppercases with Turkish locale and strips non-alnum", () => {
    expect(mgmNorm("Tekirdağ")).toBe("TEKİRDAĞ");
    expect(mgmNorm("a b-c")).toBe("ABC");
    expect(mgmNorm("İstanbul 123")).toBe("İSTANBUL123");
  });
  it("empty and null", () => {
    expect(mgmNorm("")).toBe("");
    expect(mgmNorm(null)).toBe("");
    expect(mgmNorm(undefined)).toBe("");
  });
  it("preserves Turkish chars", () => {
    // "ı" uppercases to "I" (dotless) in Turkish locale, not "İ"
    expect(mgmNorm("çğıöşüÇĞİÖŞÜ")).toBe("ÇĞIÖŞÜÇĞİÖŞÜ");
  });
});

describe("istasyon anahtarları", () => {
  it("stKey adı ve sabit koordinat hassasiyetini kullanır", () => {
    expect(stKey({ name: "Merkez", lat: 39.1234567, lon: 32.7654321 })).toBe("Merkez|39.12346|32.76543");
  });
  it("yağış anahtarında varsa kodu tercih eder", () => {
    expect(istasyonYagisAnahtari({ name: "Merkez", kod: 17030, lat: 39, lon: 32 })).toBe("kod:17030");
  });
  it("kodsuz aynı adlı istasyonları koordinatla ayırır", () => {
    const a = istasyonYagisAnahtari({ name: "Merkez", lat: 39, lon: 32 });
    const b = istasyonYagisAnahtari({ name: "Merkez", lat: 40, lon: 33 });
    expect(a).not.toBe(b);
    expect(a).toBe("istasyon:Merkez|39.00000|32.00000");
  });
});
