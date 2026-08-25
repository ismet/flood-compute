/**
 * @fileoverview Bilgi katmanı yükleyici (KML/KMZ/GeoJSON — hesaba girmez).
 * @module map/bilgi
 * Owns: S.infoLayers
 * Exports: — (self-wiring)
 * Notes: Rank 2 (map). S.infoLayers yalnızca burada yazılır.
 */

import { S } from "../core/state.js";
import { _esc } from "../core/format.js";
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
    `<b>Bilgi katmanları</b> (hesaba girmez):` +
    `<table class="tbl small" style="margin-top:6px"><thead><tr><th style="width:22px"></th><th>Dosya</th><th style="width:70px;text-align:right">Geometri</th><th style="width:44px;text-align:center">Görünür</th><th style="width:30px"></th></tr></thead><tbody>` +
    S.infoLayers
      .map(
        (k, i) =>
          `<tr>` +
          `<td style="text-align:center"><span style="display:inline-block;width:12px;height:12px;background:${_esc(k.renk)};border-radius:2px;vertical-align:middle"></span></td>` +
          `<td style="text-align:left;word-break:break-all" title="${_esc(k.ad)}">${_esc(k.ad)}</td>` +
          `<td style="text-align:right;color:#8a857e">${_esc(k.sayi)}</td>` +
          `<td style="text-align:center"><input type="checkbox" class="info-chk" data-i="${i}" ${k.gorunur ? "checked" : ""} style="width:auto;accent-color:var(--vurgu)"></td>` +
          `<td style="text-align:center"><button class="link-btn" data-del="${i}" title="Kaldır">✕</button></td>` +
          `</tr>`,
      )
      .join("") +
    `</tbody></table>`;
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
    setStatus("delinStatus", `“${_esc(f.name)}” bilgi katmanı olarak okunuyor…`, "loading");
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
          if (ad) lyr.bindTooltip(_esc(ad), { sticky: true });
        },
      }).addTo(map);
      S.infoLayers.push({ ad: r.ad || f.name, layer, renk, gorunur: true, sayi: r.sayi });
      renderInfoLayers();
      const tur = Object.entries(r.turler || {})
        .map(([k, v]) => `${_esc(v)} ${_esc(k)}`)
        .join(", ");
      setStatus(
        "delinStatus",
        `Bilgi katmanı eklendi: ${_esc(r.ad)} — ${_esc(r.sayi)} geometri (${tur}). ` + `Hesaba girmez, yalnız haritada gösterilir.`,
        "ok",
      );
    } catch (e) {
      setStatus("delinStatus", `“${_esc(f.name)}” eklenemedi: ${e.message}`, "err");
    }
  }
  $("infoFile").value = "";
};
