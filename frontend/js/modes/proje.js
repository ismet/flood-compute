/**
 * @fileoverview Proje kayıt/yükleme — JSON kaydetme, geri yükleme.
 * @module modes/proje
 * Owns: — (S'ye toptan yazar — yaşayan katmanlar korunur)
 * Exports: loadProjects, buildDurumS, yagisAnahtarlariniGocur
 * Notes:
 *  - Sanctioned wholesale Object.assign(S, d.S) yalnızca restore'da (§3.1).
 *  - Save'da infoLayers/rasterLayers/resMarker canlı Leaflet nesneleri oldukları
 *    için stripped (buildDurumS); yüklemede canlı değerler korunur.
 *  - Stage13: Set serileştirme replacer/reviver (agiBolgesel,stExclude,suSecili).
 *  - Rank 2 (modes) — proje→wizard renders fan-in izinli.
 */

import { S, _notifyHavzaChanged } from "../core/state.js";
import { _esc, istasyonYagisAnahtari } from "../core/format.js";
import { api } from "../core/api.js";
import { $ } from "../ui/dom.js";
import { map, layers } from "../map/init.js";
import { renderKotlar, renderCnSonuc } from "../wizard/cn.js";
import { renderRainTable } from "../wizard/rain.js";
import { renderDplvGrid, updatePlvAutoInfo } from "../wizard/dplv.js";
import { updateComputeReady } from "../wizard/steps.js";

const SET_KEYS = ["agiBolgesel", "stExclude", "stKorumali", "suSecili", "rapFilter", "seciliYontemler"];
function setReplacer(k, v) {
  return v instanceof Set ? { __set: [...v] } : v;
}
function setReviver(k, v) {
  if (v && typeof v === "object" && Array.isArray(v.__set) && SET_KEYS.includes(k)) return new Set(v.__set);
  return v;
}
function reviveSets(obj) {
  SET_KEYS.forEach((k) => {
    const v = obj[k];
    if (v instanceof Set) return;
    if (v && typeof v === "object" && Array.isArray(v.__set)) obj[k] = new Set(v.__set);
    else if (Array.isArray(v)) obj[k] = new Set(v);
    else if (v && typeof v === "object" && Object.keys(v).length === 0) obj[k] = new Set();
  });
}

// Kayda girecek durum kopyası. Canlı Leaflet nesneleri stripped — JSON.stringify
// "circular structure" ile patlar (örn. resMarker'ın Geoman .pm._layer geri
// referansı). sonuc yeniden hesaplanabilir; raster altlıkları sunucudan gelir.
export function buildDurumS() {
  const { dplvList: _deleted, mgmDbYakin: _mgm, rainMeta: _rainMeta, mgmDb: _mgmDb, ...rest } = S;
  return { ...rest, sonuc: null, infoLayers: [], rasterLayers: [], resMarker: null };
}

export function yagisAnahtarlariniGocur(durum = {}) {
  const eski = durum.rainValues;
  if (!eski || typeof eski !== "object") return { ...durum };
  const rainValues = { ...eski };
  const eskiAdlar = new Set();
  const istasyonlar = [durum.thiessen, durum.istasyonlar, durum.stBase, durum.stExtra].flatMap((x) =>
    Array.isArray(x) ? x : [],
  );
  istasyonlar.forEach((s) => {
    if (!s || !s.name || !Object.prototype.hasOwnProperty.call(eski, s.name)) return;
    const anahtar = istasyonYagisAnahtari(s);
    if (!Object.prototype.hasOwnProperty.call(rainValues, anahtar)) {
      rainValues[anahtar] = Array.isArray(eski[s.name]) ? [...eski[s.name]] : eski[s.name];
    }
    eskiAdlar.add(s.name);
  });
  eskiAdlar.forEach((ad) => delete rainValues[ad]);
  return { ...durum, rainValues };
}

$("btnDelete").onclick = async () => {
  const ad = ($("projList").value || $("projName").value).trim();
  if (!ad) return alert("Silinecek projeyi listeden seçin veya adını girin");
  if (!confirm(`"${ad}" projesi kalıcı olarak silinsin mi?`)) return;
  const r = await fetch("/api/project/" + encodeURIComponent(ad), { method: "DELETE" });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    return alert("Silinemedi: " + (j.detail || r.statusText));
  }
  await loadProjects();
  $("projList").value = "";
  if ($("projName").value.trim() === ad) $("projName").value = "";
  alert(`"${ad}" silindi`);
};

$("btnSave").onclick = async () => {
  const ad = $("projName").value.trim();
  if (!ad) return alert("Proje adı girin");
  const fields = {};
  [
    "inpA",
    "inpL",
    "inpLc",
    "inpRegion",
    "inpQbaz",
    "inpCN2",
    "inpCN3",
    "inpSoil",
    "karTemps",
    "karA",
    "karH",
    "karHist",
    "inpC100",
    "inpUs",
    "inpCt",
    "inpCp",
    "inpW50",
    "inpW75",
    "inpYald",
    "inpOetElle",
    "repBolum",
  ].forEach((id) => {
    const el = $(id);
    if (el) fields[id] = el.value;
  });
  const durumS = buildDurumS();
  try {
    const body = JSON.stringify({ ad, durum: { S: durumS, fields } }, setReplacer);
    const r = await fetch("/api/project/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const j = await r.json();
    if (!r.ok || j.hata) throw new Error(j.hata || r.statusText);
    await loadProjects();
    alert("Kaydedildi");
  } catch (e) {
    alert("Kaydedilemedi: " + e.message);
    console.error(e);
  }
};
async function loadProjects() {
  const r = await api("/api/project/list");
  const sel = $("projList");
  sel.innerHTML = `<option value="">— yükle —</option>` + r.projeler.map((p) => `<option>${_esc(p)}</option>`).join("");
}
$("projList").onchange = async () => {
  const ad = $("projList").value;
  if (!ad) return;
  try {
    const resp = await fetch("/api/project/load/" + encodeURIComponent(ad));
    const text = await resp.text();
    if (!resp.ok) {
      let msg = resp.statusText;
      try {
        msg = JSON.parse(text).hata || msg;
      } catch (e) {}
      throw new Error(msg);
    }
    const d = JSON.parse(text, setReviver);
    // haritada duran canlı katman nesneleri kayda girmez; yüklemede korunmalı
    const infoY = S.infoLayers,
      rasterY = S.rasterLayers,
      resM = S.resMarker;
    const kayitDurumu = yagisAnahtarlariniGocur(d.S || {});
    Object.assign(S, kayitDurumu);
    reviveSets(S);
    // Hazır istasyon kaldırıldı — eski projelerdeki dplvList zombie'sini temizle
    if ("dplvList" in S) delete S.dplvList;
    S.infoLayers = infoY;
    S.rasterLayers = rasterY;
    // resMarker canlı katmandır; null ile ezilirse eski mor işaretçi haritada
    // yetim kalır ve showResMarker bir daha .remove() edemez — korunmalı.
    S.resMarker = resM;
    Object.entries(d.fields).forEach(([id, v]) => {
      if ($(id)) $(id).value = v;
    });
    $("projName").value = ad;
    if (S.dplvManual === undefined) {
      const hasOldPlv = !!(d.S && d.S.dplvValues);
      S.dplvManual = hasOldPlv ? true : false;
    }
    if (S.dplvAuto === undefined) S.dplvAuto = null;
    if (S.dplvValues === undefined) S.dplvValues = null;
    if (!(S.seciliYontemler instanceof Set)) {
      // eski projeler: S.seciliYontemler yok → varsayılan DSİ+Mockus
      // rapFilter varsa ondan türetme yapma — rapFilter rapor hariç, hesap seçimi değil
      S.seciliYontemler = new Set(["dsi", "mockus"]);
    }
    if (!(S.stKorumali instanceof Set)) S.stKorumali = new Set();
    if (!(S.stExclude instanceof Set)) S.stExclude = new Set();
    // Hesap yöntem seçimini DOM'a yansıt (Adım 4 fieldset)
    try {
      document.querySelectorAll(".hesapYontem").forEach((cb) => {
        const m = cb.dataset.m;
        if (m === "dsi") cb.checked = true;
        else cb.checked = S.seciliYontemler.has(m);
      });
      const rb = document.getElementById("rasyonelBox");
      const sb = document.getElementById("snyderBox");
      if (rb) rb.classList.toggle("hidden", !S.seciliYontemler.has("rasyonel"));
      if (sb) sb.classList.toggle("hidden", !S.seciliYontemler.has("snyder"));
      // hide-sync inner legacy
      const ir = document.getElementById("inpRasyonel");
      if (ir) ir.checked = S.seciliYontemler.has("rasyonel");
      const is = document.getElementById("inpSnyder");
      if (is) is.checked = S.seciliYontemler.has("snyder");
    } catch (e) {}
    renderKotlar();
    renderRainTable();
    renderDplvGrid();
    updatePlvAutoInfo();
    // kayıtta varsa NTFA/BTFA sonuçlarını dock'a geri getir (S.tfa/S.btfa kayıtta durur)
    try {
      const frek = await import("../wizard/frekans.js");
      frek.frekansDockGuncelle();
    } catch (e) {}
    // kayıtta varsa CORINE dökümü ve Adım 4'teki C bloğu geri gelir
    if (S.cnSonuc) renderCnSonuc(S.cnSonuc);
    updateComputeReady();
    // F7: thiessen ve outlet marker'ı projeden geri getir (harita taze çıkarım görünümüne eş)
    if (S.thiessen && S.thiessen.length) {
      layers.thiessen.clearLayers();
      S.thiessen
        .filter((t) => t.agirlik > 0 && t.poligon_geojson)
        .forEach((t) => {
          try {
            layers.thiessen.addData({
              type: "Feature",
              properties: { name: t.name, kod: t.kod, lat: t.lat, lon: t.lon },
              geometry: t.poligon_geojson,
            });
          } catch (e) {}
        });
      // stil renklerini yağış verisine göre yenile
      try {
        const { recolorThiessen } = await import("../wizard/rain.js");
        recolorThiessen();
      } catch (e) {}
    } else {
      layers.thiessen.clearLayers();
    }
    // aday + hayalet katmanı: proje havzası için mgmDbYakin taze değil, yeniden kur
    try {
      const { renderAdaylar, renderAdayMarkers } = await import("../wizard/thiessen.js");
      S.mgmDbYakin = null;
      // renderAdaylar yakın MGM adaylarını lazy yükler; marker’lar sonra dolacak
      renderAdaylar();
      renderAdayMarkers();
    } catch (e) {}
    // thTable/thExcluded’ı da projeden geri getir (sadece poligon değil, tablo da)
    try {
      const { renderExcluded } = await import("../wizard/thiessen.js");
      renderExcluded();
      // thTable’ı runThiessen olmadan da doldur (aktif istasyon tablosu)
      const thTableEl = document.getElementById("thTable");
      if (thTableEl && S.thiessen && S.thiessen.length) {
        const aktif = S.thiessen.filter((t) => t.agirlik > 0);
        if (aktif.length) {
          let h = `<div class="th-legend"><span><i class="mgm-tri"></i> MGM</span><span><i class="elle-dot"></i> Elle eklenen</span></div><table class="tbl"><tr><th>İstasyon</th><th>Kurum</th><th>Ağırlık</th><th>Alan (km²)</th><th></th></tr>`;
          aktif.forEach((t) => {
            h += `<tr class="sel"><td>${t.name}</td><td>${t.kurum || "—"}</td><td>${(t.agirlik * 100).toFixed(1)}%</td><td>${t.alan_km2}</td><td></td></tr>`;
          });
          thTableEl.innerHTML = h + "</table>";
        }
      }
    } catch (e) {}
    layers.markers.clearLayers();
    if (S.outlet) {
      try {
        const lat = S.outlet.snap_lat ?? S.outlet.lat;
        const lon = S.outlet.snap_lon ?? S.outlet.lon;
        if (lat != null && lon != null) L.marker([lat, lon]).addTo(layers.markers).bindPopup("Çıkış noktası (proje)");
      } catch (e) {}
    }
    if (S.havza) {
      layers.havza.clearLayers();
      layers.havza.addData(S.havza);
      layers.dere.clearLayers();
      if (S.dere) layers.dere.addData(S.dere);
      layers.kanal.clearLayers();
      if (S.kanal) layers.kanal.addData(S.kanal);
      map.fitBounds(layers.havza.getBounds());
    }
    try {
      _notifyHavzaChanged();
    } catch (e) {}
  } catch (e) {
    alert("Proje yüklenemedi: " + e.message);
    console.error(e);
  }
};
loadProjects().catch((err) => console.error("proje listesi yüklenemedi:", err));

export { loadProjects };
