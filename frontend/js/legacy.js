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
/* ================= REZERVUAR (HAZNE) ÖTELEMESİ ================= */

async function loadReservoirDefaults() {
  try { S.resDefaults = await api("/api/reservoir-defaults"); } catch (e) { S.resDefaults = null; }
  try { S.resConDefaults = await api("/api/reservoir-controlled-defaults"); } catch (e) { S.resConDefaults = null; }
}
loadReservoirDefaults();

const RES_RP = ["2", "5", "10", "25", "50", "100", "OET"];

// Rezervuar atanabilecek noktalar: outlet (tek havza), memba/mansap (ara havza)
function reservoirPoints() {
  const pts = [];
  if (S.sonuc && S.sonuc.dsi && S.outlet)
    pts.push({ ad: "Outlet (havza çıkışı)", ll: { lat: S.outlet.snap_lat ?? S.outlet.lat, lon: S.outlet.snap_lon ?? S.outlet.lon }, kind: "compute", res: S.sonuc });
  if (S.multiSonuc) {
    const md = S.multiSonuc.md;
    S.multiSonuc.membaC.forEach((x, i) => {
      const o = md.membalar[i].outlet;
      pts.push({ ad: "Memba " + (i + 1), ll: { lat: o.snap_lat ?? o.lat, lon: o.snap_lon ?? o.lon }, kind: "compute", res: x.res, membaIndex: i });
    });
    const mo = md.mansap.outlet;
    pts.push({ ad: "Mansap (ötelenmiş)", ll: { lat: mo.snap_lat ?? mo.lat, lon: mo.snap_lon ?? mo.lon }, kind: "routed", rt: S.multiSonuc.rt });
  }
  return pts;
}
function reservoirMethods(pt) {
  if (pt.kind === "routed") return Object.keys(pt.rt.yontemler);
  const m = ["dsi"]; if (pt.res.snyder) m.push("snyder"); return m;
}
function reservoirInflow(pt, method, rp) {
  if (pt.kind === "routed") {
    const y = pt.rt.yontemler[method];
    return y && y.hidrograflar[rp] ? { data: y.hidrograflar[rp], dt: y.dt || 0.5 } : null;
  }
  if (method === "dsi") {
    let best = null, pk = -1;
    [2, 4, 6, 8, 12, 18, 24].forEach(d => { const v = pt.res.kabulet[d] && pt.res.kabulet[d][rp]; if (v != null && v > pk) { pk = v; best = d; } });
    return best != null ? { data: pt.res.dsi.hidrograflar[best][rp], dt: 0.5, note: `hakim ${best} sa` } : null;
  }
  if (method === "snyder" && pt.res.snyder) return { data: pt.res.snyder.hidrograflar[rp], dt: 1 };
  return null;
}

export function openReservoir() {
  const pts = reservoirPoints();
  if (!pts.length) { alert("Önce bir hidrograf hesaplayın (Tek Havza → HESAPLA, veya Ara Havza → Hesapla ve Ötele)"); return; }
  S.resPoints = pts;
  $("resPoint").innerHTML = pts.map((p, i) => `<option value="${i}">${p.ad}</option>`).join("");
  const fillMethodRP = () => {
    const pt = pts[+$("resPoint").value];
    const ms = reservoirMethods(pt);
    $("resMethod").innerHTML = ms.map(m => `<option value="${m}">${M_LABEL[m]}</option>`).join("");
    $("resRP").innerHTML = RES_RP.map(rp => `<option value="${rp}">Q${rp}</option>`).join("");
    $("resRP").value = "100";
    showResMarker(pt);
  };
  $("resPoint").onchange = fillMethodRP;
  fillMethodRP();
  // rezervuar varsayılanları
  const D = S.resDefaults, K = S.resConDefaults;
  if (D) { $("resKret").value = D.kret_kotu; $("resYtk").value = D.yaklasim_taban_kotu; $("resApron").value = D.apron_giris_acisi_derece || 0; $("resL").value = 40; $("resC").value = 2.1; }
  if (K) { $("resSill").value = K.esik_kotu; $("resLef").value = K.lef; $("resH0").value = K.nss; $("resHmax").value = (K.nss + 3); $("resW1").value = K.taban_debi_W1; }
  // rating grid (bir kez kur, kalıcı) — He, Q kopyala-yapıştır
  S.ratGrid = makePasteGrid("resRatingGrid", "btnResRatAdd", "btnResRatClear",
    ["He (m)", "Q (m³/s)"], (D && D.dolusavak_rating.veri) || []);
  const buildGrids = () => {
    const kap = $("resType").value === "kapakli";
    $("resUncon").classList.toggle("hidden", kap);
    $("resCon").classList.toggle("hidden", !kap);
    const volDef = kap ? (K && K.hacim_satih.veri) : (D && D.hacim_satih.veri);
    S.volGrid = makePasteGrid("resVolGrid", "btnResVolAdd", "btnResVolClear",
      kap ? ["Kot (m)", "Hacim (hm³)"] : ["Kot (m)", "Alan (km²)", "Hacim (hm³)"], volDef || []);
    const tablo = !kap && $("resMode").value === "tablo";
    $("resRatingBox").classList.toggle("hidden", !tablo);
    $("resGeom").classList.toggle("hidden", kap || $("resMode").value !== "geom");
  };
  $("resType").onchange = buildGrids;
  $("resMode").onchange = buildGrids;
  buildGrids();
  // C otomatik (P/h): kutu işaretliyse C alanı kapalı, P canlı gösterilir
  const updatePh = () => {
    const auto = $("resCauto").checked;
    $("resC").disabled = auto;
    const P = (+$("resKret").value) - (+$("resYtk").value);
    $("resPhInfo").innerHTML = (auto && isFinite(P) && P > 0)
      ? `P = kret − yak.taban = <b>${P.toFixed(1)} m</b> → C, USBR P/h eğrisinden türetilir`
      : (auto ? "P için kret ve yak. taban kotu girin" : "");
  };
  $("resCauto").addEventListener("change", updatePh);
  $("resKret").addEventListener("input", updatePh);
  $("resYtk").addEventListener("input", updatePh);
  updatePh();
  $("btnResRun").onclick = runReservoir;
  $("btnResAssign").onclick = assignReservoirToMemba;
  $("resWrap").classList.remove("hidden");
}
$("btnCloseRes").onclick = () => $("resWrap").classList.add("hidden");

// seçili rezervuar noktasını haritada işaretle
function showResMarker(pt) {
  if (!pt || !pt.ll) { $("resPointInfo").textContent = ""; return; }
  if (S.resMarker) S.resMarker.remove();
  // rezervuar atanan nokta mor gösterilir
  S.resMarker = L.circleMarker([pt.ll.lat, pt.ll.lon], {
    radius: 9, color: "#6a1b9a", weight: 3, fillColor: "#9c27b0", fillOpacity: .85,
  }).addTo(map).bindTooltip("🏞 Rezervuar: " + pt.ad, { permanent: false });
  $("resPointInfo").innerHTML = `🏞 Rezervuar <b>${pt.ad}</b> noktasına atandı (${pt.ll.lat.toFixed(4)}, ${pt.ll.lon.toFixed(4)}). Bu noktadaki hidrograf haznede ötelenecek. <span style="color:#6a1b9a">●</span> nokta harita üzerinde <b>mor</b> ile işaretlendi.`;
}

/* ---- Genel editlenebilir + kopyala-yapıştır tablo fabrikası ---- */
/* === extracted to ui/paste-grid.js makePasteGrid === *//* === extracted to ui/paste-grid.js readGridNums === */
async function runReservoir() {
  try {
    const pt = S.resPoints[+$("resPoint").value];
    const src = reservoirInflow(pt, $("resMethod").value, $("resRP").value);
    if (!src || !src.data || !src.data.length) throw new Error("Seçili nokta/yöntem/tekerrür için hidrograf yok");
    const kap = $("resType").value === "kapakli";
    const vol = readGridNums(S.volGrid, kap ? 2 : 3);
    if (vol.length < 2) throw new Error("Kot–Hacim tablosu geçersiz (en az 2 dolu satır gerekli)");
    let r;
    if (kap) {
      r = await api("/api/reservoir-controlled", {
        inflow: src.data, dt_saat: src.dt, hacim_satih: vol,
        esik_kotu: +$("resSill").value, lef: +$("resLef").value,
        baslangic_kotu: +$("resH0").value, maks_su_kotu: +$("resHmax").value,
        taban_debi: +$("resW1").value || 0,
        kapak_adedi: Math.max(1, +$("resNgate").value || 1),
        pik_sonrasi_bosalt: $("resDrain").checked,
      });
      r._kapakli = true;
    } else {
      const body = { inflow: src.data, dt_saat: src.dt, kret_kotu: +$("resKret").value, hacim_satih: vol };
      if ($("resMode").value === "tablo") {
        const rating = readGridNums(S.ratGrid, 2);
        if (rating.length < 2) throw new Error("Rating tablosu geçersiz (He, Q — en az 2 dolu satır)");
        body.rating = rating;
      } else { body.yaklasim_taban_kotu = +$("resYtk").value; body.apron_giris_acisi = +$("resApron").value || 0; body.kret_uzunlugu = +$("resL").value || 40; body.debi_katsayisi = $("resCauto").checked ? null : (+$("resC").value || 2.1); }
      r = await api("/api/reservoir-route", body);
    }
    const label = `${pt.ad} — ${M_LABEL[$("resMethod").value]} Q${$("resRP").value}${src.note ? " (" + src.note + ")" : ""}`;
    S.resSonuc = { r, src, label };
    renderReservoir();
  } catch (e) { $("resTable").innerHTML = `<div class="small err">Hata: ${e.message}</div>`; }
}

/* ---- Çok parçalı: memba noktasına hazne atama ----
   Hazne, o memba noktasının çıkışını sönümler; sönümlenmiş hidrograf
   mansaba taşındığı için aşağıdaki tüm noktaları etkiler.                  */
function buildResCfg() {
  const kap = $("resType").value === "kapakli";
  const vol = readGridNums(S.volGrid, kap ? 2 : 3);
  if (vol.length < 2) throw new Error("Kot–Hacim tablosu geçersiz (en az 2 dolu satır)");
  if (kap) {
    return { tip: "kapakli", hacim_satih: vol,
      esik_kotu: +$("resSill").value, lef: +$("resLef").value,
      baslangic_kotu: +$("resH0").value, maks_su_kotu: +$("resHmax").value,
      taban_debi: +$("resW1").value || 0,
      kapak_adedi: Math.max(1, +$("resNgate").value || 1),
      pik_sonrasi_bosalt: $("resDrain").checked };
  }
  const cfg = { tip: "kontrolsuz", hacim_satih: vol, kret_kotu: +$("resKret").value };
  if ($("resMode").value === "tablo") {
    const rating = readGridNums(S.ratGrid, 2);
    if (rating.length < 2) throw new Error("Rating tablosu geçersiz (He, Q — en az 2 dolu satır)");
    cfg.rating = rating;
  } else {
    cfg.yaklasim_taban_kotu = +$("resYtk").value;
    cfg.apron_giris_acisi = +$("resApron").value || 0;
    cfg.kret_uzunlugu = +$("resL").value || 40;
    cfg.debi_katsayisi = $("resCauto").checked ? null : (+$("resC").value || 2.1);
  }
  return cfg;
}
async function assignReservoirToMemba() {
  const st = $("resMultiStatus");
  try {
    const pt = S.resPoints[+$("resPoint").value];
    if (!pt || pt.membaIndex == null)
      throw new Error("Bu özellik yalnız çok parçalı moddaki MEMBA noktaları içindir");
    if (!S.multiSonuc) throw new Error("Önce Ara Havza → ② Hesapla ve Ötele");
    S.multiRes = S.multiRes || {};
    S.multiRes[pt.membaIndex] = buildResCfg();
    st.textContent = "Hazne atandı, mansap yeniden ötelenıyor…";
    await reRouteMulti();
    st.textContent = `✓ ${pt.ad} noktasına hazne atandı; mansap hidrografı güncellendi.`;
  } catch (e) { st.textContent = "Hata: " + e.message; }
}
// atanmış hazneleri kullanarak ötelemeyi yeniden yapar (havzalar yeniden hesaplanmaz)
async function reRouteMulti() {
  if (!S.multiSonuc) return;
  const { md, araC, membaC, methods } = S.multiSonuc;
  const rez = membaC.map((_, i) => (S.multiRes && S.multiRes[i]) || null);
  const rt = await api("/api/route", {
    ara_sonuc: araC.res, memba_sonuclari: membaC.map(x => x.res),
    lag_saat: (+$("multiLag").value || md.ara.Tc_saat), yontemler: methods,
    rezervuarlar: rez.some(Boolean) ? rez : null,
  });
  S.multiSonuc.rt = rt;
  renderMultiResults();
}

let resChart = null;
function renderReservoir() {
  const { r, label } = S.resSonuc, o = r.ozet;
  const src = { label };
  const kap = r._kapakli;
  const lab = r.t.map(t => t.toFixed(1));
  const ds = [
    { label: "Giriş I", data: r.giris, borderColor: "#e07b3a", borderWidth: 1.8, pointRadius: 0, tension: .25 },
    { label: "Çıkış O (ötelenmiş)", data: r.cikis, borderColor: "#2a9d8f", borderWidth: 2, pointRadius: 0, tension: .25 },
    { label: "Su kotu (m)", data: r.su_kotu, borderColor: "#7b1fa2", borderWidth: 1.2, borderDash: [4, 3], pointRadius: 0, yAxisID: "y2" },
  ];
  if (kap) ds.push({ label: "Kapak açıklığı (m)", data: r.kapak_acikligi, borderColor: "#c73e3a", borderWidth: 1.2, borderDash: [2, 2], pointRadius: 0, yAxisID: "y3" });
  if (resChart) resChart.destroy();
  resChart = new Chart($("resChart"), {
    type: "line", data: { labels: lab, datasets: ds },
    options: {
      animation: false, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" }, title: { display: true, text: `${kap ? "Kapaklı (optimize) hazne" : "Hazne"} ötelemesi — ${src.label}` } },
      scales: {
        x: { title: { display: true, text: "T (saat)" } },
        y: { title: { display: true, text: "Q (m³/s)" }, beginAtZero: true },
        y2: { position: "right", title: { display: true, text: "Su kotu (m)" }, grid: { drawOnChartArea: false } },
        y3: { display: false },
      },
    },
  });
  let h = `<h3 class="res">Özet</h3><table class="tbl">
    <tr><td>Giriş pik</td><td><b>${fmt(o.giris_pik, 1)}</b> m³/s @ ${fmt(o.giris_pik_saat, 0)} sa</td></tr>
    <tr><td>Çıkış pik (ötelenmiş)</td><td><b>${fmt(o.cikis_pik, 1)}</b> m³/s @ ${fmt(o.cikis_pik_saat, 0)} sa</td></tr>
    <tr><td>Pik sönümleme</td><td><b>${fmt(o.pik_sonumleme * 100, 1)}%</b></td></tr>`;
  if (kap) {
    h += `<tr><td>Optimize min çıkış piki hedefi</td><td><b>${fmt(o.min_cikis_pik_hedef, 1)}</b> m³/s</td></tr>
    <tr><td>Maks su kotu / izinli</td><td><b>${fmt(o.maks_su_kotu, 2)}</b> / ${fmt(o.H_max, 2)} m ${o.maks_su_kotu <= o.H_max + 0.01 ? "✓" : "⚠ AŞILDI"}</td></tr>
    <tr><td>Başlangıç kotu</td><td>${fmt(o.H_init, 2)} m</td></tr>
    <tr><td>Kapak adedi</td><td><b>${o.kapak_adedi || 1}</b> adet</td></tr>
    <tr><td>Pik sonrası boşaltma</td><td>${o.pik_sonrasi_bosalt ? "açık — pik sonrası O>I serbest, hazne başlangıç kotuna çekilir" : "kapalı — çıkış her zaman ≤ giriş"}</td></tr>
    <tr><td>Maks kapak açıklığı</td><td><b>${fmt(o.maks_kapak_acikligi, 2)}</b> m</td></tr>`;
    if (o.asim_uyarisi) h += `<tr><td colspan="2" class="small err">⚠ Depolama yetersiz: pass-through (O=I) bile maks kotu aşıyor; başlangıç kotunu düşürün veya maks kotu yükseltin.</td></tr>`;
    if (o.girdi_uyarisi) h += `<tr><td colspan="2" class="small err">⚠ ${o.girdi_uyarisi}</td></tr>`;
  } else {
    h += `<tr><td>Pik gecikmesi</td><td>${fmt(o.gecikme_saat, 0)} sa</td></tr>
    <tr><td>Maks su kotu</td><td><b>${fmt(o.maks_su_kotu, 2)}</b> m (kret+${fmt(o.maks_He, 2)} m)</td></tr>`;
    if (r.dolusavak_C && r.dolusavak_C.length) {
      // maks He'ye en yakın türetilen C (fiili tepe koşulu)
      const cAtPeak = r.dolusavak_C.reduce((a, b) =>
        Math.abs(b[0] - o.maks_He) < Math.abs(a[0] - o.maks_He) ? b : a);
      h += `<tr><td>Yaklaşım yüks. P</td><td>${fmt(r.yaklasim_P, 1)} m</td></tr>
      <tr><td>C (P/h, USBR)</td><td><b>${fmt(cAtPeak[1], 3)}</b> @ He=${fmt(cAtPeak[0], 2)} m
        <span class="small">(He=0.1→C=${fmt(r.dolusavak_C[0][1], 2)})</span></td></tr>`;
    }
  }
  h += `</table>`;
  if (kap) h += `<div class="small">Kapaklar; su kotu ≤ maks, çıkış ≤ giriş kısıtlarıyla çıkış piki minimum olacak şekilde
    işletilir (pik-tavan/peak-shaving; başlangıç–maks kotu arası depolama kullanılır).</div>`;
  h += `<button id="btnResCsv" class="small-btn">⬇ CSV (koordinatlar)</button>
    <table class="tbl"><tr><th>T (sa)</th><th>Giriş</th><th>Çıkış</th><th>Su kotu</th>${kap ? "<th>Kapak (m)</th>" : ""}</tr>`;
  const step = r.t.length > 80 ? 2 : 1;
  for (let i = 0; i < r.t.length; i += step)
    h += `<tr><td>${fmt(r.t[i], 1)}</td><td>${fmt(r.giris[i], 1)}</td><td>${fmt(r.cikis[i], 1)}</td><td>${fmt(r.su_kotu[i], 2)}</td>${kap ? `<td>${fmt(r.kapak_acikligi[i], 3)}</td>` : ""}</tr>`;
  h += `</table>`;
  $("resTable").innerHTML = h;
  $("btnResCsv").onclick = () => {
    const head = ["T_sa", "Giris_m3s", "Cikis_m3s", "SuKotu_m"]; if (kap) head.push("Kapak_m");
    const rows = [head];
    for (let i = 0; i < r.t.length; i++) { const row = [r.t[i].toFixed(1), r.giris[i].toFixed(2), r.cikis[i].toFixed(2), r.su_kotu[i].toFixed(3)]; if (kap) row.push(r.kapak_acikligi[i].toFixed(3)); rows.push(row); }
    download(`hazne_oteleme_${src.label.replace(/[^\w]/g, "_")}.csv`, rows.map(x => x.join(";")).join("\n"));
  };
}


// P2–P100'ü ölçümden hesaplanmış frekans sonucundan doldurur.
// (Eski sürüm mgm_plv_2020.json'daki hazır P24 tablosunu okuyordu; o tablo
//  artık yalnız plüviyograf oranları için duruyor.)

// Bir Thiessen satırını verilen MGM istasyonuna bağlar ve P24'ü hesaplatır.





/* Thiessen istasyonlarını MGM ölçüm veritabanına bağlar ve P2–P100'ü
   ölçümden hesaplatır. Eşleştirme önce koordinatla denenir: KMZ'deki ad
   serbest metindir ("ÇORLU DMİ"), koordinat ise ölçülmüş büyüklüktür ve
   Türkiye'de aynı adı taşıyan onlarca yer vardır. */





/* === extracted to wizard/hesap.js === */

/* ================= ARA HAVZA (ÇOK PARÇALI) ================= */
S.multi = { mansap: null, membalar: [], place: null };
const multiLayers = {
  poly: L.geoJSON(null, {
    style: f => ({ color: f.properties && f.properties.c || "#7b1fa2", weight: 2, fillOpacity: .12 }),
    onEachFeature: (f, layer) => {
      const p = f.properties || {};
      layer.on("click", () => onMultiPolyClick(p));
      layer.bindTooltip(p.kind === "memba" ? `🗑 Memba ${(+p.i || 0) + 1} havzasını sil (tıkla)`
        : "Ara havza — çözümü temizlemek için tıkla", { sticky: true });
    },
  }).addTo(map),
  pts: L.layerGroup().addTo(map),
};
multiLayers.poly.remove(); multiLayers.pts.remove(); // varsayılan gizli

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

/* ---------------- SU POTANSİYELİ ----------------
   Günlük akım serilerinden hacim odaklı değerlendirme. Taşkın tarafındaki
   AGİ katmanından ayrı bir veri tabanı (2909 istasyon, 1934-2015).        */
layers.su = L.layerGroup();
S.suSecili = new Set();      // periyot/regresyona girecek istasyonlar
S.suListe = [];

function suIsaretle() {
  layers.su.eachLayer(l => {
    if (!l.su) return;
    const sec = S.suSecili.has(l.su.kod);
    const hedef = $("suHedef").value === l.su.kod;
    l.setStyle({
      radius: hedef ? 9 : (sec ? 7 : 5),
      color: hedef ? "#000" : (sec ? "#00695c" : "#78909c"),
      weight: hedef ? 3 : (sec ? 2.5 : 1.2),
      fillColor: l.su.icinde ? "#26a69a" : "#90a4ae",
      fillOpacity: 0.85,
    });
  });
  $("btnSuPeriyot").disabled = S.suSecili.size < 1;
  $("btnSuTamamla").disabled = !$("suHedef").value;
}

function suHedefDoldur() {
  const sec = $("suHedef"), onceki = sec.value;
  sec.innerHTML = '<option value="">— seçin —</option>'
    + S.suListe.filter(s => S.suSecili.has(s.kod))
        .map(s => `<option value="${s.kod}">${s.kod} — ${(s.ad || "").replace(/_/g, " ")}`
                  + `${s.alan_km2 ? " (" + fmt(s.alan_km2, 0) + " km²)" : ""}</option>`).join("");
  sec.value = S.suSecili.has(onceki) ? onceki : "";
  suIsaretle();
}

function suHavzaGuncelle() {
  const a = +$("inpA").value;
  if (a && !$("suAlan").value) $("suAlan").value = a;
  $("suHavzaInfo").innerHTML = S.havza
    ? `Havza çıkarıldı — alan <b>${fmt(a, 2)} km²</b>`
      + (S.outlet ? ` · outlet ${fmt(S.outlet.snap_lat ?? S.outlet.lat, 5)}, `
                    + `${fmt(S.outlet.snap_lon ?? S.outlet.lon, 5)}` : "")
    : "Havza yok — outlet seçip çıkarın (ya da alanı elle yazıp doğrudan 3. adıma geçin).";
}

async function suBaslat() {
  layers.su.addTo(map);
  suHavzaGuncelle();
  try {
    const b = await api("/api/su-bilgi");
    if (!b.var) {
      $("btnSuGetir").disabled = true;
      $("suInfo").textContent = "veri yok — tools/su_veritabani_olustur.py ile üretin";
    } else if (!$("suInfo").textContent) {
      $("suInfo").textContent = `${b.istasyon.toLocaleString("tr")} istasyon · `
        + `${b.gun.toLocaleString("tr")} günlük kayıt · ${b.ilk_tarih}…${b.son_tarih}`;
    }
  } catch (e) { /* uç yoksa sessiz geç */ }
}

/* 1) havza — taşkın modundaki çıkarımın aynısını kullanır */
$("btnSuHavza").onclick = () => { $("btnPick").click(); };

/* 3) civardaki AGİ'ler */
$("btnSuGetir").onclick = async () => {
  setStatus("suStatus", "AGİ'ler getiriliyor…", "loading");
  try {
    let r;
    if (S.havza) {
      r = await api("/api/su-havza", {
        geometri: (S.havza.features ? S.havza.features[0].geometry : S.havza.geometry || S.havza),
        tampon_derece: +$("suTampon").value || 0,
        en_az_yil: +$("suEnAzYil").value || 5,
      });
    } else {
      const b = map.getBounds();
      const q = new URLSearchParams({
        bati: b.getWest(), guney: b.getSouth(), dogu: b.getEast(), kuzey: b.getNorth(),
        en_az_yil: +$("suEnAzYil").value || 5,
      });
      r = await api("/api/su-istasyon?" + q.toString());
    }
    S.suListe = r.istasyonlar;
    S.suSecili = new Set(r.istasyonlar.filter(s => s.alan_km2).map(s => s.kod));
    layers.su.clearLayers();
    r.istasyonlar.forEach(s => {
      if (s.lat == null || s.lon == null) return;
      const m = L.circleMarker([s.lat, s.lon], { radius: 5 });
      m.su = s;
      m.bindTooltip(`${s.kod} — ${(s.ad || "").replace(/_/g, " ")}`, { sticky: true });
      m.on("click", () => {
        if (S.suSecili.has(s.kod)) S.suSecili.delete(s.kod); else S.suSecili.add(s.kod);
        suListele();
      });
      m.addTo(layers.su);
    });
    suListele();
    const ic = r.istasyonlar.filter(s => s.icinde).length;
    setStatus("suStatus", `${r.istasyonlar.length} istasyon`
      + (S.havza ? ` (${ic} tanesi havza içinde)` : "")
      + " — analize girecekleri işaretleyin.", "ok");
  } catch (e) {
    setStatus("suStatus", "AGİ'ler getirilemedi: " + e.message, "err");
  }
};

function suListele() {
  const sat = (s) => `<tr><td><input type="checkbox" class="su-cb" data-kod="${s.kod}"`
    + `${S.suSecili.has(s.kod) ? " checked" : ""}`
    + `${s.alan_km2 ? "" : " disabled title='yağış alanı yok — havzaya taşınamaz'"}></td>`
    + `<td>${s.kod}</td><td>${(s.ad || "").replace(/_/g, " ")}</td>`
    + `<td>${s.icinde ? "içinde" : "çevre"}</td>`
    + `<td style="text-align:right">${(s.veri_gun / 365).toFixed(0)}</td>`
    + `<td style="text-align:right">${s.alan_km2 ? fmt(s.alan_km2, 1) : "—"}</td>`
    + `<td style="text-align:right">${s.q_ort != null ? fmt(s.q_ort, 2) : "—"}</td></tr>`;
  $("suListe").innerHTML = S.suListe.length
    ? '<table class="tbl small"><tr><th>✓</th><th>Kod</th><th>Ad</th><th>Konum</th>'
      + "<th>Yıl</th><th>A (km²)</th><th>Q<sub>ort</sub></th></tr>"
      + S.suListe.map(sat).join("") + "</table>"
    : '<p class="small">Bu alanda yeterli uzunlukta istasyon yok.</p>';
  $("suListe").querySelectorAll(".su-cb").forEach(cb => {
    cb.onclick = () => {
      if (cb.checked) S.suSecili.add(cb.dataset.kod); else S.suSecili.delete(cb.dataset.kod);
      suHedefDoldur();
    };
  });
  suHedefDoldur();
}

/* 4) ölçüm periyotları + korelasyon */
$("btnSuPeriyot").onclick = async () => {
  const ilk = +$("suIlkYil").value, son = +$("suSonYil").value;
  if (!(ilk && son && son >= ilk)) return setStatus("suStatus",
    "Geçerli bir yıl aralığı girin.", "err");
  setStatus("suStatus", "Periyotlar çıkarılıyor…", "loading");
  try {
    const r = await api("/api/su-periyot",
      { kodlar: [...S.suSecili], ilk_yil: ilk, son_yil: son });
    S.suPeriyot = r;
    const t = r.tablo;
    const renk = { tam: "#2e7d32", eksik: "#f9a825", yok: "#e0e0e0" };
    let h = '<p class="small"><b>Ölçüm periyotları</b> — '
      + '<span style="color:#2e7d32">■</span> tam yıl · '
      + '<span style="color:#f9a825">■</span> eksik (kısmi gözlem) · '
      + '<span style="color:#bdbdbd">■</span> veri yok</p>'
      + '<div style="overflow-x:auto"><table class="tbl small"><tr><th>İstasyon</th>'
      + t.yillar.map(y => `<th style="writing-mode:vertical-rl;font-weight:400">${y}</th>`).join("")
      + "<th>tam</th><th>eksik</th></tr>";
    t.istasyonlar.forEach(s => {
      h += `<tr><td title="${(s.ad || "").replace(/_/g, " ")}">${s.kod}</td>`
        + s.yillar.map(y => `<td title="${y.yil}: ${y.durum}${y.q != null
            ? " · " + fmt(y.q, 2) + " m³/s, " + y.gun + " gün" : ""}"`
            + ` style="background:${renk[y.durum]};padding:0 3px"></td>`).join("")
        + `<td style="text-align:right">${s.tam_yil}</td>`
        + `<td style="text-align:right">${s.eksik_yil}</td></tr>`;
    });
    h += "</table></div>";

    const ky = r.korelasyon.filter(k => k.r2 != null).sort((a, b) => b.r2 - a.r2);
    if (ky.length) {
      h += '<p class="small"><b>İstasyon çiftleri arasındaki ilişki</b> '
        + "(yıllık ortalama akım regresyonu, en iyi 12)</p><table class='tbl small'>"
        + "<tr><th>A</th><th>B</th><th>ortak yıl</th><th>r</th><th>r²</th></tr>"
        + ky.slice(0, 12).map(k => `<tr><td>${k.a}</td><td>${k.b}</td>`
            + `<td style="text-align:right">${k.ortak_yil}</td>`
            + `<td style="text-align:right">${fmt(k.r, 3)}</td>`
            + `<td style="text-align:right">${fmt(k.r2, 3)}</td></tr>`).join("")
        + "</table>";
    }
    $("suPeriyot").innerHTML = h;
    const eksikToplam = t.istasyonlar.reduce((a, s) => a + s.eksik_yil, 0);
    setStatus("suStatus", `${t.istasyonlar.length} istasyon × ${t.yillar.length} yıl — `
      + `toplam ${eksikToplam} eksik yıl. Temsil AGİ'sini seçip tamamlayın.`, "ok");
  } catch (e) {
    setStatus("suStatus", "Periyotlar çıkarılamadı: " + e.message, "err");
  }
};

$("suHedef").onchange = suIsaretle;

/* 5) eksikleri tamamla + havza çıkışına taşı */
$("btnSuTamamla").onclick = async () => {
  const hedef = $("suHedef").value;
  if (!hedef) return;
  const alan = +$("suAlan").value || +$("inpA").value;
  setStatus("suStatus", "Regresyonla tamamlanıyor…", "loading");
  try {
    const o = await api("/api/su-tamamla", {
      hedef, vericiler: [...S.suSecili],
      ilk_yil: +$("suIlkYil").value, son_yil: +$("suSonYil").value,
      en_az_r2: +$("suR2").value || 0.5,
      havza_alani_km2: alan || null, us: +$("suUs").value || 1,
    });
    S.suTamam = o;
    const i = o.istasyon;
    let h = `<h3 class="small">${i.kod} — ${(i.ad || "").replace(/_/g, " ")}`
      + `${i.alan_km2 ? " (" + fmt(i.alan_km2, 1) + " km²)" : ""}</h3>`;

    const il = Object.entries(o.iliskiler).sort((a, b) => b[1].r2 - a[1].r2);
    h += '<p class="small"><b>Kabul edilen ilişkiler</b> (eksik yıl doldurmada '
      + "kullanılma sırası)</p>";
    h += il.length
      ? '<table class="tbl small"><tr><th>Verici</th><th>r²</th><th>ortak yıl</th>'
        + "<th>bağıntı</th></tr>"
        + il.map(([k, v]) => `<tr><td>${k}</td>`
            + `<td style="text-align:right">${fmt(v.r2, 3)}</td>`
            + `<td style="text-align:right">${v.ortak_yil}</td>`
            + `<td>Q = ${fmt(v.kesim, 3)} + ${fmt(v.egim, 4)}·Q<sub>${k}</sub></td></tr>`).join("")
        + "</table>"
      : '<p class="small">r² eşiğini geçen ilişki yok — eşiği düşürün ya da başka '
        + "istasyon işaretleyin.</p>";

    h += `<p class="small"><b>Yıllık seri</b> — ${o.gozlem} gözlem, `
      + `${o.dolduruldu} regresyonla dolduruldu`
      + (o.bos ? `, <b>${o.bos} yıl boş kaldı</b>` : "") + "</p>"
      + '<div style="overflow-x:auto"><table class="tbl small"><tr><th>Su yılı</th>'
      + o.seri.map(s => `<th style="font-weight:400">${s.yil}</th>`).join("") + "</tr>"
      + "<tr><td>Q (m³/s)</td>" + o.seri.map(s =>
          `<td style="text-align:right;${s.kaynak === "gözlem" ? ""
            : s.q == null ? "background:#ffcdd2" : "background:#fff9c4"}"`
          + ` title="${s.kaynak === "gözlem" ? "gözlem"
              : s.kaynak ? s.kaynak + " ile dolduruldu (r²=" + fmt(s.r2, 3) + ")"
              : "veri yok"}">${s.q == null ? "—" : fmt(s.q, 2)}</td>`).join("")
      + "</tr></table></div>";

    if (o.outlet) {
      const u = o.outlet;
      h += `<p class="small"><b>Havza çıkışına taşınmış potansiyel</b> — `
        + `(${fmt(u.havza_alani_km2, 1)} / ${fmt(u.kaynak_alan_km2, 1)})`
        + `<sup>${fmt(u.us, 2)}</sup> = ${fmt(u.oran, 4)}</p><table class="tbl small">`
        + `<tr><td>Ortalama akım Q<sub>ort</sub></td><td><b>${fmt(u.q_ort, 3)}</b> m³/s</td></tr>`
        + `<tr><td>Yıllık hacim</td><td><b>${fmt(u.yillik_hacim_hm3, 2)}</b> hm³/yıl</td></tr>`
        + `<tr><td>Özgül verim</td><td>${fmt(u.ozgul_verim_ls_km2, 2)} L/s/km²</td></tr>`
        + `<tr><td>Yıllık verim</td><td>${fmt(u.yillik_verim_mm, 0)} mm</td></tr>`
        + `<tr><td>Kullanılan yıl</td><td>${u.yil_sayisi}</td></tr></table>`;
    }
    $("suSonuc").innerHTML = h;
    setStatus("suStatus", o.outlet
      ? `Havza çıkışı: Q_ort = ${fmt(o.outlet.q_ort, 3)} m³/s · `
        + `${fmt(o.outlet.yillik_hacim_hm3, 2)} hm³/yıl.`
      : `${o.gozlem} gözlem + ${o.dolduruldu} dolduruldu (havza alanı girilmedi).`, "ok");
  } catch (e) {
    setStatus("suStatus", "Tamamlanamadı: " + e.message, "err");
  }
};

/* ---------------- DİLEKÇE (MGM veri talebi) ---------------- */
let dilStGrid = null, dilInited = false;
let dilImzaB64 = "";   // kullanıcı görsel yüklerse; boşsa backend varsayılanı kullanır
async function initDilekce() {
  if (!dilStGrid) {
    dilStGrid = makePasteGrid("dilStGrid", "btnDilStAdd", "btnDilStClear",
      ["İst. No", "İstasyon Adı", "Ölçüm aralığı (yıl)"], [], 3);
  }
  if (dilInited) return;
  dilInited = true;
  try {
    const d = await api("/api/dilekce-defaults");
    if (!$("dilEposta").value) $("dilEposta").value = d.eposta || "";
    if (!$("dilGsm").value) $("dilGsm").value = d.gsm || "";
    if (!$("dilAdres").value.trim()) $("dilAdres").value = d.adres || "";
    if (!$("dilVeri").value.trim()) $("dilVeri").value = (d.veri_turleri || []).join("\n");
    if (d.imza_var) $("dilImzaPrev").src = "/api/dilekce-imza?" + Date.now();
  } catch (e) { setStatus("dilStatus", "Varsayılanlar yüklenemedi: " + e.message, "err"); }
}
$("dilImzaFile").onchange = () => {
  const f = $("dilImzaFile").files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { dilImzaB64 = rd.result; $("dilImzaPrev").src = rd.result; };
  rd.readAsDataURL(f);
};
$("btnDilImzaReset").onclick = () => {
  dilImzaB64 = ""; $("dilImzaFile").value = "";
  $("dilImzaPrev").src = "/api/dilekce-imza?" + Date.now();
};
$("btnDilFromTh").onclick = () => {
  const act = (S.thiessen || []).filter(t => t.agirlik > 0);
  if (!act.length) return alert("Önce Yağış adımında Thiessen hesaplayın (Tek Havza → Adım 3)");
  if (!dilStGrid) initDilekce();
  dilStGrid.render(act.map(t => ["", t.name, ""]));
};
$("btnDilekce").onclick = async () => {
  try {
    const rows = dilStGrid ? dilStGrid.read() : [];
    const istasyonlar = rows
      .filter(r => (r[1] || "").trim() || (r[0] || "").trim())
      .map(r => ({ no: (r[0] || "").trim(), ad: (r[1] || "").trim(), aralik: (r[2] || "").trim() }));
    if (!istasyonlar.length) throw new Error("En az bir istasyon girin (Ad)");
    const veri = $("dilVeri").value.split("\n").map(x => x.trim()).filter(Boolean);
    const fmt = $("dilFormat").value === "pdf" ? "pdf" : "docx";
    const body = {
      il: $("dilIl").value.trim(), istasyonlar, veri_turleri: veri.length ? veri : null,
      eposta: $("dilEposta").value.trim(), gsm: $("dilGsm").value.trim(),
      adres: $("dilAdres").value.trim(), imza: $("dilImza").value.trim(), kase: $("dilKase").value.trim(),
      format: fmt, imza_b64: dilImzaB64 || "", use_default_imza: true,
    };
    setStatus("dilStatus", "Dilekçe oluşturuluyor…", "loading");
    const resp = await fetch("/api/dilekce", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!resp.ok) { const j = await resp.json().catch(() => ({})); throw new Error(j.hata || j.detail || resp.statusText); }
    const blob = await resp.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (istasyonlar[0].ad || body.il || "MGM").replace(/[^\wçğıöşüÇĞİÖŞÜ]+/g, "_") + "_MGM_Dilekce." + fmt;
    a.click(); URL.revokeObjectURL(a.href);
    setStatus("dilStatus", "Dilekçe indirildi.", "ok");
  } catch (e) { setStatus("dilStatus", "Hata: " + e.message, "err"); }
};

// 1) Ortak veri durumu (istasyon + yağış) — Adım 3'ten (birleşik) paylaşılır
function updateMultiShared() {
  const nSt = (S.istasyonlar || []).length;
  const nRain = S.rainValues ? Object.values(S.rainValues).filter(v => v && v.slice(0, 6).every(x => x != null)).length : 0;
  const ok = nSt > 0 && nRain > 0;
  $("multiShared").innerHTML = ok
    ? `✓ İstasyonlar: ${nSt} yüklü — Yağış: ${nRain} istasyon dolu. (Değiştirmek için “Tek Havza” → Adım 3.)`
    : `⚠ Eksik: ${nSt ? "" : "istasyon (Adım 3) "}${nRain ? "" : "yağış (Adım 3) "} — “Tek Havza” → Adım 3’ü doldurun.`;
  $("multiShared").className = "small " + (ok ? "" : "err");
}
function selectedMethods() {
  return Array.from(document.querySelectorAll(".mmethod:checked")).map(x => x.dataset.m);
}

$("btnAddMansap").onclick = () => { S.multi.place = "mansap"; multiHint("Haritada MANSAP (çıkış) noktasına tıklayın"); };
$("btnAddMemba").onclick = () => { S.multi.place = "memba"; multiHint("Haritada bir MEMBA (üst havza çıkışı) noktasına tıklayın"); };
function multiHint(msg) { setStatus("multiStatus", msg, ""); map.getContainer().style.cursor = "crosshair"; }

function multiAddPoint(latlng) {
  const p = { lat: +latlng.lat.toFixed(6), lon: +latlng.lng.toFixed(6) };
  if (S.multi.place === "mansap") { S.multi.mansap = p; S.multi.mansapAuto = false; }
  else S.multi.membalar.push(p);
  S.multi.place = null;
  map.getContainer().style.cursor = "";
  setStatus("multiStatus", "", "");
  invalidateMultiSolve();
  renderMultiPoints();
}
function invalidateMultiSolve() {
  S.multiMd = null;
  S.multiRes = {};        // memba indeksleri değişebilir; hazne atamalarını düşür
  S.multiQbazVals = {};   // aynı nedenle elle girilen baz akımları da
  const b = $("btnSolveCompute"); if (b) b.disabled = true;
}

function renderMultiPoints() {
  let h = "";
  if (S.multi.mansap)
    h += `<div class="mpt-row"><span class="dot" style="background:#c73e3a"></span>
      Mansap: ${S.multi.mansap.lat.toFixed(4)}, ${S.multi.mansap.lon.toFixed(4)}
      ${S.multi.mansapAuto ? '<span class="small" style="color:#6b6762">(tek havza outlet\'i)</span>' : ""}
      <button data-t="mansap">✕</button></div>`;
  S.multi.membalar.forEach((m, i) => {
    h += `<div class="mpt-row"><span class="dot" style="background:#1e88e5"></span>
      Memba ${i + 1}: ${m.lat.toFixed(4)}, ${m.lon.toFixed(4)}
      <button data-t="memba" data-i="${i}">✕</button></div>`;
  });
  $("multiPoints").innerHTML = h || `<div class="small">Henüz nokta eklenmedi.</div>`;
  $("multiPoints").querySelectorAll("button").forEach(b => b.onclick = () => {
    if (b.dataset.t === "mansap") { S.multi.mansap = null; S.multi.mansapAuto = false; }
    else S.multi.membalar.splice(+b.dataset.i, 1);
    invalidateMultiSolve();
    renderMultiPoints();
  });
  drawMultiPoints();
}

function drawMultiPoints() {
  multiLayers.pts.clearLayers();
  if (S.multi.mansap)
    L.marker([S.multi.mansap.lat, S.multi.mansap.lon]).addTo(multiLayers.pts).bindTooltip("Mansap");
  S.multi.membalar.forEach((m, i) =>
    L.circleMarker([m.lat, m.lon], { radius: 6, color: "#1e88e5", fillOpacity: .8 })
      .addTo(multiLayers.pts).bindTooltip("Memba " + (i + 1)));
}

// bir alt havza poligonunu seçili yöntemlerle tam otomatik hesaplar
/* ---- Alt havza baz akımları ----
   Varsayılan: mansap toplamı alan oranıyla dağıtılır. Kullanıcı her havza
   için (memba_i / ara) elle değer girerse o kullanılır.                    */
function qbazOran(sub, aMansap) {
  const tot = +$("multiQbaz").value || 0;
  return aMansap > 0 ? tot * (sub.alan_km2 / aMansap) : 0;
}
function qbazDegeri(anahtar, sub, aMansap) {
  const el = $("qb_" + anahtar);
  if (el && el.value !== "" && !isNaN(+el.value)) return +el.value;
  return qbazOran(sub, aMansap);
}
function renderMultiQbaz() {
  const box = $("multiQbazBox");
  if (!box) return;
  const md = S.multiMd;
  if (!md) { box.innerHTML = ""; return; }
  const aM = md.mansap.alan_km2;
  const satir = (anahtar, ad, sub) => {
    const onceki = S.multiQbazVals ? S.multiQbazVals[anahtar] : undefined;
    const oran = qbazOran(sub, aM);
    return `<tr><td>${ad}</td><td>${fmt(sub.alan_km2, 1)}</td>
      <td>${fmt(oran, 2)}</td>
      <td><input class="qbaz-cell" id="qb_${anahtar}" type="number" step="0.1"
           value="${onceki != null ? onceki : ""}" placeholder="${oran.toFixed(2)}"></td></tr>`;
  };
  let h = `<div class="mstep"><b>Baz akımlar</b> — boş bırakılırsa alan oranıyla dağıtılan
    değer kullanılır (gri yazı)</div>
    <table class="tbl"><tr><th>Havza</th><th>A (km²)</th><th>Alan oranıyla</th>
    <th>Elle (m³/s)</th></tr>`;
  md.membalar.forEach((mb, i) => h += satir("m" + i, "Memba " + (i + 1), mb));
  h += satir("ara", "Ara havza", md.ara);
  h += `</table><div class="small" id="qbazToplam"></div>`;
  box.innerHTML = h;
  const guncelle = () => {
    S.multiQbazVals = {};
    box.querySelectorAll(".qbaz-cell").forEach(inp => {
      if (inp.value !== "") S.multiQbazVals[inp.id.slice(3)] = +inp.value;
    });
    let t = qbazDegeri("ara", md.ara, aM);
    md.membalar.forEach((mb, i) => t += qbazDegeri("m" + i, mb, aM));
    $("qbazToplam").textContent =
      `Mansapta toplanacak baz akım: ${t.toFixed(2)} m³/s (girilen mansap toplamı: ` +
      `${(+$("multiQbaz").value || 0).toFixed(2)} m³/s)`;
  };
  box.querySelectorAll(".qbaz-cell").forEach(inp => inp.addEventListener("input", guncelle));
  // atama ile bağla — addEventListener her render'da birikirdi
  $("multiQbaz").oninput = () => renderMultiQbaz();
  guncelle();
}

async function autoComputeSub(sub, qbaz, methods) {
  const w = await api("/api/thiessen", { havza_geojson: sub.havza_geojson, istasyonlar: S.istasyonlar,
                                        min_agirlik: Math.max(0, (+$("inpMinW").value || 0) / 100) });
  const act = w.sonuc.filter(t => t.agirlik > 0);
  const T = [2, 5, 10, 25, 50, 100];
  const P24 = {}; let OET = 0, oetOk = true;
  T.forEach((tt, j) => {
    P24[tt] = act.reduce((a, t) => { const rv = S.rainValues[t.name]; return a + (rv ? t.agirlik * rv[j] : 0); }, 0);
  });
  act.forEach(t => { const rv = S.rainValues[t.name]; if (!rv || rv[6] == null) oetOk = false; else OET += t.agirlik * rv[6]; });
  const cn = await api("/api/cn", { havza_geojson: sub.havza_geojson, zemin_grubu: $("multiSoil").value });
  const girdi = {
    ad: "alt", A_km2: sub.alan_km2, L_km: sub.L_km, Lc_km: sub.Lc_km,
    CN2: cn.CN2, CN3: cn.CN3, region: (sub.yzd_bolge && sub.yzd_bolge.bolge) || "B",
    elevations: sub.kotlar, Qbaz: qbaz,
    P24, P24_OET: oetOk ? OET : 0, dplv_ratios: dplvRatios(),
  };
  const snyderOn = methods.includes("snyder");
  // rasyonel C: alt havzanın KENDİ CORINE dökümünden türet; yoksa 0.45'e düş
  const c100 = (cn.rasyonel_C && cn.rasyonel_C.C_orta) || 0.45;
  const res = await api("/api/compute", {
    girdi, rasyonel: methods.includes("rasyonel"), c100,
    snyder: snyderOn, snyder_par: snyderOn ? { Ct: +$("multiCt").value || 1.55, Cp: +$("multiCp").value || 0.6 } : null,
  });
  return { girdi, res, cn, thiessen: act };
}

// ① Havzaları çöz (delineate + çiz + alt havza tablosu)
$("btnSolveDelin").onclick = async () => {
  try {
    if (!S.multi.mansap) throw new Error("Mansap noktası seçin");
    if (!S.multi.membalar.length) throw new Error("En az bir memba noktası ekleyin");
    setStatus("multiStatus", "Ara havza çıkarılıyor… DEM işleniyor; havzalar büyükse " +
      "birkaç dakika sürebilir.", "loading");
    const md = await api("/api/multi-delineate", {
      mansap: S.multi.mansap, membalar: S.multi.membalar, river_km2: +$("multiRivThr").value || 1,
      snap_m: +$("inpSnap").value || 500, dem_source: $("inpDem").value,
    });
    multiLayers.poly.clearLayers();
    const addPoly = (gj, c, meta) => multiLayers.poly.addData({ type: "Feature", properties: { c, ...(meta || {}) }, geometry: JSON.parse(JSON.stringify(gj)) });
    addPoly(md.ara.havza_geojson, "#2a9d8f", { kind: "ara" });
    md.membalar.forEach((mb, i) => addPoly(mb.havza_geojson, "#1e88e5", { kind: "memba", i }));
    map.fitBounds(multiLayers.poly.getBounds(), { padding: [30, 30] });
    S.multiMd = md;
    let h = `<h3 class="res">Alt Havzalar (çıkarıldı)</h3><table class="tbl">
      <tr><th>Havza</th><th>A (km²)</th><th>L (km)</th><th>Lc</th><th>Bölge</th><th>Tc (sa)</th></tr>`;
    md.membalar.forEach((mb, i) => h += `<tr><td>Memba ${i + 1}</td><td>${fmt(mb.alan_km2, 2)}</td><td>${fmt(mb.L_km, 2)}</td><td>${fmt(mb.Lc_km, 2)}</td><td>${(mb.yzd_bolge || {}).bolge || "—"}</td><td>${fmt(mb.Tc_saat, 2)}</td></tr>`);
    h += `<tr><td><b>Ara havza</b></td><td>${fmt(md.ara.alan_km2, 2)}</td><td>${fmt(md.ara.L_km, 2)}</td><td>${fmt(md.ara.Lc_km, 2)}</td><td>${(md.ara.yzd_bolge || {}).bolge || "—"}</td><td><b>${fmt(md.ara.Tc_saat, 2)}</b></td></tr>`;
    h += `<tr><td colspan="6"><b>Mansap:</b> A=${fmt(md.mansap.alan_km2, 2)} km² | öteleme = ara Tc = ${fmt(md.ara.Tc_saat, 2)} sa</td></tr></table>`;
    if (md.uyari && md.uyari.length) h += `<div class="small err">⚠ ${md.uyari.join("; ")}</div>`;
    $("multiResults").innerHTML = h;
    if (!$("multiLag").value && md.ara.Tc_saat) $("multiLag").value = md.ara.Tc_saat.toFixed(2);
    renderMultiQbaz();
    $("btnSolveCompute").disabled = false;
    setStatus("multiStatus", "Havzalar çıkarıldı. Şimdi ② Hesapla ve Ötele.", "ok");
  } catch (e) { setStatus("multiStatus", "Hata: " + e.message, "err"); $("btnSolveCompute").disabled = true; }
};

// ② Hesapla ve ötele (seçili yöntemlerle her alt havza + routing)
$("btnSolveCompute").onclick = async () => {
  try {
    if (!S.multiMd) throw new Error("Önce ① Havzaları Çöz");
    if (!S.istasyonlar || !S.istasyonlar.length) throw new Error("İstasyon yok — Tek Havza → Adım 3");
    if (!S.rainValues || !Object.keys(S.rainValues).length) throw new Error("Yağış yok — Tek Havza → Adım 3");
    const methods = selectedMethods();
    if (!methods.length) throw new Error("En az bir yöntem seçin");
    const md = S.multiMd, aMansap = md.mansap.alan_km2;
    setStatus("multiStatus", "Alt havzalar hesaplanıyor (CN, Thiessen, hidrograf)…", "loading");
    const araC = await autoComputeSub(md.ara, qbazDegeri("ara", md.ara, aMansap), methods);
    const membaC = [];
    for (let i = 0; i < md.membalar.length; i++) {
      const mb = md.membalar[i];
      membaC.push({ mb, ...(await autoComputeSub(mb, qbazDegeri("m" + i, mb, aMansap), methods)) });
    }
    setStatus("multiStatus", `Öteleme (ara Tc=${fmt(md.ara.Tc_saat, 2)} sa)…`, "loading");
    const rez0 = membaC.map((_, i) => (S.multiRes && S.multiRes[i]) || null);
    const rt = await api("/api/route", {
      ara_sonuc: araC.res, memba_sonuclari: membaC.map(x => x.res),
      lag_saat: (+$("multiLag").value || md.ara.Tc_saat), yontemler: methods,
      rezervuarlar: rez0.some(Boolean) ? rez0 : null,
    });
    S.multiSonuc = { md, araC, membaC, rt, methods };
    renderMultiResults();
    setStatus("multiStatus", "Tamamlandı", "ok");
  } catch (e) { setStatus("multiStatus", "Hata: " + e.message, "err"); }
};

const MRP = ["2", "5", "10", "25", "50", "100", "OET"];
/* === extracted to core/constants.js M_LABEL === */function _envPeak(res, rp) {
  let mx = null;
  ["2", "4", "6", "8", "12", "18", "24"].forEach(d => { const v = res.kabulet[d] && res.kabulet[d][rp]; if (v != null) mx = mx == null ? v : Math.max(mx, v); });
  return mx;
}

/* ---- Alt havza fiziksel parametreleri ekranı ----
   Çok parçalı çözümde her alt havza için DEM/CORINE/Thiessen'den baştan
   hesaplanan tüm girdiler tek ekranda toplanır.                            */
/* Kot profili tanılaması: harmonik eğim S=(10/Σ√(l/Δh))² en düz segmente
   aşırı duyarlıdır. Her segmentin toplamdaki payını çıkarıp, eğimi tek bir
   segmentin belirlediği veya profilin gerçekdışı düz olduğu durumları
   işaretler.                                                               */
function profilTani(elevations, L_km) {
  const e = elevations || [];
  if (e.length !== 11 || !(L_km > 0)) return null;
  const l = (L_km * 1000) / 10;
  const dh = [], term = [];
  for (let i = 1; i <= 10; i++) {
    const d = e[i] - e[i - 1];
    dh.push(d);
    term.push(d > 0 ? Math.sqrt(l / d) : Infinity);
  }
  const toplam = term.reduce((a, b) => a + b, 0);
  const S_harm = Math.pow(10 / toplam, 2);
  const paylar = term.map(t => t / toplam);
  const enBuyukPay = Math.max(...paylar);
  const enBuyukIdx = paylar.indexOf(enBuyukPay);
  const dhTop = e[10] - e[0];
  const S_ort = dhTop / (L_km * 1000);
  const oran = S_harm > 0 ? S_ort / S_harm : Infinity;   // ortalama/harmonik
  const uyarilar = [];
  if (enBuyukPay > 0.35)
    uyarilar.push(`Eğimi tek segment belirliyor: <b>H${enBuyukIdx}–H${enBuyukIdx + 1}</b> ` +
      `harmonik eğim toplamının %${(enBuyukPay * 100).toFixed(0)}'ini oluşturuyor ` +
      `(Δh=${dh[enBuyukIdx].toFixed(1)} m). Bu segment T<sub>c</sub>'yi tek başına şişirir.`);
  if (oran > 5)
    uyarilar.push(`Harmonik eğim, ortalama eğimin <b>${oran.toFixed(1)} katı</b> altında ` +
      `(harmonik %${(S_harm * 100).toFixed(3)} — ortalama %${(S_ort * 100).toFixed(3)}); ` +
      `profilde düz bölümler baskın.`);
  if (S_harm < 0.0005)
    uyarilar.push(`Harmonik eğim çok düşük (%${(S_harm * 100).toFixed(4)}) — ` +
      `T<sub>c</sub> gerçekçi olmayacak kadar büyük çıkar.`);
  if (dhTop < L_km * 0.5)
    uyarilar.push(`Toplam kot farkı ${dhTop.toFixed(1)} m, ${L_km.toFixed(1)} km uzunluk için ` +
      `çok az (ortalama eğim %${(S_ort * 100).toFixed(3)}). DEM profili kusurlu olabilir.`);
  const kucukler = dh.filter(d => d <= 0.5).length;
  if (kucukler)
    uyarilar.push(`${kucukler} segmentte kot artışı ≤0,5 m — düz/yamalı profil.`);
  return { dh, paylar, S_harm, S_ort, oran, dhTop, enBuyukIdx, enBuyukPay, uyarilar };
}

let parChart = null;
function openParams() {
  if (!S.multiSonuc) { alert("Önce ② Hesapla ve Ötele"); return; }
  const { md, araC, membaC } = S.multiSonuc;
  const satirlar = membaC.map((x, i) => ({ ad: "Memba " + (i + 1), sub: x.mb, c: x }));
  satirlar.push({ ad: "Ara havza", sub: md.ara, c: araC });
  const S_of = (c) => (c.res && c.res.girdi_ozeti && c.res.girdi_ozeti.S_harmonik);

  let h = `<p class="hint">Her alt havza için <b>tüm fiziksel parametreler baştan hesaplanır</b>:
    A/L/Lc ve 11 noktalı kot profili DEM'den, CN CORINE'den, yağış Thiessen ağırlıklarıyla.
    T<sub>c</sub> Kirpich formülüyle harmonik eğimden bulunur; harmonik eğim
    <b>en düz segmente çok duyarlıdır</b>, bu yüzden kot profilini kontrol edin.</p>`;

  h += `<h3 class="res">Geometri ve Hesap Parametreleri</h3><table class="tbl">
    <tr><th>Havza</th><th>A (km²)</th><th>L (km)</th><th>Lc (km)</th><th>S harmonik</th>
    <th>Tc (sa)</th><th>CN II</th><th>CN III</th><th>YZD</th><th>Qbaz</th></tr>`;
  satirlar.forEach(r => {
    const g = r.c.girdi, sh = S_of(r.c);
    h += `<tr><td>${r.ad}</td><td>${fmt(g.A_km2, 2)}</td><td>${fmt(g.L_km, 2)}</td>
      <td>${fmt(g.Lc_km, 2)}</td><td>${sh == null ? "—" : sh.toFixed(5) + " (%" + (sh * 100).toFixed(3) + ")"}</td>
      <td>${fmt(r.sub.Tc_saat, 2)}</td><td>${fmt(g.CN2, 1)}</td><td>${fmt(g.CN3, 1)}</td>
      <td>${g.region || "—"}</td><td>${fmt(g.Qbaz, 2)}</td></tr>`;
  });
  h += `</table>`;

  h += `<h3 class="res">Kot Profili (outlet → memba, 11 nokta, m)</h3><table class="tbl">
    <tr><th>Havza</th>` + Array.from({ length: 11 }, (_, i) => `<th>H${i}</th>`).join("") +
    `<th>Δh top.</th></tr>`;
  satirlar.forEach(r => {
    const e = r.c.girdi.elevations || [];
    const dh = (e.length === 11) ? e[10] - e[0] : null;
    h += `<tr><td>${r.ad}</td>` + e.map(v => `<td>${fmt(v, 1)}</td>`).join("") +
      `<td>${dh == null ? "—" : fmt(dh, 1)}</td></tr>`;
  });
  h += `</table>`;

  // profil grafiği + segment payları + uyarılar
  h += `<h3 class="res">Kot Profili Grafiği</h3>
    <div style="height:280px;position:relative"><canvas id="parChartC"></canvas></div>
    <div class="small">Yatay eksen: çıkıştan yukarı doğru mesafe (km). Profil düz seyrediyorsa
    harmonik eğim düşer ve T<sub>c</sub> büyür.</div>`;

  const taniLar = satirlar.map(r => ({ ad: r.ad, t: profilTani(r.c.girdi.elevations, r.c.girdi.L_km) }));
  h += `<h3 class="res">Segment Eğim Payları (harmonik eğime katkı)</h3><table class="tbl">
    <tr><th>Havza</th>` + Array.from({ length: 10 }, (_, i) => `<th>H${i}–H${i + 1}</th>`).join("") + `</tr>`;
  taniLar.forEach(x => {
    if (!x.t) { h += `<tr><td>${x.ad}</td><td colspan="10">—</td></tr>`; return; }
    h += `<tr><td>${x.ad}</td>` + x.t.paylar.map((p, i) =>
      `<td${p > 0.35 ? ' class="max"' : ""}>%${(p * 100).toFixed(0)}</td>`).join("") + `</tr>`;
  });
  h += `</table><div class="small">Bir segmentin payı %35'i aşıyorsa (sarı) eğimi —dolayısıyla
    T<sub>c</sub>'yi— tek başına o segment belirliyordur.</div>`;

  const uyarili = taniLar.filter(x => x.t && x.t.uyarilar.length);
  if (uyarili.length) {
    h += `<h3 class="res">⚠ Profil Uyarıları</h3>`;
    uyarili.forEach(x => {
      h += `<div class="small err" style="margin-bottom:6px"><b>${x.ad}</b><ul style="margin-left:18px">` +
        x.t.uyarilar.map(u => `<li>${u}</li>`).join("") + `</ul></div>`;
    });
    h += `<div class="small">Çözüm: kot profili gerçeği yansıtmıyorsa <i>Öteleme süresi</i> alanına
      elle makul bir değer girin, ya da havzayı daha ince DEM çözünürlüğüyle (Copernicus /
      daha küçük pencere) yeniden çözün.</div>`;
  } else {
    h += `<div class="small" style="color:#3b7a4e">✓ Kot profillerinde anormallik bulunmadı.</div>`;
  }

  h += `<h3 class="res">Thiessen İstasyonları ve Ağırlıkları</h3><table class="tbl">
    <tr><th>Havza</th><th>İstasyonlar (ağırlık)</th></tr>`;
  satirlar.forEach(r => {
    const t = r.c.thiessen || [];
    h += `<tr><td>${r.ad}</td><td style="text-align:left">` +
      (t.length ? t.map(x => `${x.name} %${(x.agirlik * 100).toFixed(1)}`).join(" · ") : "—") +
      `</td></tr>`;
  });
  h += `</table>`;

  const RPL = [2, 5, 10, 25, 50, 100];
  h += `<h3 class="res">Ağırlıklı 24 Saatlik Yağış (mm)</h3><table class="tbl">
    <tr><th>Havza</th>` + RPL.map(t => `<th>P${t}</th>`).join("") + `<th>OEY</th></tr>`;
  satirlar.forEach(r => {
    const g = r.c.girdi;
    h += `<tr><td>${r.ad}</td>` + RPL.map(t => `<td>${fmt((g.P24 || {})[t], 1)}</td>`).join("") +
      `<td>${fmt(g.P24_OET, 1)}</td></tr>`;
  });
  h += `</table>`;

  h += `<h3 class="res">Öteleme</h3><div class="small">
    Kullanılan öteleme süresi: <b>${fmt(S.multiSonuc.rt.lag_saat, 2)} sa</b>
    (ara havza Kirpich T<sub>c</sub>: ${fmt(md.ara.Tc_saat, 2)} sa).
    Değiştirmek için sol paneldeki <i>Öteleme süresi</i> alanını doldurup
    <i>② Hesapla ve Ötele</i>'yi tekrar çalıştırın.</div>`;

  $("parBody").innerHTML = h;
  $("parWrap").classList.remove("hidden");

  // profil grafiği (x: çıkıştan mesafe km, y: kot m) — her alt havza bir seri
  const RENK = ["#1565c0", "#e65100", "#2e7d32", "#7b1fa2", "#c73e3a", "#00838f"];
  const ds = [];
  satirlar.forEach((r, k) => {
    const e = r.c.girdi.elevations || [], L = r.c.girdi.L_km;
    if (e.length !== 11 || !(L > 0)) return;
    const t = profilTani(e, L);
    const noktalar = e.map((v, i) => ({ x: +(L * i / 10).toFixed(3), y: v }));
    ds.push({
      label: r.ad + (t && t.uyarilar.length ? " ⚠" : ""),
      data: noktalar, borderColor: RENK[k % RENK.length],
      backgroundColor: RENK[k % RENK.length],
      borderWidth: 2, tension: 0.1,
      // eğimi belirleyen (payı en yüksek) segmentin uçlarını büyük göster
      pointRadius: noktalar.map((_, i) =>
        (t && t.enBuyukPay > 0.35 && (i === t.enBuyukIdx || i === t.enBuyukIdx + 1)) ? 6 : 3),
      pointBackgroundColor: noktalar.map((_, i) =>
        (t && t.enBuyukPay > 0.35 && (i === t.enBuyukIdx || i === t.enBuyukIdx + 1))
          ? "#c73e3a" : RENK[k % RENK.length]),
    });
  });
  if (parChart) parChart.destroy();
  if (ds.length) {
    parChart = new Chart($("parChartC"), {
      type: "line", data: { datasets: ds },
      options: {
        animation: false, maintainAspectRatio: false, parsing: false,
        plugins: {
          legend: { position: "bottom" },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y.toFixed(1)} m @ ${c.parsed.x} km` } },
        },
        scales: {
          x: { type: "linear", title: { display: true, text: "Çıkıştan mesafe (km)" } },
          y: { title: { display: true, text: "Kot (m)" } },
        },
      },
    });
  }
}
$("btnClosePar").onclick = () => $("parWrap").classList.add("hidden");

function renderMultiResults() {
  const { md, araC, membaC, rt, methods } = S.multiSonuc;
  // Hazne atanmışsa: varsayılan görünüm rezervuarlı; rezervuarsız çözüm de saklanır
  const rezVar = !!rt.rezervuarli;
  if (S.multiShowRes == null) S.multiShowRes = true;
  const Y = (rezVar && !S.multiShowRes) ? rt.yontemler_rezervuarsiz : rt.yontemler;
  // 1) alt havza tablosu
  let h = `<h3 class="res">Alt Havzalar</h3><table class="tbl">
    <tr><th>Havza</th><th>A (km²)</th><th>L (km)</th><th>Lc</th><th>CN</th><th>Bölge</th><th>Tc (sa)</th><th>DSİ Q100</th></tr>`;
  const rowFor = (ad, sub, comp, tc, bold) => {
    const t = `<td>${fmt(sub.alan_km2, 2)}</td><td>${fmt(sub.L_km, 2)}</td><td>${fmt(sub.Lc_km, 2)}</td>
      <td>${fmt(comp.cn.CN2, 0)}</td><td>${(sub.yzd_bolge && sub.yzd_bolge.bolge) || "—"}</td>
      <td>${fmt(tc, 2)}</td><td>${fmt(_envPeak(comp.res, "100"), 1)}</td>`;
    return `<tr><td>${bold ? "<b>" + ad + "</b>" : ad}</td>${t}</tr>`;
  };
  membaC.forEach((x, i) => h += rowFor("Memba " + (i + 1), x.mb, x, x.mb.Tc_saat));
  h += rowFor("Ara havza", md.ara, araC, md.ara.Tc_saat, true);
  h += `</table>`;
  if (md.uyari && md.uyari.length) h += `<div class="small err">⚠ ${md.uyari.join("; ")}</div>`;
  // kot profili anormallikleri (Tc/öteleme süresini şişirebilir)
  const _tani = membaC.map((x, i) => ({ ad: "Memba " + (i + 1), t: profilTani(x.girdi.elevations, x.girdi.L_km) }))
    .concat([{ ad: "Ara havza", t: profilTani(araC.girdi.elevations, araC.girdi.L_km) }])
    .filter(x => x.t && x.t.uyarilar.length);
  if (_tani.length) h += `<div class="small err">⚠ Kot profili şüpheli: ${_tani.map(x => x.ad).join(", ")} — T<sub>c</sub> ve öteleme süresi olduğundan büyük çıkabilir. Ayrıntı için <b>📐 Fiziksel Parametreler</b>.</div>`;

  // 2) mansap pikleri — yöntem × tekerrür
  if (rezVar) {
    const rl = rt.yontemler, rs = rt.yontemler_rezervuarsiz;
    h += `<div class="mstep"><b>🏞 Memba haznesi etkin</b> — mansap hidrografı sönümlenmiş memba çıkışıyla hesaplandı.</div>
      <div class="rain-tools"><label class="inline"><input type="checkbox" id="multiResToggle" ${S.multiShowRes ? "checked" : ""} style="width:auto;margin-right:4px">Rezervuarlı sonucu göster</label>
      <button id="btnClearMultiRes" class="small-btn">Hazne atamalarını kaldır</button></div>`;
    h += `<table class="tbl"><tr><th>Yöntem</th><th>Q100 rezervuarsız</th><th>Q100 rezervuarlı</th><th>Sönümleme</th></tr>`;
    methods.forEach(m => {
      const a = rs[m] && rs[m].pikler["100"], b = rl[m] && rl[m].pikler["100"];
      if (a == null || b == null) return;
      h += `<tr><td>${M_LABEL[m]}</td><td>${fmt(a,1)}</td><td><b>${fmt(b,1)}</b></td><td>%${fmt((1-b/a)*100,1)}</td></tr>`;
    });
    h += `</table>`;
  }
  h += `<h3 class="res">Mansap Taşkın Pikleri (öteleme=${fmt(md.ara.Tc_saat, 2)} sa, m³/s)</h3>
    <table class="tbl"><tr><th>Yöntem</th>` + MRP.map(rp => `<th>Q${rp}</th>`).join("") + `</tr>`;
  methods.forEach(m => {
    const y = Y[m]; if (!y) return;
    const syn = (m === "mockus" || m === "rasyonel") ? " *" : "";
    h += `<tr><td>${M_LABEL[m]}${syn}</td>` +
      MRP.map(rp => `<td>${y.pikler[rp] == null ? "—" : fmt(y.pikler[rp], 1)}</td>`).join("") + `</tr>`;
  });
  h += `</table><div class="small">* Mockus ve Rasyonel pik yöntemidir; öteleme üçgen hidrografla yapılır.
    DSİ ve Snyder gerçek süperpozisyon hidrograflarıdır.</div>`;

  // 3) Q100 bileşen dökümü (seçili ilk gerçek yöntem)
  const dm = methods.includes("dsi") ? "dsi" : methods[0];
  const comp = Y[dm] && Y[dm].bilesenler["100"];
  if (comp) h += `<div class="small">${M_LABEL[dm]} Q100 bileşen: ara ${fmt(comp.ara_pik, 1)} +
    memba ${comp.memba_pikleri.map(v => fmt(v, 1)).join(", ")} (ötelenmiş) → ${fmt(Y[dm].pikler["100"], 1)} m³/s</div>`;

  h += `<div class="export-row" style="align-items:center">
    <button id="btnMcmp" class="primary">⚖ Sonuç ve Karşılaştırma (tam ekran)</button>
    <button id="btnResMulti" class="primary">🏞 Rezervuar Ötelemesi</button>
    <button id="btnPar" class="primary">📐 Fiziksel Parametreler</button>
    <label class="inline" style="flex-direction:row;gap:4px">Grafik yöntem
      <select id="multiChartM">${methods.map(m => `<option value="${m}">${M_LABEL[m]}</option>`).join("")}</select></label>
    <button id="btnMultiChart" class="primary">📈 Mansap hidrografları</button>
    <button id="btnMultiCsv">⬇ CSV</button></div>`;
  $("multiResults").innerHTML = h;
  if (rezVar) {
    const tg = $("multiResToggle");
    if (tg) tg.onchange = () => { S.multiShowRes = tg.checked; renderMultiResults(); };
    const cl = $("btnClearMultiRes");
    if (cl) cl.onclick = async () => { S.multiRes = {}; await reRouteMulti(); };
  }
  $("btnMcmp").onclick = openMcmp;
  $("btnResMulti").onclick = openReservoir;
  $("btnPar").onclick = openParams;
  $("btnMultiChart").onclick = () => showMultiChart($("multiChartM").value);
  $("btnMultiCsv").onclick = exportMultiCsv;
}

/* ---- Çok parçalı: bileşen + yöntem karşılaştırma tam ekran ---- */
let mcmpChart = null;
const mcmpState = { tab: "bilesen", rp: "100", method: "dsi" };
const M_COLORS = { dsi: "#2a9d8f", snyder: "#c73e3a", mockus: "#e07b3a", rasyonel: "#7b1fa2" };

function openMcmp() {
  const { methods } = S.multiSonuc;
  mcmpState.method = methods.includes("dsi") ? "dsi" : methods[0];
  $("mcmpMethod").innerHTML = methods.map(m => `<option value="${m}">${M_LABEL[m]}</option>`).join("");
  $("mcmpMethod").value = mcmpState.method;
  $("mcmpMethod").onchange = () => { mcmpState.method = $("mcmpMethod").value; renderMcmp(); };
  $("mcmpRP").onchange = () => { mcmpState.rp = $("mcmpRP").value; renderMcmp(); };
  document.querySelectorAll(".mcmp-tab").forEach(b => b.onclick = () => {
    document.querySelectorAll(".mcmp-tab").forEach(x => x.classList.remove("active"));
    b.classList.add("active"); mcmpState.tab = b.dataset.tab; renderMcmp();
  });
  $("mcmpWrap").classList.remove("hidden");
  renderMcmp();
}
$("btnCloseMcmp").onclick = () => $("mcmpWrap").classList.add("hidden");

function mcmpRpOptions() {
  // bileşen/hidro sekmesinde yöntemde mevcut tekerrürler
  const y = S.multiSonuc.rt.yontemler[mcmpState.method];
  const rps = MRP.filter(rp => (S.multiSonuc.rt.yontemler[mcmpState.method]?.hidrograflar || {})[rp]);
  return (mcmpState.tab === "pik") ? MRP : (rps.length ? rps : MRP);
}
function renderMcmp() {
  const opts = mcmpRpOptions();
  if (!opts.includes(mcmpState.rp)) mcmpState.rp = opts.includes("100") ? "100" : opts[0];
  $("mcmpRP").innerHTML = opts.map(rp => `<option value="${rp}" ${rp === mcmpState.rp ? "selected" : ""}>Q${rp}</option>`).join("");
  document.querySelector(".mcmp-method").style.display = mcmpState.tab === "bilesen" ? "" : "none";
  if (mcmpState.tab === "bilesen") renderMcmpBilesen();
  else if (mcmpState.tab === "pik") renderMcmpPik();
  else renderMcmpHidro();
}

function _mkChart(datasets, title, parsing) {
  if (mcmpChart) mcmpChart.destroy();
  mcmpChart = new Chart($("mcmpChart"), {
    type: parsing === "bar" ? "bar" : "line",
    data: parsing === "bar" ? datasets : { datasets },
    options: {
      animation: false, maintainAspectRatio: false, parsing: parsing === "bar" ? undefined : false,
      plugins: { legend: { position: "bottom", display: parsing !== "bar" }, title: { display: true, text: title } },
      scales: parsing === "bar"
        ? { y: { title: { display: true, text: "Q (m³/s)" }, beginAtZero: true } }
        : { x: { type: "linear", title: { display: true, text: "T (saat)" } }, y: { title: { display: true, text: "Q (m³/s)" }, beginAtZero: true } },
    },
  });
}

// Bileşenler: ara + ötelenmiş membalar + mansap (toplam), seçili yöntem + tekerrür
function renderMcmpBilesen() {
  const { rt, md } = S.multiSonuc, m = mcmpState.method, rp = mcmpState.rp;
  const y = rt.yontemler[m], b = y.bilesenler[rp], dt = y.dt, shift = y.shift_adim;
  const ds = [];
  ds.push({ label: "Ara havza", data: b.ara_h.map((v, i) => ({ x: i * dt, y: v })), borderColor: "#2a9d8f", borderWidth: 1.6, pointRadius: 0, tension: .25 });
  b.memba_hs.forEach((uh, k) => ds.push({
    label: `Memba ${k + 1} (ötelenmiş ${fmt(md.ara.Tc_saat, 1)} sa)`,
    data: uh.map((v, i) => ({ x: (i + shift) * dt, y: v })),
    borderColor: "#1e88e5", borderWidth: 1.4, borderDash: [5, 3], pointRadius: 0, tension: .25,
  }));
  ds.push({ label: "MANSAP (toplam)", data: y.hidrograflar[rp].map((v, i) => ({ x: i * dt, y: v })), borderColor: "#c73e3a", borderWidth: 2.2, pointRadius: 0, tension: .25 });
  _mkChart(ds, `${M_LABEL[m]} — Q${rp}: bileşenler ve süperpozisyon`);

  // koordinat tablosu (additif döküm): T | Ara | Memba_k(ötel.) | Mansap
  const comb = y.hidrograflar[rp];
  let h = `<h3 class="res">Koordinatlar (Q${rp}, ${M_LABEL[m]})</h3>
    <button id="btnMcmpCsv" class="small-btn">⬇ CSV</button>
    <table class="tbl"><tr><th>T (sa)</th><th>Ara</th>` +
    b.memba_hs.map((_, k) => `<th>Memba ${k + 1}↦</th>`).join("") + `<th>Mansap</th></tr>`;
  const rows = [];
  for (let i = 0; i < comb.length; i++) {
    const ara = b.ara_h[i] ?? "";
    const mem = b.memba_hs.map(uh => (i - shift >= 0 && i - shift < uh.length) ? uh[i - shift] : 0);
    rows.push([(i * dt).toFixed(1), ara === "" ? "" : (+ara).toFixed(2), ...mem.map(v => v.toFixed(2)), comb[i].toFixed(2)]);
    h += `<tr><td>${fmt(i * dt, 1)}</td><td>${ara === "" ? "—" : fmt(ara, 2)}</td>` +
      mem.map(v => `<td>${fmt(v, 2)}</td>`).join("") + `<td><b>${fmt(comb[i], 2)}</b></td></tr>`;
  }
  h += `</table>`;
  $("mcmpTable").innerHTML = h;
  $("btnMcmpCsv").onclick = () => {
    const head = ["T(sa)", "Ara", ...b.memba_hs.map((_, k) => "Memba" + (k + 1) + "_otel"), "Mansap"];
    download(`bilesen_Q${rp}_${m}.csv`, [head, ...rows].map(r => r.join(";")).join("\n"));
  };
}

// Yöntem pik: seçili tekerrürde yöntemler bar + yöntem×tekerrür tablo
function renderMcmpPik() {
  const { rt, methods } = S.multiSonuc, rp = mcmpState.rp;
  const labels = methods.map(m => M_LABEL[m]);
  const data = methods.map(m => (rt.yontemler[m].pikler || {})[rp] ?? null);
  _mkChart({ labels, datasets: [{ label: `Q${rp} mansap piki`, data, backgroundColor: methods.map(m => M_COLORS[m]) }] },
    `Mansap Q${rp} pik debileri (öteleme sonrası)`, "bar");
  let h = `<h3 class="res">Mansap Pikleri — yöntem × tekerrür (m³/s)</h3>
    <table class="tbl"><tr><th>Yöntem</th>` + MRP.map(t => `<th>Q${t}</th>`).join("") + `</tr>`;
  methods.forEach(m => {
    const p = rt.yontemler[m].pikler || {};
    h += `<tr><td style="border-left:4px solid ${M_COLORS[m]}">${M_LABEL[m]}</td>` +
      MRP.map(t => `<td class="${t === rp ? "max" : ""}">${p[t] == null ? "—" : fmt(p[t], 1)}</td>`).join("") + `</tr>`;
  });
  h += `</table><div class="small">Mockus/Rasyonel üçgen hidrografla ötelenmiştir. Rasyonel'de OET yoktur.</div>`;
  $("mcmpTable").innerHTML = h;
}

// Yöntem hidrograf: seçili tekerrürde yöntemlerin mansap hidrografları üst üste + koordinat
function renderMcmpHidro() {
  const { rt, methods } = S.multiSonuc, rp = mcmpState.rp;
  const ds = [];
  const series = [];
  methods.forEach(m => {
    const y = rt.yontemler[m]; const arr = (y.hidrograflar || {})[rp]; if (!arr) return;
    const dt = y.dt, pts = arr.map((v, i) => ({ x: i * dt, y: v }));
    ds.push({ label: M_LABEL[m], data: pts, borderColor: M_COLORS[m], borderWidth: 1.8, pointRadius: 0, tension: .25 });
    series.push({ m, pts });
  });
  _mkChart(ds, `Mansap Q${rp} taşkın hidrografları — yöntem karşılaştırması`);
  // koordinat tablosu: ortak zaman ekseni (1 sa) interpolasyon
  const maxT = Math.max(...series.map(s => s.pts[s.pts.length - 1].x), 0);
  const step = maxT > 60 ? 2 : 1;
  let h = `<h3 class="res">Koordinatlar (Q${rp})</h3><button id="btnMcmpCsv2" class="small-btn">⬇ CSV</button>
    <table class="tbl"><tr><th>T (sa)</th>` + series.map(s => `<th>${M_LABEL[s.m]}</th>`).join("") + `</tr>`;
  const rows = [];
  for (let t = 0; t <= maxT + 1e-9; t += step) {
    const vals = series.map(s => cmpInterp(s.pts, t));
    rows.push([t.toFixed(1), ...vals.map(v => v == null ? "" : v.toFixed(2))]);
    h += `<tr><td>${fmt(t, 1)}</td>` + vals.map(v => `<td>${v == null ? "—" : fmt(v, 2)}</td>`).join("") + `</tr>`;
  }
  h += `</table>`;
  $("mcmpTable").innerHTML = h;
  $("btnMcmpCsv2").onclick = () => {
    const head = ["T(sa)", ...series.map(s => M_LABEL[s.m])];
    download(`mansap_hidrograf_Q${rp}.csv`, [head, ...rows].map(r => r.join(";")).join("\n"));
  };
}

function exportMultiCsv() {
  const { rt, methods } = S.multiSonuc;
  const rows = [["Yontem", ...MRP.map(rp => "Q" + rp)]];
  methods.forEach(m => {
    const y = rt.yontemler[m]; if (!y) return;
    rows.push([M_LABEL[m], ...MRP.map(rp => y.pikler[rp] == null ? "" : y.pikler[rp].toFixed(2))]);
  });
  download("mansap_pikleri_yontemler.csv", rows.map(r => r.join(";")).join("\n"));
}

function showMultiChart(method) {
  const y = S.multiSonuc.rt.yontemler[method];
  if (!y) return;
  $("chartwrap").classList.remove("hidden");
  $("chartDur").innerHTML = `<option>${M_LABEL[method]} — mansap hidrografları (öteleme sonrası)</option>`;
  $("chartDur").onchange = null;
  const colors = { "2": "#9db5b2", "5": "#64b5aa", "10": "#2a9d8f", "25": "#d9a441", "50": "#e07b3a", "100": "#c73e3a", "OET": "#5e2d48" };
  const dt = y.dt || 0.5;
  const rps = MRP.filter(rp => y.hidrograflar[rp]);
  const ds = rps.map(rp => ({ label: "Q" + rp, data: y.hidrograflar[rp], borderColor: colors[rp], borderWidth: 1.6, pointRadius: 0, tension: .25 }));
  const n = Math.max(...rps.map(rp => y.hidrograflar[rp].length));
  const labels = Array.from({ length: n }, (_, i) => (i * dt).toFixed(1));
  if (chart) chart.destroy();
  chart = new Chart($("chart"), {
    type: "line", data: { labels, datasets: ds },
    options: {
      animation: false, maintainAspectRatio: false,
      scales: { x: { title: { display: true, text: "T (saat)" } }, y: { title: { display: true, text: "Q (m³/s)" }, beginAtZero: true } },
      plugins: { legend: { position: "bottom", labels: { boxWidth: 18 } } },
    },
  });
}

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


function onMultiPolyClick(p) {
  if (!p) return;
  if (p.kind === "memba") {
    const i = +p.i || 0;
    if (!confirm(`Memba ${i + 1} havzasını silmek istiyor musunuz? Ara havza yeniden hesaplanacak; bu membaya bağlı sonuçlar silinecek.`)) return;
    S.multi.membalar.splice(i, 1);
    S.multiSonuc = null; $("multiResults").innerHTML = "";
    invalidateMultiSolve();
    multiLayers.poly.clearLayers();
    renderMultiPoints();
    if (S.multi.membalar.length) $("btnSolveDelin").click();   // ara havzayı yeniden çöz
    else setStatus("multiStatus", "Memba silindi. En az bir memba ekleyip tekrar çözün.", "");
  } else if (p.kind === "ara") {
    if (!confirm("Ara havza mansap−membalardan otomatik türetilir, tek başına silinemez. Tüm çok parçalı çözümü temizlemek ister misiniz?")) return;
    S.multiMd = null; S.multiSonuc = null;
    multiLayers.poly.clearLayers(); $("multiResults").innerHTML = "";
    invalidateMultiSolve();
    setStatus("multiStatus", "Çok parçalı çözüm temizlendi.", "");
  }
}

$("btnDelete").onclick = async () => {
  const ad = ($("projList").value || $("projName").value).trim();
  if (!ad) return alert("Silinecek projeyi listeden seçin veya adını girin");
  if (!confirm(`"${ad}" projesi kalıcı olarak silinsin mi?`)) return;
  const r = await fetch("/api/project/" + encodeURIComponent(ad), { method: "DELETE" });
  if (!r.ok) { const j = await r.json().catch(() => ({})); return alert("Silinemedi: " + (j.detail || r.statusText)); }
  await loadProjects();
  $("projList").value = "";
  if ($("projName").value.trim() === ad) $("projName").value = "";
  alert(`"${ad}" silindi`);
};

$("btnSave").onclick = async () => {
  const ad = $("projName").value.trim();
  if (!ad) return alert("Proje adı girin");
  const fields = {};
  ["inpA", "inpL", "inpLc", "inpRegion", "inpQbaz", "inpCN2", "inpCN3", "inpSoil",
   "inpDplv", "karTemps", "karA", "karH", "karHist", "inpC100", "inpUs",
   "inpCt", "inpCp", "inpW50", "inpW75", "inpYald"]
    .forEach(id => fields[id] = $(id).value);
  // infoLayers/rasterLayers içinde Leaflet katman nesneleri var; bunlar haritaya
  // geri başvurduğu için JSON.stringify "circular structure" ile patlar. Raster
  // altlıklar zaten sunucuda duruyor ve açılışta /api/raster-layers ile geliyor.
  const durumS = { ...S, sonuc: null, infoLayers: [], rasterLayers: [] };
  await api("/api/project/save", { ad, durum: { S: durumS, fields } });
  loadProjects();
  alert("Kaydedildi");
};
async function loadProjects() {
  const r = await api("/api/project/list");
  const sel = $("projList");
  sel.innerHTML = `<option value="">— yükle —</option>` +
    r.projeler.map(p => `<option>${p}</option>`).join("");
}
$("projList").onchange = async () => {
  const ad = $("projList").value;
  if (!ad) return;
  const d = await api("/api/project/load/" + encodeURIComponent(ad));
  // haritada duran canlı katman nesneleri kayda girmez; yüklemede korunmalı
  const infoY = S.infoLayers, rasterY = S.rasterLayers;
  Object.assign(S, d.S);
  S.infoLayers = infoY; S.rasterLayers = rasterY;
  Object.entries(d.fields).forEach(([id, v]) => { if ($(id)) $(id).value = v; });
  $("projName").value = ad;
  if (S.dplvManual === undefined) {
    const hasOldPlv = !!(d.S && d.S.dplvValues) || !!(d.fields && d.fields.inpDplv != null && String(d.fields.inpDplv) !== "");
    S.dplvManual = hasOldPlv ? true : false;
  }
  if (S.dplvAuto === undefined) S.dplvAuto = null;
  if (S.dplvValues === undefined) S.dplvValues = null;
  if (!S.dplvList) { try { await loadDplv(); } catch (e) {} }
  renderKotlar();
  renderRainTable();
  renderDplvGrid();
  updatePlvAutoInfo();
  // kayıtta varsa CORINE dökümü ve Adım 4'teki C bloğu geri gelir
  if (S.cnSonuc) renderCnSonuc(S.cnSonuc);
  updateComputeReady();
  if (S.havza) {
    layers.havza.clearLayers(); layers.havza.addData(S.havza);
    layers.dere.clearLayers(); if (S.dere) layers.dere.addData(S.dere);
    layers.kanal.clearLayers(); if (S.kanal) layers.kanal.addData(S.kanal);
    map.fitBounds(layers.havza.getBounds());
  }
};
loadProjects();
