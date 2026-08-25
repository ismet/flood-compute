/**
 * @fileoverview Bilgi katmanı yükleyici (KML/KMZ/GeoJSON — hesaba girmez).
 * @module map/bilgi
 * Owns: S.infoLayers
 * Exports: — (self-wiring)
 * Notes: Rank 2 (map). S.infoLayers yalnızca burada yazılır.
 */

import { S } from "../core/state.js";
import { $, setStatus } from "../ui/dom.js";
import { api } from "../core/api.js";
import { map } from "./init.js";

/* ---- bilgi amaçlı harita katmanları ----
   Hesaba GİRMEZ; proje sınırı, yollar, yerleşim, mevcut tesis gibi bağlam
   katmanlarını haritada göstermek içindir.                                 */
const INFO_RENK = ["#8e24aa", "#00838f", "#ef6c00", "#5d4037", "#c2185b", "#455a64", "#1565c0", "#2e7d32"];
S.infoLayers = [];
function renderInfoLayers() {
  const el = $("infoLayers");
  if (!el) return;
  if (!S.infoLayers.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML =
    `<b>Bilgi katmanları</b> (hesaba girmez):<br>` +
    S.infoLayers
      .map(
        (k, i) =>
          `<label class="inline" style="gap:4px">
       <input type="checkbox" class="info-chk" data-i="${i}" ${k.gorunur ? "checked" : ""} style="width:auto">
       <span style="color:${k.renk};font-weight:700">■</span> ${k.ad}
       <span style="color:#8a857e">(${k.sayi})</span>
       <button class="link-btn" data-del="${i}" title="Kaldır">✕</button>
     </label>`,
      )
      .join("<br>");
  el.querySelectorAll(".info-chk").forEach(
    (c) =>
      (c.onchange = () => {
        const k = S.infoLayers[+c.dataset.i];
        k.gorunur = c.checked;
        if (c.checked) k.layer.addTo(map);
        else k.layer.remove();
      }),
  );
  el.querySelectorAll("button[data-del]").forEach(
    (b) =>
      (b.onclick = () => {
        const i = +b.dataset.del;
        S.infoLayers[i].layer.remove();
        S.infoLayers.splice(i, 1);
        renderInfoLayers();
      }),
  );
}
$("infoFile").onchange = async () => {
  const dosyalar = Array.from($("infoFile").files || []);
  if (!dosyalar.length) return;
  for (const f of dosyalar) {
    setStatus("delinStatus", `“${f.name}” bilgi katmanı olarak okunuyor…`, "loading");
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await api("/api/bilgi-katmani", fd, true);
      const renk = INFO_RENK[S.infoLayers.length % INFO_RENK.length];
      const layer = L.geoJSON(r.geojson, {
        style: { color: renk, weight: 2, fillOpacity: 0.08, dashArray: "5 3" },
        pointToLayer: (f2, ll) => L.circleMarker(ll, { radius: 5, color: renk, fillColor: renk, fillOpacity: 0.85 }),
        onEachFeature: (f2, lyr) => {
          const ad = f2.properties && f2.properties.ad;
          if (ad) lyr.bindTooltip(ad, { sticky: true });
        },
      }).addTo(map);
      S.infoLayers.push({ ad: r.ad || f.name, layer, renk, gorunur: true, sayi: r.sayi });
      renderInfoLayers();
      const tur = Object.entries(r.turler || {})
        .map(([k, v]) => `${v} ${k}`)
        .join(", ");
      setStatus(
        "delinStatus",
        `Bilgi katmanı eklendi: ${r.ad} — ${r.sayi} geometri (${tur}). ` + `Hesaba girmez, yalnız haritada gösterilir.`,
        "ok",
      );
    } catch (e) {
      setStatus("delinStatus", `“${f.name}” eklenemedi: ${e.message}`, "err");
    }
  }
  $("infoFile").value = "";
};
