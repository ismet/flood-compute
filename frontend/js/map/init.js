/**
 * @fileoverview Harita kurulumu ve registry-bag.
 * @module map/init
 * Owns: layers registry-bag ({}), map nesnesi, pasif dere/kanal/markers katmanları; katmanGeojson()
 * Exports: map, layers, katmanGeojson, setOnHavzaClick, getOnHavzaClick
 * Notes:
 *  - Registry-bag: init.js `export const layers = {}`; sahipler assign eder
 *    (layers.havza = L.geoJSON…); tüketiciler {layers} import eder (§3.1).
 *  - Rank 2 (feature: map) — ui→core'a import edebilir, diğer feature'lardan import etmez
 *    (istisna: duzenle/hesap → registry okuma serbest).
 */

export const map = L.map("map").setView([39.2, 32.8], 6);
export const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap",
}).addTo(map);
export const sat = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { maxZoom: 19, attribution: "Esri World Imagery" },
);
export const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
  maxZoom: 17,
  attribution: "© OpenStreetMap katkıcıları, SRTM | © OpenTopoMap (CC-BY-SA)",
});
L.control.layers({ Harita: osm, Uydu: sat, Topoğrafya: topo }).addTo(map);
let _onHavzaClick = null;
export function setOnHavzaClick(fn) {
  _onHavzaClick = fn;
}
export function getOnHavzaClick() {
  return _onHavzaClick;
}
export const layers = {
  dere: L.geoJSON(null, { style: { color: "#3b8ea5", weight: 1.5 } }).addTo(map),
  kanal: L.geoJSON(null, { style: { color: "#c73e3a", weight: 2.5, dashArray: "6 4" } }).addTo(map),
  markers: L.layerGroup().addTo(map),
};
export function katmanGeojson(katman) {
  if (!katman) return null;
  const gj = katman.toGeoJSON();
  return gj && gj.features && gj.features.length ? gj : null;
}
