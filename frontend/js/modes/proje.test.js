import { describe, it, expect } from "vitest";
import { buildDurumS, yagisAnahtarlariniGocur } from "./proje.js";
import { S } from "../core/state.js";
import { istasyonYagisAnahtari } from "../core/format.js";

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

describe("proje save strips live leaflet layers", () => {
  // Gerçek kaza: showResMarker (modes/rezervuar.js) S.resMarker'a canlı
  // L.circleMarker koyar; Geoman katmana .pm._layer geri referansı ekler,
  // JSON.stringify "circular structure" ile patlar ve kayıt hiç yapılamaz.
  it("buildDurumS nulls resMarker — stringify survives pm/_map cycles", () => {
    const marker = {};
    marker._map = { _layers: { 9: marker } };
    marker.pm = { _layer: marker };
    const once = S.resMarker;
    S.resMarker = marker;
    try {
      let body;
      expect(() => {
        body = JSON.stringify({ ad: "t", durum: { S: buildDurumS(), fields: {} } }, setReplacer);
      }).not.toThrow();
      const parsed = JSON.parse(body, setReviver);
      expect(parsed.durum.S.resMarker).toBeNull();
      expect(parsed.durum.S.infoLayers).toEqual([]);
      expect(parsed.durum.S.rasterLayers).toEqual([]);
    } finally {
      S.resMarker = once;
    }
  });
});

describe("proje yağış anahtarı göçü", () => {
  it("eski ad anahtarını kanonik anahtara taşır ve değeri korur", () => {
    const istasyon = { name: "MERKEZ", kod: "17030", lat: 39, lon: 32 };
    const eski = { thiessen: [istasyon], rainValues: { MERKEZ: [1, 2, 3, 4, 5, 6, 7] } };
    const gocen = yagisAnahtarlariniGocur(eski);
    expect(gocen.rainValues.MERKEZ).toBeUndefined();
    expect(gocen.rainValues[istasyonYagisAnahtari(istasyon)]).toEqual(eski.rainValues.MERKEZ);
    expect(eski.rainValues[istasyonYagisAnahtari(istasyon)]).toBeUndefined();
  });

  it("aynı adlı istasyonları ayrı kanonik anahtarlara taşır", () => {
    const a = { name: "MERKEZ", kod: "100", lat: 39, lon: 32 };
    const b = { name: "MERKEZ", kod: "200", lat: 40, lon: 33 };
    const gocen = yagisAnahtarlariniGocur({ thiessen: [a, b], rainValues: { MERKEZ: [10, 20] } });
    expect(gocen.rainValues[istasyonYagisAnahtari(a)]).toEqual([10, 20]);
    expect(gocen.rainValues[istasyonYagisAnahtari(b)]).toEqual([10, 20]);
  });

  it("kanonik kayıt turunda ayrı değerleri değiştirmez", () => {
    const a = { name: "MERKEZ", kod: "100", lat: 39, lon: 32 };
    const b = { name: "MERKEZ", kod: "200", lat: 40, lon: 33 };
    const durum = {
      thiessen: [a, b],
      rainValues: { [istasyonYagisAnahtari(a)]: [10], [istasyonYagisAnahtari(b)]: [20] },
    };
    const tur = yagisAnahtarlariniGocur(JSON.parse(JSON.stringify(durum)));
    expect(tur.rainValues).toEqual(durum.rainValues);
  });
});
