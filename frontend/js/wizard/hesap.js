/**
 * @fileoverview Hesap — DSİ/Mockus/Rasyonel/Snyder compute, abaklar, kar erimesi; Yıl_Ara + dock.
 * @module wizard/hesap
 * Owns: S.girdi, S.sonuc, S.ctcp, S.abak2 (abak verileri), kar DOM (karBox: karA/karH/karHist/karRate/karPeriod/karTemps — havza-scoped, clearSingleBasin'de sıfırlanır)
 * Exports: logInterp, lin1, yaldFromArea, loadCtCp, loadAbak2, snyderW, updateSnyderW, build*Html, renderHesapDock, renderResults, syncRepSecili, downloadReport, downloadKmz, exportCSV
 * Notes:
 *  - Allowed pulls (§3.1): hesap→grafik (showChart, showSnyderChart), hesap→kmz (exportKmz — legacy re-export)
 *  - KMZ dışa aktarım wizard/kmz.js'e taşındı (step 1'den erişim); buradaki downloadKmz uyumluluk sarmalayıcısıdır.
 *  - 6. adım (Mukayese ve Rapor) için rapor mantığı bu modülde tek sahiplidir; comparison.js buradan import eder (comparison→hesap).
 *  - Rank 2 (wizard).
 * @typedef {Object} ComputeGirdi
 * @property {string} ad - Proje/havza adı
 * @property {number} A_km2 - Alan km²
 * @property {number} L_km - Ana kanal uzunluğu
 * @property {number} Lc_km - Ağırlık merkezi uzaklığı
 * @property {number} CN2 - CN II
 * @property {number|null} CN3
 * @property {string} region - YZD bölgesi A/B/C
 * @property {Array<number>} elevations - 11 kot
 * @property {number} Qbaz
 * @property {Object} P24 - {2,5,10,25,50,100} ağırlıklı P24
 * @property {number} P24_OET - OET yağış
 * @property {Array<number>} dplv_ratios - 14 oran
 * @typedef {Object} ComputePayload
 * @property {ComputeGirdi} girdi
 * @property {Object|null} kar - Kar erimesi parametreleri veya null
 * @property {boolean} rasyonel
 * @property {number} c100
 * @property {number} us
 * @property {boolean} snyder
 * @property {Object|null} snyder_par - {Ct,Cp,W50,W75,YALD}
 */

import { S } from "../core/state.js";
import { api } from "../core/api.js";
import { fmt, _esc } from "../core/format.js";
import { $, setStatus, download, dosyaIndir } from "../ui/dom.js";
import { DURS, RPS, CMP_LABELS } from "../core/constants.js";
import { dplvRatios } from "./dplv.js";
import { markDone } from "./steps.js";
import { showChart, showSnyderChart } from "./grafik.js";
import { exportKmz } from "./kmz.js";

/* ---- Hesaplanacak Yöntemler (Sentetik Yöntemler) — S.seciliYontemler Set ---- */
export function seciliYontemler() {
  if (S.seciliYontemler instanceof Set) return new Set(S.seciliYontemler);
  const dom = document.querySelectorAll(".hesapYontem:checked");
  if (dom.length) return new Set(Array.from(dom).map((e) => e.dataset.m));
  return new Set(["dsi", "mockus"]);
}
function yontemSecili(m) {
  return (S.seciliYontemler instanceof Set ? S.seciliYontemler : seciliYontemler()).has(m);
}
function syncYontemBoxes() {
  const sel = S.seciliYontemler instanceof Set ? S.seciliYontemler : new Set(["dsi", "mockus"]);
  const rBox = $("rasyonelBox");
  const sBox = $("snyderBox");
  if (rBox) {
    rBox.classList.toggle("hidden", !sel.has("rasyonel"));
    if (sel.has("rasyonel")) rBox.open = true;
  }
  if (sBox) {
    sBox.classList.toggle("hidden", !sel.has("snyder"));
    if (sel.has("snyder")) {
      sBox.open = true;
      updateSnyderW();
    }
  }
  // hide-sync: inner legacy checkboxes for one-release compat (cn.js / app.js still write inpRasyonel)
  const ir = $("inpRasyonel");
  if (ir) ir.checked = sel.has("rasyonel");
  const is = $("inpSnyder");
  if (is) is.checked = sel.has("snyder");
  // DSİ zorunlu — enforce checked disabled
  const dsi = document.querySelector('.hesapYontem[data-m="dsi"]');
  if (dsi) { dsi.checked = true; dsi.disabled = true; }
}
function wireYontemSecim() {
  const boxes = document.querySelectorAll(".hesapYontem");
  if (!boxes.length) return false;
  boxes.forEach((cb) => {
    if (cb.dataset.wired) return;
    cb.dataset.wired = "1";
    cb.addEventListener("change", () => {
      if (!(S.seciliYontemler instanceof Set)) S.seciliYontemler = new Set(["dsi", "mockus"]);
      const m = cb.dataset.m;
      if (m === "dsi") { cb.checked = true; return; } // zorunlu
      if (cb.checked) S.seciliYontemler.add(m);
      else S.seciliYontemler.delete(m);
      if (!S.seciliYontemler.size) {
        // en az bir yöntem — sonuncuyu geri al
        S.seciliYontemler.add(m);
        cb.checked = true;
        setStatus("compStatus", "En az bir yöntem seçili olmalı", "err");
        setTimeout(() => setStatus("compStatus", "", ""), 1500);
        return;
      }
      syncYontemBoxes();
      // live-filter overlay if already computed
      if (S.sonuc) renderHesapDock();
      // update disabled state of HESAPLA via steps helper if available
      try { const e = $("btnCompute"); if (e) { const ready = $("inpA").value && $("inpL").value && S.P24w != null; e.disabled = !ready || S.seciliYontemler.size === 0; } } catch (e) {}
    });
  });
  // initial sync from S (project restore) to DOM
  boxes.forEach((cb) => {
    const m = cb.dataset.m;
    if (m === "dsi") cb.checked = true;
    else cb.checked = S.seciliYontemler instanceof Set ? S.seciliYontemler.has(m) : cb.checked;
  });
  syncYontemBoxes();
  return true;
}
// try immediate wire, else on DOMContentLoaded
if (!wireYontemSecim()) {
  document.addEventListener("DOMContentLoaded", wireYontemSecim);
}
/* ---- Snyder Ct-Cp abağı (log-log, çift yönlü otomatik) ---- */

let ctcpGuard = false;
export function logInterp(x, xs, ys) {
  const lx = Math.log(x),
    LX = xs.map(Math.log),
    LY = ys.map(Math.log);
  if (lx <= LX[0]) return Math.exp(LY[0]);
  if (lx >= LX[LX.length - 1]) return Math.exp(LY[LY.length - 1]);
  for (let i = 1; i < LX.length; i++)
    if (lx <= LX[i]) {
      const t = (lx - LX[i - 1]) / (LX[i] - LX[i - 1]);
      return Math.exp(LY[i - 1] + t * (LY[i] - LY[i - 1]));
    }
  return Math.exp(LY[LY.length - 1]);
}
function ctFromCp(cp) {
  return logInterp(cp, S.ctcp.Cp, S.ctcp.Ct);
}
function cpFromCt(ct) {
  return logInterp(ct, [...S.ctcp.Ct].reverse(), [...S.ctcp.Cp].reverse());
}
function wireCtCp(ctId, cpId) {
  const ct = $(ctId),
    cp = $(cpId);
  if (!ct || !cp) return;
  cp.addEventListener("input", () => {
    if (ctcpGuard || !S.ctcp || !+cp.value) return;
    ctcpGuard = true;
    ct.value = ctFromCp(+cp.value).toFixed(2);
    ctcpGuard = false;
    if (ctId === "inpCt") updateSnyderW();
  });
  ct.addEventListener("input", () => {
    if (ctcpGuard || !S.ctcp || !+ct.value) return;
    ctcpGuard = true;
    cp.value = cpFromCt(+ct.value).toFixed(2);
    ctcpGuard = false;
    if (ctId === "inpCt") updateSnyderW();
  });
}
async function loadCtCp() {
  try {
    S.ctcp = await api("/api/snyder-ctcp");
    wireCtCp("inpCt", "inpCp");
    wireCtCp("multiCt", "multiCp");
  } catch (e) {
    S.ctcp = null;
  }
}
loadCtCp();

// ŞEKİL 1'den okunan W50/W75'i Ct/Cp/L/Lc'den canlı hesapla ve göster
function snyderW(Ct, Cp, L, Lc) {
  if (!(Ct > 0 && Cp > 0 && L > 0 && Lc > 0)) return null;
  const tp = Ct * Math.pow(L * Lc, 0.3);
  const qp = (2760 * Cp) / tp; // lt/s/km²/cm
  const q = qp / 1000; // Qp/A (m³/s/km²/cm)
  return { tp, qp, W50: 5.87 / Math.pow(q, 1.08) / 2.54, W75: 3.35 / Math.pow(q, 1.08) / 2.54 };
}
export function lin1(x, xs, ys) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let i = 1; i < xs.length; i++)
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  return ys[ys.length - 1];
}
// YALD (24 sa alansal azaltma) — ABAK2'den; A≤25 ise 1.0 (snyder.compute ile aynı)
export function yaldFromArea(A) {
  if (!(A > 0) || !S.abak2) return null;
  if (A <= 25) return 1.0;
  const col = S.abak2.percent.map((r) => r[r.length - 1]); // 24 sa kolonu
  return lin1(A, S.abak2.areas_km2, col) / 100;
}
async function loadAbak2() {
  try {
    S.abak2 = await api("/api/abak2");
    updateSnyderW();
  } catch (e) {
    S.abak2 = null;
  }
}
loadAbak2();

function updateSnyderW() {
  const el = $("snyWReadout");
  if (!el) return;
  const A = +$("inpA").value;
  const w = snyderW(+$("inpCt").value, +$("inpCp").value, +$("inpL").value, +$("inpLc").value);
  const yald = yaldFromArea(A);
  const parts = [];
  if (w) {
    $("inpW50").placeholder = w.W50.toFixed(1);
    $("inpW75").placeholder = w.W75.toFixed(1);
    parts.push(
      `t<sub>p</sub>=${w.tp.toFixed(2)} sa, q<sub>p</sub>=${w.qp.toFixed(1)} lt/s/km²/cm → <b>W50=${w.W50.toFixed(1)}</b>, <b>W75=${w.W75.toFixed(1)}</b> saat (ŞEKİL 1)`,
    );
  } else {
    $("inpW50").placeholder = "ŞEKİL 1 (oto)";
    $("inpW75").placeholder = "ŞEKİL 1 (oto)";
  }
  if (yald != null) {
    $("inpYald").placeholder = yald.toFixed(3);
    parts.push(`ADK/<b>YALD</b> (24 sa, A=${A.toFixed(1)} km²) = <b>${yald.toFixed(3)}</b>`);
  }
  el.innerHTML = parts.length
    ? `🔎 <b>Otomatik (abaklar):</b> ${parts.join(" &nbsp;|&nbsp; ")} <span style="color:#6b6762">— boş kutularda bu değerler kullanılır</span>`
    : "";
}
["inpCt", "inpCp", "inpL", "inpLc", "inpA"].forEach((id) => {
  const e = $(id);
  if (e) e.addEventListener("input", updateSnyderW);
});
{
  const sb = $("snyderBox");
  if (sb) sb.addEventListener("toggle", updateSnyderW);
}
/* ---------------- ADIM 4: hesap ---------------- */
$("btnCompute").onclick = async () => {
  try {
    if (!$("inpA").value || !$("inpL").value) throw new Error("A ve L girilmedi (Adım 1)");
    if (!S.P24w) throw new Error("Ağırlıklı yağış yok (Adım 3)");
    const kar = $("karTemps").value.trim()
      ? {
          daily_tmax: $("karTemps")
            .value.split(/[\s,;]+/)
            .map((x) => +x.replace(",", "."))
            .filter((x) => !isNaN(x)),
          a_kar_km2: +$("karA").value,
          h_kar_m: +$("karH").value,
          h_ist_m: +$("karHist").value,
          melt_rate: +$("karRate").value,
          period: +$("karPeriod").value,
        }
      : null;
    const _dplv = dplvRatios(); // throws if eksik — mesaj doğrudan compStatus'a gider
    const girdi = {
      ad: $("projName").value || "Havza",
      A_km2: +$("inpA").value,
      L_km: +$("inpL").value,
      Lc_km: +$("inpLc").value,
      CN2: +$("inpCN2").value,
      CN3: +$("inpCN3").value || null,
      region: $("inpRegion").value,
      elevations: S.kotlar.map(Number),
      Qbaz: +$("inpQbaz").value || 0,
      P24: S.P24w,
      P24_OET: S.OETw ?? 0,
      dplv_ratios: _dplv,
    };
    S.girdi = girdi;
    setStatus("compStatus", "Hesaplanıyor…", "loading");
    const sel = S.seciliYontemler instanceof Set ? S.seciliYontemler : seciliYontemler();
    if (!sel.size) throw new Error("En az bir yöntem seçin (Hesaplanacak Yöntemler)");
    if (sel.has("dsi") === false) { sel.add("dsi"); S.seciliYontemler = sel; } // DSİ zorunlu
    const rasyonelOn = sel.has("rasyonel");
    const snyderOn = sel.has("snyder");
    // hide-sync keep inner legacy checkboxes for one-release compat
    if ($("inpRasyonel")) $("inpRasyonel").checked = rasyonelOn;
    if ($("inpSnyder")) $("inpSnyder").checked = snyderOn;
    S.sonuc = await api("/api/compute", {
      girdi,
      kar,
      dsi: sel.has("dsi"),
      mockus: sel.has("mockus"),
      rasyonel: rasyonelOn,
      c100: +$("inpC100").value || 0.45,
      us: +$("inpUs").value || 0.2,
      snyder: snyderOn,
      snyder_par: snyderOn
        ? {
            Ct: +$("inpCt").value || 1.55,
            Cp: +$("inpCp").value || 0.6,
            W50: +$("inpW50").value || null,
            W75: +$("inpW75").value || null,
            YALD: +$("inpYald").value || null,
          }
        : null,
    });
    renderResults();
    // step 6 view may already be active — auto-open compare overlay (Q3: each entry to 6)
    try {
      if (document.querySelector('.step[data-step="6"]')?.classList.contains("active") && S.sonuc) {
        const { openCompare } = await import("./grafik.js");
        openCompare();
      }
    } catch (e) {}
    setStatus("compStatus", "Tamamlandı", "ok");
    markDone(4);
  } catch (e) {
    setStatus("compStatus", "Hata: " + e.message, "err");
  }
};

/* === extracted to core/constants.js DURS === */ /* === extracted to core/constants.js RPS === */ function buildDsiHtml(
  r,
) {
  if (!r?.dsi_onhesap || !r?.girdi_ozeti) return "";
  const on = r.dsi_onhesap;
  return (
    `<h3 class="res">DSİ Sentetik — Önhesap</h3>` +
    `<div class="small">S=${fmt(r.girdi_ozeti.S_harmonik, 5)} | qp=${fmt(on.qp, 2)} l/s/km²/mm |` +
    ` Qp=${fmt(on.Qp, 4)} m³/s/mm | T=${on.T_saat} sa | Tp=${fmt(on.Tp, 2)} sa</div>`
  );
}
function buildKabuletHtml(r) {
  if (!r?.kabulet) return "";
  let h = `<h3 class="res">Pik Debiler — KABULET (m³/s)</h3><div class="tbl-wrap"><table class="tbl"><tr><th>T (yıl)</th>`;
  DURS.forEach((d) => (h += `<th>${d} sa</th>`));
  h += `</tr>`;
  RPS.forEach((rp) => {
    const vals = DURS.map((d) => r.kabulet[d]?.[rp]);
    const mx = Math.max(...vals.filter((v) => v != null));
    h +=
      `<tr><td>Q${rp}</td>` +
      vals.map((v) => `<td class="${v === mx && v != null ? "max" : ""}">${v == null ? "—" : fmt(v, 2)}</td>`).join("") +
      `</tr>`;
  });
  ["500", "1000", "10000"].forEach((rp) => {
    h += `<tr><td>Q${rp}</td>` + DURS.map((d) => `<td>${r.kabulet[d]?.[rp] == null ? "—" : fmt(r.kabulet[d][rp], 2)}</td>`).join("") + `</tr>`;
  });
  h +=
    `</table></div>` +
    `<div class="grid2"><label>Proje sağanak süresi` +
    `<select id="selDur">${DURS.map((d) => `<option value="${d}">${d} saat</option>`).join("")}</select>` +
    `</label><button id="btnChart">📈 Hidrografları göster</button></div>`;
  return h;
}
function buildMockusHtml(r) {
  if (!r?.mockus?.sonuclar) return "";
  const m = r.mockus;
  let h =
    `<h3 class="res">Mockus (süperpozesiz) pik debiler</h3>` +
    `<div class="small">Tc=${fmt(m.Tc, 3)} sa | D=${m.D} sa | Tp=${fmt(m.Tp, 3)} sa</div>` +
    `<div class="tbl-wrap"><table class="tbl"><tr><th>K</th><th>qp</th><th>Q2</th><th>Q5</th><th>Q10</th><th>Q25</th><th>Q50</th><th>Q100</th><th>Q500</th><th>Q1000</th><th>QOET</th></tr>`;
  ["K1", "K2", "K3"].forEach((k) => {
    const s = m.sonuclar[k];
    h +=
      `<tr><td>${k}=${s.K}</td><td>${fmt(s.qp, 3)}</td>` +
      [2, 5, 10, 25, 50, 100].map((t) => `<td>${fmt(s.Q[t], 2)}</td>`).join("") +
      `<td>${fmt(s.Q_ext[500], 2)}</td><td>${fmt(s.Q_ext[1000], 2)}</td><td>${fmt(s.Q_OET, 2)}</td></tr>`;
  });
  h += `</table></div>`;
  return h;
}
function buildRasyonelHtml(r) {
  if (!r?.rasyonel) return "";
  const ra = r.rasyonel;
  let h =
    `<h3 class="res">Rasyonel Yöntem</h3>` +
    `<div class="small">Tc=${fmt(ra.Tc_dk, 1)} dk | S=${fmt(ra.S_dogrusal, 5)} | YADK=${fmt(ra.YADK, 3)} | PLV(Tc)=${fmt(ra.PLV_Tc, 3)} | C100=${ra.C100} | üs=${ra.us} | Tb=${fmt(ra.Tb_saat, 2)} sa</div>` +
    `<div class="tbl-wrap"><table class="tbl"><tr>` +
    [2, 5, 10, 25, 50, 100].map((t) => `<th>Q${t}</th>`).join("") +
    `<th>Q500</th><th>Q1000</th><th>Q10000</th></tr><tr>` +
    [2, 5, 10, 25, 50, 100].map((t) => `<td>${fmt(ra.Q[t], 2)}</td>`).join("") +
    `<td>${fmt(ra.Q_ext["500"], 2)}</td><td>${fmt(ra.Q_ext["1000"], 2)}</td><td>${fmt(ra.Q_ext["10000"], 2)}</td></tr></table></div>`;
  if (r.girdi_ozeti?.A_km2 > 1)
    h += `<div class="small">⚠ A > 1 km²: rasyonel yöntem küçük havzalar içindir, karşılaştırma amaçlı gösteriliyor.</div>`;
  return h;
}
function buildSnyderHtml(r) {
  if (!r?.snyder) return "";
  const sn = r.snyder,
    p = sn.parametreler;
  let h =
    `<h3 class="res">Snyder Yöntemi</h3>` +
    `<div class="small">t<sub>p</sub>=${fmt(p.tp, 2)} sa | t<sub>r</sub>=${p.tr} sa | q<sub>p</sub>=${fmt(p.qp, 2)} l/s/km²/cm | Q<sub>p</sub>=${fmt(p.Qp, 3)} m³/s/mm | T<sub>p</sub>=${p.Tp} sa | T<sub>b</sub>=${p.Tb} sa | W50=${fmt(p.W50, 1)} | W75=${fmt(p.W75, 1)} | YALD=${fmt(p.YALD, 3)} | BH hacmi=${fmt(p.hacim_mm, 3)} mm</div>` +
    `<div class="tbl-wrap"><table class="tbl"><tr>` +
    ["2", "5", "10", "25", "50", "100", "500", "1000", "10000", "OET"].map((t) => `<th>Q${t}</th>`).join("") +
    `</tr><tr>` +
    ["2", "5", "10", "25", "50", "100", "500", "1000", "10000", "OET"]
      .map((t) => `<td>${fmt(sn.pikler[t], 2)}</td>`)
      .join("") +
    `</tr></table></div>` +
    `<button id="btnSnyChart">📈 Snyder hidrograflarını göster</button><div class="small">Q500/1000/10000 ekstrapolasyon (Q10–Q100), QOET C<sub>III</sub> ile; 24 sa sağanak ${sn.hidrograflar["2"] ? Math.round(24 / p.tr) : "?"} bloğa bölünüp süperpoze edilmiştir.</div>`;
  if (sn.yzdo_yad) {
    const yy = sn.yzdo_yad;
    h +=
      `<div class="small" style="margin-top:4px"><b>Otomatik çekilen YZDO & YAD</b> — bölge <b>${yy.bolge}</b> | ADK/YALD (24 sa alansal azaltma) = <b>${fmt(yy.YALD, 3)}</b> | MF=${fmt(yy.MF, 2)} | ${yy.n_blok}×${yy.tr} sa blok</div><div class="tbl-wrap"><table class="tbl"><tr><th>Blok</th>` +
      yy.bloklar.map((b) => `<th>${b.sure_sa} sa</th>`).join("") +
      `</tr><tr><td>T/ΣT</td>` +
      yy.bloklar.map((b) => `<td>${fmt(b.oran, 3)}</td>`).join("") +
      `</tr><tr><td>YZDO (${yy.bolge})</td>` +
      yy.bloklar.map((b) => `<td>${fmt(b.yzdo, 3)}</td>`).join("") +
      `</tr></table></div>`;
  }
  return h;
}
function buildKarHtml(r) {
  if (!r?.kar) return "";
  return `<div class="small" style="margin-top:6px">Kar erimesi piki: ${fmt(r.kar.Qkar_pik, 1)} m³/s (OET hidrografına eklendi)</div>`;
}
function renderHesapDock() {
  const el = $("hesapDock"),
    grid = $("hesapGrid");
  if (!el || !grid) return;
  if (!S.sonuc) {
    el.classList.add("hidden");
    grid.innerHTML = "";
    return;
  }
  const sel = S.seciliYontemler instanceof Set ? S.seciliYontemler : new Set(["dsi", "mockus"]);
  const r = S.sonuc;
  // DSİ zorunlu — if missing (backend filtered), show hint not throw (guards in builders)
  let html = "";
  if (sel.has("dsi")) {
    html += buildDsiHtml(r) + buildKabuletHtml(r);
    if (!r.kabulet) html += `<div class="small" style="margin-top:4px">DSİ seçili ama hesaplanmadı — HESAPLA ile yenileyin.</div>`;
  }
  if (sel.has("mockus")) {
    html += buildMockusHtml(r);
    if (!r.mockus) html += `<div class="small" style="margin-top:4px">Mockus seçili ama hesaplanmadı — HESAPLA ile yenileyin.</div>`;
  }
  if (sel.has("rasyonel")) {
    html += buildRasyonelHtml(r);
    if (!r.rasyonel) html += `<div class="small" style="margin-top:4px">Rasyonel seçili ama hesaplanmadı (A>1 ve parametreler eksik olabilir) — HESAPLA ile yenileyin.</div>`;
  }
  if (sel.has("snyder")) {
    html += buildSnyderHtml(r);
    if (!r.snyder) html += `<div class="small" style="margin-top:4px">Snyder seçili ama hesaplanmadı — HESAPLA ile yenileyin.</div>`;
  }
  html += buildKarHtml(r);
  if (!html.trim()) html = `<div class="small">Seçili yöntem yok — Hesaplanacak Yöntemler’den en az birini seçip HESAPLA.</div>`;
  grid.innerHTML = html;
  const btn = grid.querySelector("#btnChart");
  if (btn) btn.onclick = () => showChart(+grid.querySelector("#selDur").value);
  const btnSny = grid.querySelector("#btnSnyChart");
  if (btnSny) btnSny.onclick = () => showSnyderChart();
  // router-only: visibility is controlled solely by app.js:activateStep; no DOM peek here
}
function renderResults() {
  const r = S.sonuc,
    el = $("results");
  renderHesapDock();
  // after compute, the hesapDock visibility is authoritative via activateStep (only on 4); ensure correct here for immediate feedback
  const cur4 = document.querySelector('.step[data-step="4"]');
  const hd = $("hesapDock");
  if (hd) {
    if (cur4 && cur4.classList.contains("active") && S.sonuc) hd.classList.remove("hidden");
    else hd.classList.add("hidden");
  }
  let h = "";

  h += `<h3 class="res">Tekerrür yılı ara (Yıl_Ara)</h3>
    <div class="grid2"><label>Debi (m³/s)<input id="yilQ" type="number" step="0.1"></label>
    <button id="btnYil">Ara</button></div><div id="yilRes" class="status"></div>`;
  el.innerHTML = h;

  $("btnYil").onclick = () => {
    const sel = document.querySelector("#hesapGrid #selDur") || $("selDur");
    const d = sel?.value,
      q = +$("yilQ").value;
    if (!d) return;
    const q10 = r?.kabulet?.[d]?.["10"];
    const q100 = r?.kabulet?.[d]?.["100"];
    if (q10 == null || q100 == null) {
      $("yilRes").textContent = "DSİ KABULET yok — Yıl_Ara yalnızca DSİ hesaplandıysa çalışır.";
      return;
    }
    api("/api/yil-ara", { q, q10, q100 }).then(
      (x) =>
        ($("yilRes").textContent =
          `T ≈ ${x.tekerrur_yili ? x.tekerrur_yili.toFixed(1) : "—"} yıl (${d} sa hidrografına göre)`),
    );
  };
}

/* ================= WORD RAPORU ================= */
// dahil kutuları değişince "seçilen yöntem" menüsünü yalnız işaretli yöntemlerle güncelle
// — comparison.js de aynı seti S.rapFilter üzerinden yönetir; bu fonksiyon tek kaynaktır.
function syncRepSecili() {
  const checked = Array.from(document.querySelectorAll(".repMethod:checked")).map((x) => x.dataset.m);
  const sel = $("repSecili");
  if (!sel) return;
  // keep rapFilter in sync when called from comparison.js checkbox handler (already synced) or direct DOM
  // (fallback: if comparison.js didn't update Set, derive it)
  if (S.rapFilter instanceof Set) {
    const avail = ["dsi", "mockus", "rasyonel", "snyder"];
    avail.forEach((m) => {
      if (checked.includes(m)) S.rapFilter.delete(m);
      else {
        // only track if method was available (checkbox existed)
        const exists = document.querySelector(`.repMethod[data-m="${m}"]`);
        if (exists) S.rapFilter.add(m);
      }
    });
  }
  const cur = sel.value;
  sel.innerHTML = checked.map((mm) => `<option value="${mm}">${_esc(CMP_LABELS[mm])}</option>`).join("");
  if (checked.includes(cur)) sel.value = cur;
  else if (checked[0]) sel.value = checked[0];
}

async function downloadReport() {
  // status element may be #repStatus (inside comparison.js view) or fallback #comparisonStatus
  const statusEl = $("repStatus") || $("comparisonStatus");
  const statusId = statusEl ? statusEl.id : "repStatus";
  if (!S.sonuc || !S.girdi) {
    if (statusEl) statusEl.textContent = "Önce hesaplayın";
    else setStatus(statusId, "Önce hesaplayın", "err");
    return;
  }
  const dahil = Array.from(document.querySelectorAll(".repMethod:checked")).map((x) => x.dataset.m);
  if (!dahil.length) {
    if (statusEl) statusEl.textContent = "En az bir yöntem seçin";
    else setStatus(statusId, "En az bir yöntem seçin", "err");
    return;
  }
  setStatus(statusId, "", "");
  if (statusEl) statusEl.textContent = "Rapor hazırlanıyor… (şekiller çiziliyor)";
  try {
    const secili = $("repSecili").value;
    let dplvKaynak;
    if (S.dplvAuto && !S.dplvManual) {
      dplvKaynak = { ad: S.dplvAuto.ad, kod: S.dplvAuto.kod, mesafe_km: S.dplvAuto.mesafe_km, yontem: "mgm-auto" };
    } else if (S.dplvValues) {
      const hit = (S.mgm || []).find((s) => s.plv && S.dplvValues.length === 14 && s.plv.every((v, i) => Math.abs(v - S.dplvValues[i]) < 1e-6));
      if (hit) dplvKaynak = { ad: hit.ad, kod: hit.no ? String(hit.no) : "", mesafe_km: null, yontem: "mgm-manuel" };
      else dplvKaynak = { yontem: "elle", plv: S.dplvValues };
    } else {
      dplvKaynak = { yontem: "elle", plv: S.dplvValues };
    }
    const meta = {
      proje_adi: $("projName").value || S.girdi.ad || "Proje",
      bolum_no: $("repBolum").value.trim() || "4.7.3",
      rapor_yontemleri: dahil,
      secili_yontem: dahil.includes(secili) ? secili : dahil[0],
      MF: 1.13,
      thiessen: (S.thiessen || []).filter((t) => t.agirlik > 0).map((t) => ({ name: t.name, agirlik: t.agirlik })),
      dplvKaynak,
    };
    const resp = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ girdi: S.girdi, sonuc: S.sonuc, meta }),
    });
    const name = await dosyaIndir(resp, "Taskin_Bolum.docx");
    const okEl = $("repStatus") || $("comparisonStatus");
    if (okEl) okEl.textContent = "✓ İndirildi: " + name;
  } catch (e) {
    const errEl = $("repStatus") || $("comparisonStatus");
    if (errEl) errEl.textContent = "Hata: " + e.message;
  }
}

/* Yanıttaki dosyayı Content-Disposition adıyla indirir, indirilen adı döndürür. */
/* === extracted to ui/dom.js dosyaIndir === */
/* Katmandaki güncel geometri (elle düzenlemeler dahil); boşsa null. */
/* === extracted to map/init.js katmanGeojson === */
/* KMZ dışa aktarım wizard/kmz.js'e taşındı — step 1'den erişim. */
async function downloadKmz(opts = {}) {
  // Uyumluluk sarmalayıcısı: eski çağrılar repStatus'a yazar
  const statusId = opts.statusId || "repStatus";
  return exportKmz({ ...opts, statusId });
}
/* === extracted to ui/dom.js download === */ function exportCSV() {
  const r = S.sonuc;
  if (!r?.kabulet) { download("kabulet.csv", "KABULET yok — DSİ hesaplanmadı"); return; }
  let rows = [["T(yil)", ...DURS.map((d) => d + "sa")]];
  [...RPS, "500", "1000", "10000"].forEach((rp) => rows.push([rp, ...DURS.map((d) => fmt(r.kabulet[d]?.[rp] ?? "", 3))]));
  download("kabulet.csv", rows.map((x) => x.join(";")).join("\n"));
}

export {
  loadCtCp,
  loadAbak2,
  snyderW,
  updateSnyderW,
  buildKabuletHtml,
  buildMockusHtml,
  buildRasyonelHtml,
  buildSnyderHtml,
  buildKarHtml,
  renderHesapDock,
  renderResults,
  syncRepSecili,
  syncYontemBoxes,
  wireYontemSecim,
  yontemSecili,
  downloadReport,
  downloadKmz,
  exportCSV,
};
