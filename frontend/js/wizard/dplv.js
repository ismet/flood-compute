/**
 * @fileoverview DPLV oranları — MGM PLV (otomatik) + manuel 14 grid.
 * @module wizard/dplv
 * Owns: S.dplvManual, S.dplvAuto, S.dplvValues, S.mgm, S.mgmByNorm, S.mgmDb
 * Exports: DPLV_LABELS, loadMgm, updatePlvAutoInfo, autoSelectPLV, loadMgmDb, mgmFind, renderDplvGrid, readDplvGrid, dplvRatios
 * Notes: Rank 2 (wizard). DPLV_LABELS lokal sabit (constants admission).
 *   Hazır istasyon (dplvList/DPLV_GIZLI/loadDplv, GET /api/dplv) kaldırıldı — tek kaynak MGM PLV.
 */

import { S } from "../core/state.js";
import { $ } from "../ui/dom.js";
import { api } from "../core/api.js";
import { _esc, mgmNorm } from "../core/format.js";

export const DPLV_LABELS = [
  "5dk",
  "10dk",
  "15dk",
  "30dk",
  "1sa",
  "2sa",
  "3sa",
  "4sa",
  "5sa",
  "6sa",
  "8sa",
  "12sa",
  "18sa",
  "24sa",
];
let _autoPlvPromise = null;
export async function loadMgm() {
  try {
    const d = await api("/api/mgm-stations");
    S.mgm = d.istasyonlar || [];
    S.mgmByNorm = {};
    S.mgm.forEach((s) => (S.mgmByNorm[mgmNorm(s.ad)] = s));
    let dl = document.getElementById("mgmList");
    if (!dl) {
      dl = document.createElement("datalist");
      dl.id = "mgmList";
      document.body.appendChild(dl);
    }
    dl.innerHTML = S.mgm.map((s) => `<option value="${_esc(s.ad)}"></option>`).join("");
    const md = $("mgmDplv");
    if (md)
      md.onchange = () => {
        const st = mgmFind(md.value);
        if (st) {
          S.dplvManual = true;
          md.value = st.ad;
          S.dplvValues = st.plv.slice();
          renderDplvGrid();
          updatePlvAutoInfo();
        }
      };
  } catch (e) {
    S.mgm = [];
  }
}
loadMgm();
export function updatePlvAutoInfo() {
  const el = $("plvAutoInfo");
  if (!el) return;
  const a = S.dplvAuto;
  if (!a) {
    el.innerHTML = "";
    return;
  }
  const manual = S.dplvManual
    ? ' · <span class="warn">elle değiştirildi</span> <button id="btnPlvAutoReset" class="link-btn" title="Otomatik seçime dön">↺ Otomatik’e dön</button>'
    : "";
  el.innerHTML = `🌧 Otomatik: <b>${_esc(a.ad)}</b> (${_esc(a.kod)}) — ${(+a.mesafe_km).toFixed(1)} km${manual}`;
  const btn = $("btnPlvAutoReset");
  if (btn)
    btn.onclick = () => {
      S.dplvManual = false;
      autoSelectPLV({ force: true });
    };
}
export async function autoSelectPLV({ force = false } = {}) {
  if (!S.havza) return;
  if (!force && S.dplvManual) return;
  if (_autoPlvPromise) return _autoPlvPromise;
  _autoPlvPromise = (async () => {
    const curHavza = S.havza;
    try {
      const r = await api("/api/plv-en-yakin", { havza_geojson: curHavza });
      if (curHavza !== S.havza) return; // havza değişti, eski sonuç atılır
      if (!r || !r.plv) return;
      S.dplvValues = r.plv.slice();
      S.dplvAuto = r;
      const md = $("mgmDplv");
      if (md) md.value = r.ad;
      renderDplvGrid();
      updatePlvAutoInfo();
    } catch (e) {
      const el = $("plvAutoInfo");
      if (el) el.innerHTML = `⚠ MGM PLV otomatik seçim yapılamadı: ${_esc(e.message)} — 14 oranı elle doldurun`;
    }
  })();
  try {
    return await _autoPlvPromise;
  } finally {
    _autoPlvPromise = null;
  }
}
export async function loadMgmDb() {
  try {
    S.mgmDb = await api("/api/mgm-bilgi");
  } catch (e) {
    S.mgmDb = { var: false };
  }
}
loadMgmDb();
export function mgmFind(name) {
  if (!S.mgmByNorm) return null;
  const n = mgmNorm(name);
  if (S.mgmByNorm[n]) return S.mgmByNorm[n];
  // kısmi eşleşme (Thiessen adı MGM adını içeriyorsa veya tersi)
  let best = null;
  for (const s of S.mgm) {
    const sn = mgmNorm(s.ad);
    if (n && (sn.includes(n) || n.includes(sn))) {
      best = s;
      break;
    }
  }
  return best;
}
export function renderDplvGrid() {
  const div = $("dplvGrid");
  if (!div) return;
  const vals = S.dplvValues || Array(14).fill(null);
  let h =
    `<table class="tbl rain"><tr>` +
    DPLV_LABELS.map((l) => `<th>${l}</th>`).join("") +
    `</tr><tr>` +
    vals
      .map(
        (v, c) =>
          `<td><input class="dplv-cell" data-c="${c}" value="${v == null ? "" : Math.round(v * 1e6) / 1e6}"></td>`,
      )
      .join("") +
    `</tr></table>`;
  div.innerHTML = h;
  div.querySelectorAll(".dplv-cell").forEach((inp) => {
    inp.addEventListener("input", () => {
      S.dplvManual = true;
      readDplvGrid();
      updatePlvAutoInfo();
    });
    inp.addEventListener("paste", (e) => {
      const text = (e.clipboardData || window.clipboardData).getData("text");
      if (!text || (!text.includes("\t") && !text.includes("\n") && !text.includes(";") && !text.includes(" "))) return;
      e.preventDefault();
      const flat = text
        .replace(/\r/g, "")
        .split(/[\s;]+/)
        .map((x) => x.trim())
        .filter((x) => x !== "");
      const c0 = +e.target.dataset.c;
      flat.forEach((val, dc) => {
        const cell = document.querySelector(`.dplv-cell[data-c="${c0 + dc}"]`);
        if (cell) cell.value = val;
      });
      S.dplvManual = true;
      readDplvGrid();
      updatePlvAutoInfo();
    });
  });
  updatePlvAutoInfo();
}
export function readDplvGrid() {
  S.dplvValues = Array(14).fill(null);
  document.querySelectorAll(".dplv-cell").forEach((inp) => {
    const t = inp.value.trim().replaceAll(",", ".");
    S.dplvValues[+inp.dataset.c] = t === "" || isNaN(+t) ? null : +t;
  });
}
export function dplvRatios() {
  const valsOk = S.dplvValues && S.dplvValues.every((v) => v != null && Number.isFinite(v)) && Math.abs(S.dplvValues[13] - 1.0) < 1e-9;
  const autoOk = S.dplvAuto && S.dplvAuto.plv && S.dplvAuto.plv.every((v) => v != null && Number.isFinite(v));
  // Elle modda eksik grid asla otomatikle maskelenmemeli — hep throw, asla silent fallback yok
  if (S.dplvManual) {
    if (!valsOk) throw new Error("DPLV elle tablo eksik — 14 hücreyi doldurun (son oran 1.0 olmalı)");
    return S.dplvValues;
  }
  if (valsOk) return S.dplvValues;
  if (autoOk) return S.dplvAuto.plv;
  throw new Error("DPLV 14 oran eksik — MGM PLV otomatik seçilmedi ve tablo boş. Havzayı çıkarıp MGM'yi bekleyin veya 14 oranı doldurun.");
}
