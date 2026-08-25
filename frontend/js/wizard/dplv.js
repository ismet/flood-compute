import { S } from "../core/state.js";
import { $, setStatus } from "../ui/dom.js";
import { api } from "../core/api.js";
import { _esc, mgmNorm } from "../core/format.js";

export const DPLV_LABELS = ["5dk", "10dk", "15dk", "30dk", "1sa", "2sa", "3sa", "4sa",
                     "5sa", "6sa", "8sa", "12sa", "18sa", "24sa"];
export const DPLV_GIZLI = ["TEKİRDAĞ"];
let _loadDplvPromise = null;
let _autoPlvPromise = null;
export async function loadDplv() {
  if (S.dplvList) return S.dplvList;
  if (_loadDplvPromise) return _loadDplvPromise;
  _loadDplvPromise = (async () => {
    const d = await api("/api/dplv");
    S.dplvList = d;
    const sel = $("inpDplv");
    sel.innerHTML = "";
    let ilk = null;
    d.stations.forEach((s, i) => {
      if (DPLV_GIZLI.includes(s.name)) return;
      if (ilk === null) ilk = i;
      const o = document.createElement("option"); o.value = i; o.textContent = s.name;
      sel.appendChild(o);
    });
    sel.onchange = () => {
      S.dplvManual = true;
      S.dplvValues = S.dplvList.stations[+sel.value].ratios.slice();
      renderDplvGrid();
      updatePlvAutoInfo();
    };
    if (ilk !== null) {
      sel.value = ilk;
      if (!S.dplvValues && !S.dplvAuto && !S.dplvManual) S.dplvValues = d.stations[ilk].ratios.slice();
    }
    renderDplvGrid();
    updatePlvAutoInfo();
    return d;
  })();
  try { return await _loadDplvPromise; } finally { _loadDplvPromise = null; }
}
loadDplv().catch(()=>{});
export async function loadMgm() {
  try {
    const d = await api("/api/mgm-stations");
    S.mgm = d.istasyonlar || [];
    S.mgmByNorm = {}; S.mgm.forEach(s => S.mgmByNorm[mgmNorm(s.ad)] = s);
    let dl = document.getElementById("mgmList");
    if (!dl) { dl = document.createElement("datalist"); dl.id = "mgmList"; document.body.appendChild(dl); }
    dl.innerHTML = S.mgm.map(s => `<option value="${s.ad}"></option>`).join("");
    const md = $("mgmDplv");
    if (md) md.onchange = () => {
      const st = mgmFind(md.value);
      if (st) { S.dplvManual = true; md.value = st.ad; S.dplvValues = st.plv.slice(); renderDplvGrid(); updatePlvAutoInfo(); }
    };
  } catch (e) { S.mgm = []; }
}
loadMgm();
export function updatePlvAutoInfo() {
  const el = $("plvAutoInfo");
  if (!el) return;
  const a = S.dplvAuto;
  if (!a) { el.innerHTML = ""; return; }
  const manual = S.dplvManual ? ' · <span class="warn">elle değiştirildi</span> <button id="btnPlvAutoReset" class="link-btn" title="Otomatik seçime dön">↺ Otomatik’e dön</button>' : "";
  el.innerHTML = `🌧 Otomatik: <b>${_esc(a.ad)}</b> (${_esc(a.kod)}) — ${(+a.mesafe_km).toFixed(1)} km${manual}`;
  const btn = $("btnPlvAutoReset");
  if (btn) btn.onclick = () => { S.dplvManual = false; autoSelectPLV({ force: true }); };
}
export async function autoSelectPLV({ force = false } = {}) {
  if (!S.havza) return;
  if (!force && S.dplvManual) return;
  if (_autoPlvPromise) return _autoPlvPromise;
  _autoPlvPromise = (async () => {
    // S.dplvList hazır değilse bekle (loadDplv fire-and-forget)
    if (!S.dplvList) {
      try { await loadDplv(); } catch (e) { /* sessiz */ }
      if (!S.dplvList) return;
    }
    const curHavza = S.havza;
    try {
      const r = await api("/api/plv-en-yakin", { havza_geojson: curHavza });
      if (curHavza !== S.havza) return; // havza değişti, eski sonuç atılır
      if (!r || !r.plv) return;
      S.dplvValues = r.plv.slice();
      S.dplvAuto = r;
      const md = $("mgmDplv");
      if (md) md.value = r.ad;
      // inpDplv dokunulmaz (3’lü), dplvRatios S.dplvValues öncelikli
      renderDplvGrid();
      updatePlvAutoInfo();
    } catch (e) {
      // sessiz fallback: statik ÇORLU davranışı korunur
    }
  })();
  try { return await _autoPlvPromise; } finally { _autoPlvPromise = null; }
}
export async function loadMgmDb() {
  try {
    S.mgmDb = await api("/api/mgm-bilgi");
  } catch (e) { S.mgmDb = { var: false }; }
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
    if (n && (sn.includes(n) || n.includes(sn))) { best = s; break; }
  }
  return best;
}
export function renderDplvGrid() {
  const div = $("dplvGrid");
  if (!div || !S.dplvList) return;
  const vals = S.dplvValues || Array(14).fill(null);
  let h = `<table class="tbl rain"><tr>` +
    DPLV_LABELS.map(l => `<th>${l}</th>`).join("") + `</tr><tr>` +
    vals.map((v, c) =>
      `<td><input class="dplv-cell" data-c="${c}" value="${v == null ? "" : Math.round(v * 1e6) / 1e6}"></td>`).join("") +
    `</tr></table>`;
  div.innerHTML = h;
  div.querySelectorAll(".dplv-cell").forEach(inp => {
    inp.addEventListener("input", () => { S.dplvManual = true; readDplvGrid(); updatePlvAutoInfo(); });
    inp.addEventListener("paste", (e) => {
      const text = (e.clipboardData || window.clipboardData).getData("text");
      if (!text || (!text.includes("\t") && !text.includes("\n"))) return;
      e.preventDefault();
      const flat = text.replace(/\r/g, "").split(/[\n\t]/).map(x => x.trim()).filter(x => x !== "");
      const c0 = +e.target.dataset.c;
      flat.forEach((val, dc) => {
        const cell = document.querySelector(`.dplv-cell[data-c="${c0 + dc}"]`);
        if (cell) cell.value = val;
      });
      S.dplvManual = true; readDplvGrid(); updatePlvAutoInfo();
    });
  });
  updatePlvAutoInfo();
}
export function readDplvGrid() {
  S.dplvValues = Array(14).fill(null);
  document.querySelectorAll(".dplv-cell").forEach(inp => {
    const t = inp.value.trim().replace(",", ".");
    S.dplvValues[+inp.dataset.c] = t === "" || isNaN(+t) ? null : +t;
  });
}
export function dplvRatios() {
  if (S.dplvValues && S.dplvValues.every(v => v != null)) return S.dplvValues;
  // Boş/bayat seçim (ör. gizlenmiş bir istasyonu işaret eden eski proje) +"" ile
  // 0. istasyona düşmesin; ilk görünür istasyona geri çekil.
  const v = $("inpDplv").value;
  const st = v === "" ? null : S.dplvList.stations[+v];
  const gorunur = S.dplvList.stations.find(s => !DPLV_GIZLI.includes(s.name));
  return (st || gorunur || S.dplvList.stations[0]).ratios;
}
