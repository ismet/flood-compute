import { S } from "../core/state.js";
import { $, setStatus } from "../ui/dom.js";
import { api } from "../core/api.js";
import { map, layers } from "../map/init.js";
import { recolorThiessen, renderRainTable } from "./rain.js";

export const kurumColor = (k) => k === "DSİ" ? "#e65100" : k === "DMİ" ? "#1565c0"
  : k === "Elle" ? "#2e7d32" : "#7d6e4f";
export const stKey = (s) => `${s.name}|${(+s.lat).toFixed(5)}|${(+s.lon).toFixed(5)}`;
S.stExclude = new Set();
export function effectiveStations() {
  const base = (S.stBase || []).filter(s => !S.stExclude.has(stKey(s)));
  return base.concat(S.stExtra);
}
export async function loadStationSet(list, kaynak) {
  S.stBase = list;
  S.stExclude = new Set();
  S.stExtra = [];
  await runThiessen(effectiveStations(), kaynak);
}
export async function recomputeThiessen() {
  if (!S.stBase && !S.stExtra.length) return;
  await runThiessen(effectiveStations(), S.stKaynak || "Güncel liste");
}
export function renderExcluded() {
  const el = $("thExcluded");
  if (!el) return;
  const list = (S.stBase || []).filter(s => S.stExclude.has(stKey(s)));
  const elenen = S.thElenen || [];
  if (!list.length && !S.stExtra.length && !elenen.length) { el.innerHTML = ""; return; }
  let h = "";
  if (elenen.length)
    h += `<div class="small"><b>Küçük pay eşiğinin altında elenenler:</b> ` +
      elenen.map(x => `${x.name} (%${(x.agirlik * 100).toFixed(1)})`).join(", ") +
      ` — alanları komşu istasyonlara dağıtıldı.</div>`;
  if (S.stExtra.length)
    h += `<div class="small"><b>Elle eklenenler:</b> ` + S.stExtra.map((s, i) =>
      `${s.name} <button class="link-btn" data-x="${i}" title="Kaldır">✕</button>`).join(", ") + `</div>`;
  if (list.length)
    h += `<div class="small"><b>Çıkarılanlar:</b> ` + list.map(s =>
      `${s.name} <button class="link-btn" data-r="${stKey(s)}" title="Geri al">↺</button>`).join(", ") + `</div>`;
  if (S.stExclude.size)
    h += `<div style="margin-top:6px"><button id="btnResetStations" class="small-btn">↺ Çıkarılanları geri al</button></div>`;
  el.innerHTML = h;
  el.querySelectorAll("button[data-r]").forEach(b => b.onclick = () => {
    S.stExclude.delete(b.dataset.r); recomputeThiessen();
  });
  el.querySelectorAll("button[data-x]").forEach(b => b.onclick = () => {
    S.stExtra.splice(+b.dataset.x, 1); recomputeThiessen();
  });
  const rb = el.querySelector("#btnResetStations");
  if (rb) rb.onclick = () => { S.stExclude = new Set(); recomputeThiessen(); };
}
export async function runThiessen(stations, kaynak) {
  if (!S.havza) return setStatus("thStatus", "Önce havzayı çıkarın (Adım 1)", "err");
  setStatus("thStatus", "Thiessen hesaplanıyor…", "loading");
  try {
    S.istasyonlar = stations;
    S.stKaynak = kaynak;
    if (!S.stBase) S.stBase = stations;   // doğrudan çağrılırsa temel liste bu olsun
    const minW = Math.max(0, (+$("inpMinW").value || 0) / 100);
    const r2 = await api("/api/thiessen", { havza_geojson: S.havza, istasyonlar: S.istasyonlar,
                                            min_agirlik: minW });
    S.thiessen = r2.sonuc;
    S.thElenen = r2.elenen || [];
    layers.thiessen.clearLayers();
    layers.markers.clearLayers();
    if (S.outlet) L.marker([S.outlet.snap_lat, S.outlet.snap_lon]).addTo(layers.markers).bindPopup("Outlet");
    const aktif = S.thiessen.filter(t => t.agirlik > 0);
    let h = `<div class="th-legend">
      <span><i style="background:#1565c0"></i> DMİ/MGM</span>
      <span><i style="background:#e65100"></i> DSİ</span>
      <span><i style="background:#2e7d32"></i> Elle eklenen</span></div>
      <table class="tbl"><tr><th>İstasyon</th><th>Kurum</th><th>Ağırlık</th><th>Alan (km²)</th><th></th></tr>`;
    aktif.forEach(t => {
      if (t.poligon_geojson) layers.thiessen.addData(
        { type: "Feature", properties: { name: t.name }, geometry: t.poligon_geojson });
      const col = kurumColor(t.kurum);
      const mk = L.circleMarker([t.lat, t.lon], { radius: 6, color: col, fillColor: col, fillOpacity: .8 })
        .addTo(layers.markers)
        .bindPopup(`${t.name}${t.kurum ? " [" + t.kurum + "]" : ""} (w=${(t.agirlik * 100).toFixed(1)}%)`
          + `<br><button class="link-btn" data-pop-del="1">✕ Bu istasyonu çıkar</button>`);
      const key = stKey(t);
      mk.on("popupopen", (ev) => {
        const btn = ev.popup.getElement().querySelector("button[data-pop-del]");
        if (btn) btn.onclick = () => removeStation(key);
      });
      h += `<tr class="sel"><td>${t.name}</td><td>${t.kurum || "—"}</td><td>${(t.agirlik * 100).toFixed(1)}%</td><td>${t.alan_km2}</td>`
        + `<td><button class="link-btn" data-del="${stKey(t)}" title="Bu istasyonu çıkar">✕</button></td></tr>`;
    });
    $("thTable").innerHTML = h + "</table>";
    $("thTable").querySelectorAll("button[data-del]").forEach(b =>
      b.onclick = () => removeStation(b.dataset.del));
    renderExcluded();
    recolorThiessen();
    const nEk = S.stExtra.length, nCik = S.stExclude.size, nEle = (S.thElenen || []).length;
    setStatus("thStatus",
      `${kaynak}: ${stations.length} istasyondan ${aktif.length} tanesi havzada pay alıyor`
      + (nCik ? ` | ${nCik} elle çıkarıldı` : "") + (nEk ? ` | ${nEk} elle eklendi` : "")
      + (nEle ? ` | ${nEle} istasyon küçük pay eşiğinin altında kaldığı için elendi` : ""), "ok");
    // birleşik adımda done yalnızca ağırlıklı yağış hazır olunca yanar (recalcRain → markDone(3))
    renderRainTable();
  } catch (e) { setStatus("thStatus", "Hata: " + e.message, "err"); }
}
export function removeStation(key) {
  S.stExclude.add(key);
  const i = S.stExtra.findIndex(s => stKey(s) === key);
  if (i >= 0) S.stExtra.splice(i, 1);   // elle eklenmişse listeden sil
  map.closePopup();
  recomputeThiessen();
}
export async function useDefaultStations() {
  setStatus("thStatus", "MGM istasyonları yükleniyor…", "loading");
  try {
    const r = await api("/api/stations/default");
    if (!r.istasyonlar.length)
      return setStatus("thStatus",
        "İstasyon kümesi boş (python tools/mgm_veritabani_olustur.py)", "err");
    await loadStationSet(r.istasyonlar,
      `MGM ölçüm ağı — ${r.istasyonlar.length} istasyon (≥${r.en_az_yil} yıl yağış ölçümü)`);
  } catch (e) { setStatus("thStatus", "Hata: " + e.message, "err"); }
}
const _btnDef = $("btnDefaultSt"); if (_btnDef) _btnDef.onclick = useDefaultStations;

// Thiessen self-wiring
$("inpMinW")?.addEventListener("change", () => { if (S.thiessen && S.thiessen.length) recomputeThiessen(); });
map.on("click", (ev) => {
  if (!S.stPlace) return;
  S.stPlace = false;
  map.getContainer().style.cursor = "";
  const ad = (prompt("İstasyon adı:", "Yeni İstasyon") || "").trim();
  if (!ad) return setStatus("thStatus", "İptal edildi", "");
  S.stExtra.push({ name: ad, lat: +ev.latlng.lat.toFixed(6), lon: +ev.latlng.lng.toFixed(6),
                   kurum: "Elle" });
  recomputeThiessen();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && S.stPlace) {
    S.stPlace = false;
    map.getContainer().style.cursor = "";
    setStatus("thStatus", "İptal edildi", "");
  }
});

// stPlace dead-code flag (until stage 14) — keep S.stPlace initialization if not exists
if (S.stPlace === undefined) S.stPlace = false;
