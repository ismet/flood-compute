/* Taşkın Hesap — arayüz mantığı */
"use strict";

import { S, onHavzaChanged, _notifyHavzaChanged } from "./core/state.js";
import { api } from "./core/api.js";
import { DURS, RPS, M_LABEL, CMP_LABELS, CMP_RPS } from "./core/constants.js";
import { fmt, _esc, mgmNorm } from "./core/format.js";
import { $, setStatus, download, dosyaIndir } from "./ui/dom.js";
import { makePasteGrid, readGridNums } from "./ui/paste-grid.js";
import { map, osm, sat, topo, layers, katmanGeojson, setOnHavzaClick } from "./map/init.js";
import { STEP_KEYS, markDone, updateComputeReady } from "./wizard/steps.js";
import { importBasinFiles, applyBasinResult, renderAdayKanallar } from "./wizard/havza.js";
import { renderKotlar, renderCnSonuc, RASYONEL_C_HINT, renderRasyonelC, zeminGrubunuBelirle } from "./wizard/cn.js";
import { kurumColor, stKey, effectiveStations, loadStationSet, recomputeThiessen, renderExcluded, runThiessen, removeStation, useDefaultStations } from "./wizard/thiessen.js";
import { RAIN_BLUES, rainRange, rainColor, thiessenStyle, recolorThiessen, renderRainLegend, RAIN_COLS, activeStations, renderRainTable, mgmOtomatikEslestir, onRainPaste, readRainGrid, recalcRain, mgmDbListesi, fillRainRowFromP24, mgmSatirBagla } from "./wizard/rain.js";
import { DPLV_LABELS, DPLV_GIZLI, loadDplv, loadMgm, updatePlvAutoInfo, autoSelectPLV, loadMgmDb, mgmFind, renderDplvGrid, readDplvGrid, dplvRatios } from "./wizard/dplv.js";
import { agiKatmanAc } from "./wizard/frekans.js";
import { renderHesapDock } from "./wizard/hesap.js";

import { multiLayers, updateMultiShared, renderMultiPoints, invalidateMultiSolve } from "./modes/multi.js";
import { suBaslat } from "./modes/su.js";
import { initDilekce } from "./modes/dilekce.js";


/* === extracted to core/state.js S === *//* === extracted to ui/dom.js $ === *//* === extracted to core/api.js api === *//* === extracted to core/format.js fmt === *//* === extracted to core/format.js _esc === */// istasyon kurumuna göre renk (DMİ/MGM vs DSİ)

/* ---- Thiessen poligonlarını yağış miktarına göre mavi tonlarıyla boya ----
   Az yağış = açık mavi, çok yağış = koyu mavi. Boyama, seçili tekerrür
   sütunundaki (vars. 100 yıl) değerlere göre yapılır.                        */

/* 10 m DEM iki aşamalı çalışır ve tampon ister; kutu yalnız o seçilince görünür. */

/* ---------------- harita ---------------- */
/* === extracted to map/init.js map+layers === */
/* === extracted to map/geocode.js === */
/* ---------------- adım gezinme ---------------- */
document.querySelectorAll(".step").forEach(b => {
  b.tabIndex = 0;
  b.onclick = () => activateStep(+b.dataset.step);
  b.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activateStep(+b.dataset.step); }
    const dir = STEP_KEYS[e.key];
    if (dir) {
      e.preventDefault();
      const n = +b.dataset.step + dir;
      const next = document.querySelector(`.step[data-step="${n < 1 ? 5 : n > 5 ? 1 : n}"]`);
      if (next) next.focus();
    }
  };
});

function activateStep(n) {
  document.querySelectorAll(".step").forEach(x => x.classList.remove("active"));
  const _active = document.querySelector(`.step[data-step="${n}"]`);
  if (!_active) return;
  _active.classList.add("active");
  document.querySelectorAll(".page").forEach(p =>
    p.classList.toggle("hidden", p.dataset.page !== String(n)));
  if (n === 3 && S.havza && !S.thiessen.length) useDefaultStations();
  $("rainDock").classList.toggle("hidden", n !== 3);
  if (n === 3) { renderRainTable(); renderDplvGrid(); if (S.havza && !S.dplvManual && !S.dplvAuto) autoSelectPLV(); }
  const hd = $("hesapDock");
  if (hd) {
    if (n !== 4 || !S.sonuc) hd.classList.add("hidden");
    else { hd.classList.remove("hidden"); renderHesapDock(); }
  }
  if (n === 4 && +$("inpA").value > 0 && +$("inpA").value <= 1) {
    $("inpRasyonel").checked = true;
    $("rasyonelBox").open = true;
  }
  if (n === 4) updateComputeReady();
  if (n === 5) {
    agiKatmanAc();
    // havza çıkarıldıysa alanı BTFA'ya taşı (kullanıcı yine de değiştirebilir)
    if (!$("btfaAlan").value && +$("inpA").value) $("btfaAlan").value = $("inpA").value;
  }
}
/* === extracted to ui/dom.js setStatus === */

/* ---------------- ADIM 1: havza ---------------- */
/* === extracted to map/bilgi.js === */
/* === extracted to map/raster.js === */
/* === extracted to map/akarsu.js === */
/* === extracted to wizard/frekans.js === */

/* === extracted to map/yagis-katman.js === */
/* ---- dışarıdan çizilmiş havza/dere içe aktarma ----
   Sınır kullanıcıdan gelir; alan poligondan (jeodezik), L/Lc/kotlar ve
   (dere verilmediyse) dere ağı DEM'den üretilir.                          */

// delineate / import sonucunu arayüze uygular (ikisi de aynı biçimde döner)
/* Tıklama çevresindeki rakip akarsu kolları.
   İki DEM aynı dereyi farklı yere koyabiliyor ve 300 m yarıçapta alanları
   2/10/16 km² olan ayrı kollar bulunabiliyor; hangisinin kullanıcının
   kastettiği outlet olduğu koddan bilinemez. Eskiden kullanıcı "kanala
   kenetleme" yarıçapını tahminle ayarlamak zorundaydı — bilemeyeceği bir
   şey. Artık seçenekler alanlarıyla listeleniyor, tek tıkla geçiliyor.   */

/* === extracted to map/duzenle.js === */
/* ---------------- ADIM 2: kotlar ---------------- */

/* ---------------- ADIM 2 (devamı): CN ---------------- */

/* CORINE sınıf dökümü + aynı geçişten türetilen rasyonel akış katsayısı C.
   C, CN ile aynı CORINE kesitinden gelir; ayrıca veri indirilmez.
   Sınıf tablosu bu adımda kalır; C seçim kutusu Adım 4'teki rasyonel
   seçeneklerine taşındı (renderRasyonelC).                              */


/* Adım 4 · "Rasyonel yöntem seçenekleri" içindeki C bloğu.
   Seçim ANINDA uygulanır: değer inpC100'e yazılır, rasyonel işaretlenir.
   Yeniden çizim (yeni CN sonucu, proje yüklemesi) yalnızca gösterimdir;
   girdilere dokunmaz.                                                   */

/* ---------------- ADIM 3: Yağış (Thiessen + Yağış birleşik) ---------------- */
/* ---- istasyon listesi yönetimi (çıkarma / elle ekleme) ----
   S.stBase   : kaynaktan (KML/KMZ) gelen tam liste
   S.stExclude: kullanıcının çıkardığı istasyon anahtarları
   S.stExtra  : haritadan elle eklenen istasyonlar
   Etkin liste = (temel − çıkarılanlar) + elle eklenenler                      */


// istasyonu Thiessen'den çıkar (haritadaki açılır pencereden de çağrılır)


// eşik değişince Thiessen'i yeniden kur


/* ---------------- ADIM 3: Yağış (birleşik) — yağış tablosu & DPLV ---------------- */

/* "Hazır istasyon" açılır listesinde gösterilmeyen istasyonlar. Verileri
   data/tables/dplv_stations.json'da durur ve yanındaki MGM PLV kutusundan
   seçilebilir; yalnızca varsayılan olarak gelmesinler diye gizleniyor.
   Seçenek value'ları özgün dizi indeksi kalır → kayıtlı projelerde kayma olmaz. */


/* ---- Hidrolojik zemin grubunu havzanın toprağından seç ----
   Bu parametre taşkın hesabının sonucunu en çok değiştiren girdidir: Karakurt
   havzasında B ile C arasında Q100 296'dan 771 m³/s'ye çıkıyor. Eskiden açılır
   listede gerekçesiz bir varsayılan (B) seçili geliyordu ve kullanıcı
   dokunmazsa sonucu sessizce o belirliyordu — oysa B, Türkiye'nin %1.6'sına
   uyuyor. Artık YZD bölgesiyle aynı kalıp: otomatik belirlenir, GEREKÇESİ
   yazılır, kullanıcı değiştirebilir. */

/* ---- MGM PLV 2020 tablosu — YALNIZ plüviyograf (PLV) oranları için ----
   P2–P100 artık buradan gelmiyor; ölçüm veritabanından frekans analiziyle
   hesaplanıyor (loadMgmDb / mgmOtomatikEslestir). Uç, bu tablonun P24
   sütunlarını hiç göndermiyor: iki ayrı yağış kaynağını paralel tutmak
   hangisinin kullanıldığını belirsiz bırakıyordu. */

/* ---- DPLV en yakın MGM PLV otomatik seçimi ----
   Havza çıkınca 236 MGM-PLV içinden havza centroid’ine en yakın olanı
   seçer (küresel en yakın, yarıçap limiti yok). Elle seçim galip gelir. */


/* ---- MGM ölçüm veritabanı — P2–P100'ün kaynağı ----
   1290 istasyonun yıllık en büyük günlük yağışı. P24 değerleri NTFA ile aynı
   hesaptan (altı dağılım + Smirnov-Kolmogorov) geçirilerek üretilir. */

// Havza çevresindeki istasyonları elle seçim listesine doldurur.

/* === extracted to wizard/hesap.js (Snyder abak) === */
/* === extracted to modes/rezervuar.js === */

// P2–P100'ü ölçümden hesaplanmış frekans sonucundan doldurur.
// (Eski sürüm mgm_plv_2020.json'daki hazır P24 tablosunu okuyordu; o tablo
//  artık yalnız plüviyograf oranları için duruyor.)

// Bir Thiessen satırını verilen MGM istasyonuna bağlar ve P24'ü hesaplatır.





/* Thiessen istasyonlarını MGM ölçüm veritabanına bağlar ve P2–P100'ü
   ölçümden hesaplatır. Eşleştirme önce koordinatla denenir: KMZ'deki ad
   serbest metindir ("ÇORLU DMİ"), koordinat ise ölçülmüş büyüklüktür ve
   Türkiye'de aynı adı taşıyan onlarca yer vardır. */





/* === extracted to wizard/hesap.js === */

/* === extracted to modes/multi.js === */
function setMode(mode) {
  S.mode = mode;
  const multi = mode === "multi", dil = mode === "dilekce", wiz = mode === "wizard";
  const suM = mode === "su";
  $("modeWizard").classList.toggle("active", wiz);
  $("modeMulti").classList.toggle("active", multi);
  $("modeDilekce").classList.toggle("active", dil);
  $("modeSu").classList.toggle("active", suM);
  $("steps").classList.toggle("hidden", !wiz);
  if (!wiz) document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
  $("multiMode").classList.toggle("hidden", !multi);
  $("dilekceMode").classList.toggle("hidden", !dil);
  $("suMode").classList.toggle("hidden", !suM);
  if (suM) suBaslat(); else layers.su.remove();
  $("rainDock").classList.add("hidden");
  $("hesapDock")?.classList.add("hidden");
  if (multi) {
    // Mansap noktası varsayılan: tek havzadaki outlet (kullanıcı elle değiştirmediyse hep senkron)
    if (S.outlet && (!S.multi.mansap || S.multi.mansapAuto)) {
      const nm = { lat: +(S.outlet.snap_lat ?? S.outlet.lat).toFixed(6),
                   lon: +(S.outlet.snap_lon ?? S.outlet.lon).toFixed(6) };
      if (!S.multi.mansap || S.multi.mansap.lat !== nm.lat || S.multi.mansap.lon !== nm.lon) {
        S.multi.mansap = nm; S.multi.mansapAuto = true; invalidateMultiSolve();
      }
    }
    multiLayers.poly.addTo(map); multiLayers.pts.addTo(map);
    renderMultiPoints(); updateMultiShared();
  }
  else {
    multiLayers.poly.remove(); multiLayers.pts.remove();
    if (wiz) document.querySelector('.step[data-step="1"]').click();
  }
  if (dil) initDilekce();
}
$("modeWizard").onclick = () => setMode("wizard");
$("modeMulti").onclick = () => setMode("multi");
$("modeDilekce").onclick = () => setMode("dilekce");
$("modeSu").onclick = () => setMode("su");

/* === extracted to modes/su.js === */
/* === extracted to modes/dilekce.js === */

/* === extracted to modes/multi.js === */
/* === extracted to modes/multi-sonuc.js === */
/* === extracted to wizard/grafik.js === */

/* === extracted to wizard/hesap.js (exportCSV) === */

/* ---------------- havza silme (haritadan tıkla) ---------------- */
function clearSingleBasin() {
  // durum
  S.outlet = null; S.havza = null; S.dere = null; S.kanal = null;
  S.kotlar = Array(11).fill("");
  S.thiessen = []; S.istasyonlar = []; S.yzdBolge = null;
  S.zemin = null;
  if ($("zeminInfo")) $("zeminInfo").innerHTML = "";
  S.stBase = null; S.stExclude = new Set(); S.stExtra = []; S.stPlace = false;
  S.rainValues = {}; S.P24w = null; S.OETw = null; S.yagis = [];
  // MGM eşleşmeleri ve yakın istasyon listesi havzaya bağlıdır; yeni havzada
  // eskisinin listesiyle eşleştirmek yanlış istasyonu getirir.
  S.rainMeta = {}; S.mgmDbYakin = null;
  // CORINE dökümü ve ondan türeyen rasyonel C havzaya bağlıdır; havza gidince
  // onlar da gider (C tercihleri S.cSecim'de kalır).
  S.cnSonuc = null; S.rasyonelCKaynak = null;
  S.sonuc = null; S.girdi = null; S.dplvManual = false; S.dplvAuto = null; S.dplvValues = null;
  S.resPoints = null; S.resSonuc = null;
  if (S.resMarker) { S.resMarker.remove(); S.resMarker = null; }
  // harita katmanları
  ["havza", "dere", "kanal", "thiessen", "markers"].forEach(k => layers[k].clearLayers());
  // giriş alanları
  ["inpA", "inpL", "inpLc", "inpCN3"].forEach(id => { if ($(id)) $(id).value = ""; });
  $("inpCN2").value = "75";
  $("yzdInfo").textContent = "";
  ["cnTable", "thTable", "results"].forEach(id => { if ($(id)) $(id).innerHTML = ""; });
  if ($("hesapGrid")) $("hesapGrid").innerHTML = "";
  $("hesapDock")?.classList.add("hidden");
  renderRasyonelC(null);
  ["delinStatus", "cnStatus", "thStatus", "compStatus", "rainStatus"].forEach(id => { if ($(id)) setStatus(id, "", ""); });
  document.querySelectorAll(".step").forEach(s => s.classList.remove("done"));
  renderKotlar(); renderRainTable(); renderDplvGrid(); updateComputeReady();
  // çok parçalı: mansap tek havza outlet'ine bağlıysa onu da düşür
  if (S.multi) { if (S.multi.mansapAuto) { S.multi.mansap = null; S.multi.mansapAuto = false; } invalidateMultiSolve(); }
  activateStep(1);
  setStatus("delinStatus", "Havza ve bağlı tüm veriler silindi. Yeni outlet seçebilirsiniz.", "");
}
function onHavzaClick() {
  if (!S.havza) return;
  if (!confirm("Bu havzayı ve ona bağlı TÜM verileri (parametreler, CN, Thiessen, yağış, hidrograflar) silmek istiyor musunuz?")) return;
  clearSingleBasin();
}
setOnHavzaClick(onHavzaClick);


/* === extracted to modes/multi.js === */

/* === extracted to modes/proje.js === */
