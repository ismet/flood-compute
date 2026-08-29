/**
 * @fileoverview Koordinatlı raster altlık yükleyici (GeoTIFF/MrSID → XYZ).
 * @module map/raster
 * Owns: S.rasterLayers
 * Exports: — (self-wiring; rasterKatmanEkle içsel)
 * Notes: Rank 2 (map).
 */

import { S } from "../core/state.js";
import { _esc } from "../core/format.js";
import { $, setStatus } from "../ui/dom.js";
import { api } from "../core/api.js";
import { map } from "./init.js";

/* ---- koordinatlı raster altlıklar (1/25000 paftalar) ----
   Dosya arka uca yüklenir, orada Web Mercator'a yeniden projeksiyonlanıp XYZ
   karo olarak sunulur; burada yalnızca L.tileLayer ile gösterilir.          */
S.rasterLayers = []; // [{meta, layer, gorunur, saydam}]

function renderRasterLayers() {
  const el = $("rasterLayers");
  if (!el) return;
  if (!S.rasterLayers.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML =
    `<b>Raster altlıklar:</b>` +
    `<table class="tbl small" style="margin-top:6px"><thead><tr><th>Dosya</th><th style="width:90px;text-align:center">Opaklık</th><th style="width:44px;text-align:center">Görünür</th><th style="width:60px"></th></tr></thead><tbody>` +
    S.rasterLayers
      .map(
        (k, i) =>
          `<tr>` +
          `<td style="text-align:left;word-break:break-all" title="${_esc(k.meta.baslik || k.meta.ad)}">🗺 ${_esc(k.meta.baslik || k.meta.ad)}</td>` +
          `<td style="text-align:center"><input type="range" class="ras-op" data-i="${i}" min="10" max="100" value="${Math.round(k.saydam * 100)}" title="Saydamlık" style="width:80px;vertical-align:middle"></td>` +
          `<td style="text-align:center"><input type="checkbox" class="ras-chk" data-i="${i}" ${k.gorunur ? "checked" : ""} style="width:auto;accent-color:var(--vurgu)"></td>` +
          `<td style="text-align:center"><button class="link-btn" data-zoom="${i}" title="Katmana git">⌖</button> <button class="link-btn" data-del="${i}" title="Kaldır">✕</button></td>` +
          `</tr>`,
      )
      .join("") +
    `</tbody></table>`;
  el.querySelectorAll(".ras-chk").forEach(
    (c) =>
      (c.onchange = () => {
        const k = S.rasterLayers[+c.dataset.i];
        k.gorunur = c.checked;
        if (c.checked) k.layer.addTo(map);
        else k.layer.remove();
      }),
  );
  el.querySelectorAll(".ras-op").forEach(
    (r) =>
      (r.oninput = () => {
        const k = S.rasterLayers[+r.dataset.i];
        k.saydam = +r.value / 100;
        k.layer.setOpacity(k.saydam);
      }),
  );
  el.querySelectorAll("button[data-zoom]").forEach(
    (b) =>
      (b.onclick = () => {
        const k = S.rasterLayers[+b.dataset.zoom];
        if (k.meta.sinir) map.fitBounds(k.meta.sinir, { padding: [20, 20] });
      }),
  );
  el.querySelectorAll("button[data-del]").forEach(
    (b) =>
      (b.onclick = async () => {
        const i = +b.dataset.del,
          k = S.rasterLayers[i];
        if (!confirm(`“${_esc(k.meta.baslik || k.meta.ad)}” altlığı sunucudan silinsin mi?`)) return;
        try {
          await api("/api/raster-delete", { ad: k.meta.ad });
        } catch (e) {}
        k.layer.remove();
        S.rasterLayers.splice(i, 1);
        renderRasterLayers();
      }),
  );
}

/* Meta bilgisinden Leaflet karo katmanı kurar (haritaya ekler). */
function rasterKatmanEkle(meta) {
  if (S.rasterLayers.some((k) => k.meta.ad === meta.ad)) return;
  const layer = L.tileLayer(`/api/raster/${encodeURIComponent(meta.ad)}/{z}/{x}/{y}.png`, {
    pane: "rasterPane",
    maxZoom: 22,
    opacity: 1,
    bounds: meta.sinir || undefined,
    attribution: meta.baslik || meta.ad,
  }).addTo(map);
  S.rasterLayers.push({ meta, layer, gorunur: true, saydam: 1 });
  renderRasterLayers();
}

async function loadRasterLayers() {
  try {
    const r = await api("/api/raster-layers");
    (r.katmanlar || []).forEach(rasterKatmanEkle);
  } catch (e) {
    /* altlık yoksa sessiz geç */
  }
}
loadRasterLayers();

/* MrSID kod çözücüsü var mı — .sid seçilir seçilmez söyle. Sunucuda sürücü
   kurulamıyor (tescilli DSDK); kullanıcının yüzlerce MB'ı yükleyip sonunda
   hata almasındansa dosya seçilirken uyarmak gerekiyor.                    */
let mrsidDurum = null;
(async function mrsidSorgula() {
  try {
    mrsidDurum = await api("/api/raster-converter");
  } catch (e) {
    /* uç yoksa geç */
  }
})();

function sidUyar(dosyalar) {
  if (!mrsidDurum || mrsidDurum.mrsid) return false;
  if (!dosyalar.some((f) => /\.(sid|ecw)$/i.test(f.name))) return false;
    setStatus(
      "rasterStatus",
      mrsidDurum.sunucu
        ? "Bu sunucu .sid (MrSID) okuyamıyor — sürücü tescilli olduğu için kurulamıyor. " +
          "Dosyayı QGIS ile ya da “gdal_translate -of GTiff pafta.sid pafta.tif” " +
          "komutuyla GeoTIFF'e çevirip onu yükleyin (GeoTIFF doğrudan açılır)."
        : "MrSID kod çözücüsü kurulu değil. OSGeo4W'den 'gdal-mrsid' eklentisini kurun " +
          "ya da dosyayı elle GeoTIFF'e çevirip yükleyin.",
      "err",
    );
  return true;
}

async function rasterYukle() {
  const dosyalar = Array.from($("rasterFile").files || []);
  if (!dosyalar.length) return setStatus("rasterStatus", "Önce raster dosyasını seçin", "err");
  // Tek dosya modu: yalnızca ilk dosya yüklenir (world dosyası CRS ile çözülür)
  const tekDosya = dosyalar.slice(0, 1);
  if (sidUyar(tekDosya)) {
    $("rasterFile").value = "";
    return;
  }
  const sid = tekDosya.some((f) => /\.sid$/i.test(f.name));
  const worldVar = tekDosya.some((f) => /\.(sdw|tfw|wld|prj)$/i.test(f.name));
  if (sid && !worldVar && !$("rasterCrs").value.trim()) {
    setStatus(
      "rasterStatus",
      "Uyarı: .sid seçtiniz ama yanında .sdw/.tfw yok ve CRS " +
        "boş. Georeferans dosyanın içinde değilse altlık yanlış yere oturur.",
      "err",
    );
  }
  setStatus(
    "rasterStatus",
    `${tekDosya.map((f) => "“" + _esc(f.name) + "”").join(", ")} yükleniyor…` +
      (sid ? " (.sid → GeoTIFF dönüşümü sürebilir)" : ""),
    "loading",
  );
  try {
    const fd = new FormData();
    tekDosya.forEach((f) => fd.append("files", f));
    const crs = $("rasterCrs").value.trim();
    const url = "/api/raster-add" + (crs ? `?crs=${encodeURIComponent(crs)}` : "");
    const meta = await api(url, fd, true);
    rasterKatmanEkle(meta);
    if (meta.sinir) map.fitBounds(meta.sinir, { padding: [20, 20] });
    setStatus(
      "rasterStatus",
      `Altlık eklendi: ${meta.baslik || meta.ad} — ` +
        `${meta.genislik}×${meta.yukseklik} piksel, ${meta.bant} bant, ${meta.etkin_crs}.`,
      "ok",
    );
    $("rasterFile").value = "";
  } catch (e) {
    setStatus("rasterStatus", "Altlık eklenemedi: " + e.message, "err");
  }
}
$("rasterFile").onchange = () => {
  if (sidUyar(Array.from($("rasterFile").files || []))) {
    $("rasterFile").value = "";
    return;
  }
  rasterYukle();
};
$("btnRasterAdd").onclick = rasterYukle;
