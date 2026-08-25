import { $ , setStatus } from "../ui/dom.js";
import { api } from "../core/api.js";
import { map, layers } from "./init.js";

/* ---- DSİ kaynak akarsu ağı (bağlam katmanı — hesaba GİRMEZ) ----
   Türkiye geneli üç ölçekte ~405.000 çizgi; tamamı gönderilemez, bu yüzden
   yalnız görünen pencere istenir ve harita gezdikçe yenilenir. Havza/dere
   çıkarımı yine DEM'den yapılır; bu katman göz kontrolü içindir.          */
layers.akarsu = L.geoJSON(null, {
  style: { color: "#1565c0", weight: 1.2, opacity: 0.85 },
  onEachFeature: (f, l) => {
    const p = f.properties || {};
    const ad = p.ad || p.tip || "akarsu";
    const km = p.uzunluk_m ? ` — ${(p.uzunluk_m / 1000).toFixed(2)} km` : "";
    l.bindTooltip(ad + km, { sticky: true });
  },
});
const AKARSU_MIN_ZOOM = 9;
let akarsuZaman = null, akarsuSira = 0;

async function akarsuYukle() {
  if (!$("akarsuAc").checked) return;
  if (map.getZoom() < AKARSU_MIN_ZOOM) {
    layers.akarsu.clearLayers();
    $("akarsuInfo").textContent =
      `yakınlaştırın (z≥${AKARSU_MIN_ZOOM}) — bu ölçekte tüm ülke yüklenemez`;
    return;
  }
  const b = map.getBounds();
  // Leaflet kaydırma sonrası ±180 dışında boylam döndürebilir; sunucu bunu
  // reddeder. Ayrıca NaN gelirse istek hiç kurulamaz — ikisini de kırp.
  const sy = (v, alt, ust) => Math.min(ust, Math.max(alt, Number(v)));
  const bati = sy(b.getWest(), -180, 179.999), dogu = sy(b.getEast(), -179.999, 180);
  const guney = sy(b.getSouth(), -90, 89.999), kuzey = sy(b.getNorth(), -89.999, 90);
  if (!(bati < dogu && guney < kuzey)) {
    $("akarsuInfo").textContent = "harita penceresi okunamadı";
    return;
  }
  const sira = ++akarsuSira;
  $("akarsuInfo").textContent = "yükleniyor…";
  let url = "";
  try {
    const q = new URLSearchParams({
      bati, guney, dogu, kuzey, olcek: $("akarsuOlcek").value,
    });
    url = "/api/akarsu?" + q.toString();
    let r;
    try {
      r = await api(url);
    } catch (ilk) {
      // Ağ düzeyinde kopma (sunucu yeniden başlıyor olabilir) → bir kez dene
      if (!(ilk instanceof TypeError)) throw ilk;
      await new Promise(res => setTimeout(res, 800));
      if (sira !== akarsuSira) return;
      r = await api(url);
    }
    if (sira !== akarsuSira) return;          // daha yeni bir istek yolda
    layers.akarsu.clearLayers();
    layers.akarsu.addData(r.geojson);
    $("akarsuInfo").textContent =
      `${r.sayi} kol · 1/${r.olcek}.000${r.otomatik ? " (otomatik)" : ""}`
      + (r.kirpildi ? ` — ${r.sinir} sınırı aşıldı, yakınlaştırın` : "");
  } catch (e) {
    if (sira !== akarsuSira) return;
    // "Failed to fetch" tek başına hiçbir şey söylemiyor: isteğin sunucuya
    // ulaşıp ulaşmadığını ayırt edebilmek için URL'yi ve hata türünü göster.
    console.error("akarsu isteği başarısız", { url, hata: e });
    const ag = (e instanceof TypeError);
    $("akarsuInfo").textContent =
      `Hata: ${e.name}: ${e.message}${ag ? " (istek sunucuya ulaşmadı)" : ""} — ${url}`;
  }
}

$("akarsuAc").onchange = () => {
  if ($("akarsuAc").checked) { layers.akarsu.addTo(map); akarsuYukle(); }
  else {
    layers.akarsu.remove(); layers.akarsu.clearLayers();
    $("akarsuInfo").textContent = "";
  }
};
$("akarsuOlcek").onchange = () => { if ($("akarsuAc").checked) akarsuYukle(); };
map.on("moveend zoomend", () => {
  if (!$("akarsuAc").checked) return;
  clearTimeout(akarsuZaman);
  akarsuZaman = setTimeout(akarsuYukle, 350);   // gezinirken istek yağmuru olmasın
});

/* veri kurulu değilse seçeneği kapat ve nasıl üretileceğini söyle */
(async function akarsuDurum() {
  try {
    const b = await api("/api/akarsu-bilgi");
    if (!b.var) {
      $("akarsuAc").disabled = true;
      $("akarsuOlcek").disabled = true;
      $("akarsuInfo").textContent = "veri yok — tools/mdb_akarsu_cikar.py ile üretin";
    } else {
      $("akarsuInfo").textContent =
        b.olcekler.map(o => `1/${o.olcek}.000: ${o.kol.toLocaleString("tr")}`).join(" · ");
    }
  } catch (e) { /* uç yoksa sessiz geç */ }
})();

