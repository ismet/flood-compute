/**
 * @fileoverview İstasyon sembolleri — MGM kırmızı üçgen / AGİ mavi daire.
 * @module map/station-markers
 * Owns: — (pure factory, no side effects)
 * Exports: AGI_BLUE, MGM_RED, MGM_STROKE, ELLE_GREEN, STATION_TOOLTIP_AGI, STATION_TOOLTIP_MGM, mgmTriangleIcon, agiCircleMarker, elleCircleMarker
 * Notes:
 *  - Renkler `style.css :root --istasyon-*` ile eşlenir; JS tek kaynak için
 *    `getComputedStyle` ile okur, yoksa fallback hex kullanır (no-build).
 *  - 16×14 (seçili 18×16) yukarı üçgen, merkez anchor [w/2,h/2] — `L.circleMarker` ile aynı
 *    konum hatası; `outside` sınıfı opaklığı CSS'ten alır (print uyumlu).
 *  - Rank 2 (map) — wizard/modes → map içe aktarabilir (MIGRATION.md §3.1).
 */

/* Fallback hex — style.css :root ile senkron tutulur */
export const AGI_BLUE = "#0072b2";
export const MGM_RED = "#d55e00";
export const MGM_STROKE = "#ffffff";
export const ELLE_GREEN = "#2e7d32";

function cssVar(name, fallback) {
  try {
    const v = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch (e) {
    return fallback;
  }
}

export function agiRenk() {
  return cssVar("--istasyon-agi", AGI_BLUE);
}

export function mgmRenk() {
  return cssVar("--istasyon-mgm", MGM_RED);
}

export function mgmStroke() {
  return cssVar("--istasyon-mgm-koyu", "#8e0000");
}

export function elleRenk() {
  return cssVar("--istasyon-elle", ELLE_GREEN);
}

export const STATION_TOOLTIP_AGI = { sticky: true, className: "station-agi" };
export const STATION_TOOLTIP_MGM = { sticky: true, className: "station-mgm" };
export const STATION_TOOLTIP_ELLE = { sticky: true, className: "station-elle" };

/**
 * MGM kırmızı üçgen divIcon — beyaz halo + drop-shadow CSS'te.
 * @param {Object} opts
 * @param {boolean} opts.selected - seçili/mansap vurgusu (büyük + siyah stroke)
 * @param {boolean} opts.inside - havza içinde mi (outside → .outside opacity)
 */
export function mgmTriangleIcon({ selected = false, inside = true } = {}) {
  const s = selected ? 18 : 16;
  const h = selected ? 16 : 14;
  const klass = `mgm-triangle${selected ? " mgm-selected" : ""}${inside ? "" : " outside"}`;
  // Beyaz halo — sat uydu üzerinde kontrast; seçilide siyah kalın
  const stroke = selected ? "#000" : "#ffffff";
  const sw = selected ? 2.2 : 1.5;
  const fill = mgmRenk();
  const svg = `<svg width="${s}" height="${h}" viewBox="0 0 16 14" style="overflow:visible"><polygon points="8,0 16,14 0,14" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" paint-order="stroke" /></svg>`;
  return L.divIcon({
    className: klass,
    html: svg,
    iconSize: [s, h],
    iconAnchor: [s / 2, h / 2],
  });
}

/**
 * AGİ mavi daire — `L.circleMarker` kullanır (path performansı, aynı anchor).
 * @param {[number,number]} latlon
 * @param {Object} opts
 */
export function agiCircleMarker(latlon, { inside = true, selected = false, radius } = {}) {
  const blue = agiRenk();
  const r = radius != null ? radius : selected ? 8 : 6;
  // `outside` için CSS class yok (path), opaklığı doğrudan ver — print için ayrıca CSS gerekir ama path’te inline
  const op = inside ? 0.9 : 0.32;
  return L.circleMarker(latlon, {
    radius: r,
    color: selected ? "#000" : blue,
    weight: selected ? 3 : 1.5,
    fillColor: blue,
    fillOpacity: op,
  });
}

export function elleCircleMarker(latlon, { inside = true, selected = false } = {}) {
  const g = elleRenk();
  const r = selected ? 8 : 6;
  const op = inside ? 0.85 : 0.35;
  return L.circleMarker(latlon, {
    radius: r,
    color: selected ? "#000" : g,
    weight: selected ? 3 : 1.5,
    fillColor: g,
    fillOpacity: op,
  });
}
