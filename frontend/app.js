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
import { exportKmz } from "./js/wizard/kmz.js";
import { STEP_KEYS, updateComputeReady } from "./js/wizard/steps.js";
import { renderKotlar, renderRasyonelC } from "./js/wizard/cn.js";
import { useDefaultStations } from "./js/wizard/thiessen.js";
import { renderRainTable } from "./js/wizard/rain.js";
import { renderDplvGrid, autoSelectPLV } from "./js/wizard/dplv.js";
import { renderHesapDock } from "./js/wizard/hesap.js";
import { agiKatmanAc } from "./js/wizard/frekans.js";
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

function activateStep(n) {
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
    $("inpRasyonel").checked = true;
    $("rasyonelBox").open = true;
  }
  if (n === 4) updateComputeReady();
  if (n === 5) {
    agiKatmanAc();
    if (!$("btfaAlan").value && +$("inpA").value) $("btfaAlan").value = $("inpA").value;
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
  if ("dplvList" in S) delete S.dplvList;
  S.resPoints = null;
  S.resSonuc = null;
  if (S.resMarker) {
    S.resMarker.remove();
    S.resMarker = null;
  }
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
      const next = document.querySelector(`.step[data-step="${n < 1 ? 5 : n > 5 ? 1 : n}"]`);
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
    const rw = $("resWrap");
    if (rw && !rw.classList.contains("hidden")) {
      rw.classList.add("hidden");
      return;
    }
    const mcmp = $("mcmpWrap");
    if (mcmp && !mcmp.classList.contains("hidden")) {
      mcmp.classList.add("hidden");
      return;
    }
    const cmp = $("cmpWrap");
    if (cmp && !cmp.classList.contains("hidden")) {
      cmp.classList.add("hidden");
      return;
    }
    const cw = $("chartwrap");
    if (cw && !cw.classList.contains("hidden")) {
      cw.classList.add("hidden");
      return;
    }
  }
});

if (location.search.includes("debug")) window.__fh = { map, S, layers };
