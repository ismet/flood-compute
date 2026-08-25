import { S } from "../core/state.js";
import { $ , setStatus } from "../ui/dom.js";
import { api } from "../core/api.js";
import { map, layers, katmanGeojson } from "./init.js";
import { applyBasinResult } from "../wizard/havza.js";
import { updateComputeReady } from "../wizard/steps.js";
import { renderKotlar } from "../wizard/cn.js";

/* -------- havza sınırı / dere ağını haritada elle düzenleme (Geoman) --------
   Düzenleme bitince geometri /api/basin-from-geometry'ye gönderilir; alan
   poligonun kendisinden (jeodezik), L/Lc/kot profili DEM'den yeniden üretilir
   — yani dosyadan içe aktarmayla birebir aynı yol. */
let editYedek = null;   // vazgeçmek için düzenleme öncesi anlık kopya

/* Geoman seçenekleri.
   - allowSelfIntersection: Geoman'ın varsayılanı (true) KALMALI. false yapılırsa
     her sürükleme/silme sonrası tüm poligonda kinks taraması yapılır ve kesişme
     bulunursa işlem GERİ ALINIR. DEM havzasının köşeleri ~30 m aralıklı olduğu
     için her anlamlı sürükleme komşu kenarı keser → köşe yerine geri zıplar,
     sağ tık silmesi de geri alınır.
   - limitMarkersToCount: 4000+ köşede tüm işaretçileri çizmek arayüzü kilitler;
     Geoman yalnızca imlece en yakın N tanesini gösterir.                      */
const PM_SECENEK = { allowSelfIntersection: true, limitMarkersToCount: 80, snappable: false };

function duzenlenebilirKatmanlar() {
  const out = [];
  [layers.havza, layers.dere].forEach(g => g.eachLayer(l => { if (l.pm) out.push(l); }));
  return out;
}

/* Bir Leaflet katmanındaki toplam köşe sayısı (iç içe latlng dizilerini gezer). */
function koseSayisi(katman) {
  let n = 0;
  const say = (a) => Array.isArray(a) ? a.forEach(say) : n++;
  katman.eachLayer(l => { if (l.getLatLngs) say(l.getLatLngs()); });
  return n;
}

const DERE_STIL = { color: "#3b8ea5", weight: 1.5 };
const DERE_PATLAT_LIMIT = 400;   // bu kol sayısını aşarsa patlatma yapılmaz

/* Dere ağı DEM'den TEK bir çok parçalı MultiLineString olarak gelir (her DEM
   hücresi bir segment, unary_union ile birleştirilmiş). Tek Leaflet nesnesi
   olduğu için bir kolu ayrı taşımak/silmek mümkün olmaz. Düzenlemeye girerken
   kollara ayrılır; çıkarken toGeoJSON hepsini FeatureCollection olarak toplar.
   Çok kalabalık ağlarda patlatma arayüzü kilitleyeceği için atlanır — o zaman
   önce sadeleştirme önerilir. Döner: {kol, kose, patladi}                    */
function derePatlat() {
  const kollar = [];
  layers.dere.eachLayer(l => {
    if (!l.getLatLngs) return;
    const topla = (a) => {
      if (!a.length) return;
      if (Array.isArray(a[0])) a.forEach(topla); else kollar.push(a);
    };
    topla(l.getLatLngs());
  });
  const kose = kollar.reduce((n, k) => n + k.length, 0);
  if (kollar.length <= 1 || kollar.length > DERE_PATLAT_LIMIT) {
    return { kol: kollar.length, kose, patladi: false };
  }
  layers.dere.clearLayers();
  kollar.forEach(p => layers.dere.addLayer(L.polyline(p, DERE_STIL)));
  return { kol: kollar.length, kose, patladi: true };
}

/* --- dere kolu silme kipi: kipteyken bir kola tıklamak onu kaldırır --- */
let dereSilModu = false;
function dereSilTikla(e) {
  if (!dereSilModu) return;
  L.DomEvent.stop(e);
  layers.dere.removeLayer(e.target);
  $("editInfo").textContent = `Dere kolu silindi (kalan ${layers.dere.getLayers().length}).`;
}
function setDereSil(acik) {
  dereSilModu = acik;
  $("btnDereDel").classList.toggle("picking", acik);
  map.getContainer().style.cursor = acik ? "not-allowed" : "";
  layers.dere.eachLayer(l => {
    l.off("click", dereSilTikla);
    if (acik) l.on("click", dereSilTikla);
  });
  if (acik) $("editInfo").textContent = "Silme kipi açık — kaldırmak istediğiniz dere koluna tıklayın.";
}

/* Yeni dere kolu çizme (Geoman Line aracı). */
function setDereCiz(acik) {
  if (!map.pm) return;
  $("btnDereDraw").classList.toggle("picking", acik);
  if (acik) {
    setDereSil(false);
    map.pm.enableDraw("Line", { snappable: false, finishOn: "dblclick" });
    $("editInfo").textContent = "Çizim açık — tıklayarak dereyi çizin, çift tıkla bitirin.";
  } else if (map.pm.disableDraw) {
    map.pm.disableDraw();
  }
}

/* Çizim biten kol haritanın köküne düşer; dere katmanına taşınmalı ki
   “Uygula”da katmandan okunsun ve L/Lc hesabına girsin. */
if (window.L && L.PM) {
  map.on("pm:create", (e) => {
    const l = e.layer;
    if (!l || !l.getLatLngs) return;
    map.removeLayer(l);
    if (l.setStyle) l.setStyle(DERE_STIL);
    layers.dere.addLayer(l);
    if (l.pm) l.pm.enable(PM_SECENEK);
    if (dereSilModu) l.on("click", dereSilTikla);
    $("btnDereDraw").classList.remove("picking");
    $("editInfo").textContent =
      `Yeni dere kolu eklendi (toplam ${layers.dere.getLayers().length}).`;
  });
}

/* Douglas-Peucker — DEM'den gelen merdiven basamaklı sınırı elle düzenlenebilir
   hale getirir. tol derece cinsinden (metre / 111320). kos = cos(enlem):
   boylam derecesi enlemde kısaldığı için mesafe ona göre ölçeklenir.         */
function dpSadelestir(noktalar, tol, kos) {
  if (noktalar.length < 3) return noktalar;
  const dik = (p, a, b) => {
    const px = (p.lng - a.lng) * kos, py = p.lat - a.lat;
    const bx = (b.lng - a.lng) * kos, by = b.lat - a.lat;
    if (bx === 0 && by === 0) return Math.hypot(px, py);
    const t = (px * bx + py * by) / (bx * bx + by * by);
    const u = Math.max(0, Math.min(1, t));
    return Math.hypot(px - u * bx, py - u * by);
  };
  const tut = new Array(noktalar.length).fill(false);
  tut[0] = tut[noktalar.length - 1] = true;
  const yigin = [[0, noktalar.length - 1]];
  while (yigin.length) {
    const [i, j] = yigin.pop();
    let enUzak = -1, idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = dik(noktalar[k], noktalar[i], noktalar[j]);
      if (d > enUzak) { enUzak = d; idx = k; }
    }
    if (enUzak > tol && idx > 0) { tut[idx] = true; yigin.push([i, idx], [idx, j]); }
  }
  return noktalar.filter((_, i) => tut[i]);
}

/* Havza sınırını ve dereleri verilen toleransla sadeleştirir (haritada, yerinde). */
function sadelestirGeometri(metre) {
  const tol = metre / 111320;
  const kos = Math.cos(map.getCenter().lat * Math.PI / 180) || 1;
  let once = 0, sonra = 0;
  duzenlenebilirKatmanlar().forEach(l => {
    if (!l.getLatLngs) return;
    const kapali = l instanceof L.Polygon;
    const isle = (a) => {
      if (!a.length) return a;
      if (Array.isArray(a[0])) return a.map(isle);
      once += a.length;
      let y = dpSadelestir(a, tol, kos);
      // poligon halkası en az 3 köşe olmalı; aşırı sadeleşirse dokunma
      if (kapali && y.length < 4) y = a;
      sonra += y.length;
      return y;
    };
    l.setLatLngs(isle(l.getLatLngs()));
    if (l.pm && l.pm.enabled()) { l.pm.disable(); l.pm.enable(PM_SECENEK); }
  });
  return { once, sonra };
}

function setGeomEdit(acik) {
  const btn = $("btnEditGeom"), ok = $("btnEditApply"), iptal = $("btnEditCancel");
  if (acik) {
    if (!S.havza) return setStatus("delinStatus", "Önce havzayı çıkarın", "err");
    if (!L.PM) return setStatus("delinStatus",
      "Düzenleme kütüphanesi yüklenemedi (internet bağlantısı gerekiyor).", "err");
    editYedek = {
      havza: layers.havza.toGeoJSON(), dere: layers.dere.toGeoJSON(),
      kanal: layers.kanal.toGeoJSON(), sHavza: S.havza,
    };
    // düzenlerken havzaya tıklamak SİLME onayını açmasın
    layers.havza.eachLayer(l => { l.off("click"); l.unbindTooltip(); });
    const d = derePatlat();          // dere kollarını ayrı ayrı düzenlenebilir yap
    duzenlenebilirKatmanlar().forEach(l => l.pm.enable(PM_SECENEK));
    btn.classList.add("hidden"); ok.classList.remove("hidden"); iptal.classList.remove("hidden");
    $("editTools").classList.remove("hidden");
    const n = koseSayisi(layers.havza);
    // ~400 köşe hedefiyle tolerans öner (DEM adımı ≈ 30 m)
    $("editTol").value = Math.round(Math.max(20, Math.min(1000, 30 * (n + d.kose) / 800)));
    const dereMsg = d.kol === 0 ? "Haritada dere yok."
      : d.patladi ? `Dere ağı ${d.kol} ayrı kola bölündü (${d.kose} köşe) — her kol tek tek taşınıp silinebilir.`
      : `Dere ağı ${d.kol} kol / ${d.kose} köşe — ayrı kollara bölmek için fazla kalabalık, `
        + `önce “Sadeleştir”e basın (kol sayısı ${DERE_PATLAT_LIMIT} altına inince bölünür).`;
    setStatus("delinStatus", "Düzenleme açık — köşeyi sürükleyerek taşıyın, ara noktaya "
      + "tıklayarak yeni köşe ekleyin, köşeye sağ tıklayarak silin. Bitince “Uygula”ya basın."
      + `\nHavza sınırında ${n} köşe var; imlece en yakın ${PM_SECENEK.limitMarkersToCount} tanesi gösteriliyor.`
      + "\n" + dereMsg
      + (n + d.kose > 800 ? "\n⚠ DEM'den gelen geometri piksel merdiveni olduğu için çok köşeli: tek "
        + "köşeyi oynatmak havza ölçeğinde neredeyse hiçbir şey değiştirmez. Önce “Sadeleştir”i kullanın." : ""), "");
  } else {
    setDereCiz(false); setDereSil(false);
    duzenlenebilirKatmanlar().forEach(l => { if (l.pm.enabled()) l.pm.disable(); });
    btn.classList.remove("hidden"); ok.classList.add("hidden"); iptal.classList.add("hidden");
    $("editTools").classList.add("hidden");
    $("editInfo").textContent = "";
  }
}

$("btnEditSimplify").onclick = () => {
  const m = +$("editTol").value || 60;
  const { once, sonra } = sadelestirGeometri(m);
  // sadeleşme sonrası kol sayısı sınırın altına inmiş olabilir → tekrar dene
  const d = derePatlat();
  if (d.patladi) duzenlenebilirKatmanlar().forEach(l => {
    if (!l.pm.enabled()) l.pm.enable(PM_SECENEK);
    if (dereSilModu) l.on("click", dereSilTikla);
  });
  $("editInfo").textContent =
    `${once} → ${sonra} köşe (${m} m tolerans), dere ${d.kol} kol`
    + (d.patladi ? " (ayrı ayrı düzenlenebilir)" : "")
    + ". Yetmezse toleransı artırıp tekrar basın.";
};
$("btnDereDraw").onclick = () => setDereCiz(!$("btnDereDraw").classList.contains("picking"));
$("btnDereDel").onclick = () => setDereSil(!dereSilModu);

function cancelGeomEdit() {
  setGeomEdit(false);
  if (editYedek) {
    layers.havza.clearLayers(); layers.havza.addData(editYedek.havza);
    layers.dere.clearLayers(); if (editYedek.dere) layers.dere.addData(editYedek.dere);
    layers.kanal.clearLayers(); if (editYedek.kanal) layers.kanal.addData(editYedek.kanal);
    S.havza = editYedek.sHavza;
    editYedek = null;
  }
  setStatus("delinStatus", "Düzenleme iptal edildi, önceki geometri geri yüklendi.", "");
}

async function applyGeomEdit() {
  const havza = katmanGeojson(layers.havza);
  if (!havza) return setStatus("delinStatus", "Havza sınırı boş", "err");
  setGeomEdit(false);
  setStatus("delinStatus", "Düzenlenen geometriden parametreler yeniden üretiliyor… "
    + "(DEM okunuyor, büyük havzada 1–3 dakika sürebilir)", "loading");
  try {
    const r = await api("/api/basin-from-geometry", {
      havza_geojson: havza,
      dere_geojson: katmanGeojson(layers.dere),
      river_km2: +$("inpRivThr").value || 1,
      dem_source: $("inpDem").value,
    });
    applyBasinResult(r, "Düzenlenen havza uygulandı.");
    // geometri değişti → önceki hesap ve alana bağlı adımlar bayat
    S.sonuc = null; S.girdi = null;
    if ($("results")) $("results").innerHTML = "";
    if ($("hesapGrid")) $("hesapGrid").innerHTML = "";
    $("hesapDock")?.classList.add("hidden");
    setStatus("compStatus", "", "");
    updateComputeReady();
    editYedek = null;
    setStatus("delinStatus", $("delinStatus").textContent
      + "\n⚠ Alan değiştiği için CN (Adım 2) ve Yağış (Adım 3) yeniden çalıştırılmalı, "
      + "sonra tekrar hesaplayın.", "err");
  } catch (e) {
    setStatus("delinStatus", "Hata: " + e.message + "\nGeometri haritada duruyor; "
      + "düzeltip tekrar deneyebilir veya “Vazgeç” ile geri alabilirsiniz.", "err");
    $("btnEditApply").classList.remove("hidden");
    $("btnEditCancel").classList.remove("hidden");
    $("btnEditGeom").classList.add("hidden");
  }
}

$("btnEditGeom").onclick = () => setGeomEdit(true);
$("btnEditCancel").onclick = cancelGeomEdit;
$("btnEditApply").onclick = applyGeomEdit;

map.on("click", (ev) => {
  if (S.multi && S.multi.place) {
    // will be handled by modes/multi.js in stage5; for now just return to avoid picking
    return;
  }
});
