/**
 * @fileoverview Proje kayıt/yükleme — JSON kaydetme, geri yükleme.
 * @module modes/proje
 * Owns: — (S'ye toptan yazar — yaşayan katmanlar korunur)
 * Exports: loadProjects, buildDurumS
 * Notes:
 *  - Sanctioned wholesale Object.assign(S, d.S) yalnızca restore'da (§3.1).
 *  - Save'da infoLayers/rasterLayers/resMarker canlı Leaflet nesneleri oldukları
 *    için stripped (buildDurumS); yüklemede canlı değerler korunur.
 *  - Stage13: Set serileştirme replacer/reviver (agiBolgesel,stExclude,suSecili).
 *  - Rank 2 (modes) — proje→wizard renders fan-in izinli.
 */

import { S, _notifyHavzaChanged } from "../core/state.js";
import { _esc } from "../core/format.js";
import { api } from "../core/api.js";
import { $ } from "../ui/dom.js";
import { map, layers } from "../map/init.js";
import { renderKotlar, renderCnSonuc } from "../wizard/cn.js";
import { renderRainTable } from "../wizard/rain.js";
import { renderDplvGrid, updatePlvAutoInfo } from "../wizard/dplv.js";
import { updateComputeReady } from "../wizard/steps.js";

const SET_KEYS = ["agiBolgesel", "stExclude", "suSecili", "rapFilter"];
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
  const { dplvList: _deleted, ...rest } = S;
  return { ...rest, sonuc: null, infoLayers: [], rasterLayers: [], resMarker: null };
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
    Object.assign(S, d.S);
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
    renderKotlar();
    renderRainTable();
    renderDplvGrid();
    updatePlvAutoInfo();
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
              properties: { name: t.name },
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
