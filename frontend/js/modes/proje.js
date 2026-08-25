import { S } from "../core/state.js";
import { api } from "../core/api.js";
import { $, setStatus } from "../ui/dom.js";
import { map, layers } from "../map/init.js";
import { renderKotlar, renderCnSonuc } from "../wizard/cn.js";
import { renderRainTable } from "../wizard/rain.js";
import { loadDplv, renderDplvGrid, updatePlvAutoInfo } from "../wizard/dplv.js";
import { updateComputeReady } from "../wizard/steps.js";

$("btnDelete").onclick = async () => {
  const ad = ($("projList").value || $("projName").value).trim();
  if (!ad) return alert("Silinecek projeyi listeden seçin veya adını girin");
  if (!confirm(`"${ad}" projesi kalıcı olarak silinsin mi?`)) return;
  const r = await fetch("/api/project/" + encodeURIComponent(ad), { method: "DELETE" });
  if (!r.ok) { const j = await r.json().catch(() => ({})); return alert("Silinemedi: " + (j.detail || r.statusText)); }
  await loadProjects();
  $("projList").value = "";
  if ($("projName").value.trim() === ad) $("projName").value = "";
  alert(`"${ad}" silindi`);
};

$("btnSave").onclick = async () => {
  const ad = $("projName").value.trim();
  if (!ad) return alert("Proje adı girin");
  const fields = {};
  ["inpA", "inpL", "inpLc", "inpRegion", "inpQbaz", "inpCN2", "inpCN3", "inpSoil",
   "inpDplv", "karTemps", "karA", "karH", "karHist", "inpC100", "inpUs",
   "inpCt", "inpCp", "inpW50", "inpW75", "inpYald"]
    .forEach(id => fields[id] = $(id).value);
  // infoLayers/rasterLayers içinde Leaflet katman nesneleri var; bunlar haritaya
  // geri başvurduğu için JSON.stringify "circular structure" ile patlar. Raster
  // altlıklar zaten sunucuda duruyor ve açılışta /api/raster-layers ile geliyor.
  const durumS = { ...S, sonuc: null, infoLayers: [], rasterLayers: [] };
  await api("/api/project/save", { ad, durum: { S: durumS, fields } });
  loadProjects();
  alert("Kaydedildi");
};
async function loadProjects() {
  const r = await api("/api/project/list");
  const sel = $("projList");
  sel.innerHTML = `<option value="">— yükle —</option>` +
    r.projeler.map(p => `<option>${p}</option>`).join("");
}
$("projList").onchange = async () => {
  const ad = $("projList").value;
  if (!ad) return;
  const d = await api("/api/project/load/" + encodeURIComponent(ad));
  // haritada duran canlı katman nesneleri kayda girmez; yüklemede korunmalı
  const infoY = S.infoLayers, rasterY = S.rasterLayers;
  Object.assign(S, d.S);
  S.infoLayers = infoY; S.rasterLayers = rasterY;
  Object.entries(d.fields).forEach(([id, v]) => { if ($(id)) $(id).value = v; });
  $("projName").value = ad;
  if (S.dplvManual === undefined) {
    const hasOldPlv = !!(d.S && d.S.dplvValues) || !!(d.fields && d.fields.inpDplv != null && String(d.fields.inpDplv) !== "");
    S.dplvManual = hasOldPlv ? true : false;
  }
  if (S.dplvAuto === undefined) S.dplvAuto = null;
  if (S.dplvValues === undefined) S.dplvValues = null;
  if (!S.dplvList) { try { await loadDplv(); } catch (e) {} }
  renderKotlar();
  renderRainTable();
  renderDplvGrid();
  updatePlvAutoInfo();
  // kayıtta varsa CORINE dökümü ve Adım 4'teki C bloğu geri gelir
  if (S.cnSonuc) renderCnSonuc(S.cnSonuc);
  updateComputeReady();
  if (S.havza) {
    layers.havza.clearLayers(); layers.havza.addData(S.havza);
    layers.dere.clearLayers(); if (S.dere) layers.dere.addData(S.dere);
    layers.kanal.clearLayers(); if (S.kanal) layers.kanal.addData(S.kanal);
    map.fitBounds(layers.havza.getBounds());
  }
};
loadProjects();

export { loadProjects };
