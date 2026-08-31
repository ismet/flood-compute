/**
 * @fileoverview Yağış tablosu — manuel giriş, recalcRain, renk kümesi.
 * @module wizard/rain
 * Owns: S.rainValues, S.P24w, S.OETw, S.rainColorCol; layers.thiessen OWNER-CREATED
 * Exports: RAIN_BLUES, rainRange, rainColor, thiessenStyle, recolorThiessen, renderRainLegend, RAIN_COLS, activeStations, renderRainTable, onRainPaste, readRainGrid, recalcRain
 * Notes: Rank 2 (wizard). Yağış değerleri kararlı istasyon anahtarıyla saklanır.
 */

import { S } from "../core/state.js";
import { $, setStatus } from "../ui/dom.js";
import { _esc, istasyonYagisAnahtari } from "../core/format.js";
import { map, layers } from "../map/init.js";
import { markDone, updateComputeReady } from "./steps.js";

// layers.thiessen OWNER-CREATED (registry-bag)
if (layers.thiessen) {
  try {
    map.removeLayer(layers.thiessen);
  } catch (e) {}
}
layers.thiessen = L.geoJSON(null, {
  style: { color: "#7d6e4f", weight: 1.5, fillOpacity: 0.05, dashArray: "3 3" },
}).addTo(map);

// Thiessen style will be updated via recolorThiessen (dynamic)
export const RAIN_BLUES = [
  "#e3f2fd",
  "#bbdefb",
  "#90caf9",
  "#64b5f6",
  "#42a5f5",
  "#2196f3",
  "#1e88e5",
  "#1976d2",
  "#1565c0",
  "#0d47a1",
];
function istasyonYagisi(s) {
  const degerler = S.rainValues || {};
  return degerler[istasyonYagisAnahtari(s)];
}
export function rainRange() {
  // seçili sütunda dolu değeri olan aktif istasyonlardan min/max
  const c = S.rainColorCol ?? 5;
  const vals = (S.thiessen || [])
    .filter((t) => t.agirlik > 0)
    .map((t) => (istasyonYagisi(t) || [])[c])
    .filter((v) => v != null && !isNaN(v))
    .map(Number);
  if (!vals.length) return null;
  return { min: Math.min(...vals), max: Math.max(...vals), n: vals.length, col: c };
}
export function rainColor(istasyon) {
  const rng = rainRange();
  if (!rng) return null;
  const v = (istasyonYagisi(istasyon) || [])[rng.col];
  if (v == null || isNaN(v)) return null;
  const t = rng.max > rng.min ? (v - rng.min) / (rng.max - rng.min) : 0.6;
  return RAIN_BLUES[Math.min(RAIN_BLUES.length - 1, Math.max(0, Math.round(t * (RAIN_BLUES.length - 1))))];
}
export function thiessenStyle(f) {
  const istasyon = f && f.properties;
  const col = istasyon && istasyon.name ? rainColor(istasyon) : null;
  if (!col) return { color: "#7d6e4f", weight: 1.5, fillOpacity: 0.05, dashArray: "3 3" };
  return { color: "#0d47a1", weight: 1.5, fillColor: col, fillOpacity: 0.65, dashArray: null };
}
export function recolorThiessen() {
  if (layers.thiessen) layers.thiessen.setStyle(thiessenStyle);
  renderRainLegend();
}
export function renderRainLegend() {
  const el = $("rainLegend");
  if (!el) return;
  const rng = rainRange();
  if (!rng) {
    el.innerHTML = "";
    return;
  }
  const etiket = RAIN_COLS[rng.col] === "OEY" ? "OEY" : "P" + RAIN_COLS[rng.col];
  el.innerHTML =
    `<span class="small">Alan boyaması — ${etiket} yağışı (mm):</span>
    <span class="small">${rng.min.toFixed(1)}</span>` +
    RAIN_BLUES.map((c) => `<i style="background:${c}"></i>`).join("") +
    `<span class="small">${rng.max.toFixed(1)}</span>
     <span class="small">(${rng.n} istasyon)</span>`;
}
export const RAIN_COLS = ["2", "5", "10", "25", "50", "100", "OEY"];
export const activeStations = () => S.thiessen.filter((t) => t.agirlik > 0);
export function renderRainTable() {
  const w = activeStations();
  const div = $("rainGrid");
  if (!w.length) {
    div.innerHTML = `<div class="small">Önce yukarıdaki Thiessen ağırlıklarını hesaplayın.</div>`;
    return;
  }
  if (!S.rainValues) S.rainValues = {};
  let h =
    `<div class="rain-tools"><span class="small">P2–P100 ve OEY değerlerini elle girin veya Excel'den yapıştırın.</span>
    <label class="inline" title="Haritadaki Thiessen alanları, seçilen tekerrürün yağışına göre mavi tonlarıyla boyanır (az yağış açık, çok yağış koyu).">Alan boyaması
      <select id="rainColorCol">` +
    RAIN_COLS.map(
      (c, i) =>
        `<option value="${i}"${i === (S.rainColorCol ?? 5) ? " selected" : ""}>${c === "OEY" ? "OEY" : "P" + c}</option>`,
    ).join("") +
    `</select></label></div>
    <div id="rainLegend" class="rain-legend"></div>
    <table class="tbl rain st"><tr><th colspan="8">Yinelenmeli Yağışlar (24 Saatlik)</th></tr>
    <tr><th>İstasyon (w)</th>` +
    RAIN_COLS.map((c) => `<th>${c}</th>`).join("") +
    `</tr>`;
  w.forEach((t, r) => {
    const vals = istasyonYagisi(t) || [];
    h += `<tr><td>${_esc(t.name)} (${(t.agirlik * 100).toFixed(0)}%)</td>`;
    for (let c = 0; c < 7; c++) {
      const v = vals[c] ?? "";
      h += `<td><input class="rain-cell" data-r="${r}" data-c="${c}" value="${_esc(v)}"></td>`;
    }
    h += `</tr>`;
  });
  h +=
    `<tr class="sel"><td><b>Ağırlıklı</b></td>` +
    RAIN_COLS.map((_, i) => `<td id="rw${i}"></td>`).join("") +
    `</tr></table>`;
  div.innerHTML = h;
  div.querySelectorAll(".rain-cell").forEach((inp) => {
    inp.addEventListener("input", readRainGrid);
    inp.addEventListener("paste", onRainPaste);
  });
  const sel = $("rainColorCol");
  if (sel)
    sel.onchange = () => {
      S.rainColorCol = +sel.value;
      recolorThiessen();
    };
  recolorThiessen();
  recalcRain();
}
export function onRainPaste(e) {
  const text = (e.clipboardData || window.clipboardData).getData("text");
  if (!text || (!text.includes("\t") && !text.includes("\n"))) return; // tek değer: normal yapıştır
  e.preventDefault();
  const block = text
    .replace(/\r/g, "")
    .split("\n")
    .filter((x) => x.trim() !== "")
    .map((row) => row.split("\t"));
  const r0 = +e.target.dataset.r,
    c0 = +e.target.dataset.c;
  block.forEach((cols, dr) =>
    cols.forEach((val, dc) => {
      const cell = document.querySelector(`.rain-cell[data-r="${r0 + dr}"][data-c="${c0 + dc}"]`);
      if (cell) cell.value = val.trim();
    }),
  );
  readRainGrid();
}
export function readRainGrid() {
  const w = activeStations();
  S.rainValues = {};
  document.querySelectorAll(".rain-cell").forEach((inp) => {
    const r = +inp.dataset.r,
      c = +inp.dataset.c;
    if (!w[r]) return;
    const anahtar = istasyonYagisAnahtari(w[r]);
    if (!S.rainValues[anahtar]) S.rainValues[anahtar] = Array(7).fill(null);
    const t = inp.value.trim().replace(",", ".");
    S.rainValues[anahtar][c] = t === "" || isNaN(+t) ? null : +t;
  });
  recalcRain();
}
export function oetSec(elle, sums6) {
  return elle !== "" && elle != null ? +elle : sums6;
}
export function recalcRain() {
  recolorThiessen();
  const w = activeStations();
  const sums = Array(7).fill(null);
  for (let c = 0; c < 7; c++) {
    let s = 0,
      valid = w.length > 0;
    w.forEach((t) => {
      const v = (istasyonYagisi(t) || [])[c];
      if (v == null) valid = false;
      else s += t.agirlik * v;
    });
    if (valid) sums[c] = s;
  }
  const ok = sums.slice(0, 6).every((v) => v != null);
  S.P24w = ok ? { 2: sums[0], 5: sums[1], 10: sums[2], 25: sums[3], 50: sums[4], 100: sums[5] } : null;
  const elle = $("inpOetElle")?.value.trim() ?? "";
  S.OETw = oetSec(elle, sums[6]);
  for (let i = 0; i < 7; i++) {
    const el = $("rw" + i);
    if (el) el.innerHTML = sums[i] == null ? "—" : `<b>${sums[i].toFixed(2)}</b>`;
  }
  // OET kaynak bilgisi için ayrı gösterge
  const oetInfo = $("oetKaynakInfo");
  if (oetInfo) {
    if (elle !== "") oetInfo.textContent = `→ OEY ELLE ${S.OETw != null ? S.OETw.toFixed(2) : "—"} mm`;
    else if (sums[6] != null) oetInfo.textContent = `→ OEY ağırlıklı ${sums[6].toFixed(2)} mm`;
    else oetInfo.textContent = "";
  }
  if (ok) {
    const kaynakEtiket = elle !== "" ? `OEY: ELLE ${S.OETw != null ? S.OETw.toFixed(2) : "—"} mm` : sums[6] != null ? `OEY: ağırlıklı ${sums[6].toFixed(2)} mm` : "OEY: ağırlıklı —";
    setStatus(
      "rainStatus",
      S.OETw == null ? `⚠ OEY sütunu boş: OET/QOET hesapları 0 kabul edilir — ${kaynakEtiket}` : `Ağırlıklı yağışlar hazır — ${kaynakEtiket}`,
      S.OETw == null ? "err" : "ok",
    );
    markDone(3);
  } else if (w.length) {
    setStatus("rainStatus", "Tüm istasyonlar için P2..P100 değerlerini girin", "");
  }
  updateComputeReady();
}
// OET elle input self-wiring
if ($("inpOetElle") && !$("inpOetElle")._wired) {
  $("inpOetElle")._wired = true;
  $("inpOetElle").addEventListener("input", recalcRain);
} else {
  // DOM henüz yoksa, DOMContentLoaded'da bağla
  document.addEventListener("DOMContentLoaded", () => {
    const el = $("inpOetElle");
    if (el && !el._wired) {
      el._wired = true;
      el.addEventListener("input", recalcRain);
    }
  });
}
