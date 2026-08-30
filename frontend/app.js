/**
 * @fileoverview Composition root — setMode/activateStep/clearSingleBasin/overlay-Escape/?debug seam.
 * @module app
 * Owns: S.mode, overlay Esc sırası, havza click handler kaydı
 * Exports: — (entry; activateStep/setMode/clearSingleBasin module-local)
 * Notes:
 *  - §3.1 root owns mode; havza→outlet/havza/kotlar/dere/kanal sahipliği wizard/havza'da.
 *  - Debug seam: ?debug=1 → window.__fh={map,S,layers} (kalıcı, belgeli).
 *  - Thin root — 155 satır hedef, iş mantığı içermez.
 */

import { S, onHavzaChanged } from "./js/core/state.js";
import { map, layers, setOnHavzaClick, katmanGeojson } from "./js/map/init.js";
import { $, setStatus } from "./js/ui/dom.js";
import { wireDock, isMinimized, setMinimized, clearMinimized } from "./js/ui/dock.js";
import { exportKmz } from "./js/wizard/kmz.js";
import { N_STEPS, STEP_KEYS, updateComputeReady } from "./js/wizard/steps.js";
import { renderKotlar, renderRasyonelC } from "./js/wizard/cn.js";
import { useDefaultStations } from "./js/wizard/thiessen.js";
import { renderRainTable } from "./js/wizard/rain.js";
import { renderDplvGrid, autoSelectPLV } from "./js/wizard/dplv.js";
import { renderHesapDock } from "./js/wizard/hesap.js";
import { agiKatmanAc } from "./js/wizard/frekans.js";
import { openCompare } from "./js/wizard/grafik.js";
import "./js/wizard/comparison.js";
let _mmyLoaded = false;
async function ensureMmy() {
  if (_mmyLoaded) return;
  _mmyLoaded = true;
  try {
    await import("./js/wizard/mmy.js");
  } catch (e) {
    _mmyLoaded = false;
    console.error("MMY modülü yüklenemedi:", e);
  }
}
import { multiLayers, invalidateMultiSolve, renderMultiPoints, updateMultiShared } from "./js/modes/multi.js";
import { suBaslat } from "./js/modes/su.js";
import { initDilekce } from "./js/modes/dilekce.js";
import "./js/map/geocode.js";
import "./js/map/bilgi.js";
import "./js/map/raster.js";
import "./js/map/akarsu.js";
import "./js/map/yagis-katman.js";
import "./js/map/duzenle.js";
import "./js/wizard/havza.js";
import "./js/wizard/grafik.js";
import "./js/modes/multi-sonuc.js";
import "./js/modes/rezervuar.js";
import "./js/modes/proje.js";

// --- Dock minimize/maximize wiring (all 7 overlays) ---
function wireAllDocks() {
  try {
    wireDock("rainDock", { title: "🌧 Yağış Tablosu" });
    wireDock("hesapDock");
    wireDock("cmpWrap");
    wireDock("mcmpWrap");
    wireDock("parWrap");
    wireDock("resWrap");
    wireDock("chartwrap");
  } catch (e) {}
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wireAllDocks);
} else {
  wireAllDocks();
}

async function activateStep(n) {
  document.querySelectorAll(".step").forEach((x) => x.classList.remove("active"));
  const _active = document.querySelector(`.step[data-step="${n}"]`);
  if (!_active) return;
  _active.classList.add("active");
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("hidden", p.dataset.page !== String(n)));
  if (n === 3 && S.havza && !S.thiessen.length) useDefaultStations();
  $("rainDock").classList.toggle("hidden", n !== 3);
  if (n === 3) {
    renderRainTable();
    renderDplvGrid();
    if (S.havza && !S.dplvManual && !S.dplvAuto) autoSelectPLV();
    ensureMmy();
  }
  const hd = $("hesapDock");
  if (hd) {
    if (n !== 4 || !S.sonuc) hd.classList.add("hidden");
    else {
      hd.classList.remove("hidden");
      renderHesapDock();
    }
  }
  if (n === 4 && +$("inpA").value > 0 && +$("inpA").value <= 1) {
    // Rasyonel küçük havza otomatiği — yeni outer group (hide-sync compat: inner hidden)
    const rCb = document.querySelector('.hesapYontem[data-m="rasyonel"]');
    if (rCb && !rCb.checked) {
      rCb.checked = true;
      if (S.seciliYontemler instanceof Set) S.seciliYontemler.add("rasyonel");
      const rb = $("rasyonelBox");
      if (rb) { rb.classList.remove("hidden"); rb.open = true; }
      const ir = $("inpRasyonel");
      if (ir) ir.checked = true;
    } else if (!rCb) {
      // fallback before DOM (old path)
      if ($("inpRasyonel")) $("inpRasyonel").checked = true;
      if ($("rasyonelBox")) $("rasyonelBox").open = true;
    }
  }
  if (n === 4) {
    // ensure outer group synced on every entry to step 4 (project restore may have changed S.seciliYontemler)
    try {
      const boxes = document.querySelectorAll(".hesapYontem");
      boxes.forEach((cb) => {
        const m = cb.dataset.m;
        if (m === "dsi") cb.checked = true;
        else cb.checked = S.seciliYontemler instanceof Set ? S.seciliYontemler.has(m) : cb.checked;
      });
      const rBox = $("rasyonelBox");
      const sBox = $("snyderBox");
      if (rBox) { const on = S.seciliYontemler instanceof Set ? S.seciliYontemler.has("rasyonel") : !!document.querySelector('.hesapYontem[data-m="rasyonel"]:checked'); rBox.classList.toggle("hidden", !on); if (on) rBox.open = true; }
      if (sBox) { const on2 = S.seciliYontemler instanceof Set ? S.seciliYontemler.has("snyder") : !!document.querySelector('.hesapYontem[data-m="snyder"]:checked'); sBox.classList.toggle("hidden", !on2); if (on2) sBox.open = true; }
    } catch (e) {}
    updateComputeReady();
  }
  if (n === 5) {
    agiKatmanAc();
    if (!$("btfaAlan").value && +$("inpA").value) $("btfaAlan").value = $("inpA").value;
  }
  // cmpWrap — only visible on Step 6 (Mukayese ve Rapor)
  const _cmpEl = $("cmpWrap");
  if (_cmpEl) {
    if (n !== 6) _cmpEl.classList.add("hidden");
    // when n===6, visibility is decided below (needs S.sonuc)
  }
  if (n === 6) {
    try {
      const { renderMukayese } = await import("./js/wizard/comparison.js");
      renderMukayese();
      if (S.sonuc) openCompare();
      else if (_cmpEl) _cmpEl.classList.add("hidden");
    } catch (e) {
      console.error("Mukayese yüklenemedi:", e);
    }
  }
}

function setMode(mode) {
  S.mode = mode;
  const multi = mode === "multi",
    dil = mode === "dilekce",
    wiz = mode === "wizard";
  const suM = mode === "su";
  $("modeWizard").classList.toggle("active", wiz);
  $("modeMulti").classList.toggle("active", multi);
  $("modeDilekce").classList.toggle("active", dil);
  $("modeSu").classList.toggle("active", suM);
  $("steps").classList.toggle("hidden", !wiz);
  if (!wiz) document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
  $("multiMode").classList.toggle("hidden", !multi);
  $("dilekceMode").classList.toggle("hidden", !dil);
  $("suMode").classList.toggle("hidden", !suM);
  if (suM) suBaslat();
  else layers.su.remove();
  $("rainDock").classList.add("hidden");
  $("hesapDock")?.classList.add("hidden");
  $("cmpWrap")?.classList.add("hidden");
  if (multi) {
    if (S.outlet && (!S.multi.mansap || S.multi.mansapAuto)) {
      const nm = {
        lat: +(S.outlet.snap_lat ?? S.outlet.lat).toFixed(6),
        lon: +(S.outlet.snap_lon ?? S.outlet.lon).toFixed(6),
      };
      if (!S.multi.mansap || S.multi.mansap.lat !== nm.lat || S.multi.mansap.lon !== nm.lon) {
        S.multi.mansap = nm;
        S.multi.mansapAuto = true;
        invalidateMultiSolve();
      }
    }
    multiLayers.poly.addTo(map);
    multiLayers.pts.addTo(map);
    renderMultiPoints();
    updateMultiShared();
  } else {
    multiLayers.poly.remove();
    multiLayers.pts.remove();
    if (wiz) document.querySelector('.step[data-step="1"]').click();
  }
  if (dil) initDilekce();
}

function clearSingleBasin() {
  S.outlet = null;
  S.havza = null;
  S.dere = null;
  S.kanal = null;
  S.kotlar = Array(11).fill("");
  S.thiessen = [];
  S.istasyonlar = [];
  S.yzdBolge = null;
  S.zemin = null;
  if ($("zeminInfo")) $("zeminInfo").innerHTML = "";
  S.stBase = null;
  S.stExclude = new Set();
  S.stExtra = [];
  S.rainValues = {};
  S.P24w = null;
  S.OETw = null;
  S.yagis = [];
  S.rainMeta = {};
  S.mgmDbYakin = null;
  S.cnSonuc = null;
  S.rasyonelCKaynak = null;
  S.sonuc = null;
  S.girdi = null;
  S.dplvManual = false;
  S.dplvAuto = null;
  S.dplvValues = null;
  S.rapFilter = new Set();
  if ("dplvList" in S) delete S.dplvList;
  S.resPoints = null;
  S.resSonuc = null;
  if (S.resMarker) {
    S.resMarker.remove();
    S.resMarker = null;
  }
  // Mukayese UI + overlay reset (step 6)
  if ($("comparisonResults")) $("comparisonResults").innerHTML = "";
  if ($("comparisonStatus")) setStatus("comparisonStatus", "", "");
  if ($("cmpWrap")) $("cmpWrap").classList.add("hidden");
  ["mcmpWrap", "parWrap", "resWrap", "chartwrap"].forEach((id) => {
    const el = $(id);
    if (el) el.classList.add("hidden");
  });
  try {
    clearMinimized();
  } catch (e) {}
  ["havza", "dere", "kanal", "thiessen", "markers", "havzaAgi", "havzaMgm"].forEach((k) => {
    try {
      layers[k].clearLayers();
    } catch (e) {}
  });
  ["inpA", "inpL", "inpLc", "inpCN3"].forEach((id) => {
    if ($(id)) $(id).value = "";
  });
  $("inpCN2").value = "75";
  ["karA", "karH", "karHist", "karTemps"].forEach((id) => {
    if ($(id)) $(id).value = "";
  });
  if ($("karRate")) $("karRate").value = "1.08";
  if ($("karPeriod")) $("karPeriod").value = "15";
  $("yzdInfo").textContent = "";
  ["cnTable", "thTable", "results"].forEach((id) => {
    if ($(id)) $(id).innerHTML = "";
  });
  if ($("hesapGrid")) $("hesapGrid").innerHTML = "";
  $("hesapDock")?.classList.add("hidden");
  renderRasyonelC(null);
  ["delinStatus", "cnStatus", "thStatus", "compStatus", "rainStatus", "kmzStatus"].forEach((id) => {
    if ($(id)) setStatus(id, "", "");
  });
  if ($("btnKmz")) $("btnKmz").disabled = true;
  document.querySelectorAll(".step").forEach((s) => s.classList.remove("done"));
  renderKotlar();
  renderRainTable();
  renderDplvGrid();
  updateComputeReady();
  if (S.multi) {
    if (S.multi.mansapAuto) {
      S.multi.mansap = null;
      S.multi.mansapAuto = false;
    }
    invalidateMultiSolve();
  }
  activateStep(1);
  setStatus("delinStatus", "Havza ve bağlı tüm veriler silindi. Yeni outlet seçebilirsiniz.", "");
}

function onHavzaClick() {
  if (!S.havza) return;
  if (
    !confirm(
      "Bu havzayı ve ona bağlı TÜM verileri (parametreler, CN, Thiessen, yağış, hidrograflar) silmek istiyor musunuz?",
    )
  )
    return;
  clearSingleBasin();
}
setOnHavzaClick(onHavzaClick);

// KMZ dışa aktarım — composition root wiring (havza paneli + hesap verisi)
// Self-wiring değil: havza view + hesap peak'i birleştiren çapraz özellik kökte bağlanır.
if ($("btnKmz")) $("btnKmz").onclick = () => exportKmz({ statusId: "kmzStatus" });
onHavzaChanged(() => {
  const btn = $("btnKmz");
  if (!btn) return;
  const hasHavza = !!(S.havza || katmanGeojson(layers.havza));
  btn.disabled = !hasHavza;
});

document.querySelectorAll(".step").forEach((b) => {
  b.tabIndex = 0;
  b.onclick = () => activateStep(+b.dataset.step);
  b.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activateStep(+b.dataset.step);
    }
    const dir = STEP_KEYS[e.key];
    if (dir) {
      e.preventDefault();
      const n = +b.dataset.step + dir;
      const next = document.querySelector(`.step[data-step="${n < 1 ? N_STEPS : n > N_STEPS ? 1 : n}"]`);
      if (next) next.focus();
    }
  };
});

$("modeWizard").onclick = () => setMode("wizard");
$("modeMulti").onclick = () => setMode("multi");
$("modeDilekce").onclick = () => setMode("dilekce");
$("modeSu").onclick = () => setMode("su");

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const order = ["resWrap", "mcmpWrap", "cmpWrap", "chartwrap", "parWrap"];
    for (const id of order) {
      const el = $(id);
      if (el && !el.classList.contains("hidden")) {
        if (isMinimized(id)) {
          el.classList.add("hidden");
        } else {
          setMinimized(id, true);
        }
        return;
      }
    }
    // rainDock/hesapDock are step-controlled; Esc minimizes them if visible on their step
    const rain = $("rainDock");
    if (rain && !rain.classList.contains("hidden") && !isMinimized("rainDock")) {
      setMinimized("rainDock", true);
      return;
    }
    const hesap = $("hesapDock");
    if (hesap && !hesap.classList.contains("hidden") && !isMinimized("hesapDock")) {
      setMinimized("hesapDock", true);
      return;
    }
  }
});

if (location.search.includes("debug")) window.__fh = { map, S, layers };
