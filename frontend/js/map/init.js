export const map = L.map("map").setView([39.2, 32.8], 6);
export const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
export const sat = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { maxZoom: 19, attribution: "Esri World Imagery" });
export const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
  maxZoom: 17,
  attribution: "© OpenStreetMap katkıcıları, SRTM | © OpenTopoMap (CC-BY-SA)",
});
L.control.layers({ "Harita": osm, "Uydu": sat, "Topoğrafya": topo }).addTo(map);
let _onHavzaClick = null;
export function setOnHavzaClick(fn) { _onHavzaClick = fn; }
export const layers = {
  havza: L.geoJSON(null, {
    style: { color: "#0d5c63", weight: 2, fillOpacity: .08 },
    onEachFeature: (f, layer) => {
      layer.on("click", () => { if (_onHavzaClick) _onHavzaClick(); });
      layer.bindTooltip("🗑 Havzayı sil (tıkla) — parametre, yağış, hidrograf dahil", { sticky: true });
    },
  }).addTo(map),
  dere: L.geoJSON(null, { style: { color: "#3b8ea5", weight: 1.5 } }).addTo(map),
  kanal: L.geoJSON(null, { style: { color: "#c73e3a", weight: 2.5, dashArray: "6 4" } }).addTo(map),
  thiessen: L.geoJSON(null, { style: { color: "#7d6e4f", weight: 1.5, fillOpacity: .05, dashArray: "3 3" } }).addTo(map),
  markers: L.layerGroup().addTo(map),
};
export function katmanGeojson(katman) {
  if (!katman) return null;
  const gj = katman.toGeoJSON();
  return (gj && gj.features && gj.features.length) ? gj : null;
}
