/**
 * @fileoverview KMZ dışa aktarım — havza + dere + tekerrürlü pik debiler.
 * @module wizard/kmz
 * Owns: — (read-only, S.sonuc/S.girdi/S.outlet ile layers.havza/dere/kanal okur)
 * Exports: buildKmzPayload, exportKmz
 * Notes:
 *  - Allowed pulls (§3.1): kmz→map/init (katmanGeojson, layers), kmz→grafik (cmpPeak, cmpAvailable), kmz→core/constants (CMP_LABELS, CMP_RPS)
 *  - Geometri yalnız harita katmanlarından okunur (elle düzenlemeler dahil); debiler S.sonuc'tan.
 *  - Geometri-only dışa aktarım desteklenir: S.sonuc yoksa debiler boş, yontem_ad "".
 *  Rank 2 (wizard).
 */

import { S } from "../core/state.js";
import { $, setStatus } from "../ui/dom.js";
import { dosyaIndir } from "../ui/dom.js";
import { layers, katmanGeojson } from "../map/init.js";
import { CMP_LABELS, CMP_RPS } from "../core/constants.js";
import { cmpPeak, cmpAvailable } from "./grafik.js";

/**
 * Seçili yöntemi belirler — repSecili varsa onu, yoksa ilk uygun yöntem.
 * @returns {string|null} yöntem anahtarı (dsi/mockus/rasyonel/snyder) veya null
 */
function seciliYontem() {
  const sel = $("repSecili");
  if (sel && sel.value) return sel.value;
  if (!S.sonuc) return null;
  try {
    const avail = cmpAvailable();
    const first = Object.keys(avail)[0];
    return first || null;
  } catch (e) {
    return null;
  }
}

/**
 * Mevcut S.sonuc ve seçili yöntemden debiler sözlüğünü üretir.
 * @param {string|null} yontem
 * @returns {Object} {rp: Q} sözlüğü (boş olabilir)
 */
function debilerUret(yontem) {
  if (!S.sonuc || !yontem) return {};
  const out = {};
  CMP_RPS.forEach((rp) => {
    try {
      const v = cmpPeak(yontem, rp);
      if (v != null) out[rp] = v;
    } catch (e) {}
  });
  return out;
}

/**
 * KMZ payload'ını kurar — backend /api/kmz-export şemasına uygun.
 * @param {Object} opts
 * @param {string|null} opts.yontem - zorlama yöntem (null → otomatik)
 * @returns {Object|null} payload veya havza yoksa null
 */
export function buildKmzPayload(opts = {}) {
  const havza = katmanGeojson(layers.havza);
  if (!havza) return null;
  const yontem = opts.yontem !== undefined ? opts.yontem : seciliYontem();
  const debiler = debilerUret(yontem);
  const yontemAd = yontem ? CMP_LABELS[yontem] || yontem : "";
  const o = S.outlet;
  return {
    ad: ($("projName") && $("projName").value) || (S.girdi && S.girdi.ad) || "Havza",
    yontem_ad: yontemAd,
    havza_geojson: havza,
    dere_geojson: katmanGeojson(layers.dere),
    kanal_geojson: katmanGeojson(layers.kanal),
    outlet: o ? { lat: o.snap_lat ?? o.lat, lon: o.snap_lon ?? o.lon } : null,
    debiler,
    girdi_ozeti: (S.sonuc && S.sonuc.girdi_ozeti) || null,
    _yontem: yontem,
    _debilerBos: Object.keys(debiler).length === 0,
  };
}

/**
 * KMZ indir — step 1 ve step 4'ten ortak çağrılır.
 * @param {Object} opts
 * @param {string} opts.statusId - durum yazılacak element id (default "kmzStatus")
 */
export async function exportKmz(opts = {}) {
  const statusId = opts.statusId || "kmzStatus";
  const havza = katmanGeojson(layers.havza);
  if (!havza) {
    setStatus(statusId, "Havza sınırı yok — önce havzayı çıkarın", "err");
    return;
  }
  const payload = buildKmzPayload(opts);
  if (!payload) {
    setStatus(statusId, "Havza sınırı yok — önce havzayı çıkarın", "err");
    return;
  }
  const bos = payload._debilerBos;
  // iç bayrakları payload'dan temizle
  delete payload._yontem;
  delete payload._debilerBos;

  if (bos) {
    setStatus(statusId, "KMZ hazırlanıyor… (⚠ pik debiler olmadan, yalnızca havza/dere)", "loading");
  } else {
    setStatus(statusId, "KMZ hazırlanıyor…", "loading");
  }
  try {
    const resp = await fetch("/api/kmz-export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const name = await dosyaIndir(resp, "havza.kmz");
    setStatus(statusId, "✓ İndirildi: " + name, "ok");
  } catch (e) {
    setStatus(statusId, "Hata: " + e.message, "err");
  }
}
