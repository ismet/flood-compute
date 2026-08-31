/**
 * @fileoverview Havza çıkarım akışı — pick/delineate/import/applyBasinResult/adayKanallar.
 * @module wizard/havza
 * Owns: S.outlet, S.havza, S.kotlar, S.dere, S.kanal, S.yzdBolge, S.sonuc/S.girdi resetleri, S.dplv* resetleri;
 *       layers.havza, layers.havzaAgi, layers.havzaMgm OWNER-CREATED (registry-bag)
 * Exports: importBasinFiles, applyBasinResult, renderAdayKanallar, havzaYakinIstasyonlariGoster, havzaIstasyonlariniTemizle
 * Notes:
 *  - Allowed pull-imports (§3.1): havza→{cn,dplv,steps,hesap,yagis-katman}
 *    (zeminGrubunuBelirle, autoSelectPLV, markDone/updateComputeReady, updateSnyderW,
 *    havzaOrtalamasiGoster — çıkarım bitince havza ortalaması kendiliğinden hesaplanır)
 *  - Yakın istasyonlar: delineate/import sonrası AGİ (/api/agi-havza) ve MGM (/api/mgm) otomatik gösterilir (Frekans benzeri)
 *  - Observer publish: delineate sonrası _notifyHavzaChanged() (su dinler)
 *  - setOnHavzaClick(fn) ile kök onHavzaClick'i kaydeder.
 *  Rank 2 (wizard).
 */

import { S, _notifyHavzaChanged } from "../core/state.js";
import { _esc } from "../core/format.js";
import { $, setStatus } from "../ui/dom.js";
import { api } from "../core/api.js";
import { map, layers, getOnHavzaClick } from "../map/init.js";
import { renderKotlar, zeminGrubunuBelirle } from "./cn.js";
import { autoSelectPLV } from "./dplv.js";
import { markDone, updateComputeReady } from "./steps.js";
import { updateSnyderW } from "./hesap.js";
import { havzaOrtalamasiGoster } from "../map/yagis-katman.js";
import { agiCircleMarker, mgmTriangleIcon, STATION_TOOLTIP_AGI, STATION_TOOLTIP_MGM } from "../map/station-markers.js";

// layers.havza OWNER-CREATED (registry-bag)
if (layers.havza) {
  try {
    map.removeLayer(layers.havza);
  } catch (e) {}
}
layers.havza = L.geoJSON(null, {
  style: { color: "#0d5c63", weight: 2, fillOpacity: 0.08 },
  onEachFeature: (f, layer) => {
    layer.on("click", () => {
      const fn = typeof getOnHavzaClick === "function" ? getOnHavzaClick() : null;
      if (fn) fn();
    });
    layer.bindTooltip("🗑 Havzayı sil (tıkla) — parametre, yağış, hidrograf dahil", { sticky: true });
  },
}).addTo(map);

// Havza yakınındaki AGİ/MGM istasyonları (Frekans benzeri, salt görselleştirme)
if (layers.havzaAgi) {
  try {
    map.removeLayer(layers.havzaAgi);
  } catch (e) {}
}
layers.havzaAgi = L.layerGroup().addTo(map);
if (layers.havzaMgm) {
  try {
    map.removeLayer(layers.havzaMgm);
  } catch (e) {}
}
layers.havzaMgm = L.layerGroup().addTo(map);

/* AGİ mavi daire / MGM kırmızı üçgen — style.css --istasyon-* ile senkron */

export async function havzaYakinIstasyonlariGoster() {
  if (!S.havza) return;
  const geom = S.havza.features ? S.havza.features[0].geometry : S.havza.geometry || S.havza;
  layers.havzaAgi.clearLayers();
  layers.havzaMgm.clearLayers();
  try {
    const agiP = api("/api/agi-havza", { geometri: geom, tampon_derece: 0.25, en_az_yil: 10, kurum: "" });
    let mgmP = null;
    try {
      const b = layers.havza.getBounds();
      const pad = 0.25;
      const q = new URLSearchParams({
        bati: String(b.getWest() - pad),
        guney: String(b.getSouth() - pad),
        dogu: String(b.getEast() + pad),
        kuzey: String(b.getNorth() + pad),
        en_az_yil: "10",
      });
      mgmP = api("/api/mgm?" + q.toString());
    } catch (e) {
      mgmP = Promise.resolve({ istasyonlar: [] });
    }
    const [agiR, mgmR] = await Promise.all([agiP, mgmP]);
    (agiR.istasyonlar || []).forEach((s) => {
      if (s.enlem == null || s.boylam == null) return;
      const inside = s.icinde !== false;
      const m = agiCircleMarker([s.enlem, s.boylam], { inside });
      m.bindTooltip(`${_esc(s.kod)} — ${_esc(s.ad || "")} (${s.yil_sayisi} yıl) — AGİ`, STATION_TOOLTIP_AGI);
      m.bindPopup(
        `<b>${_esc(s.kod)}</b> — ${_esc(s.ad || "")}<br>${_esc(s.kurum || "")} · ${s.yil_sayisi} yıl (${s.ilk_yil}–${s.son_yil})` +
          (s.yagis_alani ? `<br>Yağış alanı: ${s.yagis_alani} km²` : "") +
          `<br><span class="small">Frekans sekmesinde analiz için seçin</span>`,
      );
      m.addTo(layers.havzaAgi);
    });
    (mgmR.istasyonlar || []).forEach((s) => {
      const lat = s.enlem ?? s.lat;
      const lon = s.boylam ?? s.lon;
      if (lat == null || lon == null) return;
      const m = L.marker([lat, lon], { icon: mgmTriangleIcon({ inside: true }) });
      m.bindTooltip(`${_esc(s.kod || s.no || "")} — ${_esc(s.ad || s.istasyon || "")} (${s.yil_sayisi || "?"} yıl) — MGM`, STATION_TOOLTIP_MGM);
      m.bindPopup(
        `<b>${_esc(s.kod || s.no || "")}</b> — ${_esc(s.ad || s.istasyon || "")}<br>MGM · ${s.yil_sayisi || "?"} yıl` +
          `<br><span class="small">Yağış sekmesinde Thiessen için kullanılır</span>`,
      );
      m.addTo(layers.havzaMgm);
    });
  } catch (e) {
    // sessiz geç — istasyon yoksa veya ağ hatası
  }
}
export function havzaIstasyonlariniTemizle() {
  try {
    layers.havzaAgi.clearLayers();
  } catch (e) {}
  try {
    layers.havzaMgm.clearLayers();
  } catch (e) {}
}

document.addEventListener("DOMContentLoaded", () => {
  const d = document.getElementById("inpDem"),
    l = document.getElementById("lblTampon");
  if (!d || !l) return;
  const g = () => l.classList.toggle("hidden", d.value !== "10m");
  d.addEventListener("change", g);
  g();
});
let picking = false;
$("btnPick").onclick = () => {
  picking = !picking;
  $("btnPick").classList.toggle("picking", picking);
  map.getContainer().style.cursor = picking ? "crosshair" : "";
  if (picking) setStatus("delinStatus", "Haritaya tıklayın (Esc ile iptal)");
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && picking) {
    picking = false;
    $("btnPick").classList.remove("picking");
    map.getContainer().style.cursor = "";
    setStatus("delinStatus", "İptal edildi", "");
  }
});
export async function importBasinFiles() {
  const f = $("basinFile").files[0];
  if (!f) {
    setStatus("delinStatus", "Önce havza (poligon) dosyası seçin", "err");
    return;
  }
  const fd2 = $("riverFile").files[0];
  setStatus(
    "delinStatus",
    `“${_esc(f.name)}”${fd2 ? " + “" + _esc(fd2.name) + "”" : ""} okunuyor, parametreler üretiliyor…`,
    "loading",
  );
  try {
    const fd = new FormData();
    fd.append("file", f);
    if (fd2) fd.append("dere_file", fd2);
    const q = `?river_km2=${+$("inpRivThr").value || 1}&dem_source=${encodeURIComponent($("inpDem").value)}`;
    const r = await api("/api/import-basin" + q, fd, true);
    applyBasinResult(r, `İçe aktarıldı: ${_esc(f.name)}${fd2 ? " + " + _esc(fd2.name) : ""}`);
  } catch (e) {
    setStatus("delinStatus", "Hata: " + e.message, "err");
  }
}
$("btnImport").onclick = importBasinFiles;
$("basinFile").onchange = () => {
  if (!$("riverFile").files[0]) importBasinFiles();
};
export function applyBasinResult(r, baslik) {
  S.outlet = r.outlet;
  S.havza = r.havza_geojson;
  S.kotlar = r.kotlar.slice();
  S.mgmDbYakin = null; // yakın MGM listesi havzaya bağlı, yeniden kurulsun
  // aday katmanını temizle (yeni havza için yeniden kurulacak)
  try { if (layers.thiessenAday) layers.thiessenAday.clearLayers(); } catch (e) {}
  try { const el = document.getElementById("thAdaylar"); if (el) el.innerHTML = ""; } catch (e) {}
  S.dplvManual = false;
  S.dplvAuto = null;
  S.dplvValues = null;
  if ("dplvList" in S) delete S.dplvList;
  // önceki hesap artık geçersiz (alan değişti) — overlay gizlenir
  S.sonuc = null;
  S.girdi = null;
  if ($("results")) $("results").innerHTML = "";
  if ($("hesapGrid")) $("hesapGrid").innerHTML = "";
  $("hesapDock")?.classList.add("hidden");
  setStatus("compStatus", "", "");
  // dere/kanal da durumda tutulur: proje kaydında saklansın ve yüklenince geri gelsin
  S.dere = r.dere_geojson || null;
  S.kanal = r.ana_kanal_geojson || null;
  $("inpA").value = r.alan_km2;
  $("inpL").value = r.L_km;
  $("inpLc").value = r.Lc_km;
  try {
    if (typeof updateSnyderW === "function")
      try {
        if (typeof updateSnyderW === "function") updateSnyderW();
      } catch (e) {}
  } catch (e) {}
  layers.havza.clearLayers();
  layers.havza.addData(r.havza_geojson);
  layers.dere.clearLayers();
  if (r.dere_geojson) layers.dere.addData(r.dere_geojson);
  layers.kanal.clearLayers();
  if (r.ana_kanal_geojson) layers.kanal.addData(r.ana_kanal_geojson);
  layers.markers.clearLayers();
  if (r.outlet)
    L.marker([r.outlet.snap_lat ?? r.outlet.lat, r.outlet.snap_lon ?? r.outlet.lon])
      .addTo(layers.markers)
      .bindPopup("Çıkış noktası (DEM'den bulundu)");
  map.fitBounds(layers.havza.getBounds(), { padding: [30, 30] });
  renderKotlar();
  let yzdMsg = "";
  if (r.yzd_bolge && r.yzd_bolge.bolge) {
    S.yzdBolge = r.yzd_bolge;
    $("inpRegion").value = r.yzd_bolge.bolge;
    yzdMsg = `\nYZD bölgesi: ${r.yzd_bolge.bolge} (${_esc(r.yzd_bolge.yontem)}) — otomatik seçildi`;
    $("yzdInfo").textContent = `🌧 Otomatik: ${r.yzd_bolge.bolge} (${_esc(r.yzd_bolge.yontem)})`;
  }
  zeminGrubunuBelirle(); // zemin grubunu da havzadan seç (sessiz varsayılan yok)
  const ia = r.ice_aktarim;
  const detay = ia
    ? `\n${ia.poligon_sayisi} poligon, ${ia.cizgi_sayisi} çizgi okundu` +
      ` | dere ağı: ${r.dere_kaynagi === "ice_aktarim" ? "dosyadan" : "DEM'den türetildi"}` +
      `
L, Lc ve kot profili: ${r.parametre_kaynagi === "dere_agi" ? "içe aktarılan DERE AĞINDAN" : "DEM akış yollarından"}` +
      `\nAlan poligondan (jeodezik); L, Lc ve kotlar DEM'den üretildi (${r.cozunurluk_m} m).`
    : "";
  const uy = (r.uyarilar || []).length ? "\n⚠ " + r.uyarilar.join("\n⚠ ") : "";
  setStatus(
    "delinStatus",
    `${baslik}\nHavza: ${r.alan_km2} km² | L=${r.L_km} km | Lc=${r.Lc_km} km` + detay + yzdMsg + uy,
    uy ? "err" : "ok",
  );
  markDone(1);
  renderAdayKanallar(r);
  updateComputeReady();
  autoSelectPLV();
  havzaOrtalamasiGoster(); // düğme gizli: ortalamayı çıkarım bitince kendiliğinden hesapla
  havzaYakinIstasyonlariGoster();
  // thiessen manuel seçimler korunur (A2): yeni havza için ağırlıkları yeniden hesapla
  if (S.stBase && S.stBase.length) {
    import("./thiessen.js").then((m) => { try { m.recomputeThiessen(); } catch (e) {} }).catch(() => {});
  } else {
    // hiç thiessen yoksa eski poligonlar temizlensin
    try { if (layers.thiessen) layers.thiessen.clearLayers(); } catch (e) {}
  }
  try {
    _notifyHavzaChanged();
  } catch (e) {}
}

export function renderAdayKanallar(r) {
  const el = $("adayKanallar");
  if (!el) return;
  const ad = (r && r.aday_kanallar) || [];
  const secili = r && r.alan_km2;
  // yalnız gerçekten farklı bir seçenek varsa göster (%20'den fazla sapma)
  const digerleri = ad.filter((k) => secili && Math.abs(k.alan_km2 - secili) > 0.2 * secili);
  if (!digerleri.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML =
    `<b>Yakındaki diğer kollar</b> — tıklanan nokta bir yatağın tam üstünde
     değilse havza yanlış kola oturmuş olabilir. Doğrusu bunlardan biriyse tıklayın:<br>` +
    digerleri
      .map(
        (k, i) =>
          `<button class="link-btn" data-aday="${i}" title="Bu kola kenetlenip havzayı yeniden çıkar">
         ${k.alan_km2.toFixed(2)} km² — ${k.mesafe_m.toFixed(0)} m ötede</button>`,
      )
      .join(" · ") +
    `<div class="small" style="color:#8a857e">Şu an seçili: ${(+secili).toFixed(2)} km²
       (${(r.snap_mesafe_m || 0).toFixed(0)} m kenetlendi)</div>`;
  el.querySelectorAll("button[data-aday]").forEach(
    (b) =>
      (b.onclick = async () => {
        const k = digerleri[+b.dataset.aday];
        setStatus(
          "delinStatus",
          `${k.alan_km2.toFixed(2)} km²'lik kola kenetlenip ` + `havza yeniden çıkarılıyor…`,
          "loading",
        );
        el.innerHTML = "";
        try {
          // adayın tam hücresine kenetle: dar yarıçap, başka kola atlamasın
          const r2 = await api("/api/delineate", {
            lat: k.lat,
            lon: k.lon,
            river_km2: +$("inpRivThr").value || 1,
            snap_m: 60,
            dem_source: $("inpDem").value,
          });
          applyBasinResult(r2, "Seçilen kola göre havza çıkarıldı.");
        } catch (e) {
          setStatus("delinStatus", "Hata: " + e.message, "err");
        }
      }),
  );
}

map.on("click", async (ev) => {
  if (!picking) return;
  picking = false;
  $("btnPick").classList.remove("picking");
  map.getContainer().style.cursor = "";
  setStatus(
    "delinStatus",
    "Havza çıkarılıyor… DEM işleniyor: küçük havzada birkaç saniye, " +
      "büyük havzada (binlerce km²) pencere büyütülüp DEM indirildiği için 1–3 dakika sürebilir.",
    "loading",
  );
  try {
    const r = await api("/api/delineate", {
      lat: ev.latlng.lat,
      lon: ev.latlng.lng,
      river_km2: +$("inpRivThr").value || 1,
      snap_m: +$("inpSnap").value || 500,
      dem_source: $("inpDem").value,
      // Beklenen alan verilirse kenetleme "en büyük kol" yerine "alanı buna en
      // yakın kol" der. Kavşakta tıklandığında fark büyük: Beyağaç'ta 24.6 km²
      // yerine doğru kol olan 8.3 km² geliyor ve nokta 477 m değil 78 m kayıyor.
      hedef_alan_km2: +$("inpHedefAlan").value || 0,
      tampon_m: +$("inpTampon").value || 500,
    });
    S.outlet = r.outlet;
    S.havza = r.havza_geojson;
    S.kotlar = r.kotlar.slice();
    S.mgmDbYakin = null;
    try { if (layers.thiessenAday) layers.thiessenAday.clearLayers(); } catch (e) {}
    try { const el = document.getElementById("thAdaylar"); if (el) el.innerHTML = ""; } catch (e) {}
    S.dplvManual = false;
    S.dplvAuto = null;
    S.dplvValues = null;
    if ("dplvList" in S) delete S.dplvList;
    S.sonuc = null;
    S.girdi = null;
    if ($("results")) $("results").innerHTML = "";
    if ($("hesapGrid")) $("hesapGrid").innerHTML = "";
    $("hesapDock")?.classList.add("hidden");
    setStatus("compStatus", "", "");
    S.dere = r.dere_geojson || null;
    S.kanal = r.ana_kanal_geojson || null;
    $("inpA").value = r.alan_km2;
    $("inpL").value = r.L_km;
    $("inpLc").value = r.Lc_km;
    try {
      if (typeof updateSnyderW === "function")
        try {
          if (typeof updateSnyderW === "function") updateSnyderW();
        } catch (e) {}
    } catch (e) {}
    layers.havza.clearLayers();
    layers.havza.addData(r.havza_geojson);
    layers.dere.clearLayers();
    if (r.dere_geojson) layers.dere.addData(r.dere_geojson);
    layers.kanal.clearLayers();
    layers.kanal.addData(r.ana_kanal_geojson);
    layers.markers.clearLayers();
    L.marker([r.outlet.snap_lat, r.outlet.snap_lon]).addTo(layers.markers).bindPopup("Outlet");
    map.fitBounds(layers.havza.getBounds(), { padding: [30, 30] });
    renderKotlar();
    // YZD alansal dağılım bölgesini (A/B/C) otomatik ayarla
    let yzdMsg = "";
    if (r.yzd_bolge && r.yzd_bolge.bolge) {
      S.yzdBolge = r.yzd_bolge;
      $("inpRegion").value = r.yzd_bolge.bolge;
      yzdMsg = `\nYZD bölgesi: ${r.yzd_bolge.bolge} (${_esc(r.yzd_bolge.yontem)}) — otomatik seçildi`;
      const ov = r.yzd_bolge.ortusme;
      const ovTxt = ov
        ? " | örtüşme: " +
          Object.entries(ov)
            .map(([k, v]) => `${k}=${(v * 100).toFixed(0)}%`)
            .join(" ")
        : "";
      $("yzdInfo").textContent = `🌧 Otomatik: ${r.yzd_bolge.bolge} (${_esc(r.yzd_bolge.yontem)})${ovTxt}`;
    }
    zeminGrubunuBelirle(); // zemin grubunu da havzadan seç (sessiz varsayılan yok)
    // teşhis: çözünürlük + kenetleme mesafesi (havza beklenenden küçükse ipucu)
    let dgn = "";
    if (r.cozunurluk_m) dgn += `\nDEM çözünürlüğü: ${r.cozunurluk_m} m`;
    if (r.snap_mesafe_m != null) dgn += ` | kanala kenetleme: ${r.snap_mesafe_m} m`;
    if (r.snap_mesafe_m != null && r.snap_mesafe_m > 0.8 * (+$("inpSnap").value || 500))
      dgn +=
        `\n⚠ Tıklanan nokta kanaldan uzak (${r.snap_mesafe_m} m) — yanlış/küçük bir kola oturmuş olabilir.` +
        ` Havza beklenenden küçükse dere ağına daha yakın tıklayın veya "Kanala kenetleme" değerini artırın.`;
    setStatus(
      "delinStatus",
      `Havza: ${r.alan_km2} km² | L=${r.L_km} km | Lc=${r.Lc_km} km` +
        (r.kenar_uyarisi ? "\n⚠ Havza pencere kenarına değiyor, sonuçları kontrol edin!" : "") +
        dgn +
        yzdMsg,
      "ok",
    );
    markDone(1);
    renderAdayKanallar(r);
    updateComputeReady();
    autoSelectPLV();
    havzaOrtalamasiGoster(); // düğme gizli: ortalamayı çıkarım bitince kendiliğinden hesapla
    havzaYakinIstasyonlariGoster();
    if (S.stBase && S.stBase.length) {
      import("./thiessen.js").then((m) => { try { m.recomputeThiessen(); } catch (e) {} }).catch(() => {});
    } else {
      try { if (layers.thiessen) layers.thiessen.clearLayers(); } catch (e) {}
    }
    try {
      _notifyHavzaChanged();
    } catch (e) {}
  } catch (e) {
    setStatus("delinStatus", "Hata: " + e.message, "err");
  }
});
