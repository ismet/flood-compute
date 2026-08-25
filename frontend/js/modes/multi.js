/**
 * @fileoverview Ara havza (multi) — noktalar, Qbaz, solve orchestration + reRouteMulti.
 * @module modes/multi
 * Owns: S.multi, S.multiMd, S.multiQbazVals, S.multiSonuc, S.multiShowRes (shared with multi-sonuc); multiLayers
 * Exports: multiLayers, invalidateMultiSolve, renderMultiPoints, updateMultiShared, reRouteMulti
 * Notes:
 *  - Allowed pulls (§3.1): multi→dplv (dplvRatios), multi→multi-sonuc
 *  - Rank 2 (modes).
 */

import { S } from "../core/state.js";
import { api } from "../core/api.js";
import { fmt, _esc } from "../core/format.js";
import { $, setStatus } from "../ui/dom.js";
import { map } from "../map/init.js";
import { dplvRatios } from "../wizard/dplv.js";
import { renderMultiResults } from "./multi-sonuc.js";

/* ================= ARA HAVZA (ÇOK PARÇALI) ================= */
S.multi = { mansap: null, membalar: [], place: null };
const multiLayers = {
  poly: L.geoJSON(null, {
    style: (f) => ({ color: (f.properties && f.properties.c) || "#7b1fa2", weight: 2, fillOpacity: 0.12 }),
    onEachFeature: (f, layer) => {
      const p = f.properties || {};
      layer.on("click", () => onMultiPolyClick(p));
      layer.bindTooltip(
        p.kind === "memba"
          ? `🗑 Memba ${(+p.i || 0) + 1} havzasını sil (tıkla)`
          : "Ara havza — çözümü temizlemek için tıkla",
        { sticky: true },
      );
    },
  }).addTo(map),
  pts: L.layerGroup().addTo(map),
};
multiLayers.poly.remove();
multiLayers.pts.remove(); // varsayılan gizli

// 1) Ortak veri durumu (istasyon + yağış) — Adım 3'ten (birleşik) paylaşılır
function updateMultiShared() {
  const nSt = (S.istasyonlar || []).length;
  const nRain = S.rainValues
    ? Object.values(S.rainValues).filter((v) => v && v.slice(0, 6).every((x) => x != null)).length
    : 0;
  const ok = nSt > 0 && nRain > 0;
  $("multiShared").innerHTML = ok
    ? `✓ İstasyonlar: ${nSt} yüklü — Yağış: ${nRain} istasyon dolu. (Değiştirmek için “Tek Havza” → Adım 3.)`
    : `⚠ Eksik: ${nSt ? "" : "istasyon (Adım 3) "}${nRain ? "" : "yağış (Adım 3) "} — “Tek Havza” → Adım 3’ü doldurun.`;
  $("multiShared").className = "small " + (ok ? "" : "err");
}
function selectedMethods() {
  return Array.from(document.querySelectorAll(".mmethod:checked")).map((x) => x.dataset.m);
}

$("btnAddMansap").onclick = () => {
  S.multi.place = "mansap";
  multiHint("Haritada MANSAP (çıkış) noktasına tıklayın");
};
$("btnAddMemba").onclick = () => {
  S.multi.place = "memba";
  multiHint("Haritada bir MEMBA (üst havza çıkışı) noktasına tıklayın");
};
function multiHint(msg) {
  setStatus("multiStatus", msg, "");
  map.getContainer().style.cursor = "crosshair";
}

function multiAddPoint(latlng) {
  const p = { lat: +latlng.lat.toFixed(6), lon: +latlng.lng.toFixed(6) };
  if (S.multi.place === "mansap") {
    S.multi.mansap = p;
    S.multi.mansapAuto = false;
  } else S.multi.membalar.push(p);
  S.multi.place = null;
  map.getContainer().style.cursor = "";
  setStatus("multiStatus", "", "");
  invalidateMultiSolve();
  renderMultiPoints();
}
function invalidateMultiSolve() {
  S.multiMd = null;
  S.multiRes = {}; // memba indeksleri değişebilir; hazne atamalarını düşür
  S.multiQbazVals = {}; // aynı nedenle elle girilen baz akımları da
  const b = $("btnSolveCompute");
  if (b) b.disabled = true;
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
  $("multiPoints")
    .querySelectorAll("button")
    .forEach(
      (b) =>
        (b.onclick = () => {
          if (b.dataset.t === "mansap") {
            S.multi.mansap = null;
            S.multi.mansapAuto = false;
          } else S.multi.membalar.splice(+b.dataset.i, 1);
          invalidateMultiSolve();
          renderMultiPoints();
        }),
    );
  drawMultiPoints();
}

function drawMultiPoints() {
  multiLayers.pts.clearLayers();
  if (S.multi.mansap) L.marker([S.multi.mansap.lat, S.multi.mansap.lon]).addTo(multiLayers.pts).bindTooltip("Mansap");
  S.multi.membalar.forEach((m, i) =>
    L.circleMarker([m.lat, m.lon], { radius: 6, color: "#1e88e5", fillOpacity: 0.8 })
      .addTo(multiLayers.pts)
      .bindTooltip("Memba " + (i + 1)),
  );
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
  if (!md) {
    box.innerHTML = "";
    return;
  }
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
  md.membalar.forEach((mb, i) => (h += satir("m" + i, "Memba " + (i + 1), mb)));
  h += satir("ara", "Ara havza", md.ara);
  h += `</table><div class="small" id="qbazToplam"></div>`;
  box.innerHTML = h;
  const guncelle = () => {
    S.multiQbazVals = {};
    box.querySelectorAll(".qbaz-cell").forEach((inp) => {
      if (inp.value !== "") S.multiQbazVals[inp.id.slice(3)] = +inp.value;
    });
    let t = qbazDegeri("ara", md.ara, aM);
    md.membalar.forEach((mb, i) => (t += qbazDegeri("m" + i, mb, aM)));
    $("qbazToplam").textContent =
      `Mansapta toplanacak baz akım: ${t.toFixed(2)} m³/s (girilen mansap toplamı: ` +
      `${(+$("multiQbaz").value || 0).toFixed(2)} m³/s)`;
  };
  box.querySelectorAll(".qbaz-cell").forEach((inp) => inp.addEventListener("input", guncelle));
  // atama ile bağla — addEventListener her render'da birikirdi
  $("multiQbaz").oninput = () => renderMultiQbaz();
  guncelle();
}

async function autoComputeSub(sub, qbaz, methods) {
  const w = await api("/api/thiessen", {
    havza_geojson: sub.havza_geojson,
    istasyonlar: S.istasyonlar,
    min_agirlik: Math.max(0, (+$("inpMinW").value || 0) / 100),
  });
  const act = w.sonuc.filter((t) => t.agirlik > 0);
  const T = [2, 5, 10, 25, 50, 100];
  const P24 = {};
  let OET = 0,
    oetOk = true;
  T.forEach((tt, j) => {
    P24[tt] = act.reduce((a, t) => {
      const rv = S.rainValues[t.name];
      return a + (rv ? t.agirlik * rv[j] : 0);
    }, 0);
  });
  act.forEach((t) => {
    const rv = S.rainValues[t.name];
    if (!rv || rv[6] == null) oetOk = false;
    else OET += t.agirlik * rv[6];
  });
  const cn = await api("/api/cn", { havza_geojson: sub.havza_geojson, zemin_grubu: $("multiSoil").value });
  const girdi = {
    ad: "alt",
    A_km2: sub.alan_km2,
    L_km: sub.L_km,
    Lc_km: sub.Lc_km,
    CN2: cn.CN2,
    CN3: cn.CN3,
    region: (sub.yzd_bolge && sub.yzd_bolge.bolge) || "B",
    elevations: sub.kotlar,
    Qbaz: qbaz,
    P24,
    P24_OET: oetOk ? OET : 0,
    dplv_ratios: dplvRatios(),
  };
  const snyderOn = methods.includes("snyder");
  // rasyonel C: alt havzanın KENDİ CORINE dökümünden türet; yoksa 0.45'e düş
  const c100 = (cn.rasyonel_C && cn.rasyonel_C.C_orta) || 0.45;
  const res = await api("/api/compute", {
    girdi,
    rasyonel: methods.includes("rasyonel"),
    c100,
    snyder: snyderOn,
    snyder_par: snyderOn ? { Ct: +$("multiCt").value || 1.55, Cp: +$("multiCp").value || 0.6 } : null,
  });
  return { girdi, res, cn, thiessen: act };
}

// ① Havzaları çöz (delineate + çiz + alt havza tablosu)
$("btnSolveDelin").onclick = async () => {
  try {
    if (!S.multi.mansap) throw new Error("Mansap noktası seçin");
    if (!S.multi.membalar.length) throw new Error("En az bir memba noktası ekleyin");
    setStatus(
      "multiStatus",
      "Ara havza çıkarılıyor… DEM işleniyor; havzalar büyükse " + "birkaç dakika sürebilir.",
      "loading",
    );
    const md = await api("/api/multi-delineate", {
      mansap: S.multi.mansap,
      membalar: S.multi.membalar,
      river_km2: +$("multiRivThr").value || 1,
      snap_m: +$("inpSnap").value || 500,
      dem_source: $("inpDem").value,
    });
    multiLayers.poly.clearLayers();
    const addPoly = (gj, c, meta) =>
      multiLayers.poly.addData({
        type: "Feature",
        properties: { c, ...(meta || {}) },
        geometry: JSON.parse(JSON.stringify(gj)),
      });
    addPoly(md.ara.havza_geojson, "#2a9d8f", { kind: "ara" });
    md.membalar.forEach((mb, i) => addPoly(mb.havza_geojson, "#1e88e5", { kind: "memba", i }));
    map.fitBounds(multiLayers.poly.getBounds(), { padding: [30, 30] });
    S.multiMd = md;
    let h = `<h3 class="res">Alt Havzalar (çıkarıldı)</h3><table class="tbl">
      <tr><th>Havza</th><th>A (km²)</th><th>L (km)</th><th>Lc</th><th>Bölge</th><th>Tc (sa)</th></tr>`;
    md.membalar.forEach(
      (mb, i) =>
        (h += `<tr><td>Memba ${i + 1}</td><td>${fmt(mb.alan_km2, 2)}</td><td>${fmt(mb.L_km, 2)}</td><td>${fmt(mb.Lc_km, 2)}</td><td>${(mb.yzd_bolge || {}).bolge || "—"}</td><td>${fmt(mb.Tc_saat, 2)}</td></tr>`),
    );
    h += `<tr><td><b>Ara havza</b></td><td>${fmt(md.ara.alan_km2, 2)}</td><td>${fmt(md.ara.L_km, 2)}</td><td>${fmt(md.ara.Lc_km, 2)}</td><td>${(md.ara.yzd_bolge || {}).bolge || "—"}</td><td><b>${fmt(md.ara.Tc_saat, 2)}</b></td></tr>`;
    h += `<tr><td colspan="6"><b>Mansap:</b> A=${fmt(md.mansap.alan_km2, 2)} km² | öteleme = ara Tc = ${fmt(md.ara.Tc_saat, 2)} sa</td></tr></table>`;
    if (md.uyari && md.uyari.length) h += `<div class="small err">⚠ ${md.uyari.join("; ")}</div>`;
    $("multiResults").innerHTML = h;
    if (!$("multiLag").value && md.ara.Tc_saat) $("multiLag").value = md.ara.Tc_saat.toFixed(2);
    renderMultiQbaz();
    $("btnSolveCompute").disabled = false;
    setStatus("multiStatus", "Havzalar çıkarıldı. Şimdi ② Hesapla ve Ötele.", "ok");
  } catch (e) {
    setStatus("multiStatus", "Hata: " + e.message, "err");
    $("btnSolveCompute").disabled = true;
  }
};

// ② Hesapla ve ötele (seçili yöntemlerle her alt havza + routing)
$("btnSolveCompute").onclick = async () => {
  try {
    if (!S.multiMd) throw new Error("Önce ① Havzaları Çöz");
    if (!S.istasyonlar || !S.istasyonlar.length) throw new Error("İstasyon yok — Tek Havza → Adım 3");
    if (!S.rainValues || !Object.keys(S.rainValues).length) throw new Error("Yağış yok — Tek Havza → Adım 3");
    const methods = selectedMethods();
    if (!methods.length) throw new Error("En az bir yöntem seçin");
    const md = S.multiMd,
      aMansap = md.mansap.alan_km2;
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
      ara_sonuc: araC.res,
      memba_sonuclari: membaC.map((x) => x.res),
      lag_saat: +$("multiLag").value || md.ara.Tc_saat,
      yontemler: methods,
      rezervuarlar: rez0.some(Boolean) ? rez0 : null,
    });
    S.multiSonuc = { md, araC, membaC, rt, methods };
    renderMultiResults();
    setStatus("multiStatus", "Tamamlandı", "ok");
  } catch (e) {
    setStatus("multiStatus", "Hata: " + e.message, "err");
  }
};

async function reRouteMulti() {
  if (!S.multiSonuc) return;
  const { md, araC, membaC, methods } = S.multiSonuc;
  const rez = membaC.map((_, i) => (S.multiRes && S.multiRes[i]) || null);
  const rt = await api("/api/route", {
    ara_sonuc: araC.res,
    memba_sonuclari: membaC.map((x) => x.res),
    lag_saat: +$("multiLag").value || md.ara.Tc_saat,
    yontemler: methods,
    rezervuarlar: rez.some(Boolean) ? rez : null,
  });
  S.multiSonuc.rt = rt;
  renderMultiResults();
}

function onMultiPolyClick(p) {
  if (!p) return;
  if (p.kind === "memba") {
    const i = +p.i || 0;
    if (
      !confirm(
        `Memba ${i + 1} havzasını silmek istiyor musunuz? Ara havza yeniden hesaplanacak; bu membaya bağlı sonuçlar silinecek.`,
      )
    )
      return;
    S.multi.membalar.splice(i, 1);
    S.multiSonuc = null;
    $("multiResults").innerHTML = "";
    invalidateMultiSolve();
    multiLayers.poly.clearLayers();
    renderMultiPoints();
    if (S.multi.membalar.length)
      $("btnSolveDelin").click(); // ara havzayı yeniden çöz
    else setStatus("multiStatus", "Memba silindi. En az bir memba ekleyip tekrar çözün.", "");
  } else if (p.kind === "ara") {
    if (
      !confirm(
        "Ara havza mansap−membalardan otomatik türetilir, tek başına silinemez. Tüm çok parçalı çözümü temizlemek ister misiniz?",
      )
    )
      return;
    S.multiMd = null;
    S.multiSonuc = null;
    multiLayers.poly.clearLayers();
    $("multiResults").innerHTML = "";
    invalidateMultiSolve();
    setStatus("multiStatus", "Çok parçalı çözüm temizlendi.", "");
  }
}

// Harita tıklaması — memba/mansap noktası ekleme (stage5: gerçek handler)
map.on("click", (ev) => {
  if (!S.multi || !S.multi.place) return;
  multiAddPoint(ev.latlng);
});

export {
  multiLayers,
  updateMultiShared,
  selectedMethods,
  multiAddPoint,
  invalidateMultiSolve,
  renderMultiPoints,
  drawMultiPoints,
  qbazOran,
  qbazDegeri,
  renderMultiQbaz,
  autoComputeSub,
  reRouteMulti,
  onMultiPolyClick,
};
