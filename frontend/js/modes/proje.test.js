import { describe, it, expect } from "vitest";

const SET_KEYS = ["agiBolgesel", "stExclude", "suSecili"];
function setReplacer(k, v) {
  return v instanceof Set ? { __set: [...v] } : v;
}
function setReviver(k, v) {
  if (v && typeof v === "object" && Array.isArray(v.__set) && SET_KEYS.includes(k)) return new Set(v.__set);
  return v;
}

describe("proje Set serialization", () => {
  it("save replacer wraps Sets and load reviver restores", () => {
    const S = {
      agiBolgesel: new Set(["E123", "D456"]),
      stExclude: new Set(["a|1", "b|2"]),
      suSecili: new Set(["S1"]),
      havza: { type: "Polygon" },
      diger: "test",
    };
    const durumS = { ...S, sonuc: null, infoLayers: [], rasterLayers: [] };
    const fields = { inpA: "10" };
    const body = JSON.stringify({ ad: "test", durum: { S: durumS, fields } }, setReplacer);
    // Ensure __set appears
    expect(body).toContain("__set");
    const parsed = JSON.parse(body, setReviver);
    expect(parsed.durum.S.agiBolgesel instanceof Set).toBe(true);
    expect(parsed.durum.S.agiBolgesel.has("E123")).toBe(true);
    expect(parsed.durum.S.stExclude.has("a|1")).toBe(true);
    expect(parsed.durum.S.suSecili.has("S1")).toBe(true);
    // Ensure has/add works after reviver
    parsed.durum.S.agiBolgesel.add("NEW");
    expect(parsed.durum.S.agiBolgesel.has("NEW")).toBe(true);
  });

  it("reviver restores only known keys", () => {
    const json = JSON.stringify({ agiBolgesel: { __set: ["a"] }, diger: { __set: ["b"] } });
    const parsed = JSON.parse(json, setReviver);
    expect(parsed.agiBolgesel instanceof Set).toBe(true);
    expect(parsed.diger instanceof Set).toBe(false);
    expect(parsed.diger.__set).toEqual(["b"]);
  });
});
