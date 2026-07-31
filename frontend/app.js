/* Taşkın Hesap — arayüz mantığı */
"use strict";

const S = {
  outlet: null, havza: null, kotlar: Array(11).fill(""),
  istasyonlar: [], thiessen: [], yagis: [], dplvList: null, sonuc: null,
};
const $ = (id) => document.getElementById(id);
const api = async (url, body, isForm) => {
  const opt = body === undefined ? {} :
    isForm ? { method: "POST", body } :
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const r = await fetch(url, opt);
  const j = await r.json();
  if (!r.ok || j.hata) throw new Error(j.hata || r.statusText);
  return j;
};
const fmt = (x, d = 2) => (x === null || x === undefined || isNaN(x)) ? "—" : (+x).toFixed(d);
// istasyon kurumuna göre renk (DMİ/MGM vs DSİ)
const kurumColor = (k) => k === "DSİ" ? "#e65100" : k === "DMİ" ? "#1565c0"
  : k === "Elle" ? "#2e7d32" : "#7d6e4f";

/* ---- Thiessen poligonlarını yağış miktarına göre mavi tonlarıyla boya ----
   Az yağış = açık mavi, çok yağış = koyu mavi. Boyama, seçili tekerrür
   sütunundaki (vars. 100 yıl) değerlere göre yapılır.                        */
const RAIN_BLUES = ["#e3f2fd", "#bbdefb", "#90caf9", "#64b5f6", "#42a5f5",
                    "#2196f3", "#1e88e5", "#1976d2", "#1565c0", "#0d47a1"];
function rainRange() {
  // seçili sütunda dolu değeri olan aktif istasyonlardan min/max
  const c = S.rainColorCol ?? 5;
  const vals = (S.thiessen || []).filter(t => t.agirlik > 0)
    .map(t => (S.rainValues && S.rainValues[t.name] || [])[c])
    .filter(v => v != null && !isNaN(v)).map(Number);
  if (!vals.length) return null;
  return { min: Math.min(...vals), max: Math.max(...vals), n: vals.length, col: c };
}
function rainColor(name) {
  const rng = rainRange();
  if (!rng) return null;
  const v = (S.rainValues && S.rainValues[name] || [])[rng.col];
  if (v == null || isNaN(v)) return null;
  const t = rng.max > rng.min ? (v - rng.min) / (rng.max - rng.min) : 0.6;
  return RAIN_BLUES[Math.min(RAIN_BLUES.length - 1,
    Math.max(0, Math.round(t * (RAIN_BLUES.length - 1))))];
}
function thiessenStyle(f) {
  const ad = f && f.properties && f.properties.name;
  const col = ad ? rainColor(ad) : null;
  if (!col) return { color: "#7d6e4f", weight: 1.5, fillOpacity: .05, dashArray: "3 3" };
  return { color: "#0d47a1", weight: 1.5, fillColor: col, fillOpacity: .65, dashArray: null };
}
function recolorThiessen() {
  if (layers.thiessen) layers.thiessen.setStyle(thiessenStyle);
  renderRainLegend();
}
function renderRainLegend() {
  const el = $("rainLegend");
  if (!el) return;
  const rng = rainRange();
  if (!rng) { el.innerHTML = ""; return; }
  const etiket = RAIN_COLS[rng.col] === "OEY" ? "OEY" : "P" + RAIN_COLS[rng.col];
  el.innerHTML = `<span class="small">Alan boyaması — ${etiket} yağışı (mm):</span>
    <span class="small">${rng.min.toFixed(1)}</span>` +
    RAIN_BLUES.map(c => `<i style="background:${c}"></i>`).join("") +
    `<span class="small">${rng.max.toFixed(1)}</span>
     <span class="small">(${rng.n} istasyon)</span>`;
}

/* ---------------- harita ---------------- */
const map = L.map("map").setView([39.2, 32.8], 6);
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
const sat = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { maxZoom: 19, attribution: "Esri World Imagery" });
L.control.layers({ "Harita": osm, "Uydu": sat }).addTo(map);
const layers = {
  havza: L.geoJSON(null, {
    style: { color: "#0d5c63", weight: 2, fillOpacity: .08 },
    onEachFeature: (f, layer) => {
      layer.on("click", onHavzaClick);
      layer.bindTooltip("🗑 Havzayı sil (tıkla) — parametre, yağış, hidrograf dahil", { sticky: true });
    },
  }).addTo(map),
  dere: L.geoJSON(null, { style: { color: "#3b8ea5", weight: 1.5 } }).addTo(map),
  kanal: L.geoJSON(null, { style: { color: "#c73e3a", weight: 2.5, dashArray: "6 4" } }).addTo(map),
  thiessen: L.geoJSON(null, { style: (f) => thiessenStyle(f) }).addTo(map),
  markers: L.layerGroup().addTo(map),
};

/* ---------------- harita adres arama (il/ilçe/mahalle) ---------------- */
(function geocodeSearch() {
  const inp = $("geoQ"), box = $("geoResults");
  let items = [], active = -1, timer = null, seq = 0, geoMarker = null;
  const hide = () => { box.classList.add("hidden"); box.innerHTML = ""; active = -1; };
  function render() {
    if (!items.length) { box.innerHTML = `<div class="geo-empty">Sonuç yok</div>`; box.classList.remove("hidden"); return; }
    box.innerHTML = items.map((it, i) =>
      `<div class="geo-item${i === active ? " active" : ""}" data-i="${i}">
         <span class="geo-type">${it.tur || ""}</span> ${it.ad}</div>`).join("");
    box.classList.remove("hidden");
    box.querySelectorAll(".geo-item").forEach(el =>
      el.onclick = () => choose(+el.dataset.i));
  }
  function choose(i) {
    const it = items[i]; if (!it) return;
    inp.value = it.ad; hide();
    const s = it.sinir;
    if (s && s.length === 4) map.fitBounds([[+s[0], +s[2]], [+s[1], +s[3]]], { maxZoom: 15 });
    else map.setView([it.lat, it.lon], 13);
    if (geoMarker) geoMarker.remove();
    geoMarker = L.marker([it.lat, it.lon]).addTo(map)
      .bindTooltip(it.ad, { direction: "top" }).openTooltip();
  }
  async function run(q) {
    const my = ++seq;
    try {
      const r = await api("/api/geocode?q=" + encodeURIComponent(q));
      if (my !== seq) return;                 // eski istek — yoksay
      items = Array.isArray(r) ? r : []; active = -1; render();
    } catch (e) { if (my === seq) { items = []; render(); } }
  }
  inp.addEventListener("input", () => {
    const q = inp.value.trim();
    clearTimeout(timer);
    if (q.length < 2) { hide(); return; }
    timer = setTimeout(() => run(q), 350);    // debounce (Nominatim politikası)
  });
  inp.addEventListener("keydown", (e) => {
    if (box.classList.contains("hidden") || !items.length) {
      if (e.key === "Enter") { e.preventDefault(); if (inp.value.trim().length >= 2) run(inp.value.trim()); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % items.length; render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + items.length) % items.length; render(); }
    else if (e.key === "Enter") { e.preventDefault(); choose(active < 0 ? 0 : active); }
    else if (e.key === "Escape") { hide(); }
  });
  document.addEventListener("click", (e) => { if (!$("mapSearch").contains(e.target)) hide(); });
})();

/* ---------------- adım gezinme ---------------- */
const STEP_KEYS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
document.querySelectorAll(".step").forEach(b => {
  b.tabIndex = 0;
  b.onclick = () => activateStep(+b.dataset.step);
  b.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activateStep(+b.dataset.step); }
    const dir = STEP_KEYS[e.key];
    if (dir) {
      e.preventDefault();
      const n = +b.dataset.step + dir;
      const next = document.querySelector(`.step[data-step="${n < 1 ? 7 : n > 7 ? 1 : n}"]`);
      if (next) next.focus();
    }
  };
});

function activateStep(n) {
  document.querySelectorAll(".step").forEach(x => x.classList.remove("active"));
  document.querySelector(`.step[data-step="${n}"]`).classList.add("active");
  document.querySelectorAll(".page").forEach(p =>
    p.classList.toggle("hidden", p.dataset.page !== String(n)));
  if (n === 4 && S.havza && !S.thiessen.length) useDefaultStations();
  $("rainDock").classList.toggle("hidden", n !== 5);
  if (n === 5) { renderRainTable(); renderDplvGrid(); }
  if (n === 6 && +$("inpA").value > 0 && +$("inpA").value <= 1) {
    $("inpRasyonel").checked = true;
    $("rasyonelBox").open = true;
  }
  if (n === 6) updateComputeReady();
  if (n === 7) {
    agiKatmanAc();
    // havza çıkarıldıysa alanı BTFA'ya taşı (kullanıcı yine de değiştirebilir)
    if (!$("btfaAlan").value && +$("inpA").value) $("btfaAlan").value = $("inpA").value;
  }
}
const markDone = (n) => document.querySelector(`.step[data-step="${n}"]`).classList.add("done");
const setStatus = (id, msg, cls = "") => {
  const e = $(id); e.textContent = msg; e.className = "status " + cls;
  const loader = $("loader");
  if (loader) loader.classList.toggle("hidden", cls !== "loading");
};

function updateComputeReady() {
  const ready = $("inpA").value && $("inpL").value && S.P24w != null;
  $("btnCompute").disabled = !ready;
}

/* ---------------- ADIM 1: havza ---------------- */
let picking = false;
$("btnPick").onclick = () => {
  picking = !picking;
  $("btnPick").classList.toggle("picking", picking);
  map.getContainer().style.cursor = picking ? "crosshair" : "";
  if (picking) setStatus("delinStatus", "Haritaya tıklayın (Esc ile iptal)");
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && picking) {
    picking = false;
    $("btnPick").classList.remove("picking");
    map.getContainer().style.cursor = "";
    setStatus("delinStatus", "İptal edildi", "");
  }
  if (e.key === "Escape" && S.stPlace) {
    S.stPlace = false;
    map.getContainer().style.cursor = "";
    setStatus("thStatus", "İptal edildi", "");
  }
});
/* ---- bilgi amaçlı harita katmanları ----
   Hesaba GİRMEZ; proje sınırı, yollar, yerleşim, mevcut tesis gibi bağlam
   katmanlarını haritada göstermek içindir.                                 */
const INFO_RENK = ["#8e24aa", "#00838f", "#ef6c00", "#5d4037", "#c2185b",
                   "#455a64", "#1565c0", "#2e7d32"];
S.infoLayers = [];
function renderInfoLayers() {
  const el = $("infoLayers");
  if (!el) return;
  if (!S.infoLayers.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<b>Bilgi katmanları</b> (hesaba girmez):<br>` + S.infoLayers.map((k, i) =>
    `<label class="inline" style="gap:4px">
       <input type="checkbox" class="info-chk" data-i="${i}" ${k.gorunur ? "checked" : ""} style="width:auto">
       <span style="color:${k.renk};font-weight:700">■</span> ${k.ad}
       <span style="color:#8a857e">(${k.sayi})</span>
       <button class="link-btn" data-del="${i}" title="Kaldır">✕</button>
     </label>`).join("<br>");
  el.querySelectorAll(".info-chk").forEach(c => c.onchange = () => {
    const k = S.infoLayers[+c.dataset.i];
    k.gorunur = c.checked;
    if (c.checked) k.layer.addTo(map); else k.layer.remove();
  });
  el.querySelectorAll("button[data-del]").forEach(b => b.onclick = () => {
    const i = +b.dataset.del;
    S.infoLayers[i].layer.remove();
    S.infoLayers.splice(i, 1);
    renderInfoLayers();
  });
}
$("infoFile").onchange = async () => {
  const dosyalar = Array.from($("infoFile").files || []);
  if (!dosyalar.length) return;
  for (const f of dosyalar) {
    setStatus("delinStatus", `“${f.name}” bilgi katmanı olarak okunuyor…`, "loading");
    try {
      const fd = new FormData(); fd.append("file", f);
      const r = await api("/api/bilgi-katmani", fd, true);
      const renk = INFO_RENK[S.infoLayers.length % INFO_RENK.length];
      const layer = L.geoJSON(r.geojson, {
        style: { color: renk, weight: 2, fillOpacity: .08, dashArray: "5 3" },
        pointToLayer: (f2, ll) => L.circleMarker(ll,
          { radius: 5, color: renk, fillColor: renk, fillOpacity: .85 }),
        onEachFeature: (f2, lyr) => {
          const ad = f2.properties && f2.properties.ad;
          if (ad) lyr.bindTooltip(ad, { sticky: true });
        },
      }).addTo(map);
      S.infoLayers.push({ ad: r.ad || f.name, layer, renk, gorunur: true, sayi: r.sayi });
      renderInfoLayers();
      const tur = Object.entries(r.turler || {}).map(([k, v]) => `${v} ${k}`).join(", ");
      setStatus("delinStatus", `Bilgi katmanı eklendi: ${r.ad} — ${r.sayi} geometri (${tur}). ` +
        `Hesaba girmez, yalnız haritada gösterilir.`, "ok");
    } catch (e) {
      setStatus("delinStatus", `“${f.name}” eklenemedi: ${e.message}`, "err");
    }
  }
  $("infoFile").value = "";
};

/* ---- koordinatlı raster altlıklar (1/25000 paftalar) ----
   Dosya arka uca yüklenir, orada Web Mercator'a yeniden projeksiyonlanıp XYZ
   karo olarak sunulur; burada yalnızca L.tileLayer ile gösterilir.          */
S.rasterLayers = [];      // [{meta, layer, gorunur, saydam}]

function renderRasterLayers() {
  const el = $("rasterLayers");
  if (!el) return;
  if (!S.rasterLayers.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<b>Raster altlıklar:</b><br>` + S.rasterLayers.map((k, i) =>
    `<label class="inline" style="gap:4px">
       <input type="checkbox" class="ras-chk" data-i="${i}" ${k.gorunur ? "checked" : ""} style="width:auto">
       🗺 ${k.meta.baslik || k.meta.ad}
       <input type="range" class="ras-op" data-i="${i}" min="10" max="100" value="${Math.round(k.saydam * 100)}"
              title="Saydamlık" style="width:80px">
       <button class="link-btn" data-zoom="${i}" title="Katmana git">⌖</button>
       <button class="link-btn" data-del="${i}" title="Kaldır">✕</button>
     </label>`).join("<br>");
  el.querySelectorAll(".ras-chk").forEach(c => c.onchange = () => {
    const k = S.rasterLayers[+c.dataset.i];
    k.gorunur = c.checked;
    if (c.checked) k.layer.addTo(map); else k.layer.remove();
  });
  el.querySelectorAll(".ras-op").forEach(r => r.oninput = () => {
    const k = S.rasterLayers[+r.dataset.i];
    k.saydam = +r.value / 100;
    k.layer.setOpacity(k.saydam);
  });
  el.querySelectorAll("button[data-zoom]").forEach(b => b.onclick = () => {
    const k = S.rasterLayers[+b.dataset.zoom];
    if (k.meta.sinir) map.fitBounds(k.meta.sinir, { padding: [20, 20] });
  });
  el.querySelectorAll("button[data-del]").forEach(b => b.onclick = async () => {
    const i = +b.dataset.del, k = S.rasterLayers[i];
    if (!confirm(`“${k.meta.baslik || k.meta.ad}” altlığı sunucudan silinsin mi?`)) return;
    try { await api("/api/raster-delete", { ad: k.meta.ad }); } catch (e) {}
    k.layer.remove();
    S.rasterLayers.splice(i, 1);
    renderRasterLayers();
  });
}

/* Meta bilgisinden Leaflet karo katmanı kurar (haritaya ekler). */
function rasterKatmanEkle(meta) {
  if (S.rasterLayers.some(k => k.meta.ad === meta.ad)) return;
  const layer = L.tileLayer(`/api/raster/${encodeURIComponent(meta.ad)}/{z}/{x}/{y}.png`, {
    maxZoom: 22, opacity: 1, bounds: meta.sinir || undefined,
    attribution: meta.baslik || meta.ad,
  }).addTo(map);
  S.rasterLayers.push({ meta, layer, gorunur: true, saydam: 1 });
  renderRasterLayers();
}

async function loadRasterLayers() {
  try {
    const r = await api("/api/raster-layers");
    (r.katmanlar || []).forEach(rasterKatmanEkle);
  } catch (e) { /* altlık yoksa sessiz geç */ }
}
loadRasterLayers();

/* MrSID kod çözücüsü var mı — .sid seçilir seçilmez söyle. Sunucuda sürücü
   kurulamıyor (tescilli DSDK); kullanıcının yüzlerce MB'ı yükleyip sonunda
   hata almasındansa dosya seçilirken uyarmak gerekiyor.                    */
let mrsidDurum = null;
(async function mrsidSorgula() {
  try { mrsidDurum = await api("/api/raster-converter"); } catch (e) { /* uç yoksa geç */ }
})();

function sidUyar(dosyalar) {
  if (!mrsidDurum || mrsidDurum.mrsid) return false;
  if (!dosyalar.some(f => /\.(sid|ecw)$/i.test(f.name))) return false;
  setStatus("delinStatus", mrsidDurum.sunucu
    ? "Bu sunucu .sid (MrSID) okuyamıyor — sürücü tescilli olduğu için kurulamıyor. "
      + "Dosyayı QGIS ile ya da “gdal_translate -of GTiff pafta.sid pafta.tif” "
      + "komutuyla GeoTIFF'e çevirip onu yükleyin (GeoTIFF doğrudan açılır)."
    : "MrSID kod çözücüsü kurulu değil. OSGeo4W'den 'gdal-mrsid' eklentisini kurun "
      + "ya da dosyayı elle GeoTIFF'e çevirip yükleyin.", "err");
  return true;
}

$("rasterFile").onchange = () => sidUyar(Array.from($("rasterFile").files || []));

$("btnRasterAdd").onclick = async () => {
  const dosyalar = Array.from($("rasterFile").files || []);
  if (!dosyalar.length) return setStatus("delinStatus", "Önce raster dosyasını seçin", "err");
  if (sidUyar(dosyalar)) return;             // boşuna yükleme yapma
  const sid = dosyalar.some(f => /\.sid$/i.test(f.name));
  const worldVar = dosyalar.some(f => /\.(sdw|tfw|wld|prj)$/i.test(f.name));
  if (sid && !worldVar && !$("rasterCrs").value.trim()) {
    // .sid'lerde georeferans çoğu kez yalnız .sdw'dedir; uyar ama engelleme
    setStatus("delinStatus", "Uyarı: .sid seçtiniz ama yanında .sdw/.tfw yok ve CRS "
      + "boş. Georeferans dosyanın içinde değilse altlık yanlış yere oturur.", "err");
  }
  setStatus("delinStatus",
    `${dosyalar.map(f => "“" + f.name + "”").join(", ")} yükleniyor…`
    + (sid ? " (.sid → GeoTIFF dönüşümü sürebilir)" : ""), "loading");
  try {
    const fd = new FormData();
    dosyalar.forEach(f => fd.append("files", f));
    const crs = $("rasterCrs").value.trim();
    const url = "/api/raster-add" + (crs ? `?crs=${encodeURIComponent(crs)}` : "");
    const meta = await api(url, fd, true);
    rasterKatmanEkle(meta);
    if (meta.sinir) map.fitBounds(meta.sinir, { padding: [20, 20] });
    setStatus("delinStatus", `Altlık eklendi: ${meta.baslik || meta.ad} — `
      + `${meta.genislik}×${meta.yukseklik} piksel, ${meta.bant} bant, ${meta.etkin_crs}.`, "ok");
    $("rasterFile").value = "";
  } catch (e) {
    setStatus("delinStatus", "Altlık eklenemedi: " + e.message, "err");
  }
};

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

/* ---- AGİ (Akım Gözlem İstasyonu) katmanı + noktasal frekans analizi ----
   Sentetik yöntemlerden bağımsız ikinci bir yol: gözlenmiş yıllık pik akımlara
   DSİ ekstrem dağılım hesabı (ornek.xlsm ile birebir, bkz. backend/core/tfa.py).
   İstasyonlar havza poligonuyla sorgulanır; tampon dışarıyı da kapsar, çünkü
   çıkarılan havzada AGİ olmayabilir ve komşu havza karşılaştırması gerekir.  */
layers.agi = L.layerGroup();
S.agiSecili = null;        // noktasal analiz (tek istasyon)
S.agiBolgesel = new Set(); // bölgesel analiz (çok istasyon)
S.agiListe = [];

const agiRenk = (s) => (s.kurum === "EİE" ? "#6a1b9a" : "#e65100");

function agiIsaretle() {
  layers.agi.eachLayer(l => {
    const s = l.agi;
    if (!s) return;
    const secili = S.agiSecili && S.agiSecili.kod === s.kod;
    const bolgesel = S.agiBolgesel.has(s.kod);
    l.setStyle({
      radius: secili ? 8 : (bolgesel ? 7 : 5),
      color: secili ? "#000" : (bolgesel ? "#00695c" : agiRenk(s)),
      weight: secili ? 3 : (bolgesel ? 2.5 : 1.5),
      fillColor: agiRenk(s),
      fillOpacity: s.icinde === false ? 0.25 : 0.85,
    });
  });
  $("btnTfa").disabled = !S.agiSecili;
  $("btnBtfa").disabled = S.agiBolgesel.size < 2;
  const n = S.agiBolgesel.size;
  $("btfaStatus").textContent = n
    ? `${n} istasyon bölgesel analize işaretli` + (n < 2 ? " — en az 2 gerekir" : "")
    : "";
  // aktarım açılır listesi yalnız işaretlilerden seçilebilsin
  const sec = $("btfaTransfer"), onceki = sec.value;
  sec.innerHTML = '<option value="">yok</option>'
    + S.agiListe.filter(s => S.agiBolgesel.has(s.kod))
        .map(s => `<option value="${s.kod}">${s.kod} — ${s.ad || ""}</option>`).join("");
  sec.value = S.agiBolgesel.has(onceki) ? onceki : "";
}

function agiBolgeselDegis(kod, ac) {
  if (ac) S.agiBolgesel.add(kod); else S.agiBolgesel.delete(kod);
  agiIsaretle();
}

function agiSec(s) {
  S.agiSecili = s;
  agiIsaretle();
  $("agiInfo").innerHTML =
    `<b>${s.kod}</b> ${s.ad || ""} — ${s.kurum} · ${s.yil_sayisi} yıl `
    + `(${s.ilk_yil}–${s.son_yil})`
    + (s.yagis_alani ? ` · yağış alanı ${fmt(s.yagis_alani, 1)} km²` : "");
  $("tfaSonuc").innerHTML = "";
  setStatus("tfaStatus", "", "");
}

function agiListele(ist) {
  S.agiListe = ist;
  const icinde = ist.filter(s => s.icinde !== false);
  const disinda = ist.filter(s => s.icinde === false);
  // Yağış alanı bilinmeyen istasyon bölgesel analize giremez (indeks debi
  // bağıntısı alana dayanıyor); kutusu kapalı gösterilir.
  const sat = (s) => `<tr data-kod="${s.kod}" class="agi-sat">`
    + `<td><input type="checkbox" class="agi-bol" data-kod="${s.kod}"`
    + `${S.agiBolgesel.has(s.kod) ? " checked" : ""}`
    + `${s.yagis_alani ? "" : " disabled title='yağış alanı bilinmiyor'"}></td>`
    + `<td>${s.kod}</td><td>${s.ad || ""}</td><td>${s.kurum}</td>`
    + `<td style="text-align:right">${s.yil_sayisi}</td>`
    + `<td style="text-align:right">${s.ilk_yil}–${s.son_yil}</td>`
    + `<td style="text-align:right">${s.yagis_alani ? fmt(s.yagis_alani, 1) : "—"}</td></tr>`;
  const bas = "<tr><th title='bölgesel analize dahil et'>BTFA</th><th>Kod</th><th>Ad</th>"
    + "<th>Kurum</th><th>Yıl</th><th>Aralık</th><th>A (km²)</th></tr>";
  let h = '<div class="rain-tools"><button id="agiHepsi" class="small-btn">'
    + "Tümünü BTFA'ya ekle</button>"
    + '<button id="agiHicbiri" class="small-btn">Seçimi temizle</button></div>';
  if (icinde.length) h += `<p class="small"><b>Havza içinde (${icinde.length})</b></p>`
    + `<table class="tbl small">${bas}${icinde.map(sat).join("")}</table>`;
  if (disinda.length) h += `<p class="small"><b>Çevrede (${disinda.length})</b></p>`
    + `<table class="tbl small">${bas}${disinda.map(sat).join("")}</table>`;
  if (!icinde.length && !disinda.length) h = '<p class="small">Bu alanda yeterli uzunlukta AGİ yok.</p>';
  $("agiListe").innerHTML = h;

  $("agiListe").querySelectorAll(".agi-bol").forEach(cb => {
    cb.onclick = (e) => { e.stopPropagation(); agiBolgeselDegis(cb.dataset.kod, cb.checked); };
  });
  $("agiListe").querySelectorAll(".agi-sat").forEach(tr => {
    tr.onclick = () => {
      const s = ist.find(x => x.kod === tr.dataset.kod);
      if (s) { agiSec(s); map.setView([s.enlem, s.boylam], Math.max(map.getZoom(), 11)); }
    };
  });
  const hepsi = $("agiHepsi"), hicbiri = $("agiHicbiri");
  if (hepsi) hepsi.onclick = () => {
    ist.forEach(s => { if (s.yagis_alani) S.agiBolgesel.add(s.kod); });
    agiListele(ist);
  };
  if (hicbiri) hicbiri.onclick = () => { S.agiBolgesel.clear(); agiListele(ist); };
  agiIsaretle();
}

async function agiYukle() {
  const enAz = +$("agiEnAzYil").value || 10;
  const kurum = $("agiKurum").value;
  setStatus("tfaStatus", "AGİ'ler getiriliyor…", "loading");
  try {
    let r;
    if (S.havza) {
      r = await api("/api/agi-havza", {
        geometri: (S.havza.features ? S.havza.features[0].geometry : S.havza.geometry || S.havza),
        tampon_derece: +$("agiTampon").value || 0,
        en_az_yil: enAz, kurum,
      });
    } else {
      const b = map.getBounds();
      const q = new URLSearchParams({
        bati: b.getWest(), guney: b.getSouth(), dogu: b.getEast(), kuzey: b.getNorth(),
        en_az_yil: enAz, kurum,
      });
      r = await api("/api/agi?" + q.toString());
    }
    layers.agi.clearLayers();
    r.istasyonlar.forEach(s => {
      if (s.enlem == null || s.boylam == null) return;
      const m = L.circleMarker([s.enlem, s.boylam], { radius: 5 });
      m.agi = s;
      m.bindTooltip(`${s.kod} — ${s.ad || ""} (${s.yil_sayisi} yıl)`, { sticky: true });
      m.on("click", () => agiSec(s));
      m.addTo(layers.agi);
    });
    layers.agi.addTo(map);
    agiIsaretle();
    agiListele(r.istasyonlar);
    setStatus("tfaStatus", `${r.istasyonlar.length} istasyon bulundu — `
      + "haritadan ya da listeden birini seçin.", "ok");
  } catch (e) {
    setStatus("tfaStatus", "AGİ'ler getirilemedi: " + e.message, "err");
  }
}

async function agiKatmanAc() {
  try {
    const b = await api("/api/agi-bilgi");
    if (!b.var) {
      $("btnAgiHavza").disabled = true;
      $("agiInfo").textContent =
        "veri yok — tools/agi_veritabani_olustur.py ile üretin";
      return;
    }
    if (!$("agiInfo").textContent) {
      $("agiInfo").textContent = `${b.istasyon.toLocaleString("tr")} istasyon · `
        + `${b.pik.toLocaleString("tr")} yıllık pik · ${b.ilk_yil}–${b.son_yil}`;
    }
  } catch (e) { /* uç yoksa sessiz geç */ }
}

$("btnAgiHavza").onclick = agiYukle;

/* ---- NTFA sonuç tablosu (Excel SONUÇLAR sayfasının karşılığı) ---- */
function tfaCiz(o) {
  const T = o.tekerrur;
  const bas = (h) => `<th style="text-align:right">${h}</th>`;
  let h = `<h3 class="small">${o.istasyon}</h3>`;

  h += '<p class="small"><b>Tekerrür debileri (m³/s)</b></p><table class="tbl small">'
    + "<tr><th>Dağılım</th>" + T.map(t => bas(t)).join("") + "<th>Kabul</th></tr>";
  o.debiler.forEach(d => {
    h += `<tr${d.kabul_edilen ? ' style="font-weight:600"' : ""}><td>${d.dagilim}</td>`
      + d.q.map(v => `<td style="text-align:right">${v == null ? "—" : fmt(v, 1)}</td>`).join("")
      + `<td style="text-align:center">${d.kabul_edilen ? "****" : ""}</td></tr>`;
  });
  h += "</table>";

  const p = o.parametreler;
  h += '<p class="small"><b>İstatistik parametreler</b></p><table class="tbl small">'
    + `<tr><td>Yıl sayısı</td><td style="text-align:right">${p.yil_sayisi}</td>`
    + `<td>Lineer ortalama</td><td style="text-align:right">${fmt(p.lineer_ortalama, 3)}</td></tr>`
    + `<tr><td>Lineer çarpıklık</td><td style="text-align:right">${fmt(p.lineer_carpiklik, 4)}</td>`
    + `<td>Lineer std. sapma</td><td style="text-align:right">${fmt(p.lineer_standart_sapma, 3)}</td></tr>`
    + `<tr><td>Logaritmik çarpıklık</td><td style="text-align:right">${fmt(p.logaritmik_carpiklik, 4)}</td>`
    + `<td>Logaritmik ortalama</td><td style="text-align:right">${fmt(p.logaritmik_ortalama, 4)}</td></tr>`
    + `<tr><td></td><td></td><td>Logaritmik std. sapma</td>`
    + `<td style="text-align:right">${fmt(p.logaritmik_standart_sapma, 4)}</td></tr></table>`;

  h += '<p class="small"><b>Simirnov-Kolmogorov testi</b></p><table class="tbl small">'
    + "<tr><th>Dağılım</th>" + bas("Teorik Pi") + bas("Amprik Pi") + bas("Dmaks")
    + bas("Gözlem") + o.ks_anlamlilik.map(a => bas(Math.round(a * 100) + "%")).join("") + "</tr>";
  o.ks_testi.forEach(s => {
    if (s.dmax == null) {
      h += `<tr><td>${s.dagilim}</td><td colspan="9" class="small">—3 &gt; Cs &gt; 3, hesaplanmadı</td></tr>`;
      return;
    }
    h += `<tr><td>${s.dagilim}</td>`
      + `<td style="text-align:right">${fmt(s.teorik_pi, 4)}</td>`
      + `<td style="text-align:right">${fmt(s.amprik_pi, 4)}</td>`
      + `<td style="text-align:right">${fmt(s.dmax, 4)}</td>`
      + `<td style="text-align:right">${fmt(s.gozlem, 2)}</td>`
      + o.ks_anlamlilik.map(a =>
          `<td style="text-align:center">${s.kabul[a] ? "Kabul" : "Red"}</td>`).join("")
      + "</tr>";
  });
  h += "</table>";
  h += `<p class="small"><b>NOT:</b> ${o.kabul_edilen_adi} dağılımı uygundur.</p>`;
  $("tfaSonuc").innerHTML = h;
}

$("btnTfa").onclick = async () => {
  if (!S.agiSecili) return;
  setStatus("tfaStatus", "Frekans analizi yapılıyor…", "loading");
  try {
    const o = await api("/api/tfa", {
      kod: S.agiSecili.kod,
      ilk_yil: +$("tfaIlkYil").value || 0,
      son_yil: +$("tfaSonYil").value || 0,
      dusuk_guveni_at: $("tfaDusukAt").checked,
    });
    S.tfa = o;
    tfaCiz(o);
    setStatus("tfaStatus", `${o.parametreler.yil_sayisi} yıllık seri — `
      + `kabul edilen dağılım: ${o.kabul_edilen_adi}.`, "ok");
  } catch (e) {
    setStatus("tfaStatus", "Analiz yapılamadı: " + e.message, "err");
  }
};

/* ---- BTFA: bölgesel taşkın frekans analizi (indeks-debi) ---- */
let btfaHomChart = null;

/* Dalrymple grafiği: yatayda kayıt uzunluğu, düşeyde eşdeğer tekerrür (log).
   Zarf olmadan test okunmuyor — kısa serilerde band çok geniş olduğu için bir
   istasyonun "sapması" tek başına bir şey söylemiyor.                        */
function btfaHomojenCiz(hm) {
  const kutu = $("btfaHomojenGrafikKutu");
  if (!hm || !hm.zarf || !hm.zarf.length) { kutu.classList.add("hidden"); return; }
  kutu.classList.remove("hidden");
  if (btfaHomChart) btfaHomChart.destroy();
  const nokta = (f) => hm.istasyonlar.filter(f)
    .map(s => ({ x: s.yil_sayisi, y: s.t_esdeger, kod: s.kod }));
  btfaHomChart = new Chart($("btfaHomojenGrafik"), {
    type: "line",
    data: {
      datasets: [
        { label: "üst sınır (%95)", data: hm.zarf.map(z => ({ x: z.n, y: z.t_ust })),
          borderColor: "#1565c0", borderWidth: 1.5, borderDash: [6, 3],
          pointRadius: 0, tension: 0.2 },
        { label: "alt sınır (%95)", data: hm.zarf.map(z => ({ x: z.n, y: z.t_alt })),
          borderColor: "#1565c0", borderWidth: 1.5, borderDash: [6, 3],
          pointRadius: 0, tension: 0.2, fill: "-1",
          backgroundColor: "rgba(21,101,192,.08)" },
        { label: `T = ${hm.t_merkez} yıl`, data: hm.zarf.map(z => ({ x: z.n, y: hm.t_merkez })),
          borderColor: "#9e9e9e", borderWidth: 1, pointRadius: 0 },
        { label: "homojen", data: nokta(s => s.homojen === true), showLine: false,
          pointBackgroundColor: "#2e7d32", pointBorderColor: "#2e7d32", pointRadius: 5 },
        { label: "aykırı", data: nokta(s => s.homojen === false), showLine: false,
          pointBackgroundColor: "#c62828", pointBorderColor: "#000",
          pointBorderWidth: 1.5, pointRadius: 6, pointStyle: "triangle" },
      ],
    },
    options: {
      animation: false, maintainAspectRatio: false, parsing: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 18, font: { size: 10 } } },
        title: { display: true, text: "Homojenlik testi — Dalrymple zarfı" },
        tooltip: { callbacks: { label: (c) => c.raw.kod
          ? `${c.raw.kod}: N=${c.raw.x} yıl, T=${(+c.raw.y).toFixed(1)} yıl`
          : `N=${c.raw.x}: T=${(+c.raw.y).toFixed(1)}` } },
      },
      scales: {
        x: { type: "linear", title: { display: true, text: "Kayıt uzunluğu N (yıl)" } },
        y: { type: "logarithmic", title: { display: true, text: "Eşdeğer tekerrür T (yıl)" } },
      },
    },
  });
}

function btfaKarsilastir(o) {
  const a = o.aykirisiz;
  if (!a) return o.aykirisiz_hata
    ? `<p class="small"><b>${o.aykirisiz_hata}</b></p>` : "";
  const T = o.btfa.tekerrur;
  const sag = (v) => `<td style="text-align:right">${v == null ? "—" : fmt(v, 1)}</td>`;
  const fark = T.map((_, i) => {
    const x = o.btfa.q[i], y = a.btfa.q[i];
    return (x && y) ? (y - x) / x * 100 : null;
  });
  return `<p class="small"><b>Aykırılar çıkarılınca</b> — çıkarılan: `
    + `${a.cikarilan.join(", ")} (${o.kullanilan_sayisi} → ${a.kullanilan_sayisi} istasyon). `
    + (a.homojenlik.homojen
        ? "Kalan bölge <b>homojen</b>."
        : `Hâlâ aykırı var: ${a.homojenlik.aykiri.join(", ")}.`)
    + '</p><table class="tbl small"><tr><th>Durum</th>'
    + T.map(t => `<th style="text-align:right">${t}</th>`).join("") + "</tr>"
    + "<tr><td>Tüm istasyonlar</td>" + o.btfa.q.map(sag).join("") + "</tr>"
    + "<tr><td>Aykırısız</td>" + a.btfa.q.map(sag).join("") + "</tr>"
    + '<tr><td>Fark</td>' + fark.map(v => `<td style="text-align:right;color:${
        v == null ? "#666" : (Math.abs(v) > 10 ? "#c62828" : "#666")}">`
        + `${v == null ? "—" : (v > 0 ? "+" : "") + fmt(v, 1) + "%"}</td>`).join("")
    + "</tr></table>"
    + `<p class="small">Aykırısız büyüme eğrisi: `
    + a.buyume_egrisi.map(v => fmt(v, 3)).join(" · ")
    + ` · indeks debi Q2 = ${fmt(a.q2_indeks, 2)} m³/s `
    + `(${fmt(a.bagintis.katsayi, 4)}·A<sup>${fmt(a.bagintis.us, 4)}</sup>)</p>`;
}

function btfaCiz(o) {
  const T = o.tekerrur;
  const sag = (v, d = 1) => `<td style="text-align:right">${v == null ? "—" : fmt(v, d)}</td>`;
  let h = '<p class="small"><b>Bölgesel analizde kullanılan AGİ\'ler</b> '
    + `(${o.kullanilan_sayisi} istasyon)</p><table class="tbl small">`
    + "<tr><th>İstasyon</th><th>Ad</th><th>A (km²)</th><th>N</th><th>Dağılım</th>"
    + T.map(t => `<th style="text-align:right">Q${t}</th>`).join("")
    + '<th style="text-align:right">Q<sub>maks</sub></th></tr>';
  o.istasyonlar.forEach(s => {
    const disi = !s.kullanildi;
    h += `<tr${disi ? ' style="opacity:.5"' : ""}><td>${s.kod}</td><td>${s.ad || ""}</td>`
      + sag(s.alan, 1) + `<td style="text-align:right">${s.yil_sayisi ?? "—"}</td>`
      + `<td>${disi ? (s.hata || "dışarıda") : (s.dagilim || "").toUpperCase()}</td>`
      + (s.q || []).map(v => sag(v)).join("") + sag(s.gozlem_maks) + "</tr>";
  });
  h += "</table>";

  const hm = o.homojenlik;
  if (hm) {
    btfaHomojenCiz(hm);
    h += `<p class="small"><b>Homojenlik testi</b> — ${hm.yontem}. `
      + (hm.homojen
          ? "Bölge <b>homojen</b>: tüm istasyonlar %95 bandının içinde."
          : `<b>${hm.aykiri.length} istasyon banda sığmıyor</b> (${hm.aykiri.join(", ")}) — `
            + "bunları çıkarıp yeniden çalıştırmayı deneyin.")
      + '</p><table class="tbl small"><tr><th>İstasyon</th><th>N</th>'
      + "<th>Q10/Q2</th><th>T eşdeğer</th><th>alt–üst sınır</th><th>Sonuç</th></tr>";
    hm.istasyonlar.forEach(s => {
      const durum = s.homojen === null ? "sınanmadı" : (s.homojen ? "homojen" : "aykırı");
      h += `<tr${s.homojen === false ? ' style="color:#b71c1c;font-weight:600"' : ""}>`
        + `<td>${s.kod}</td><td style="text-align:right">${s.yil_sayisi}</td>`
        + `<td style="text-align:right">${fmt(s.oran_q10_q2, 3)}</td>`
        + `<td style="text-align:right">${fmt(s.t_esdeger, 1)}</td>`
        + `<td style="text-align:right">${s.t_alt == null ? "—"
            : fmt(s.t_alt, 1) + " – " + fmt(s.t_ust, 1)}</td>`
        + `<td>${durum}</td></tr>`;
    });
    h += "</table>";
  }

  h += '<p class="small"><b>Bölgesel büyüme eğrisi</b> (Q<sub>T</sub>/Q<sub>2</sub> ortalaması)'
    + '</p><table class="tbl small"><tr><th>T (yıl)</th>'
    + T.map(t => `<th style="text-align:right">${t}</th>`).join("") + "</tr><tr><td>oran</td>"
    + o.buyume_egrisi.map(v => sag(v, 4)).join("") + "</tr></table>";

  const b = o.bagintis, rs = b.regresyon_serbest, r1 = b.regresyon_a1;
  h += '<p class="small"><b>İndeks debi bağıntısı</b> — kullanılan: '
    + `Q2 = ${fmt(b.katsayi, 4)} · A<sup>${fmt(b.us, 4)}</sup> (${b.kaynak})`
    + `<br>veriden: a=1 ile A<sup>${fmt(r1.us, 4)}</sup> (R²=${fmt(r1.r2, 3)}) · `
    + `serbest ${fmt(rs.katsayi, 4)}·A<sup>${fmt(rs.us, 4)}</sup> (R²=${fmt(rs.r2, 3)}), `
    + `n=${rs.n}</p>`;

  const bt = o.btfa;
  h += `<p class="small"><b>Havza taşkın debileri</b> — A = ${fmt(o.alan_km2, 2)} km², `
    + `Q<sub>2</sub> = ${fmt(o.q2_indeks, 2)} m³/s</p><table class="tbl small">`
    + "<tr><th>Yöntem</th>" + bt.tekerrur.map((t, i) =>
        `<th style="text-align:right">${t}${i >= bt.ekstrapole_baslangic ? "*" : ""}</th>`).join("")
    + "</tr><tr><td><b>BTFA</b></td>" + bt.q.map(v => sag(v)).join("") + "</tr>";
  if (o.ntfa_transfer) {
    const t2 = o.ntfa_transfer;
    h += `<tr><td>NTFA aktarım<br><span class="small">${t2.kod}, `
      + `(A/${fmt(t2.kaynak_alan, 1)})<sup>${fmt(t2.us, 3)}</sup></span></td>`
      + t2.q.map(v => sag(v)).join("") + "</tr>";
  }
  h += "</table><p class='small'>* Q500 ve üzeri, Q10–Q100'den ekstrapole edilmiştir "
    + "(k = 1.692 / 1.99 / 2.98) — Excel'deki (Q100−Q10)·1.692+Q10 ile aynı.</p>";
  h += btfaKarsilastir(o);
  $("btfaSonuc").innerHTML = h;
}

$("btnBtfa").onclick = async () => {
  const alan = +$("btfaAlan").value || +$("inpA").value;
  if (!alan) return setStatus("btfaStatus",
    "Havza alanı (km²) gerekli — 1. adımda havzayı çıkarın ya da elle yazın.", "err");
  setStatus("btfaStatus", "Bölgesel analiz yapılıyor…", "loading");
  try {
    const o = await api("/api/btfa", {
      kodlar: [...S.agiBolgesel],
      alan_km2: alan,
      us: $("btfaUs").value === "" ? null : +$("btfaUs").value,
      katsayi: $("btfaKatsayi").value === "" ? null : +$("btfaKatsayi").value,
      katsayi_serbest: $("btfaSerbest").checked,
      transfer_kod: $("btfaTransfer").value,
      transfer_ussu: +$("btfaTransferUs").value || (2 / 3),
      aykiri_disla: $("btfaAykiriAt").checked,
      ilk_yil: +$("tfaIlkYil").value || 0,
      son_yil: +$("tfaSonYil").value || 0,
      dusuk_guveni_at: $("tfaDusukAt").checked,
    });
    S.btfa = o;
    btfaCiz(o);
    const at = o.istasyonlar.length - o.kullanilan_sayisi;
    setStatus("btfaStatus", `${o.kullanilan_sayisi} istasyon kullanıldı`
      + (at ? `, ${at} tanesi dışarıda kaldı` : "")
      + ` — Q100 = ${fmt(o.btfa.q[5], 1)} m³/s`
      + (o.aykirisiz
          ? ` · aykırısız (${o.aykirisiz.kullanilan_sayisi} istasyon): `
            + `${fmt(o.aykirisiz.btfa.q[5], 1)} m³/s`
          : (o.homojenlik && o.homojenlik.homojen ? " · bölge homojen" : "")) + ".", "ok");
  } catch (e) {
    setStatus("btfaStatus", "Bölgesel analiz yapılamadı: " + e.message, "err");
  }
};

/* ---- MMY: muhtemel maksimum yağış (Hershfield) ----
   Sonuç, 6. adımdaki OET yağış satırına yazılınca QOET (muhtemel maksimum
   feyezan) mevcut hesap zinciriyle üretilir.                              */
(async function mmyBolgeYukle() {
  try {
    const r = await api("/api/mmy-bolgeler");
    $("mmyBolge").innerHTML = r.bolgeler
      .map(b => `<option value="${b.no}">${b.no}. ${b.ad}</option>`).join("");
  } catch (e) { /* uç yoksa sessiz geç */ }
})();

$("btnMmy").onclick = async () => {
  const p = ($("mmySeri").value || "").split(/[\s,;]+/)
    .map(s => parseFloat(s.replace(",", "."))).filter(v => !isNaN(v) && v > 0);
  if (p.length < 3) return setStatus("mmyStatus",
    "En az 3 yıllık yağış değeri girin (her satıra bir değer).", "err");
  setStatus("mmyStatus", "MMY hesaplanıyor…", "loading");
  try {
    const o = await api("/api/mmy", {
      p, bolge_no: +$("mmyBolge").value,
      m1_ort: +$("mmyM1o").value || 1, m2_ort: +$("mmyM2o").value || 1,
      m1_s: +$("mmyM1s").value || 1, m2_s: +$("mmyM2s").value || 1,
      gun_katsayisi: $("mmyGun").checked,
      istasyon: $("mmyIstasyon").value.trim(),
    });
    S.mmy = o;
    const sat = (ad, v, br = "") => `<tr><td>${ad}</td>`
      + `<td style="text-align:right">${typeof v === "number" ? fmt(v, 4) : v}</td>`
      + `<td class="small">${br}</td></tr>`;
    $("mmySonuc").innerHTML = (o.istasyon ? `<h3 class="small">${o.istasyon}</h3>` : "")
      + '<table class="tbl small">'
      + sat("N", o.yil_sayisi, "yıl") + sat("P<sub>maks</sub>", o.pmax, "mm")
      + sat("ΣP", o.toplam, "mm") + sat("ΣP (−P<sub>maks</sub>)", o.toplam_pmaxsiz, "mm")
      + sat("P<sub>ort</sub>", o.ortalama, "mm")
      + sat("P<sub>ort</sub> (−P<sub>maks</sub>)", o.ortalama_pmaxsiz, "mm")
      + sat("oran P<sub>ort</sub>(−P<sub>maks</sub>)/P<sub>ort</sub>", o.ortalama_orani,
            "→ M1<sub>ort</sub> abağı bu oran ve N ile okunur")
      + sat("S", o.standart_sapma, "mm")
      + sat("S (−P<sub>maks</sub>)", o.standart_sapma_pmaxsiz, "mm")
      + sat("oran S(−P<sub>maks</sub>)/S", o.standart_sapma_orani,
            "→ M1<sub>s</sub> abağı bu oran ve N ile okunur")
      + sat("M1<sub>ort</sub> · M2<sub>ort</sub>", o.m1_ort * o.m2_ort, "girilen")
      + sat("M1<sub>s</sub> · M2<sub>s</sub>", o.m1_s * o.m2_s, "girilen")
      + sat("düzeltilmiş P<sub>ort</sub>", o.duzeltilmis_ortalama, "mm")
      + sat("düzeltilmiş S", o.duzeltilmis_standart_sapma, "mm")
      + sat("K<sub>m</sub>", o.km, `${o.bolge_no}. ${o.bolge_adi}`)
      + (o.gun_katsayisi !== 1 ? sat("gün katsayısı", o.gun_katsayisi, "sabit saat → 24 saat") : "")
      + `<tr><td><b>MMY</b></td><td style="text-align:right"><b>${fmt(o.mmy, 1)}</b></td>`
      + "<td class='small'>mm</td></tr></table>"
      + '<div class="rain-tools"><button id="btnMmyOet" class="small-btn">'
      + "↧ Bu değeri 6. adımdaki OET yağışına yaz</button></div>";
    $("btnMmyOet").onclick = () => {
      const hedef = document.querySelector('[data-rain-oet], #inpP24OET');
      if (hedef) { hedef.value = fmt(o.mmy, 1); setStatus("mmyStatus", "OET yağışı güncellendi.", "ok"); }
      else {
        navigator.clipboard?.writeText(fmt(o.mmy, 1));
        setStatus("mmyStatus", `MMY = ${fmt(o.mmy, 1)} mm panoya kopyalandı — `
          + "5. adımdaki yağış tablosunda OET satırına yapıştırın.", "ok");
      }
    };
    setStatus("mmyStatus", `MMY = ${fmt(o.mmy, 1)} mm `
      + `(N=${o.yil_sayisi}, Km=${fmt(o.km, 3)}).`, "ok");
  } catch (e) {
    setStatus("mmyStatus", "MMY hesaplanamadı: " + e.message, "err");
  }
};

/* ---- yıllık toplam yağış katmanı (CHELSA v2.1, ~1 km) ----
   Altlık değil tematik harita: renk merdiveniyle çizilir. Asıl işe yarayan
   büyüklük havzanın ALANSAL ortalaması — dağlık havzada tek nokta yanıltır. */
let yagisBilgi = null;
layers.yagis = null;

const yagisKatmanBilgi = (k) =>
  (yagisBilgi && yagisBilgi.katmanlar || []).find(x => x.anahtar === k);

function yagisLejantCiz(k) {
  const b = yagisKatmanBilgi(k);
  if (!b) { $("yagisLejant").innerHTML = ""; return; }
  let onceki = 0;
  const koyu = k === "pet" ? 1150 : (k === "net" ? 250 : 500);
  $("yagisLejant").innerHTML = `<b>${b.kisa} (mm/yıl)</b> `
    + b.lejant.map(l => {
        const et = l.deger >= 10000 ? `${onceki}+` : `${onceki}–${l.deger}`;
        onceki = l.deger;
        return `<span style="display:inline-block;padding:0 4px;margin:1px;`
          + `background:${l.renk};color:${l.deger > koyu ? "#fff" : "#000"};`
          + `border-radius:2px">${et}</span>`;
      }).join("");
}

function yagisKatmanUygula() {
  const k = $("yagisKatman").value;
  if (layers.yagis) layers.yagis.remove();
  layers.yagis = L.tileLayer(`/api/yagis/${k}/{z}/{x}/{y}.png`, {
    opacity: (+$("yagisOpak").value || 75) / 100, maxZoom: 18, crossOrigin: true,
    attribution: "İklim: CHELSA v2.1",
  });
  if ($("yagisAc").checked) layers.yagis.addTo(map);
  yagisLejantCiz(k);
  const b = yagisKatmanBilgi(k);
  if (b) {
    $("yagisInfo").innerHTML = `<b>${b.ad}</b> — ${b.kaynak} · ${b.donem} · `
      + `~${b.cozunurluk_m} m piksel · ${b.lisans}`
      + (b.yontem ? ` · ${b.yontem}` : "");
  }
}

$("yagisAc").onchange = () => {
  if (!$("yagisAc").checked) {
    if (layers.yagis) layers.yagis.remove();
    $("yagisLejant").innerHTML = "";
    return;
  }
  yagisKatmanUygula();
};
$("yagisKatman").onchange = yagisKatmanUygula;
$("yagisOpak").oninput = () => {
  if (layers.yagis) layers.yagis.setOpacity((+$("yagisOpak").value || 75) / 100);
};

$("btnYagisHavza").onclick = async () => {
  if (!S.havza) {
    $("yagisInfo").textContent = "Önce havzayı çıkarın.";
    return;
  }
  $("yagisInfo").textContent = "Havza ortalamaları hesaplanıyor…";
  try {
    const g = S.havza.features ? S.havza.features[0].geometry
                               : (S.havza.geometry || S.havza);
    const r = await api("/api/yagis-havza", { geometri: g });
    S.yagisHavza = r;
    const sat = (k, ad) => r[k]
      ? `<tr><td>${ad}</td><td style="text-align:right"><b>${fmt(r[k].ortalama_mm, 0)}</b></td>`
        + `<td style="text-align:right">${fmt(r[k].medyan_mm, 0)}</td>`
        + `<td style="text-align:right">${fmt(r[k].en_az_mm, 0)}–${fmt(r[k].en_cok_mm, 0)}</td>`
        + `<td style="text-align:right">±${fmt(r[k].std_mm, 0)}</td></tr>` : "";
    const t = r.turetilmis;
    $("yagisInfo").innerHTML =
      '<table class="tbl small"><tr><th>Havza alansal ortalaması</th>'
      + "<th>mm/yıl</th><th>medyan</th><th>aralık</th><th>sapma</th></tr>"
      + sat("yagis", "Yağış P") + sat("pet", "PET") + sat("net", "Net yağış (P−AET)")
      + "</table>"
      + (t ? `<p class="small">Gerçek buharlaşma AET ≈ <b>${fmt(t.aet_mm, 0)}</b> mm/yıl · `
             + `akış katsayısı <b>${fmt(t.akis_katsayisi, 3)}</b>. `
             + "Net yağış uzun dönem ortalama akış yüksekliğidir; "
             + "yakındaki bir AGİ'nin özgül verimiyle (Su Potansiyeli sekmesi) "
             + "karşılaştırarak doğrulayın.</p>" : "");
  } catch (e) {
    $("yagisInfo").textContent = "Hesaplanamadı: " + e.message;
  }
};

/* katman listesini kur; veri yoksa seçeneği kapat */
(async function yagisDurum() {
  try {
    yagisBilgi = await api("/api/yagis-bilgi");
    if (!yagisBilgi.var) {
      $("yagisAc").disabled = true;
      $("yagisKatman").disabled = true;
      $("btnYagisHavza").disabled = true;
      $("yagisInfo").textContent =
        "veri yok — tools/yagis_haritasi_indir.py ile üretin";
      return;
    }
    $("yagisKatman").innerHTML = yagisBilgi.katmanlar
      .map(k => `<option value="${k.anahtar}">${k.ad}</option>`).join("");
    $("yagisKatman").value = yagisBilgi.varsayilan;
  } catch (e) { /* uç yoksa sessiz geç */ }
})();

/* ---- dışarıdan çizilmiş havza/dere içe aktarma ----
   Sınır kullanıcıdan gelir; alan poligondan (jeodezik), L/Lc/kotlar ve
   (dere verilmediyse) dere ağı DEM'den üretilir.                          */
async function importBasinFiles() {
  const f = $("basinFile").files[0];
  if (!f) { setStatus("delinStatus", "Önce havza (poligon) dosyası seçin", "err"); return; }
  const fd2 = $("riverFile").files[0];
  setStatus("delinStatus", `“${f.name}”${fd2 ? " + “" + fd2.name + "”" : ""} okunuyor, parametreler üretiliyor…`, "loading");
  try {
    const fd = new FormData(); fd.append("file", f);
    if (fd2) fd.append("dere_file", fd2);
    const q = `?river_km2=${+$("inpRivThr").value || 1}&dem_source=${encodeURIComponent($("inpDem").value)}`;
    const r = await api("/api/import-basin" + q, fd, true);
    applyBasinResult(r, `İçe aktarıldı: ${f.name}${fd2 ? " + " + fd2.name : ""}`);
  } catch (e) {
    setStatus("delinStatus", "Hata: " + e.message, "err");
  }
}
$("btnImport").onclick = importBasinFiles;
$("basinFile").onchange = () => { if (!$("riverFile").files[0]) importBasinFiles(); };

// delineate / import sonucunu arayüze uygular (ikisi de aynı biçimde döner)
function applyBasinResult(r, baslik) {
  S.outlet = r.outlet; S.havza = r.havza_geojson; S.kotlar = r.kotlar.slice();
  // dere/kanal da durumda tutulur: proje kaydında saklansın ve yüklenince geri gelsin
  S.dere = r.dere_geojson || null; S.kanal = r.ana_kanal_geojson || null;
  $("inpA").value = r.alan_km2; $("inpL").value = r.L_km; $("inpLc").value = r.Lc_km;
  updateSnyderW();
  layers.havza.clearLayers(); layers.havza.addData(r.havza_geojson);
  layers.dere.clearLayers(); if (r.dere_geojson) layers.dere.addData(r.dere_geojson);
  layers.kanal.clearLayers(); if (r.ana_kanal_geojson) layers.kanal.addData(r.ana_kanal_geojson);
  layers.markers.clearLayers();
  if (r.outlet) L.marker([r.outlet.snap_lat ?? r.outlet.lat, r.outlet.snap_lon ?? r.outlet.lon])
    .addTo(layers.markers).bindPopup("Çıkış noktası (DEM'den bulundu)");
  map.fitBounds(layers.havza.getBounds(), { padding: [30, 30] });
  renderKotlar();
  let yzdMsg = "";
  if (r.yzd_bolge && r.yzd_bolge.bolge) {
    S.yzdBolge = r.yzd_bolge;
    $("inpRegion").value = r.yzd_bolge.bolge;
    yzdMsg = `\nYZD bölgesi: ${r.yzd_bolge.bolge} (${r.yzd_bolge.yontem}) — otomatik seçildi`;
    $("yzdInfo").textContent = `🌧 Otomatik: ${r.yzd_bolge.bolge} (${r.yzd_bolge.yontem})`;
  }
  const ia = r.ice_aktarim;
  const detay = ia ? `\n${ia.poligon_sayisi} poligon, ${ia.cizgi_sayisi} çizgi okundu` +
    ` | dere ağı: ${r.dere_kaynagi === "ice_aktarim" ? "dosyadan" : "DEM'den türetildi"}` +
    `
L, Lc ve kot profili: ${r.parametre_kaynagi === "dere_agi" ? "içe aktarılan DERE AĞINDAN" : "DEM akış yollarından"}` +
    `\nAlan poligondan (jeodezik); L, Lc ve kotlar DEM'den üretildi (${r.cozunurluk_m} m).` : "";
  const uy = (r.uyarilar || []).length ? "\n⚠ " + r.uyarilar.join("\n⚠ ") : "";
  setStatus("delinStatus",
    `${baslik}\nHavza: ${r.alan_km2} km² | L=${r.L_km} km | Lc=${r.Lc_km} km` + detay + yzdMsg + uy,
    uy ? "err" : "ok");
  markDone(1);
  renderAdayKanallar(r);
  updateComputeReady();
}

/* Tıklama çevresindeki rakip akarsu kolları.
   İki DEM aynı dereyi farklı yere koyabiliyor ve 300 m yarıçapta alanları
   2/10/16 km² olan ayrı kollar bulunabiliyor; hangisinin kullanıcının
   kastettiği outlet olduğu koddan bilinemez. Eskiden kullanıcı "kanala
   kenetleme" yarıçapını tahminle ayarlamak zorundaydı — bilemeyeceği bir
   şey. Artık seçenekler alanlarıyla listeleniyor, tek tıkla geçiliyor.   */
function renderAdayKanallar(r) {
  const el = $("adayKanallar");
  if (!el) return;
  const ad = (r && r.aday_kanallar) || [];
  const secili = r && r.alan_km2;
  // yalnız gerçekten farklı bir seçenek varsa göster (%20'den fazla sapma)
  const digerleri = ad.filter(k => secili && Math.abs(k.alan_km2 - secili) > 0.2 * secili);
  if (!digerleri.length) { el.innerHTML = ""; return; }
  el.innerHTML =
    `<b>Yakındaki diğer kollar</b> — tıklanan nokta bir yatağın tam üstünde
     değilse havza yanlış kola oturmuş olabilir. Doğrusu bunlardan biriyse tıklayın:<br>`
    + digerleri.map((k, i) =>
      `<button class="link-btn" data-aday="${i}" title="Bu kola kenetlenip havzayı yeniden çıkar">
         ${k.alan_km2.toFixed(2)} km² — ${k.mesafe_m.toFixed(0)} m ötede</button>`).join(" · ")
    + `<div class="small" style="color:#8a857e">Şu an seçili: ${(+secili).toFixed(2)} km²
       (${(r.snap_mesafe_m || 0).toFixed(0)} m kenetlendi)</div>`;
  el.querySelectorAll("button[data-aday]").forEach(b => b.onclick = async () => {
    const k = digerleri[+b.dataset.aday];
    setStatus("delinStatus", `${k.alan_km2.toFixed(2)} km²'lik kola kenetlenip `
      + `havza yeniden çıkarılıyor…`, "loading");
    el.innerHTML = "";
    try {
      // adayın tam hücresine kenetle: dar yarıçap, başka kola atlamasın
      const r2 = await api("/api/delineate", {
        lat: k.lat, lon: k.lon, river_km2: +$("inpRivThr").value || 1,
        snap_m: 60, dem_source: $("inpDem").value,
      });
      applyBasinResult(r2, "Seçilen kola göre havza çıkarıldı.");
    } catch (e) {
      setStatus("delinStatus", "Hata: " + e.message, "err");
    }
  });
}

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
    layers.havza.eachLayer(l => { l.off("click", onHavzaClick); l.unbindTooltip(); });
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
    setStatus("compStatus", "", "");
    updateComputeReady();
    editYedek = null;
    setStatus("delinStatus", $("delinStatus").textContent
      + "\n⚠ Alan değiştiği için CN (Adım 3) ve Thiessen (Adım 4) yeniden çalıştırılmalı, "
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
  if (S.multi && S.multi.place) { multiAddPoint(ev.latlng); return; }
});
map.on("click", async (ev) => {
  if (!picking) return;
  picking = false;
  $("btnPick").classList.remove("picking");
  map.getContainer().style.cursor = "";
  setStatus("delinStatus", "Havza çıkarılıyor… DEM işleniyor: küçük havzada birkaç saniye, " +
    "büyük havzada (binlerce km²) pencere büyütülüp DEM indirildiği için 1–3 dakika sürebilir.", "loading");
  try {
    const r = await api("/api/delineate", {
      lat: ev.latlng.lat, lon: ev.latlng.lng, river_km2: +$("inpRivThr").value || 1,
      snap_m: +$("inpSnap").value || 500, dem_source: $("inpDem").value,
    });
    S.outlet = r.outlet; S.havza = r.havza_geojson; S.kotlar = r.kotlar.slice();
    S.dere = r.dere_geojson || null; S.kanal = r.ana_kanal_geojson || null;
    $("inpA").value = r.alan_km2; $("inpL").value = r.L_km; $("inpLc").value = r.Lc_km;
    updateSnyderW();
    layers.havza.clearLayers(); layers.havza.addData(r.havza_geojson);
    layers.dere.clearLayers(); if (r.dere_geojson) layers.dere.addData(r.dere_geojson);
    layers.kanal.clearLayers(); layers.kanal.addData(r.ana_kanal_geojson);
    layers.markers.clearLayers();
    L.marker([r.outlet.snap_lat, r.outlet.snap_lon]).addTo(layers.markers).bindPopup("Outlet");
    map.fitBounds(layers.havza.getBounds(), { padding: [30, 30] });
    renderKotlar();
    // YZD alansal dağılım bölgesini (A/B/C) otomatik ayarla
    let yzdMsg = "";
    if (r.yzd_bolge && r.yzd_bolge.bolge) {
      S.yzdBolge = r.yzd_bolge;
      $("inpRegion").value = r.yzd_bolge.bolge;
      yzdMsg = `\nYZD bölgesi: ${r.yzd_bolge.bolge} (${r.yzd_bolge.yontem}) — otomatik seçildi`;
      const ov = r.yzd_bolge.ortusme;
      const ovTxt = ov ? " | örtüşme: " + Object.entries(ov).map(([k, v]) => `${k}=${(v * 100).toFixed(0)}%`).join(" ") : "";
      $("yzdInfo").textContent = `🌧 Otomatik: ${r.yzd_bolge.bolge} (${r.yzd_bolge.yontem})${ovTxt}`;
    }
    // teşhis: çözünürlük + kenetleme mesafesi (havza beklenenden küçükse ipucu)
    let dgn = "";
    if (r.cozunurluk_m) dgn += `\nDEM çözünürlüğü: ${r.cozunurluk_m} m`;
    if (r.snap_mesafe_m != null) dgn += ` | kanala kenetleme: ${r.snap_mesafe_m} m`;
    if (r.snap_mesafe_m != null && r.snap_mesafe_m > 0.8 * (+$("inpSnap").value || 500))
      dgn += `\n⚠ Tıklanan nokta kanaldan uzak (${r.snap_mesafe_m} m) — yanlış/küçük bir kola oturmuş olabilir.` +
             ` Havza beklenenden küçükse dere ağına daha yakın tıklayın veya "Kanala kenetleme" değerini artırın.`;
    setStatus("delinStatus",
      `Havza: ${r.alan_km2} km² | L=${r.L_km} km | Lc=${r.Lc_km} km` +
      (r.kenar_uyarisi ? "\n⚠ Havza pencere kenarına değiyor, sonuçları kontrol edin!" : "") +
      dgn + yzdMsg, "ok");
    markDone(1);
    renderAdayKanallar(r);
    updateComputeReady();
    if (S.mode === "su") suHavzaGuncelle();   // su akışı 1. adımı havzayla başlıyor
  } catch (e) { setStatus("delinStatus", "Hata: " + e.message, "err"); }
});

/* ---------------- ADIM 2: kotlar ---------------- */
function renderKotlar() {
  const g = $("kotlar"); g.innerHTML = "";
  for (let i = 0; i < 11; i++) {
    const lab = document.createElement("label");
    lab.innerHTML = `H${i}${i === 0 ? " (outlet)" : i === 10 ? " (memba)" : ""}`;
    const inp = document.createElement("input");
    inp.type = "number"; inp.step = "0.1"; inp.value = S.kotlar[i];
    inp.oninput = () => { S.kotlar[i] = +inp.value; };
    lab.appendChild(inp); g.appendChild(lab);
  }
}
renderKotlar();

/* ---------------- ADIM 3: CN ---------------- */
$("btnCN").onclick = async () => {
  if (!S.havza) return setStatus("cnStatus", "Önce havzayı çıkarın (Adım 1)", "err");
  setStatus("cnStatus", "CORINE kesiliyor…", "loading");
  try {
    const r = await api("/api/cn", { havza_geojson: S.havza, zemin_grubu: $("inpSoil").value });
    $("inpCN2").value = r.CN2; $("inpCN3").value = r.CN3;
    S.cnSonuc = r;
    renderCnSonuc(r);
    setStatus("cnStatus", `Ağırlıklı CN(II)=${r.CN2}  CN(III)=${r.CN3}\nVeri kaynağı: ${r.kaynak}`, "ok");
    markDone(3);
  } catch (e) { setStatus("cnStatus", "Hata: " + e.message, "err"); }
};

/* CORINE sınıf dökümü + aynı geçişten türetilen rasyonel akış katsayısı C.
   C, CN ile aynı CORINE kesitinden gelir; ayrıca veri indirilmez.        */
function renderCnSonuc(r) {
  let h = `<table class="tbl"><tr><th></th><th>Kod</th><th>Sınıf</th><th>Oran</th>`
    + `<th>CN</th><th>C</th><th>C aralığı</th></tr>`;
  r.dokum.forEach(d => {
    const kutu = d.c_renk
      ? `<span style="display:inline-block;width:11px;height:11px;border:1px solid #b5b0a8;background:${d.c_renk}"></span>`
      : "";
    const cOrt = d.c_ort == null ? "—"
      : `<b>${d.c_ort.toFixed(2)}</b>${d.c_tablo ? "" : " *"}`;
    const aralik = d.c_min == null ? "—"
      : `${d.c_min.toFixed(2)}–${d.c_max.toFixed(2)}`;
    h += `<tr><td>${kutu}</td><td>${d.kod}</td><td>${d.ad}</td>`
      + `<td>${(d.oran * 100).toFixed(1)}%</td><td>${d.cn}</td>`
      + `<td>${cOrt}</td><td>${aralik}</td></tr>`;
  });
  h += `</table>`;

  const c = r.rasyonel_C;
  if (c) {
    const turetilmis = c.turetilmis_orani > 0
      ? `<div class="small">* Alanın %${(c.turetilmis_orani * 100).toFixed(1)}'i eşleştirme
           matrisinde yer almayan CORINE sınıfı; en yakın sınıftan türetildi.</div>` : "";
    h += `<div style="margin-top:6px;padding:6px;border:1px solid #d8d3cc;border-radius:4px">
      <b>Rasyonel yöntem akış katsayısı C</b> <span class="small">(CORINE'den alansal ağırlıklı)</span>
      <div style="margin:3px 0">alt <b>${c.C_min.toFixed(3)}</b> ·
        <span title="Tablodaki 'önerilen ortalama' değerlerin alansal ağırlıklı ortalaması — aralığın orta noktası değildir">önerilen
        <b>${c.C_orta.toFixed(3)}</b></span> · üst <b>${c.C_max.toFixed(3)}</b></div>
      <label class="inline">Kullanılacak
        <select id="cSecim">
          <option value="C_min">alt — ${c.C_min.toFixed(3)}</option>
          <option value="C_orta" selected>önerilen — ${c.C_orta.toFixed(3)}</option>
          <option value="C_max">üst — ${c.C_max.toFixed(3)}</option>
        </select></label>
      <button id="btnCToRational" class="small-btn">→ Rasyonel C100 alanına aktar</button>
      <span id="cAktarInfo" class="small"></span>
      ${turetilmis}
      <div class="small">⚠ Tablo değerleri <b>genel</b> rasyonel C'dir; Adım 6'daki alan ise
        <b>C100</b> (T=100 katsayısı) olup küçük tekerrürlere C<sub>T</sub>=C100·(T/100)<sup>üs</sup>
        ile ölçeklenir. Aktarılan değeri mühendislik kararınızla gözden geçirin.</div>
    </div>`;
  }
  $("cnTable").innerHTML = h;

  if (c) $("btnCToRational").onclick = () => {
    const anahtar = $("cSecim").value;
    const deger = c[anahtar];
    $("inpC100").value = deger.toFixed(3);
    $("inpRasyonel").checked = true;
    if ($("rasyonelBox")) $("rasyonelBox").open = true;
    S.rasyonelCKaynak = { deger, secim: anahtar, kaynak: r.kaynak };
    $("cAktarInfo").textContent = `✓ C100 = ${deger.toFixed(3)} yazıldı, rasyonel yöntem işaretlendi.`;
    updateComputeReady();
  };
}

/* ---------------- ADIM 4: Thiessen ---------------- */
/* ---- istasyon listesi yönetimi (çıkarma / elle ekleme) ----
   S.stBase   : kaynaktan (KML/KMZ) gelen tam liste
   S.stExclude: kullanıcının çıkardığı istasyon anahtarları
   S.stExtra  : haritadan elle eklenen istasyonlar
   Etkin liste = (temel − çıkarılanlar) + elle eklenenler                      */
const stKey = (s) => `${s.name}|${(+s.lat).toFixed(5)}|${(+s.lon).toFixed(5)}`;
S.stExclude = new Set();
S.stExtra = [];
function effectiveStations() {
  const base = (S.stBase || []).filter(s => !S.stExclude.has(stKey(s)));
  return base.concat(S.stExtra);
}
// yeni kaynak yüklendiğinde: temel listeyi kur, çıkarma/eklemeleri sıfırla
async function loadStationSet(list, kaynak) {
  S.stBase = list;
  S.stExclude = new Set();
  S.stExtra = [];
  await runThiessen(effectiveStations(), kaynak);
}
async function recomputeThiessen() {
  if (!S.stBase && !S.stExtra.length) return;
  await runThiessen(effectiveStations(), S.stKaynak || "Güncel liste");
}
function renderExcluded() {
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
  el.innerHTML = h;
  el.querySelectorAll("button[data-r]").forEach(b => b.onclick = () => {
    S.stExclude.delete(b.dataset.r); recomputeThiessen();
  });
  el.querySelectorAll("button[data-x]").forEach(b => b.onclick = () => {
    S.stExtra.splice(+b.dataset.x, 1); recomputeThiessen();
  });
}

async function runThiessen(stations, kaynak) {
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
    markDone(4);
    renderRainTable();
  } catch (e) { setStatus("thStatus", "Hata: " + e.message, "err"); }
}

// istasyonu Thiessen'den çıkar (haritadaki açılır pencereden de çağrılır)
function removeStation(key) {
  S.stExclude.add(key);
  const i = S.stExtra.findIndex(s => stKey(s) === key);
  if (i >= 0) S.stExtra.splice(i, 1);   // elle eklenmişse listeden sil
  map.closePopup();
  recomputeThiessen();
}

// haritaya tıklayarak elle istasyon ekle
$("btnAddStation").onclick = () => {
  if (!S.havza) return setStatus("thStatus", "Önce havzayı çıkarın (Adım 1)", "err");
  S.stPlace = true;
  map.getContainer().style.cursor = "crosshair";
  setStatus("thStatus", "Yeni istasyonun yerine haritada tıklayın (Esc ile iptal)", "");
};
$("btnResetStations").onclick = () => {
  if (!S.stExclude.size) return;
  S.stExclude = new Set();
  recomputeThiessen();
};
// eşik değişince Thiessen'i yeniden kur
$("inpMinW").addEventListener("change", () => { if (S.thiessen && S.thiessen.length) recomputeThiessen(); });
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

async function useDefaultStations() {
  setStatus("thStatus", "Varsayılan istasyonlar yükleniyor…", "loading");
  try {
    const r = await api("/api/stations/default");
    if (!r.istasyonlar.length)
      return setStatus("thStatus", "Varsayılan KMZ bulunamadı (data/stations/)", "err");
    await loadStationSet(r.istasyonlar, r.dosya);
  } catch (e) { setStatus("thStatus", "Hata: " + e.message, "err"); }
}
$("btnDefaultSt").onclick = useDefaultStations;

$("kmzFile").onchange = async () => {
  const f = $("kmzFile").files[0];
  if (!f) return;
  setStatus("thStatus", "İstasyonlar okunuyor…", "loading");
  try {
    const fd = new FormData(); fd.append("file", f);
    const r1 = await api("/api/stations", fd, true);
    await loadStationSet(r1.istasyonlar, f.name);
  } catch (e) { setStatus("thStatus", "Hata: " + e.message, "err"); }
};

/* ---------------- ADIM 5: yağış ---------------- */
const DPLV_LABELS = ["5dk", "10dk", "15dk", "30dk", "1sa", "2sa", "3sa", "4sa",
                     "5sa", "6sa", "8sa", "12sa", "18sa", "24sa"];

/* "Hazır istasyon" açılır listesinde gösterilmeyen istasyonlar. Verileri
   data/tables/dplv_stations.json'da durur ve yanındaki MGM PLV kutusundan
   seçilebilir; yalnızca varsayılan olarak gelmesinler diye gizleniyor.
   Seçenek value'ları özgün dizi indeksi kalır → kayıtlı projelerde kayma olmaz. */
const DPLV_GIZLI = ["TEKİRDAĞ"];

async function loadDplv() {
  const d = await api("/api/dplv");
  S.dplvList = d;
  const sel = $("inpDplv");
  let ilk = null;
  d.stations.forEach((s, i) => {
    if (DPLV_GIZLI.includes(s.name)) return;
    if (ilk === null) ilk = i;
    const o = document.createElement("option"); o.value = i; o.textContent = s.name;
    sel.appendChild(o);
  });
  sel.onchange = () => {
    S.dplvValues = S.dplvList.stations[+sel.value].ratios.slice();
    renderDplvGrid();
  };
  if (ilk !== null) {
    sel.value = ilk;
    if (!S.dplvValues) S.dplvValues = d.stations[ilk].ratios.slice();
  }
  renderDplvGrid();
}
loadDplv();

/* ---- MGM PLV 2020 istasyon veritabanı ---- */
const mgmNorm = (s) => (s || "").toLocaleUpperCase("tr").replace(/[^A-ZÇĞİÖŞÜ0-9]/g, "");
async function loadMgm() {
  try {
    const d = await api("/api/mgm-stations");
    S.mgm = d.istasyonlar || [];
    S.mgmByNorm = {}; S.mgm.forEach(s => S.mgmByNorm[mgmNorm(s.ad)] = s);
    let dl = document.getElementById("mgmList");
    if (!dl) { dl = document.createElement("datalist"); dl.id = "mgmList"; document.body.appendChild(dl); }
    dl.innerHTML = S.mgm.map(s => `<option value="${s.ad}"></option>`).join("");
    const md = $("mgmDplv");
    if (md) md.onchange = () => {
      const st = mgmFind(md.value);
      if (st) { md.value = st.ad; S.dplvValues = st.plv.slice(); renderDplvGrid(); }
    };
  } catch (e) { S.mgm = []; }
}
loadMgm();

/* ---- Snyder Ct-Cp abağı (log-log, çift yönlü otomatik) ---- */
let ctcpGuard = false;
function logInterp(x, xs, ys) {
  const lx = Math.log(x), LX = xs.map(Math.log), LY = ys.map(Math.log);
  if (lx <= LX[0]) return Math.exp(LY[0]);
  if (lx >= LX[LX.length - 1]) return Math.exp(LY[LY.length - 1]);
  for (let i = 1; i < LX.length; i++)
    if (lx <= LX[i]) { const t = (lx - LX[i - 1]) / (LX[i] - LX[i - 1]); return Math.exp(LY[i - 1] + t * (LY[i] - LY[i - 1])); }
  return Math.exp(LY[LY.length - 1]);
}
function ctFromCp(cp) { return logInterp(cp, S.ctcp.Cp, S.ctcp.Ct); }
function cpFromCt(ct) { return logInterp(ct, [...S.ctcp.Ct].reverse(), [...S.ctcp.Cp].reverse()); }
function wireCtCp(ctId, cpId) {
  const ct = $(ctId), cp = $(cpId);
  if (!ct || !cp) return;
  cp.addEventListener("input", () => { if (ctcpGuard || !S.ctcp || !+cp.value) return; ctcpGuard = true; ct.value = ctFromCp(+cp.value).toFixed(2); ctcpGuard = false; if (ctId === "inpCt") updateSnyderW(); });
  ct.addEventListener("input", () => { if (ctcpGuard || !S.ctcp || !+ct.value) return; ctcpGuard = true; cp.value = cpFromCt(+ct.value).toFixed(2); ctcpGuard = false; if (ctId === "inpCt") updateSnyderW(); });
}
async function loadCtCp() {
  try { S.ctcp = await api("/api/snyder-ctcp"); wireCtCp("inpCt", "inpCp"); wireCtCp("multiCt", "multiCp"); }
  catch (e) { S.ctcp = null; }
}
loadCtCp();

// ŞEKİL 1'den okunan W50/W75'i Ct/Cp/L/Lc'den canlı hesapla ve göster
function snyderW(Ct, Cp, L, Lc) {
  if (!(Ct > 0 && Cp > 0 && L > 0 && Lc > 0)) return null;
  const tp = Ct * Math.pow(L * Lc, 0.30);
  const qp = 2760 * Cp / tp;          // lt/s/km²/cm
  const q = qp / 1000;                // Qp/A (m³/s/km²/cm)
  return { tp, qp, W50: 5.87 / Math.pow(q, 1.08) / 2.54, W75: 3.35 / Math.pow(q, 1.08) / 2.54 };
}
function lin1(x, xs, ys) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let i = 1; i < xs.length; i++)
    if (x <= xs[i]) { const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[i - 1] + t * (ys[i] - ys[i - 1]); }
  return ys[ys.length - 1];
}
// YALD (24 sa alansal azaltma) — ABAK2'den; A≤25 ise 1.0 (snyder.compute ile aynı)
function yaldFromArea(A) {
  if (!(A > 0) || !S.abak2) return null;
  if (A <= 25) return 1.0;
  const col = S.abak2.percent.map(r => r[r.length - 1]);   // 24 sa kolonu
  return lin1(A, S.abak2.areas_km2, col) / 100;
}
async function loadAbak2() {
  try { S.abak2 = await api("/api/abak2"); updateSnyderW(); } catch (e) { S.abak2 = null; }
}
loadAbak2();

function updateSnyderW() {
  const el = $("snyWReadout"); if (!el) return;
  const A = +$("inpA").value;
  const w = snyderW(+$("inpCt").value, +$("inpCp").value, +$("inpL").value, +$("inpLc").value);
  const yald = yaldFromArea(A);
  const parts = [];
  if (w) {
    $("inpW50").placeholder = w.W50.toFixed(1); $("inpW75").placeholder = w.W75.toFixed(1);
    parts.push(`t<sub>p</sub>=${w.tp.toFixed(2)} sa, q<sub>p</sub>=${w.qp.toFixed(1)} lt/s/km²/cm → <b>W50=${w.W50.toFixed(1)}</b>, <b>W75=${w.W75.toFixed(1)}</b> saat (ŞEKİL 1)`);
  } else { $("inpW50").placeholder = "ŞEKİL 1 (oto)"; $("inpW75").placeholder = "ŞEKİL 1 (oto)"; }
  if (yald != null) {
    $("inpYald").placeholder = yald.toFixed(3);
    parts.push(`ADK/<b>YALD</b> (24 sa, A=${A.toFixed(1)} km²) = <b>${yald.toFixed(3)}</b>`);
  }
  el.innerHTML = parts.length
    ? `🔎 <b>Otomatik (abaklar):</b> ${parts.join(" &nbsp;|&nbsp; ")} <span style="color:#6b6762">— boş kutularda bu değerler kullanılır</span>`
    : "";
}
["inpCt", "inpCp", "inpL", "inpLc", "inpA"].forEach(id => { const e = $(id); if (e) e.addEventListener("input", updateSnyderW); });
{ const sb = $("snyderBox"); if (sb) sb.addEventListener("toggle", updateSnyderW); }

/* ================= REZERVUAR (HAZNE) ÖTELEMESİ ================= */
async function loadReservoirDefaults() {
  try { S.resDefaults = await api("/api/reservoir-defaults"); } catch (e) { S.resDefaults = null; }
  try { S.resConDefaults = await api("/api/reservoir-controlled-defaults"); } catch (e) { S.resConDefaults = null; }
}
loadReservoirDefaults();

const RES_RP = ["2", "5", "10", "25", "50", "100", "OET"];

// Rezervuar atanabilecek noktalar: outlet (tek havza), memba/mansap (ara havza)
function reservoirPoints() {
  const pts = [];
  if (S.sonuc && S.sonuc.dsi && S.outlet)
    pts.push({ ad: "Outlet (havza çıkışı)", ll: { lat: S.outlet.snap_lat ?? S.outlet.lat, lon: S.outlet.snap_lon ?? S.outlet.lon }, kind: "compute", res: S.sonuc });
  if (S.multiSonuc) {
    const md = S.multiSonuc.md;
    S.multiSonuc.membaC.forEach((x, i) => {
      const o = md.membalar[i].outlet;
      pts.push({ ad: "Memba " + (i + 1), ll: { lat: o.snap_lat ?? o.lat, lon: o.snap_lon ?? o.lon }, kind: "compute", res: x.res, membaIndex: i });
    });
    const mo = md.mansap.outlet;
    pts.push({ ad: "Mansap (ötelenmiş)", ll: { lat: mo.snap_lat ?? mo.lat, lon: mo.snap_lon ?? mo.lon }, kind: "routed", rt: S.multiSonuc.rt });
  }
  return pts;
}
function reservoirMethods(pt) {
  if (pt.kind === "routed") return Object.keys(pt.rt.yontemler);
  const m = ["dsi"]; if (pt.res.snyder) m.push("snyder"); return m;
}
function reservoirInflow(pt, method, rp) {
  if (pt.kind === "routed") {
    const y = pt.rt.yontemler[method];
    return y && y.hidrograflar[rp] ? { data: y.hidrograflar[rp], dt: y.dt || 0.5 } : null;
  }
  if (method === "dsi") {
    let best = null, pk = -1;
    [2, 4, 6, 8, 12, 18, 24].forEach(d => { const v = pt.res.kabulet[d] && pt.res.kabulet[d][rp]; if (v != null && v > pk) { pk = v; best = d; } });
    return best != null ? { data: pt.res.dsi.hidrograflar[best][rp], dt: 0.5, note: `hakim ${best} sa` } : null;
  }
  if (method === "snyder" && pt.res.snyder) return { data: pt.res.snyder.hidrograflar[rp], dt: 1 };
  return null;
}

function openReservoir() {
  const pts = reservoirPoints();
  if (!pts.length) { alert("Önce bir hidrograf hesaplayın (Tek Havza → HESAPLA, veya Ara Havza → Hesapla ve Ötele)"); return; }
  S.resPoints = pts;
  $("resPoint").innerHTML = pts.map((p, i) => `<option value="${i}">${p.ad}</option>`).join("");
  const fillMethodRP = () => {
    const pt = pts[+$("resPoint").value];
    const ms = reservoirMethods(pt);
    $("resMethod").innerHTML = ms.map(m => `<option value="${m}">${M_LABEL[m]}</option>`).join("");
    $("resRP").innerHTML = RES_RP.map(rp => `<option value="${rp}">Q${rp}</option>`).join("");
    $("resRP").value = "100";
    showResMarker(pt);
  };
  $("resPoint").onchange = fillMethodRP;
  fillMethodRP();
  // rezervuar varsayılanları
  const D = S.resDefaults, K = S.resConDefaults;
  if (D) { $("resKret").value = D.kret_kotu; $("resYtk").value = D.yaklasim_taban_kotu; $("resApron").value = D.apron_giris_acisi_derece || 0; $("resL").value = 40; $("resC").value = 2.1; }
  if (K) { $("resSill").value = K.esik_kotu; $("resLef").value = K.lef; $("resH0").value = K.nss; $("resHmax").value = (K.nss + 3); $("resW1").value = K.taban_debi_W1; }
  // rating grid (bir kez kur, kalıcı) — He, Q kopyala-yapıştır
  S.ratGrid = makePasteGrid("resRatingGrid", "btnResRatAdd", "btnResRatClear",
    ["He (m)", "Q (m³/s)"], (D && D.dolusavak_rating.veri) || []);
  const buildGrids = () => {
    const kap = $("resType").value === "kapakli";
    $("resUncon").classList.toggle("hidden", kap);
    $("resCon").classList.toggle("hidden", !kap);
    const volDef = kap ? (K && K.hacim_satih.veri) : (D && D.hacim_satih.veri);
    S.volGrid = makePasteGrid("resVolGrid", "btnResVolAdd", "btnResVolClear",
      kap ? ["Kot (m)", "Hacim (hm³)"] : ["Kot (m)", "Alan (km²)", "Hacim (hm³)"], volDef || []);
    const tablo = !kap && $("resMode").value === "tablo";
    $("resRatingBox").classList.toggle("hidden", !tablo);
    $("resGeom").classList.toggle("hidden", kap || $("resMode").value !== "geom");
  };
  $("resType").onchange = buildGrids;
  $("resMode").onchange = buildGrids;
  buildGrids();
  // C otomatik (P/h): kutu işaretliyse C alanı kapalı, P canlı gösterilir
  const updatePh = () => {
    const auto = $("resCauto").checked;
    $("resC").disabled = auto;
    const P = (+$("resKret").value) - (+$("resYtk").value);
    $("resPhInfo").innerHTML = (auto && isFinite(P) && P > 0)
      ? `P = kret − yak.taban = <b>${P.toFixed(1)} m</b> → C, USBR P/h eğrisinden türetilir`
      : (auto ? "P için kret ve yak. taban kotu girin" : "");
  };
  $("resCauto").addEventListener("change", updatePh);
  $("resKret").addEventListener("input", updatePh);
  $("resYtk").addEventListener("input", updatePh);
  updatePh();
  $("btnResRun").onclick = runReservoir;
  $("btnResAssign").onclick = assignReservoirToMemba;
  $("resWrap").classList.remove("hidden");
}
$("btnCloseRes").onclick = () => $("resWrap").classList.add("hidden");

// seçili rezervuar noktasını haritada işaretle
function showResMarker(pt) {
  if (!pt || !pt.ll) { $("resPointInfo").textContent = ""; return; }
  if (S.resMarker) S.resMarker.remove();
  // rezervuar atanan nokta mor gösterilir
  S.resMarker = L.circleMarker([pt.ll.lat, pt.ll.lon], {
    radius: 9, color: "#6a1b9a", weight: 3, fillColor: "#9c27b0", fillOpacity: .85,
  }).addTo(map).bindTooltip("🏞 Rezervuar: " + pt.ad, { permanent: false });
  $("resPointInfo").innerHTML = `🏞 Rezervuar <b>${pt.ad}</b> noktasına atandı (${pt.ll.lat.toFixed(4)}, ${pt.ll.lon.toFixed(4)}). Bu noktadaki hidrograf haznede ötelenecek. <span style="color:#6a1b9a">●</span> nokta harita üzerinde <b>mor</b> ile işaretlendi.`;
}

/* ---- Genel editlenebilir + kopyala-yapıştır tablo fabrikası ---- */
function makePasteGrid(gridId, addId, clearId, headers, data, minRows) {
  const el = $(gridId);
  el.dataset.cols = headers.length;
  function readGrid() {
    const cols = +el.dataset.cols, map = {};
    el.querySelectorAll(".resvol-cell").forEach(inp => {
      const r = +inp.dataset.r, c = +inp.dataset.c;
      if (!map[r]) map[r] = new Array(cols).fill("");
      map[r][c] = inp.value.trim();
    });
    return Object.keys(map).sort((a, b) => a - b).map(k => map[k]);
  }
  function onPaste(e) {
    const text = (e.clipboardData || window.clipboardData).getData("text");
    if (!text || (!text.includes("\t") && !text.includes("\n"))) return;
    e.preventDefault();
    const block = text.replace(/\r/g, "").split("\n").filter(x => x.trim() !== "").map(row => row.split(/[\t;,]/));
    const r0 = +e.target.dataset.r, c0 = +e.target.dataset.c, cols = +el.dataset.cols;
    const cur = readGrid();
    while (cur.length < r0 + block.length) cur.push([]);
    block.forEach((vals, dr) => vals.forEach((val, dc) => { if (c0 + dc < cols) { if (!cur[r0 + dr]) cur[r0 + dr] = []; cur[r0 + dr][c0 + dc] = val.trim(); } }));
    render(cur);
  }
  function render(d) {
    const rows = Math.max((d || []).length, minRows || 6);
    let h = `<table class="tbl rain"><tr>` + headers.map(c => `<th>${c}</th>`).join("") + `</tr>`;
    for (let r = 0; r < rows; r++) {
      h += "<tr>";
      for (let c = 0; c < headers.length; c++) {
        const v = d && d[r] && d[r][c] != null ? d[r][c] : "";
        h += `<td><input class="resvol-cell" data-r="${r}" data-c="${c}" value="${v}"></td>`;
      }
      h += "</tr>";
    }
    el.innerHTML = h + "</table>";
    el.querySelectorAll(".resvol-cell").forEach(inp => inp.addEventListener("paste", onPaste));
  }
  render(data);
  if ($(addId)) $(addId).onclick = () => render(readGrid().concat([[]]));
  if ($(clearId)) $(clearId).onclick = () => render([]);
  return { render, read: readGrid, cols: headers.length };
}
function readGridNums(grid, ncol) {
  return grid.read()
    .filter(r => r.slice(0, ncol).every(x => x !== "" && x != null && !isNaN(+x)))
    .map(r => r.slice(0, ncol).map(Number));
}

async function runReservoir() {
  try {
    const pt = S.resPoints[+$("resPoint").value];
    const src = reservoirInflow(pt, $("resMethod").value, $("resRP").value);
    if (!src || !src.data || !src.data.length) throw new Error("Seçili nokta/yöntem/tekerrür için hidrograf yok");
    const kap = $("resType").value === "kapakli";
    const vol = readGridNums(S.volGrid, kap ? 2 : 3);
    if (vol.length < 2) throw new Error("Kot–Hacim tablosu geçersiz (en az 2 dolu satır gerekli)");
    let r;
    if (kap) {
      r = await api("/api/reservoir-controlled", {
        inflow: src.data, dt_saat: src.dt, hacim_satih: vol,
        esik_kotu: +$("resSill").value, lef: +$("resLef").value,
        baslangic_kotu: +$("resH0").value, maks_su_kotu: +$("resHmax").value,
        taban_debi: +$("resW1").value || 0,
        kapak_adedi: Math.max(1, +$("resNgate").value || 1),
        pik_sonrasi_bosalt: $("resDrain").checked,
      });
      r._kapakli = true;
    } else {
      const body = { inflow: src.data, dt_saat: src.dt, kret_kotu: +$("resKret").value, hacim_satih: vol };
      if ($("resMode").value === "tablo") {
        const rating = readGridNums(S.ratGrid, 2);
        if (rating.length < 2) throw new Error("Rating tablosu geçersiz (He, Q — en az 2 dolu satır)");
        body.rating = rating;
      } else { body.yaklasim_taban_kotu = +$("resYtk").value; body.apron_giris_acisi = +$("resApron").value || 0; body.kret_uzunlugu = +$("resL").value || 40; body.debi_katsayisi = $("resCauto").checked ? null : (+$("resC").value || 2.1); }
      r = await api("/api/reservoir-route", body);
    }
    const label = `${pt.ad} — ${M_LABEL[$("resMethod").value]} Q${$("resRP").value}${src.note ? " (" + src.note + ")" : ""}`;
    S.resSonuc = { r, src, label };
    renderReservoir();
  } catch (e) { $("resTable").innerHTML = `<div class="small err">Hata: ${e.message}</div>`; }
}

/* ---- Çok parçalı: memba noktasına hazne atama ----
   Hazne, o memba noktasının çıkışını sönümler; sönümlenmiş hidrograf
   mansaba taşındığı için aşağıdaki tüm noktaları etkiler.                  */
function buildResCfg() {
  const kap = $("resType").value === "kapakli";
  const vol = readGridNums(S.volGrid, kap ? 2 : 3);
  if (vol.length < 2) throw new Error("Kot–Hacim tablosu geçersiz (en az 2 dolu satır)");
  if (kap) {
    return { tip: "kapakli", hacim_satih: vol,
      esik_kotu: +$("resSill").value, lef: +$("resLef").value,
      baslangic_kotu: +$("resH0").value, maks_su_kotu: +$("resHmax").value,
      taban_debi: +$("resW1").value || 0,
      kapak_adedi: Math.max(1, +$("resNgate").value || 1),
      pik_sonrasi_bosalt: $("resDrain").checked };
  }
  const cfg = { tip: "kontrolsuz", hacim_satih: vol, kret_kotu: +$("resKret").value };
  if ($("resMode").value === "tablo") {
    const rating = readGridNums(S.ratGrid, 2);
    if (rating.length < 2) throw new Error("Rating tablosu geçersiz (He, Q — en az 2 dolu satır)");
    cfg.rating = rating;
  } else {
    cfg.yaklasim_taban_kotu = +$("resYtk").value;
    cfg.apron_giris_acisi = +$("resApron").value || 0;
    cfg.kret_uzunlugu = +$("resL").value || 40;
    cfg.debi_katsayisi = $("resCauto").checked ? null : (+$("resC").value || 2.1);
  }
  return cfg;
}
async function assignReservoirToMemba() {
  const st = $("resMultiStatus");
  try {
    const pt = S.resPoints[+$("resPoint").value];
    if (!pt || pt.membaIndex == null)
      throw new Error("Bu özellik yalnız çok parçalı moddaki MEMBA noktaları içindir");
    if (!S.multiSonuc) throw new Error("Önce Ara Havza → ② Hesapla ve Ötele");
    S.multiRes = S.multiRes || {};
    S.multiRes[pt.membaIndex] = buildResCfg();
    st.textContent = "Hazne atandı, mansap yeniden ötelenıyor…";
    await reRouteMulti();
    st.textContent = `✓ ${pt.ad} noktasına hazne atandı; mansap hidrografı güncellendi.`;
  } catch (e) { st.textContent = "Hata: " + e.message; }
}
// atanmış hazneleri kullanarak ötelemeyi yeniden yapar (havzalar yeniden hesaplanmaz)
async function reRouteMulti() {
  if (!S.multiSonuc) return;
  const { md, araC, membaC, methods } = S.multiSonuc;
  const rez = membaC.map((_, i) => (S.multiRes && S.multiRes[i]) || null);
  const rt = await api("/api/route", {
    ara_sonuc: araC.res, memba_sonuclari: membaC.map(x => x.res),
    lag_saat: (+$("multiLag").value || md.ara.Tc_saat), yontemler: methods,
    rezervuarlar: rez.some(Boolean) ? rez : null,
  });
  S.multiSonuc.rt = rt;
  renderMultiResults();
}

let resChart = null;
function renderReservoir() {
  const { r, label } = S.resSonuc, o = r.ozet;
  const src = { label };
  const kap = r._kapakli;
  const lab = r.t.map(t => t.toFixed(1));
  const ds = [
    { label: "Giriş I", data: r.giris, borderColor: "#e07b3a", borderWidth: 1.8, pointRadius: 0, tension: .25 },
    { label: "Çıkış O (ötelenmiş)", data: r.cikis, borderColor: "#2a9d8f", borderWidth: 2, pointRadius: 0, tension: .25 },
    { label: "Su kotu (m)", data: r.su_kotu, borderColor: "#7b1fa2", borderWidth: 1.2, borderDash: [4, 3], pointRadius: 0, yAxisID: "y2" },
  ];
  if (kap) ds.push({ label: "Kapak açıklığı (m)", data: r.kapak_acikligi, borderColor: "#c73e3a", borderWidth: 1.2, borderDash: [2, 2], pointRadius: 0, yAxisID: "y3" });
  if (resChart) resChart.destroy();
  resChart = new Chart($("resChart"), {
    type: "line", data: { labels: lab, datasets: ds },
    options: {
      animation: false, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" }, title: { display: true, text: `${kap ? "Kapaklı (optimize) hazne" : "Hazne"} ötelemesi — ${src.label}` } },
      scales: {
        x: { title: { display: true, text: "T (saat)" } },
        y: { title: { display: true, text: "Q (m³/s)" }, beginAtZero: true },
        y2: { position: "right", title: { display: true, text: "Su kotu (m)" }, grid: { drawOnChartArea: false } },
        y3: { display: false },
      },
    },
  });
  let h = `<h3 class="res">Özet</h3><table class="tbl">
    <tr><td>Giriş pik</td><td><b>${fmt(o.giris_pik, 1)}</b> m³/s @ ${fmt(o.giris_pik_saat, 0)} sa</td></tr>
    <tr><td>Çıkış pik (ötelenmiş)</td><td><b>${fmt(o.cikis_pik, 1)}</b> m³/s @ ${fmt(o.cikis_pik_saat, 0)} sa</td></tr>
    <tr><td>Pik sönümleme</td><td><b>${fmt(o.pik_sonumleme * 100, 1)}%</b></td></tr>`;
  if (kap) {
    h += `<tr><td>Optimize min çıkış piki hedefi</td><td><b>${fmt(o.min_cikis_pik_hedef, 1)}</b> m³/s</td></tr>
    <tr><td>Maks su kotu / izinli</td><td><b>${fmt(o.maks_su_kotu, 2)}</b> / ${fmt(o.H_max, 2)} m ${o.maks_su_kotu <= o.H_max + 0.01 ? "✓" : "⚠ AŞILDI"}</td></tr>
    <tr><td>Başlangıç kotu</td><td>${fmt(o.H_init, 2)} m</td></tr>
    <tr><td>Kapak adedi</td><td><b>${o.kapak_adedi || 1}</b> adet</td></tr>
    <tr><td>Pik sonrası boşaltma</td><td>${o.pik_sonrasi_bosalt ? "açık — pik sonrası O>I serbest, hazne başlangıç kotuna çekilir" : "kapalı — çıkış her zaman ≤ giriş"}</td></tr>
    <tr><td>Maks kapak açıklığı</td><td><b>${fmt(o.maks_kapak_acikligi, 2)}</b> m</td></tr>`;
    if (o.asim_uyarisi) h += `<tr><td colspan="2" class="small err">⚠ Depolama yetersiz: pass-through (O=I) bile maks kotu aşıyor; başlangıç kotunu düşürün veya maks kotu yükseltin.</td></tr>`;
    if (o.girdi_uyarisi) h += `<tr><td colspan="2" class="small err">⚠ ${o.girdi_uyarisi}</td></tr>`;
  } else {
    h += `<tr><td>Pik gecikmesi</td><td>${fmt(o.gecikme_saat, 0)} sa</td></tr>
    <tr><td>Maks su kotu</td><td><b>${fmt(o.maks_su_kotu, 2)}</b> m (kret+${fmt(o.maks_He, 2)} m)</td></tr>`;
    if (r.dolusavak_C && r.dolusavak_C.length) {
      // maks He'ye en yakın türetilen C (fiili tepe koşulu)
      const cAtPeak = r.dolusavak_C.reduce((a, b) =>
        Math.abs(b[0] - o.maks_He) < Math.abs(a[0] - o.maks_He) ? b : a);
      h += `<tr><td>Yaklaşım yüks. P</td><td>${fmt(r.yaklasim_P, 1)} m</td></tr>
      <tr><td>C (P/h, USBR)</td><td><b>${fmt(cAtPeak[1], 3)}</b> @ He=${fmt(cAtPeak[0], 2)} m
        <span class="small">(He=0.1→C=${fmt(r.dolusavak_C[0][1], 2)})</span></td></tr>`;
    }
  }
  h += `</table>`;
  if (kap) h += `<div class="small">Kapaklar; su kotu ≤ maks, çıkış ≤ giriş kısıtlarıyla çıkış piki minimum olacak şekilde
    işletilir (pik-tavan/peak-shaving; başlangıç–maks kotu arası depolama kullanılır).</div>`;
  h += `<button id="btnResCsv" class="small-btn">⬇ CSV (koordinatlar)</button>
    <table class="tbl"><tr><th>T (sa)</th><th>Giriş</th><th>Çıkış</th><th>Su kotu</th>${kap ? "<th>Kapak (m)</th>" : ""}</tr>`;
  const step = r.t.length > 80 ? 2 : 1;
  for (let i = 0; i < r.t.length; i += step)
    h += `<tr><td>${fmt(r.t[i], 1)}</td><td>${fmt(r.giris[i], 1)}</td><td>${fmt(r.cikis[i], 1)}</td><td>${fmt(r.su_kotu[i], 2)}</td>${kap ? `<td>${fmt(r.kapak_acikligi[i], 3)}</td>` : ""}</tr>`;
  h += `</table>`;
  $("resTable").innerHTML = h;
  $("btnResCsv").onclick = () => {
    const head = ["T_sa", "Giris_m3s", "Cikis_m3s", "SuKotu_m"]; if (kap) head.push("Kapak_m");
    const rows = [head];
    for (let i = 0; i < r.t.length; i++) { const row = [r.t[i].toFixed(1), r.giris[i].toFixed(2), r.cikis[i].toFixed(2), r.su_kotu[i].toFixed(3)]; if (kap) row.push(r.kapak_acikligi[i].toFixed(3)); rows.push(row); }
    download(`hazne_oteleme_${src.label.replace(/[^\w]/g, "_")}.csv`, rows.map(x => x.join(";")).join("\n"));
  };
}

function mgmFind(name) {
  if (!S.mgmByNorm) return null;
  const n = mgmNorm(name);
  if (S.mgmByNorm[n]) return S.mgmByNorm[n];
  // kısmi eşleşme (Thiessen adı MGM adını içeriyorsa veya tersi)
  let best = null;
  for (const s of S.mgm) {
    const sn = mgmNorm(s.ad);
    if (n && (sn.includes(n) || n.includes(sn))) { best = s; break; }
  }
  return best;
}

function fillRainRowFromMgm(r, st) {
  ["2", "5", "10", "25", "50", "100"].forEach((k, c) => {
    const cell = document.querySelector(`.rain-cell[data-r="${r}"][data-c="${c}"]`);
    if (cell && st.P24[k] != null) cell.value = st.P24[k];
  });
  readRainGrid();
}

function renderDplvGrid() {
  const div = $("dplvGrid");
  if (!div || !S.dplvList) return;
  const vals = S.dplvValues || Array(14).fill(null);
  let h = `<table class="tbl rain"><tr>` +
    DPLV_LABELS.map(l => `<th>${l}</th>`).join("") + `</tr><tr>` +
    vals.map((v, c) =>
      `<td><input class="dplv-cell" data-c="${c}" value="${v == null ? "" : Math.round(v * 1e6) / 1e6}"></td>`).join("") +
    `</tr></table>`;
  div.innerHTML = h;
  div.querySelectorAll(".dplv-cell").forEach(inp => {
    inp.addEventListener("input", readDplvGrid);
    inp.addEventListener("paste", (e) => {
      const text = (e.clipboardData || window.clipboardData).getData("text");
      if (!text || (!text.includes("\t") && !text.includes("\n"))) return;
      e.preventDefault();
      const flat = text.replace(/\r/g, "").split(/[\n\t]/).map(x => x.trim()).filter(x => x !== "");
      const c0 = +e.target.dataset.c;
      flat.forEach((val, dc) => {
        const cell = document.querySelector(`.dplv-cell[data-c="${c0 + dc}"]`);
        if (cell) cell.value = val;
      });
      readDplvGrid();
    });
  });
}

function readDplvGrid() {
  S.dplvValues = Array(14).fill(null);
  document.querySelectorAll(".dplv-cell").forEach(inp => {
    const t = inp.value.trim().replace(",", ".");
    S.dplvValues[+inp.dataset.c] = t === "" || isNaN(+t) ? null : +t;
  });
}

const RAIN_COLS = ["2", "5", "10", "25", "50", "100", "OEY"];
const activeStations = () => S.thiessen.filter(t => t.agirlik > 0);

function renderRainTable() {
  const w = activeStations();
  const div = $("rainGrid");
  if (!w.length) {
    div.innerHTML = `<div class="small">Önce Thiessen ağırlıklarını hesaplayın (Adım 4).</div>`;
    return;
  }
  if (!S.rainValues) S.rainValues = {};
  let h = `<div class="rain-tools"><button id="btnMgmAuto" class="small-btn">🗂 MGM'den otomatik eşleştir</button>
    <span class="small">veya her satırda MGM istasyonu seçerek P2–P100'ü doldurun (OEY elle girilir)</span>
    <label class="inline" title="Haritadaki Thiessen alanları, seçilen tekerrürün yağışına göre mavi tonlarıyla boyanır (az yağış açık, çok yağış koyu).">Alan boyaması
      <select id="rainColorCol">` +
    RAIN_COLS.map((c, i) => `<option value="${i}"${i === (S.rainColorCol ?? 5) ? " selected" : ""}>${c === "OEY" ? "OEY" : "P" + c}</option>`).join("") +
    `</select></label></div>
    <div id="rainLegend" class="rain-legend"></div>
    <table class="tbl rain st"><tr><th colspan="9">Yinelenmeli Yağışlar (24 Saatlik)</th></tr>
    <tr><th>İstasyon (w)</th><th>MGM istasyonu</th>` + RAIN_COLS.map(c => `<th>${c}</th>`).join("") + `</tr>`;
  w.forEach((t, r) => {
    const vals = S.rainValues[t.name] || [];
    h += `<tr><td>${t.name} (${(t.agirlik * 100).toFixed(0)}%)</td>
      <td><input class="mgm-pick" list="mgmList" data-r="${r}" placeholder="MGM ara…" value="${t._mgm || ""}"></td>`;
    for (let c = 0; c < 7; c++) {
      const v = vals[c] ?? "";
      h += `<td><input class="rain-cell" data-r="${r}" data-c="${c}" value="${v}"></td>`;
    }
    h += `</tr>`;
  });
  h += `<tr class="sel"><td colspan="2"><b>Ağırlıklı</b></td>` +
    RAIN_COLS.map((c, i) => `<td id="rw${i}"></td>`).join("") + `</tr></table>`;
  div.innerHTML = h;
  div.querySelectorAll(".rain-cell").forEach(inp => {
    inp.addEventListener("input", readRainGrid);
    inp.addEventListener("paste", onRainPaste);
  });
  const sel = $("rainColorCol");
  if (sel) sel.onchange = () => { S.rainColorCol = +sel.value; recolorThiessen(); };
  recolorThiessen();
  div.querySelectorAll(".mgm-pick").forEach(inp => inp.addEventListener("change", () => {
    const st = mgmFind(inp.value);
    const r = +inp.dataset.r;
    if (st) { w[r]._mgm = st.ad; inp.value = st.ad; fillRainRowFromMgm(r, st); }
  }));
  $("btnMgmAuto").onclick = () => {
    let n = 0;
    w.forEach((t, r) => {
      const st = mgmFind(t.name);
      if (st) { t._mgm = st.ad; fillRainRowFromMgm(r, st); n++; }
    });
    renderRainTable();
    setStatus("rainStatus", n ? `${n}/${w.length} istasyon MGM'den dolduruldu (kontrol edin; OEY elle)` :
      "Ad eşleşmesi bulunamadı — satırlardan elle MGM istasyonu seçin", n ? "ok" : "err");
  };
  recalcRain();
}

function onRainPaste(e) {
  const text = (e.clipboardData || window.clipboardData).getData("text");
  if (!text || (!text.includes("\t") && !text.includes("\n"))) return; // tek değer: normal yapıştır
  e.preventDefault();
  const block = text.replace(/\r/g, "").split("\n")
    .filter(x => x.trim() !== "").map(row => row.split("\t"));
  const r0 = +e.target.dataset.r, c0 = +e.target.dataset.c;
  block.forEach((cols, dr) => cols.forEach((val, dc) => {
    const cell = document.querySelector(`.rain-cell[data-r="${r0 + dr}"][data-c="${c0 + dc}"]`);
    if (cell) cell.value = val.trim();
  }));
  readRainGrid();
}

function readRainGrid() {
  const w = activeStations();
  S.rainValues = {};
  document.querySelectorAll(".rain-cell").forEach(inp => {
    const r = +inp.dataset.r, c = +inp.dataset.c;
    if (!w[r]) return;
    const name = w[r].name;
    if (!S.rainValues[name]) S.rainValues[name] = Array(7).fill(null);
    const t = inp.value.trim().replace(",", ".");
    S.rainValues[name][c] = t === "" || isNaN(+t) ? null : +t;
  });
  recalcRain();
}

function recalcRain() {
  recolorThiessen();
  const w = activeStations();
  const sums = Array(7).fill(null);
  for (let c = 0; c < 7; c++) {
    let s = 0, valid = w.length > 0;
    w.forEach(t => {
      const v = (S.rainValues && S.rainValues[t.name] || [])[c];
      if (v == null) valid = false; else s += t.agirlik * v;
    });
    if (valid) sums[c] = s;
  }
  const ok = sums.slice(0, 6).every(v => v != null);
  S.P24w = ok ? { 2: sums[0], 5: sums[1], 10: sums[2], 25: sums[3], 50: sums[4], 100: sums[5] } : null;
  S.OETw = sums[6];
  for (let i = 0; i < 7; i++) {
    const el = $("rw" + i);
    if (el) el.innerHTML = sums[i] == null ? "—" : `<b>${sums[i].toFixed(2)}</b>`;
  }
  if (ok) {
    setStatus("rainStatus", S.OETw == null ?
      "⚠ OEY sütunu boş: OET/QOET hesapları 0 kabul edilir" : "Ağırlıklı yağışlar hazır", S.OETw == null ? "err" : "ok");
    markDone(5);
  } else if (w.length) {
    setStatus("rainStatus", "Tüm istasyonlar için P2..P100 değerlerini girin", "");
  }
  updateComputeReady();
}

function dplvRatios() {
  if (S.dplvValues && S.dplvValues.every(v => v != null)) return S.dplvValues;
  // Boş/bayat seçim (ör. gizlenmiş bir istasyonu işaret eden eski proje) +"" ile
  // 0. istasyona düşmesin; ilk görünür istasyona geri çekil.
  const v = $("inpDplv").value;
  const st = v === "" ? null : S.dplvList.stations[+v];
  const gorunur = S.dplvList.stations.find(s => !DPLV_GIZLI.includes(s.name));
  return (st || gorunur || S.dplvList.stations[0]).ratios;
}

/* ---------------- ADIM 6: hesap ---------------- */
$("btnCompute").onclick = async () => {
  try {
    if (!$("inpA").value || !$("inpL").value) throw new Error("A ve L girilmedi (Adım 1)");
    if (!S.P24w) throw new Error("Ağırlıklı yağış yok (Adım 5)");
    const kar = $("karTemps").value.trim() ? {
      daily_tmax: $("karTemps").value.split(/[\s,;]+/).map(x => +x.replace(",", ".")).filter(x => !isNaN(x)),
      a_kar_km2: +$("karA").value, h_kar_m: +$("karH").value, h_ist_m: +$("karHist").value,
      melt_rate: +$("karRate").value, period: +$("karPeriod").value,
    } : null;
    const girdi = {
      ad: $("projName").value || "Havza",
      A_km2: +$("inpA").value, L_km: +$("inpL").value, Lc_km: +$("inpLc").value,
      CN2: +$("inpCN2").value, CN3: +$("inpCN3").value || null,
      region: $("inpRegion").value, elevations: S.kotlar.map(Number),
      Qbaz: +$("inpQbaz").value || 0,
      P24: S.P24w, P24_OET: S.OETw ?? 0,
      dplv_ratios: dplvRatios(),
    };
    S.girdi = girdi;
    setStatus("compStatus", "Hesaplanıyor…", "loading");
    const snyderOn = $("inpSnyder").checked;
    S.sonuc = await api("/api/compute", {
      girdi, kar,
      rasyonel: $("inpRasyonel").checked,
      c100: +$("inpC100").value || 0.45,
      us: +$("inpUs").value || 0.2,
      snyder: snyderOn,
      snyder_par: snyderOn ? {
        Ct: +$("inpCt").value || 1.55, Cp: +$("inpCp").value || 0.6,
        W50: +$("inpW50").value || null, W75: +$("inpW75").value || null,
        YALD: +$("inpYald").value || null,
      } : null,
    });
    renderResults();
    setStatus("compStatus", "Tamamlandı", "ok");
    markDone(6);
  } catch (e) { setStatus("compStatus", "Hata: " + e.message, "err"); }
};

const DURS = [2, 4, 6, 8, 12, 18, 24];
const RPS = ["2", "5", "10", "25", "50", "100", "OET"];
function renderResults() {
  const r = S.sonuc, el = $("results");
  const on = r.dsi_onhesap, m = r.mockus;
  const repMethods = ["dsi", "mockus", "rasyonel", "snyder"].filter(k =>
    k === "dsi" || k === "mockus" || (k === "rasyonel" && r.rasyonel) || (k === "snyder" && r.snyder));
  let h = `<h3 class="res">DSİ Sentetik — Önhesap</h3>
    <div class="small">S=${fmt(r.girdi_ozeti.S_harmonik, 5)} | qp=${fmt(on.qp, 2)} l/s/km²/mm |
    Qp=${fmt(on.Qp, 4)} m³/s/mm | T=${on.T_saat} sa | Tp=${fmt(on.Tp, 2)} sa</div>`;

  h += `<h3 class="res">Pik Debiler — KABULET (m³/s)</h3><table class="tbl"><tr><th>T (yıl)</th>`;
  DURS.forEach(d => h += `<th>${d} sa</th>`);
  h += `</tr>`;
  RPS.forEach(rp => {
    const vals = DURS.map(d => r.kabulet[d][rp]);
    const mx = Math.max(...vals);
    h += `<tr><td>Q${rp}</td>` + vals.map(v =>
      `<td class="${v === mx ? "max" : ""}">${fmt(v, 2)}</td>`).join("") + `</tr>`;
  });
  ["500", "1000", "10000"].forEach(rp => {
    h += `<tr><td>Q${rp}</td>` + DURS.map(d => `<td>${fmt(r.kabulet[d][rp], 2)}</td>`).join("") + `</tr>`;
  });
  h += `</table>
  <div class="grid2"><label>Proje sağanak süresi
    <select id="selDur">${DURS.map(d => `<option value="${d}">${d} saat</option>`).join("")}</select>
  </label><button id="btnChart">📈 Hidrografları göster</button></div>`;

  h += `<h3 class="res">Mockus (süperpozesiz) pik debiler</h3>
    <div class="small">Tc=${fmt(m.Tc, 3)} sa | D=${m.D} sa | Tp=${fmt(m.Tp, 3)} sa</div>
    <table class="tbl"><tr><th>K</th><th>qp</th><th>Q2</th><th>Q5</th><th>Q10</th><th>Q25</th><th>Q50</th><th>Q100</th><th>Q500</th><th>Q1000</th><th>QOET</th></tr>`;
  ["K1", "K2", "K3"].forEach(k => {
    const s = m.sonuclar[k];
    h += `<tr><td>${k}=${s.K}</td><td>${fmt(s.qp, 3)}</td>` +
      [2, 5, 10, 25, 50, 100].map(t => `<td>${fmt(s.Q[t], 2)}</td>`).join("") +
      `<td>${fmt(s.Q_ext[500], 2)}</td><td>${fmt(s.Q_ext[1000], 2)}</td><td>${fmt(s.Q_OET, 2)}</td></tr>`;
  });
  h += `</table>`;

  if (r.rasyonel) {
    const ra = r.rasyonel;
    h += `<h3 class="res">Rasyonel Yöntem</h3>
      <div class="small">Tc=${fmt(ra.Tc_dk, 1)} dk | S=${fmt(ra.S_dogrusal, 5)} | YADK=${fmt(ra.YADK, 3)} |
      PLV(Tc)=${fmt(ra.PLV_Tc, 3)} | C100=${ra.C100} | üs=${ra.us} | Tb=${fmt(ra.Tb_saat, 2)} sa</div>
      <table class="tbl"><tr>` +
      [2, 5, 10, 25, 50, 100].map(t => `<th>Q${t}</th>`).join("") +
      `<th>Q500</th><th>Q1000</th><th>Q10000</th></tr><tr>` +
      [2, 5, 10, 25, 50, 100].map(t => `<td>${fmt(ra.Q[t], 2)}</td>`).join("") +
      `<td>${fmt(ra.Q_ext["500"], 2)}</td><td>${fmt(ra.Q_ext["1000"], 2)}</td><td>${fmt(ra.Q_ext["10000"], 2)}</td></tr></table>` +
      (S.sonuc.girdi_ozeti.A_km2 > 1 ? `<div class="small">⚠ A > 1 km²: rasyonel yöntem küçük havzalar içindir, karşılaştırma amaçlı gösteriliyor.</div>` : "");
  }
  if (r.snyder) {
    const sn = r.snyder, p = sn.parametreler;
    h += `<h3 class="res">Snyder Yöntemi</h3>
      <div class="small">t<sub>p</sub>=${fmt(p.tp, 2)} sa | t<sub>r</sub>=${p.tr} sa |
      q<sub>p</sub>=${fmt(p.qp, 2)} l/s/km²/cm | Q<sub>p</sub>=${fmt(p.Qp, 3)} m³/s/mm |
      T<sub>p</sub>=${p.Tp} sa | T<sub>b</sub>=${p.Tb} sa | W50=${fmt(p.W50, 1)} | W75=${fmt(p.W75, 1)} |
      YALD=${fmt(p.YALD, 3)} | BH hacmi=${fmt(p.hacim_mm, 3)} mm</div>
      <table class="tbl"><tr>` +
      ["2", "5", "10", "25", "50", "100", "500", "1000", "10000", "OET"].map(t => `<th>Q${t}</th>`).join("") +
      `</tr><tr>` +
      ["2", "5", "10", "25", "50", "100", "500", "1000", "10000", "OET"].map(t =>
        `<td>${fmt(sn.pikler[t], 2)}</td>`).join("") +
      `</tr></table>
      <button id="btnSnyChart">📈 Snyder hidrograflarını göster</button>
      <div class="small">Q500/1000/10000 ekstrapolasyon (Q10–Q100), QOET C<sub>III</sub> ile;
      24 sa sağanak ${sn.hidrograflar["2"] ? Math.round(24 / p.tr) : "?"} bloğa bölünüp süperpoze edilmiştir.</div>`;
    if (sn.yzdo_yad) {
      const yy = sn.yzdo_yad;
      h += `<div class="small" style="margin-top:4px"><b>Otomatik çekilen YZDO & YAD</b> —
        bölge <b>${yy.bolge}</b> | ADK/YALD (24 sa alansal azaltma) = <b>${fmt(yy.YALD, 3)}</b> |
        MF=${fmt(yy.MF, 2)} | ${yy.n_blok}×${yy.tr} sa blok</div>
        <table class="tbl"><tr><th>Blok</th>` + yy.bloklar.map(b => `<th>${b.sure_sa} sa</th>`).join("") + `</tr>
        <tr><td>T/ΣT</td>` + yy.bloklar.map(b => `<td>${fmt(b.oran, 3)}</td>`).join("") + `</tr>
        <tr><td>YZDO (${yy.bolge})</td>` + yy.bloklar.map(b => `<td>${fmt(b.yzdo, 3)}</td>`).join("") + `</tr></table>`;
    }
  }
  if (r.kar) h += `<div class="small">Kar erimesi piki: ${fmt(r.kar.Qkar_pik, 1)} m³/s (OET hidrografına eklendi)</div>`;

  h += `<h3 class="res">Tekerrür yılı ara (Yıl_Ara)</h3>
    <div class="grid2"><label>Debi (m³/s)<input id="yilQ" type="number" step="0.1"></label>
    <button id="btnYil">Ara</button></div><div id="yilRes" class="status"></div>
    <div class="export-row"><button id="btnCompare" class="primary">⚖ Yöntemleri Karşılaştır</button>
      <button id="btnReservoir" class="primary">🏞 Rezervuar Ötelemesi</button>
      <button id="btnCSV">⬇ CSV</button><button id="btnJSON">⬇ JSON</button></div>
    <div class="export-row" style="align-items:center;flex-wrap:wrap">
      <span class="small">Rapora dahil yöntemler:</span>
      ${repMethods.map(m => `<label style="flex-direction:row;align-items:center;gap:3px">
        <input type="checkbox" class="repMethod" data-m="${m}" checked>${CMP_LABELS[m]}</label>`).join("")}
    </div>
    <div class="export-row" style="align-items:center;flex-wrap:wrap">
      <label style="flex-direction:row;align-items:center;gap:4px">Seçilen (kabul edilen) yöntem
        <select id="repSecili">${repMethods.map(m => `<option value="${m}">${CMP_LABELS[m]}</option>`).join("")}</select></label>
      <label style="flex-direction:row;align-items:center;gap:4px">Bölüm no
        <input id="repBolum" value="4.7.3" style="width:64px"></label>
    </div>
    <div class="export-row" style="align-items:center">
      <button id="btnReport" class="primary">📄 Word Raporu (Bölüm) indir</button>
      <button id="btnKmz">🌍 KMZ indir (havza + dere + debiler)</button>
      <span id="repStatus" class="small"></span>
    </div>`;
  el.innerHTML = h;
  // dahil kutuları değişince seçilen-yöntem menüsünü güncel tut
  document.querySelectorAll(".repMethod").forEach(cb => cb.onchange = syncRepSecili);

  $("btnChart").onclick = () => showChart(+$("selDur").value);
  $("btnCompare").onclick = () => openCompare();
  $("btnReservoir").onclick = openReservoir;
  $("btnReport").onclick = downloadReport;
  $("btnKmz").onclick = downloadKmz;
  if (r.snyder) $("btnSnyChart").onclick = () => showSnyderChart();
  $("btnYil").onclick = () => {
    const d = $("selDur").value, q = +$("yilQ").value;
    const t = api("/api/yil-ara", { q, q10: r.kabulet[d]["10"], q100: r.kabulet[d]["100"] })
      .then(x => $("yilRes").textContent =
        `T ≈ ${x.tekerrur_yili ? x.tekerrur_yili.toFixed(1) : "—"} yıl (${d} sa hidrografına göre)`);
  };
  $("btnCSV").onclick = exportCSV;
  $("btnJSON").onclick = () => download("taskin_sonuc.json", JSON.stringify(S.sonuc, null, 1));
}

/* ================= WORD RAPORU ================= */
// dahil kutuları değişince "seçilen yöntem" menüsünü yalnız işaretli yöntemlerle güncelle
function syncRepSecili() {
  const checked = Array.from(document.querySelectorAll(".repMethod:checked")).map(x => x.dataset.m);
  const sel = $("repSecili");
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = checked.map(mm => `<option value="${mm}">${CMP_LABELS[mm]}</option>`).join("");
  if (checked.includes(cur)) sel.value = cur;
}

async function downloadReport() {
  if (!S.sonuc || !S.girdi) { $("repStatus").textContent = "Önce hesaplayın"; return; }
  const dahil = Array.from(document.querySelectorAll(".repMethod:checked")).map(x => x.dataset.m);
  if (!dahil.length) { $("repStatus").textContent = "En az bir yöntem seçin"; return; }
  setStatus("repStatus", "", "");
  $("repStatus").textContent = "Rapor hazırlanıyor… (şekiller çiziliyor)";
  try {
    const secili = $("repSecili").value;
    const meta = {
      proje_adi: $("projName").value || S.girdi.ad || "Proje",
      bolum_no: $("repBolum").value.trim() || "4.7.3",
      rapor_yontemleri: dahil,
      secili_yontem: dahil.includes(secili) ? secili : dahil[0],
      MF: 1.13,
      thiessen: (S.thiessen || []).filter(t => t.agirlik > 0)
        .map(t => ({ name: t.name, agirlik: t.agirlik })),
    };
    const resp = await fetch("/api/report", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ girdi: S.girdi, sonuc: S.sonuc, meta }),
    });
    const name = await dosyaIndir(resp, "Taskin_Bolum.docx");
    $("repStatus").textContent = "✓ İndirildi: " + name;
  } catch (e) { $("repStatus").textContent = "Hata: " + e.message; }
}

/* Yanıttaki dosyayı Content-Disposition adıyla indirir, indirilen adı döndürür. */
async function dosyaIndir(resp, varsayilanAd) {
  if (!resp.ok) {
    let msg = resp.statusText;
    try { msg = (await resp.json()).hata || msg; } catch (e) {}
    throw new Error(msg);
  }
  const blob = await resp.blob();
  const cd = resp.headers.get("content-disposition") || "";
  let name = varsayilanAd;
  const idx = cd.indexOf("filename=");
  if (idx >= 0) name = cd.slice(idx + 9).replace(/["';]/g, "").trim() || name;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return name;
}

/* Katmandaki güncel geometri (elle düzenlemeler dahil); boşsa null. */
function katmanGeojson(katman) {
  if (!katman) return null;
  const gj = katman.toGeoJSON();
  return (gj && gj.features && gj.features.length) ? gj : null;
}

/* Nihai havza sınırı + dere ağı + seçili yöntemin tekerrürlü pik debileri → KMZ.
   Geometri S'ten değil harita katmanlarından okunur, böylece haritada yapılan
   düzenlemeler çıktıya birebir yansır. */
async function downloadKmz() {
  if (!S.sonuc) { $("repStatus").textContent = "Önce hesaplayın"; return; }
  const havza = katmanGeojson(layers.havza);
  if (!havza) { $("repStatus").textContent = "Havza sınırı yok — önce havzayı çıkarın"; return; }
  const yontem = $("repSecili").value;
  $("repStatus").textContent = "KMZ hazırlanıyor…";
  try {
    const debiler = {};
    CMP_RPS.forEach(rp => { const v = cmpPeak(yontem, rp); if (v != null) debiler[rp] = v; });
    const o = S.outlet;
    const resp = await fetch("/api/kmz-export", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ad: $("projName").value || (S.girdi && S.girdi.ad) || "Havza",
        yontem_ad: CMP_LABELS[yontem] || yontem,
        havza_geojson: havza,
        dere_geojson: katmanGeojson(layers.dere),
        kanal_geojson: katmanGeojson(layers.kanal),
        outlet: o ? { lat: o.snap_lat ?? o.lat, lon: o.snap_lon ?? o.lon } : null,
        debiler,
        girdi_ozeti: S.sonuc.girdi_ozeti || null,
      }),
    });
    const name = await dosyaIndir(resp, "havza.kmz");
    $("repStatus").textContent = "✓ İndirildi: " + name;
  } catch (e) { $("repStatus").textContent = "Hata: " + e.message; }
}

/* ================= ARA HAVZA (ÇOK PARÇALI) ================= */
S.multi = { mansap: null, membalar: [], place: null };
const multiLayers = {
  poly: L.geoJSON(null, {
    style: f => ({ color: f.properties && f.properties.c || "#7b1fa2", weight: 2, fillOpacity: .12 }),
    onEachFeature: (f, layer) => {
      const p = f.properties || {};
      layer.on("click", () => onMultiPolyClick(p));
      layer.bindTooltip(p.kind === "memba" ? `🗑 Memba ${(+p.i || 0) + 1} havzasını sil (tıkla)`
        : "Ara havza — çözümü temizlemek için tıkla", { sticky: true });
    },
  }).addTo(map),
  pts: L.layerGroup().addTo(map),
};
multiLayers.poly.remove(); multiLayers.pts.remove(); // varsayılan gizli

function setMode(mode) {
  S.mode = mode;
  const multi = mode === "multi", dil = mode === "dilekce", wiz = mode === "wizard";
  const suM = mode === "su";
  $("modeWizard").classList.toggle("active", wiz);
  $("modeMulti").classList.toggle("active", multi);
  $("modeDilekce").classList.toggle("active", dil);
  $("modeSu").classList.toggle("active", suM);
  $("steps").classList.toggle("hidden", !wiz);
  if (!wiz) document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
  $("multiMode").classList.toggle("hidden", !multi);
  $("dilekceMode").classList.toggle("hidden", !dil);
  $("suMode").classList.toggle("hidden", !suM);
  if (suM) suBaslat(); else layers.su.remove();
  $("rainDock").classList.add("hidden");
  if (multi) {
    // Mansap noktası varsayılan: tek havzadaki outlet (kullanıcı elle değiştirmediyse hep senkron)
    if (S.outlet && (!S.multi.mansap || S.multi.mansapAuto)) {
      const nm = { lat: +(S.outlet.snap_lat ?? S.outlet.lat).toFixed(6),
                   lon: +(S.outlet.snap_lon ?? S.outlet.lon).toFixed(6) };
      if (!S.multi.mansap || S.multi.mansap.lat !== nm.lat || S.multi.mansap.lon !== nm.lon) {
        S.multi.mansap = nm; S.multi.mansapAuto = true; invalidateMultiSolve();
      }
    }
    multiLayers.poly.addTo(map); multiLayers.pts.addTo(map);
    renderMultiPoints(); updateMultiShared();
  }
  else {
    multiLayers.poly.remove(); multiLayers.pts.remove();
    if (wiz) document.querySelector('.step[data-step="1"]').click();
  }
  if (dil) initDilekce();
}
$("modeWizard").onclick = () => setMode("wizard");
$("modeMulti").onclick = () => setMode("multi");
$("modeDilekce").onclick = () => setMode("dilekce");
$("modeSu").onclick = () => setMode("su");

/* ---------------- SU POTANSİYELİ ----------------
   Günlük akım serilerinden hacim odaklı değerlendirme. Taşkın tarafındaki
   AGİ katmanından ayrı bir veri tabanı (2909 istasyon, 1934-2015).        */
layers.su = L.layerGroup();
S.suSecili = new Set();      // periyot/regresyona girecek istasyonlar
S.suListe = [];

function suIsaretle() {
  layers.su.eachLayer(l => {
    if (!l.su) return;
    const sec = S.suSecili.has(l.su.kod);
    const hedef = $("suHedef").value === l.su.kod;
    l.setStyle({
      radius: hedef ? 9 : (sec ? 7 : 5),
      color: hedef ? "#000" : (sec ? "#00695c" : "#78909c"),
      weight: hedef ? 3 : (sec ? 2.5 : 1.2),
      fillColor: l.su.icinde ? "#26a69a" : "#90a4ae",
      fillOpacity: 0.85,
    });
  });
  $("btnSuPeriyot").disabled = S.suSecili.size < 1;
  $("btnSuTamamla").disabled = !$("suHedef").value;
}

function suHedefDoldur() {
  const sec = $("suHedef"), onceki = sec.value;
  sec.innerHTML = '<option value="">— seçin —</option>'
    + S.suListe.filter(s => S.suSecili.has(s.kod))
        .map(s => `<option value="${s.kod}">${s.kod} — ${(s.ad || "").replace(/_/g, " ")}`
                  + `${s.alan_km2 ? " (" + fmt(s.alan_km2, 0) + " km²)" : ""}</option>`).join("");
  sec.value = S.suSecili.has(onceki) ? onceki : "";
  suIsaretle();
}

function suHavzaGuncelle() {
  const a = +$("inpA").value;
  if (a && !$("suAlan").value) $("suAlan").value = a;
  $("suHavzaInfo").innerHTML = S.havza
    ? `Havza çıkarıldı — alan <b>${fmt(a, 2)} km²</b>`
      + (S.outlet ? ` · outlet ${fmt(S.outlet.snap_lat ?? S.outlet.lat, 5)}, `
                    + `${fmt(S.outlet.snap_lon ?? S.outlet.lon, 5)}` : "")
    : "Havza yok — outlet seçip çıkarın (ya da alanı elle yazıp doğrudan 3. adıma geçin).";
}

async function suBaslat() {
  layers.su.addTo(map);
  suHavzaGuncelle();
  try {
    const b = await api("/api/su-bilgi");
    if (!b.var) {
      $("btnSuGetir").disabled = true;
      $("suInfo").textContent = "veri yok — tools/su_veritabani_olustur.py ile üretin";
    } else if (!$("suInfo").textContent) {
      $("suInfo").textContent = `${b.istasyon.toLocaleString("tr")} istasyon · `
        + `${b.gun.toLocaleString("tr")} günlük kayıt · ${b.ilk_tarih}…${b.son_tarih}`;
    }
  } catch (e) { /* uç yoksa sessiz geç */ }
}

/* 1) havza — taşkın modundaki çıkarımın aynısını kullanır */
$("btnSuHavza").onclick = () => { $("btnPick").click(); };

/* 3) civardaki AGİ'ler */
$("btnSuGetir").onclick = async () => {
  setStatus("suStatus", "AGİ'ler getiriliyor…", "loading");
  try {
    let r;
    if (S.havza) {
      r = await api("/api/su-havza", {
        geometri: (S.havza.features ? S.havza.features[0].geometry : S.havza.geometry || S.havza),
        tampon_derece: +$("suTampon").value || 0,
        en_az_yil: +$("suEnAzYil").value || 5,
      });
    } else {
      const b = map.getBounds();
      const q = new URLSearchParams({
        bati: b.getWest(), guney: b.getSouth(), dogu: b.getEast(), kuzey: b.getNorth(),
        en_az_yil: +$("suEnAzYil").value || 5,
      });
      r = await api("/api/su-istasyon?" + q.toString());
    }
    S.suListe = r.istasyonlar;
    S.suSecili = new Set(r.istasyonlar.filter(s => s.alan_km2).map(s => s.kod));
    layers.su.clearLayers();
    r.istasyonlar.forEach(s => {
      if (s.lat == null || s.lon == null) return;
      const m = L.circleMarker([s.lat, s.lon], { radius: 5 });
      m.su = s;
      m.bindTooltip(`${s.kod} — ${(s.ad || "").replace(/_/g, " ")}`, { sticky: true });
      m.on("click", () => {
        if (S.suSecili.has(s.kod)) S.suSecili.delete(s.kod); else S.suSecili.add(s.kod);
        suListele();
      });
      m.addTo(layers.su);
    });
    suListele();
    const ic = r.istasyonlar.filter(s => s.icinde).length;
    setStatus("suStatus", `${r.istasyonlar.length} istasyon`
      + (S.havza ? ` (${ic} tanesi havza içinde)` : "")
      + " — analize girecekleri işaretleyin.", "ok");
  } catch (e) {
    setStatus("suStatus", "AGİ'ler getirilemedi: " + e.message, "err");
  }
};

function suListele() {
  const sat = (s) => `<tr><td><input type="checkbox" class="su-cb" data-kod="${s.kod}"`
    + `${S.suSecili.has(s.kod) ? " checked" : ""}`
    + `${s.alan_km2 ? "" : " disabled title='yağış alanı yok — havzaya taşınamaz'"}></td>`
    + `<td>${s.kod}</td><td>${(s.ad || "").replace(/_/g, " ")}</td>`
    + `<td>${s.icinde ? "içinde" : "çevre"}</td>`
    + `<td style="text-align:right">${(s.veri_gun / 365).toFixed(0)}</td>`
    + `<td style="text-align:right">${s.alan_km2 ? fmt(s.alan_km2, 1) : "—"}</td>`
    + `<td style="text-align:right">${s.q_ort != null ? fmt(s.q_ort, 2) : "—"}</td></tr>`;
  $("suListe").innerHTML = S.suListe.length
    ? '<table class="tbl small"><tr><th>✓</th><th>Kod</th><th>Ad</th><th>Konum</th>'
      + "<th>Yıl</th><th>A (km²)</th><th>Q<sub>ort</sub></th></tr>"
      + S.suListe.map(sat).join("") + "</table>"
    : '<p class="small">Bu alanda yeterli uzunlukta istasyon yok.</p>';
  $("suListe").querySelectorAll(".su-cb").forEach(cb => {
    cb.onclick = () => {
      if (cb.checked) S.suSecili.add(cb.dataset.kod); else S.suSecili.delete(cb.dataset.kod);
      suHedefDoldur();
    };
  });
  suHedefDoldur();
}

/* 4) ölçüm periyotları + korelasyon */
$("btnSuPeriyot").onclick = async () => {
  const ilk = +$("suIlkYil").value, son = +$("suSonYil").value;
  if (!(ilk && son && son >= ilk)) return setStatus("suStatus",
    "Geçerli bir yıl aralığı girin.", "err");
  setStatus("suStatus", "Periyotlar çıkarılıyor…", "loading");
  try {
    const r = await api("/api/su-periyot",
      { kodlar: [...S.suSecili], ilk_yil: ilk, son_yil: son });
    S.suPeriyot = r;
    const t = r.tablo;
    const renk = { tam: "#2e7d32", eksik: "#f9a825", yok: "#e0e0e0" };
    let h = '<p class="small"><b>Ölçüm periyotları</b> — '
      + '<span style="color:#2e7d32">■</span> tam yıl · '
      + '<span style="color:#f9a825">■</span> eksik (kısmi gözlem) · '
      + '<span style="color:#bdbdbd">■</span> veri yok</p>'
      + '<div style="overflow-x:auto"><table class="tbl small"><tr><th>İstasyon</th>'
      + t.yillar.map(y => `<th style="writing-mode:vertical-rl;font-weight:400">${y}</th>`).join("")
      + "<th>tam</th><th>eksik</th></tr>";
    t.istasyonlar.forEach(s => {
      h += `<tr><td title="${(s.ad || "").replace(/_/g, " ")}">${s.kod}</td>`
        + s.yillar.map(y => `<td title="${y.yil}: ${y.durum}${y.q != null
            ? " · " + fmt(y.q, 2) + " m³/s, " + y.gun + " gün" : ""}"`
            + ` style="background:${renk[y.durum]};padding:0 3px"></td>`).join("")
        + `<td style="text-align:right">${s.tam_yil}</td>`
        + `<td style="text-align:right">${s.eksik_yil}</td></tr>`;
    });
    h += "</table></div>";

    const ky = r.korelasyon.filter(k => k.r2 != null).sort((a, b) => b.r2 - a.r2);
    if (ky.length) {
      h += '<p class="small"><b>İstasyon çiftleri arasındaki ilişki</b> '
        + "(yıllık ortalama akım regresyonu, en iyi 12)</p><table class='tbl small'>"
        + "<tr><th>A</th><th>B</th><th>ortak yıl</th><th>r</th><th>r²</th></tr>"
        + ky.slice(0, 12).map(k => `<tr><td>${k.a}</td><td>${k.b}</td>`
            + `<td style="text-align:right">${k.ortak_yil}</td>`
            + `<td style="text-align:right">${fmt(k.r, 3)}</td>`
            + `<td style="text-align:right">${fmt(k.r2, 3)}</td></tr>`).join("")
        + "</table>";
    }
    $("suPeriyot").innerHTML = h;
    const eksikToplam = t.istasyonlar.reduce((a, s) => a + s.eksik_yil, 0);
    setStatus("suStatus", `${t.istasyonlar.length} istasyon × ${t.yillar.length} yıl — `
      + `toplam ${eksikToplam} eksik yıl. Temsil AGİ'sini seçip tamamlayın.`, "ok");
  } catch (e) {
    setStatus("suStatus", "Periyotlar çıkarılamadı: " + e.message, "err");
  }
};

$("suHedef").onchange = suIsaretle;

/* 5) eksikleri tamamla + havza çıkışına taşı */
$("btnSuTamamla").onclick = async () => {
  const hedef = $("suHedef").value;
  if (!hedef) return;
  const alan = +$("suAlan").value || +$("inpA").value;
  setStatus("suStatus", "Regresyonla tamamlanıyor…", "loading");
  try {
    const o = await api("/api/su-tamamla", {
      hedef, vericiler: [...S.suSecili],
      ilk_yil: +$("suIlkYil").value, son_yil: +$("suSonYil").value,
      en_az_r2: +$("suR2").value || 0.5,
      havza_alani_km2: alan || null, us: +$("suUs").value || 1,
    });
    S.suTamam = o;
    const i = o.istasyon;
    let h = `<h3 class="small">${i.kod} — ${(i.ad || "").replace(/_/g, " ")}`
      + `${i.alan_km2 ? " (" + fmt(i.alan_km2, 1) + " km²)" : ""}</h3>`;

    const il = Object.entries(o.iliskiler).sort((a, b) => b[1].r2 - a[1].r2);
    h += '<p class="small"><b>Kabul edilen ilişkiler</b> (eksik yıl doldurmada '
      + "kullanılma sırası)</p>";
    h += il.length
      ? '<table class="tbl small"><tr><th>Verici</th><th>r²</th><th>ortak yıl</th>'
        + "<th>bağıntı</th></tr>"
        + il.map(([k, v]) => `<tr><td>${k}</td>`
            + `<td style="text-align:right">${fmt(v.r2, 3)}</td>`
            + `<td style="text-align:right">${v.ortak_yil}</td>`
            + `<td>Q = ${fmt(v.kesim, 3)} + ${fmt(v.egim, 4)}·Q<sub>${k}</sub></td></tr>`).join("")
        + "</table>"
      : '<p class="small">r² eşiğini geçen ilişki yok — eşiği düşürün ya da başka '
        + "istasyon işaretleyin.</p>";

    h += `<p class="small"><b>Yıllık seri</b> — ${o.gozlem} gözlem, `
      + `${o.dolduruldu} regresyonla dolduruldu`
      + (o.bos ? `, <b>${o.bos} yıl boş kaldı</b>` : "") + "</p>"
      + '<div style="overflow-x:auto"><table class="tbl small"><tr><th>Su yılı</th>'
      + o.seri.map(s => `<th style="font-weight:400">${s.yil}</th>`).join("") + "</tr>"
      + "<tr><td>Q (m³/s)</td>" + o.seri.map(s =>
          `<td style="text-align:right;${s.kaynak === "gözlem" ? ""
            : s.q == null ? "background:#ffcdd2" : "background:#fff9c4"}"`
          + ` title="${s.kaynak === "gözlem" ? "gözlem"
              : s.kaynak ? s.kaynak + " ile dolduruldu (r²=" + fmt(s.r2, 3) + ")"
              : "veri yok"}">${s.q == null ? "—" : fmt(s.q, 2)}</td>`).join("")
      + "</tr></table></div>";

    if (o.outlet) {
      const u = o.outlet;
      h += `<p class="small"><b>Havza çıkışına taşınmış potansiyel</b> — `
        + `(${fmt(u.havza_alani_km2, 1)} / ${fmt(u.kaynak_alan_km2, 1)})`
        + `<sup>${fmt(u.us, 2)}</sup> = ${fmt(u.oran, 4)}</p><table class="tbl small">`
        + `<tr><td>Ortalama akım Q<sub>ort</sub></td><td><b>${fmt(u.q_ort, 3)}</b> m³/s</td></tr>`
        + `<tr><td>Yıllık hacim</td><td><b>${fmt(u.yillik_hacim_hm3, 2)}</b> hm³/yıl</td></tr>`
        + `<tr><td>Özgül verim</td><td>${fmt(u.ozgul_verim_ls_km2, 2)} L/s/km²</td></tr>`
        + `<tr><td>Yıllık verim</td><td>${fmt(u.yillik_verim_mm, 0)} mm</td></tr>`
        + `<tr><td>Kullanılan yıl</td><td>${u.yil_sayisi}</td></tr></table>`;
    }
    $("suSonuc").innerHTML = h;
    setStatus("suStatus", o.outlet
      ? `Havza çıkışı: Q_ort = ${fmt(o.outlet.q_ort, 3)} m³/s · `
        + `${fmt(o.outlet.yillik_hacim_hm3, 2)} hm³/yıl.`
      : `${o.gozlem} gözlem + ${o.dolduruldu} dolduruldu (havza alanı girilmedi).`, "ok");
  } catch (e) {
    setStatus("suStatus", "Tamamlanamadı: " + e.message, "err");
  }
};

/* ---------------- DİLEKÇE (MGM veri talebi) ---------------- */
let dilStGrid = null, dilInited = false;
let dilImzaB64 = "";   // kullanıcı görsel yüklerse; boşsa backend varsayılanı kullanır
async function initDilekce() {
  if (!dilStGrid) {
    dilStGrid = makePasteGrid("dilStGrid", "btnDilStAdd", "btnDilStClear",
      ["İst. No", "İstasyon Adı", "Ölçüm aralığı (yıl)"], [], 3);
  }
  if (dilInited) return;
  dilInited = true;
  try {
    const d = await api("/api/dilekce-defaults");
    if (!$("dilEposta").value) $("dilEposta").value = d.eposta || "";
    if (!$("dilGsm").value) $("dilGsm").value = d.gsm || "";
    if (!$("dilAdres").value.trim()) $("dilAdres").value = d.adres || "";
    if (!$("dilVeri").value.trim()) $("dilVeri").value = (d.veri_turleri || []).join("\n");
    if (d.imza_var) $("dilImzaPrev").src = "/api/dilekce-imza?" + Date.now();
  } catch (e) { setStatus("dilStatus", "Varsayılanlar yüklenemedi: " + e.message, "err"); }
}
$("dilImzaFile").onchange = () => {
  const f = $("dilImzaFile").files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { dilImzaB64 = rd.result; $("dilImzaPrev").src = rd.result; };
  rd.readAsDataURL(f);
};
$("btnDilImzaReset").onclick = () => {
  dilImzaB64 = ""; $("dilImzaFile").value = "";
  $("dilImzaPrev").src = "/api/dilekce-imza?" + Date.now();
};
$("btnDilFromTh").onclick = () => {
  const act = (S.thiessen || []).filter(t => t.agirlik > 0);
  if (!act.length) return alert("Önce Thiessen hesaplayın (Tek Havza → Adım 4)");
  if (!dilStGrid) initDilekce();
  dilStGrid.render(act.map(t => ["", t.name, ""]));
};
$("btnDilekce").onclick = async () => {
  try {
    const rows = dilStGrid ? dilStGrid.read() : [];
    const istasyonlar = rows
      .filter(r => (r[1] || "").trim() || (r[0] || "").trim())
      .map(r => ({ no: (r[0] || "").trim(), ad: (r[1] || "").trim(), aralik: (r[2] || "").trim() }));
    if (!istasyonlar.length) throw new Error("En az bir istasyon girin (Ad)");
    const veri = $("dilVeri").value.split("\n").map(x => x.trim()).filter(Boolean);
    const fmt = $("dilFormat").value === "pdf" ? "pdf" : "docx";
    const body = {
      il: $("dilIl").value.trim(), istasyonlar, veri_turleri: veri.length ? veri : null,
      eposta: $("dilEposta").value.trim(), gsm: $("dilGsm").value.trim(),
      adres: $("dilAdres").value.trim(), imza: $("dilImza").value.trim(), kase: $("dilKase").value.trim(),
      format: fmt, imza_b64: dilImzaB64 || "", use_default_imza: true,
    };
    setStatus("dilStatus", "Dilekçe oluşturuluyor…", "loading");
    const resp = await fetch("/api/dilekce", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!resp.ok) { const j = await resp.json().catch(() => ({})); throw new Error(j.hata || j.detail || resp.statusText); }
    const blob = await resp.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (istasyonlar[0].ad || body.il || "MGM").replace(/[^\wçğıöşüÇĞİÖŞÜ]+/g, "_") + "_MGM_Dilekce." + fmt;
    a.click(); URL.revokeObjectURL(a.href);
    setStatus("dilStatus", "Dilekçe indirildi.", "ok");
  } catch (e) { setStatus("dilStatus", "Hata: " + e.message, "err"); }
};

// 1) Ortak veri durumu (istasyon + yağış) — Adım 4-5'ten paylaşılır
function updateMultiShared() {
  const nSt = (S.istasyonlar || []).length;
  const nRain = S.rainValues ? Object.values(S.rainValues).filter(v => v && v.slice(0, 6).every(x => x != null)).length : 0;
  const ok = nSt > 0 && nRain > 0;
  $("multiShared").innerHTML = ok
    ? `✓ İstasyonlar: ${nSt} yüklü — Yağış: ${nRain} istasyon dolu. (Değiştirmek için “Tek Havza” → Adım 4–5.)`
    : `⚠ Eksik: ${nSt ? "" : "istasyon (Adım 4) "}${nRain ? "" : "yağış (Adım 5)"} — “Tek Havza” moduna geçip Adım 4–5'i doldurun.`;
  $("multiShared").className = "small " + (ok ? "" : "err");
}
function selectedMethods() {
  return Array.from(document.querySelectorAll(".mmethod:checked")).map(x => x.dataset.m);
}

$("btnAddMansap").onclick = () => { S.multi.place = "mansap"; multiHint("Haritada MANSAP (çıkış) noktasına tıklayın"); };
$("btnAddMemba").onclick = () => { S.multi.place = "memba"; multiHint("Haritada bir MEMBA (üst havza çıkışı) noktasına tıklayın"); };
function multiHint(msg) { setStatus("multiStatus", msg, ""); map.getContainer().style.cursor = "crosshair"; }

function multiAddPoint(latlng) {
  const p = { lat: +latlng.lat.toFixed(6), lon: +latlng.lng.toFixed(6) };
  if (S.multi.place === "mansap") { S.multi.mansap = p; S.multi.mansapAuto = false; }
  else S.multi.membalar.push(p);
  S.multi.place = null;
  map.getContainer().style.cursor = "";
  setStatus("multiStatus", "", "");
  invalidateMultiSolve();
  renderMultiPoints();
}
function invalidateMultiSolve() {
  S.multiMd = null;
  S.multiRes = {};        // memba indeksleri değişebilir; hazne atamalarını düşür
  S.multiQbazVals = {};   // aynı nedenle elle girilen baz akımları da
  const b = $("btnSolveCompute"); if (b) b.disabled = true;
}

function renderMultiPoints() {
  let h = "";
  if (S.multi.mansap)
    h += `<div class="mpt-row"><span class="dot" style="background:#c73e3a"></span>
      Mansap: ${S.multi.mansap.lat.toFixed(4)}, ${S.multi.mansap.lon.toFixed(4)}
      ${S.multi.mansapAuto ? '<span class="small" style="color:#6b6762">(tek havza outlet\'i)</span>' : ""}
      <button data-t="mansap">✕</button></div>`;
  S.multi.membalar.forEach((m, i) => {
    h += `<div class="mpt-row"><span class="dot" style="background:#1e88e5"></span>
      Memba ${i + 1}: ${m.lat.toFixed(4)}, ${m.lon.toFixed(4)}
      <button data-t="memba" data-i="${i}">✕</button></div>`;
  });
  $("multiPoints").innerHTML = h || `<div class="small">Henüz nokta eklenmedi.</div>`;
  $("multiPoints").querySelectorAll("button").forEach(b => b.onclick = () => {
    if (b.dataset.t === "mansap") { S.multi.mansap = null; S.multi.mansapAuto = false; }
    else S.multi.membalar.splice(+b.dataset.i, 1);
    invalidateMultiSolve();
    renderMultiPoints();
  });
  drawMultiPoints();
}

function drawMultiPoints() {
  multiLayers.pts.clearLayers();
  if (S.multi.mansap)
    L.marker([S.multi.mansap.lat, S.multi.mansap.lon]).addTo(multiLayers.pts).bindTooltip("Mansap");
  S.multi.membalar.forEach((m, i) =>
    L.circleMarker([m.lat, m.lon], { radius: 6, color: "#1e88e5", fillOpacity: .8 })
      .addTo(multiLayers.pts).bindTooltip("Memba " + (i + 1)));
}

// bir alt havza poligonunu seçili yöntemlerle tam otomatik hesaplar
/* ---- Alt havza baz akımları ----
   Varsayılan: mansap toplamı alan oranıyla dağıtılır. Kullanıcı her havza
   için (memba_i / ara) elle değer girerse o kullanılır.                    */
function qbazOran(sub, aMansap) {
  const tot = +$("multiQbaz").value || 0;
  return aMansap > 0 ? tot * (sub.alan_km2 / aMansap) : 0;
}
function qbazDegeri(anahtar, sub, aMansap) {
  const el = $("qb_" + anahtar);
  if (el && el.value !== "" && !isNaN(+el.value)) return +el.value;
  return qbazOran(sub, aMansap);
}
function renderMultiQbaz() {
  const box = $("multiQbazBox");
  if (!box) return;
  const md = S.multiMd;
  if (!md) { box.innerHTML = ""; return; }
  const aM = md.mansap.alan_km2;
  const satir = (anahtar, ad, sub) => {
    const onceki = S.multiQbazVals ? S.multiQbazVals[anahtar] : undefined;
    const oran = qbazOran(sub, aM);
    return `<tr><td>${ad}</td><td>${fmt(sub.alan_km2, 1)}</td>
      <td>${fmt(oran, 2)}</td>
      <td><input class="qbaz-cell" id="qb_${anahtar}" type="number" step="0.1"
           value="${onceki != null ? onceki : ""}" placeholder="${oran.toFixed(2)}"></td></tr>`;
  };
  let h = `<div class="mstep"><b>Baz akımlar</b> — boş bırakılırsa alan oranıyla dağıtılan
    değer kullanılır (gri yazı)</div>
    <table class="tbl"><tr><th>Havza</th><th>A (km²)</th><th>Alan oranıyla</th>
    <th>Elle (m³/s)</th></tr>`;
  md.membalar.forEach((mb, i) => h += satir("m" + i, "Memba " + (i + 1), mb));
  h += satir("ara", "Ara havza", md.ara);
  h += `</table><div class="small" id="qbazToplam"></div>`;
  box.innerHTML = h;
  const guncelle = () => {
    S.multiQbazVals = {};
    box.querySelectorAll(".qbaz-cell").forEach(inp => {
      if (inp.value !== "") S.multiQbazVals[inp.id.slice(3)] = +inp.value;
    });
    let t = qbazDegeri("ara", md.ara, aM);
    md.membalar.forEach((mb, i) => t += qbazDegeri("m" + i, mb, aM));
    $("qbazToplam").textContent =
      `Mansapta toplanacak baz akım: ${t.toFixed(2)} m³/s (girilen mansap toplamı: ` +
      `${(+$("multiQbaz").value || 0).toFixed(2)} m³/s)`;
  };
  box.querySelectorAll(".qbaz-cell").forEach(inp => inp.addEventListener("input", guncelle));
  // atama ile bağla — addEventListener her render'da birikirdi
  $("multiQbaz").oninput = () => renderMultiQbaz();
  guncelle();
}

async function autoComputeSub(sub, qbaz, methods) {
  const w = await api("/api/thiessen", { havza_geojson: sub.havza_geojson, istasyonlar: S.istasyonlar,
                                        min_agirlik: Math.max(0, (+$("inpMinW").value || 0) / 100) });
  const act = w.sonuc.filter(t => t.agirlik > 0);
  const T = [2, 5, 10, 25, 50, 100];
  const P24 = {}; let OET = 0, oetOk = true;
  T.forEach((tt, j) => {
    P24[tt] = act.reduce((a, t) => { const rv = S.rainValues[t.name]; return a + (rv ? t.agirlik * rv[j] : 0); }, 0);
  });
  act.forEach(t => { const rv = S.rainValues[t.name]; if (!rv || rv[6] == null) oetOk = false; else OET += t.agirlik * rv[6]; });
  const cn = await api("/api/cn", { havza_geojson: sub.havza_geojson, zemin_grubu: $("multiSoil").value });
  const girdi = {
    ad: "alt", A_km2: sub.alan_km2, L_km: sub.L_km, Lc_km: sub.Lc_km,
    CN2: cn.CN2, CN3: cn.CN3, region: (sub.yzd_bolge && sub.yzd_bolge.bolge) || "B",
    elevations: sub.kotlar, Qbaz: qbaz,
    P24, P24_OET: oetOk ? OET : 0, dplv_ratios: dplvRatios(),
  };
  const snyderOn = methods.includes("snyder");
  // rasyonel C: alt havzanın KENDİ CORINE dökümünden türet; yoksa 0.45'e düş
  const c100 = (cn.rasyonel_C && cn.rasyonel_C.C_orta) || 0.45;
  const res = await api("/api/compute", {
    girdi, rasyonel: methods.includes("rasyonel"), c100,
    snyder: snyderOn, snyder_par: snyderOn ? { Ct: +$("multiCt").value || 1.55, Cp: +$("multiCp").value || 0.6 } : null,
  });
  return { girdi, res, cn, thiessen: act };
}

// ① Havzaları çöz (delineate + çiz + alt havza tablosu)
$("btnSolveDelin").onclick = async () => {
  try {
    if (!S.multi.mansap) throw new Error("Mansap noktası seçin");
    if (!S.multi.membalar.length) throw new Error("En az bir memba noktası ekleyin");
    setStatus("multiStatus", "Ara havza çıkarılıyor… DEM işleniyor; havzalar büyükse " +
      "birkaç dakika sürebilir.", "loading");
    const md = await api("/api/multi-delineate", {
      mansap: S.multi.mansap, membalar: S.multi.membalar, river_km2: +$("multiRivThr").value || 1,
      snap_m: +$("inpSnap").value || 500, dem_source: $("inpDem").value,
    });
    multiLayers.poly.clearLayers();
    const addPoly = (gj, c, meta) => multiLayers.poly.addData({ type: "Feature", properties: { c, ...(meta || {}) }, geometry: JSON.parse(JSON.stringify(gj)) });
    addPoly(md.ara.havza_geojson, "#2a9d8f", { kind: "ara" });
    md.membalar.forEach((mb, i) => addPoly(mb.havza_geojson, "#1e88e5", { kind: "memba", i }));
    map.fitBounds(multiLayers.poly.getBounds(), { padding: [30, 30] });
    S.multiMd = md;
    let h = `<h3 class="res">Alt Havzalar (çıkarıldı)</h3><table class="tbl">
      <tr><th>Havza</th><th>A (km²)</th><th>L (km)</th><th>Lc</th><th>Bölge</th><th>Tc (sa)</th></tr>`;
    md.membalar.forEach((mb, i) => h += `<tr><td>Memba ${i + 1}</td><td>${fmt(mb.alan_km2, 2)}</td><td>${fmt(mb.L_km, 2)}</td><td>${fmt(mb.Lc_km, 2)}</td><td>${(mb.yzd_bolge || {}).bolge || "—"}</td><td>${fmt(mb.Tc_saat, 2)}</td></tr>`);
    h += `<tr><td><b>Ara havza</b></td><td>${fmt(md.ara.alan_km2, 2)}</td><td>${fmt(md.ara.L_km, 2)}</td><td>${fmt(md.ara.Lc_km, 2)}</td><td>${(md.ara.yzd_bolge || {}).bolge || "—"}</td><td><b>${fmt(md.ara.Tc_saat, 2)}</b></td></tr>`;
    h += `<tr><td colspan="6"><b>Mansap:</b> A=${fmt(md.mansap.alan_km2, 2)} km² | öteleme = ara Tc = ${fmt(md.ara.Tc_saat, 2)} sa</td></tr></table>`;
    if (md.uyari && md.uyari.length) h += `<div class="small err">⚠ ${md.uyari.join("; ")}</div>`;
    $("multiResults").innerHTML = h;
    if (!$("multiLag").value && md.ara.Tc_saat) $("multiLag").value = md.ara.Tc_saat.toFixed(2);
    renderMultiQbaz();
    $("btnSolveCompute").disabled = false;
    setStatus("multiStatus", "Havzalar çıkarıldı. Şimdi ② Hesapla ve Ötele.", "ok");
  } catch (e) { setStatus("multiStatus", "Hata: " + e.message, "err"); $("btnSolveCompute").disabled = true; }
};

// ② Hesapla ve ötele (seçili yöntemlerle her alt havza + routing)
$("btnSolveCompute").onclick = async () => {
  try {
    if (!S.multiMd) throw new Error("Önce ① Havzaları Çöz");
    if (!S.istasyonlar || !S.istasyonlar.length) throw new Error("İstasyon yok — Tek Havza → Adım 4");
    if (!S.rainValues || !Object.keys(S.rainValues).length) throw new Error("Yağış yok — Tek Havza → Adım 5");
    const methods = selectedMethods();
    if (!methods.length) throw new Error("En az bir yöntem seçin");
    const md = S.multiMd, aMansap = md.mansap.alan_km2;
    setStatus("multiStatus", "Alt havzalar hesaplanıyor (CN, Thiessen, hidrograf)…", "loading");
    const araC = await autoComputeSub(md.ara, qbazDegeri("ara", md.ara, aMansap), methods);
    const membaC = [];
    for (let i = 0; i < md.membalar.length; i++) {
      const mb = md.membalar[i];
      membaC.push({ mb, ...(await autoComputeSub(mb, qbazDegeri("m" + i, mb, aMansap), methods)) });
    }
    setStatus("multiStatus", `Öteleme (ara Tc=${fmt(md.ara.Tc_saat, 2)} sa)…`, "loading");
    const rez0 = membaC.map((_, i) => (S.multiRes && S.multiRes[i]) || null);
    const rt = await api("/api/route", {
      ara_sonuc: araC.res, memba_sonuclari: membaC.map(x => x.res),
      lag_saat: (+$("multiLag").value || md.ara.Tc_saat), yontemler: methods,
      rezervuarlar: rez0.some(Boolean) ? rez0 : null,
    });
    S.multiSonuc = { md, araC, membaC, rt, methods };
    renderMultiResults();
    setStatus("multiStatus", "Tamamlandı", "ok");
  } catch (e) { setStatus("multiStatus", "Hata: " + e.message, "err"); }
};

const MRP = ["2", "5", "10", "25", "50", "100", "OET"];
const M_LABEL = { dsi: "DSİ Sentetik", snyder: "Snyder", mockus: "Mockus", rasyonel: "Rasyonel" };
function _envPeak(res, rp) {
  let mx = null;
  ["2", "4", "6", "8", "12", "18", "24"].forEach(d => { const v = res.kabulet[d] && res.kabulet[d][rp]; if (v != null) mx = mx == null ? v : Math.max(mx, v); });
  return mx;
}

/* ---- Alt havza fiziksel parametreleri ekranı ----
   Çok parçalı çözümde her alt havza için DEM/CORINE/Thiessen'den baştan
   hesaplanan tüm girdiler tek ekranda toplanır.                            */
/* Kot profili tanılaması: harmonik eğim S=(10/Σ√(l/Δh))² en düz segmente
   aşırı duyarlıdır. Her segmentin toplamdaki payını çıkarıp, eğimi tek bir
   segmentin belirlediği veya profilin gerçekdışı düz olduğu durumları
   işaretler.                                                               */
function profilTani(elevations, L_km) {
  const e = elevations || [];
  if (e.length !== 11 || !(L_km > 0)) return null;
  const l = (L_km * 1000) / 10;
  const dh = [], term = [];
  for (let i = 1; i <= 10; i++) {
    const d = e[i] - e[i - 1];
    dh.push(d);
    term.push(d > 0 ? Math.sqrt(l / d) : Infinity);
  }
  const toplam = term.reduce((a, b) => a + b, 0);
  const S_harm = Math.pow(10 / toplam, 2);
  const paylar = term.map(t => t / toplam);
  const enBuyukPay = Math.max(...paylar);
  const enBuyukIdx = paylar.indexOf(enBuyukPay);
  const dhTop = e[10] - e[0];
  const S_ort = dhTop / (L_km * 1000);
  const oran = S_harm > 0 ? S_ort / S_harm : Infinity;   // ortalama/harmonik
  const uyarilar = [];
  if (enBuyukPay > 0.35)
    uyarilar.push(`Eğimi tek segment belirliyor: <b>H${enBuyukIdx}–H${enBuyukIdx + 1}</b> ` +
      `harmonik eğim toplamının %${(enBuyukPay * 100).toFixed(0)}'ini oluşturuyor ` +
      `(Δh=${dh[enBuyukIdx].toFixed(1)} m). Bu segment T<sub>c</sub>'yi tek başına şişirir.`);
  if (oran > 5)
    uyarilar.push(`Harmonik eğim, ortalama eğimin <b>${oran.toFixed(1)} katı</b> altında ` +
      `(harmonik %${(S_harm * 100).toFixed(3)} — ortalama %${(S_ort * 100).toFixed(3)}); ` +
      `profilde düz bölümler baskın.`);
  if (S_harm < 0.0005)
    uyarilar.push(`Harmonik eğim çok düşük (%${(S_harm * 100).toFixed(4)}) — ` +
      `T<sub>c</sub> gerçekçi olmayacak kadar büyük çıkar.`);
  if (dhTop < L_km * 0.5)
    uyarilar.push(`Toplam kot farkı ${dhTop.toFixed(1)} m, ${L_km.toFixed(1)} km uzunluk için ` +
      `çok az (ortalama eğim %${(S_ort * 100).toFixed(3)}). DEM profili kusurlu olabilir.`);
  const kucukler = dh.filter(d => d <= 0.5).length;
  if (kucukler)
    uyarilar.push(`${kucukler} segmentte kot artışı ≤0,5 m — düz/yamalı profil.`);
  return { dh, paylar, S_harm, S_ort, oran, dhTop, enBuyukIdx, enBuyukPay, uyarilar };
}

let parChart = null;
function openParams() {
  if (!S.multiSonuc) { alert("Önce ② Hesapla ve Ötele"); return; }
  const { md, araC, membaC } = S.multiSonuc;
  const satirlar = membaC.map((x, i) => ({ ad: "Memba " + (i + 1), sub: x.mb, c: x }));
  satirlar.push({ ad: "Ara havza", sub: md.ara, c: araC });
  const S_of = (c) => (c.res && c.res.girdi_ozeti && c.res.girdi_ozeti.S_harmonik);

  let h = `<p class="hint">Her alt havza için <b>tüm fiziksel parametreler baştan hesaplanır</b>:
    A/L/Lc ve 11 noktalı kot profili DEM'den, CN CORINE'den, yağış Thiessen ağırlıklarıyla.
    T<sub>c</sub> Kirpich formülüyle harmonik eğimden bulunur; harmonik eğim
    <b>en düz segmente çok duyarlıdır</b>, bu yüzden kot profilini kontrol edin.</p>`;

  h += `<h3 class="res">Geometri ve Hesap Parametreleri</h3><table class="tbl">
    <tr><th>Havza</th><th>A (km²)</th><th>L (km)</th><th>Lc (km)</th><th>S harmonik</th>
    <th>Tc (sa)</th><th>CN II</th><th>CN III</th><th>YZD</th><th>Qbaz</th></tr>`;
  satirlar.forEach(r => {
    const g = r.c.girdi, sh = S_of(r.c);
    h += `<tr><td>${r.ad}</td><td>${fmt(g.A_km2, 2)}</td><td>${fmt(g.L_km, 2)}</td>
      <td>${fmt(g.Lc_km, 2)}</td><td>${sh == null ? "—" : sh.toFixed(5) + " (%" + (sh * 100).toFixed(3) + ")"}</td>
      <td>${fmt(r.sub.Tc_saat, 2)}</td><td>${fmt(g.CN2, 1)}</td><td>${fmt(g.CN3, 1)}</td>
      <td>${g.region || "—"}</td><td>${fmt(g.Qbaz, 2)}</td></tr>`;
  });
  h += `</table>`;

  h += `<h3 class="res">Kot Profili (outlet → memba, 11 nokta, m)</h3><table class="tbl">
    <tr><th>Havza</th>` + Array.from({ length: 11 }, (_, i) => `<th>H${i}</th>`).join("") +
    `<th>Δh top.</th></tr>`;
  satirlar.forEach(r => {
    const e = r.c.girdi.elevations || [];
    const dh = (e.length === 11) ? e[10] - e[0] : null;
    h += `<tr><td>${r.ad}</td>` + e.map(v => `<td>${fmt(v, 1)}</td>`).join("") +
      `<td>${dh == null ? "—" : fmt(dh, 1)}</td></tr>`;
  });
  h += `</table>`;

  // profil grafiği + segment payları + uyarılar
  h += `<h3 class="res">Kot Profili Grafiği</h3>
    <div style="height:280px;position:relative"><canvas id="parChartC"></canvas></div>
    <div class="small">Yatay eksen: çıkıştan yukarı doğru mesafe (km). Profil düz seyrediyorsa
    harmonik eğim düşer ve T<sub>c</sub> büyür.</div>`;

  const taniLar = satirlar.map(r => ({ ad: r.ad, t: profilTani(r.c.girdi.elevations, r.c.girdi.L_km) }));
  h += `<h3 class="res">Segment Eğim Payları (harmonik eğime katkı)</h3><table class="tbl">
    <tr><th>Havza</th>` + Array.from({ length: 10 }, (_, i) => `<th>H${i}–H${i + 1}</th>`).join("") + `</tr>`;
  taniLar.forEach(x => {
    if (!x.t) { h += `<tr><td>${x.ad}</td><td colspan="10">—</td></tr>`; return; }
    h += `<tr><td>${x.ad}</td>` + x.t.paylar.map((p, i) =>
      `<td${p > 0.35 ? ' class="max"' : ""}>%${(p * 100).toFixed(0)}</td>`).join("") + `</tr>`;
  });
  h += `</table><div class="small">Bir segmentin payı %35'i aşıyorsa (sarı) eğimi —dolayısıyla
    T<sub>c</sub>'yi— tek başına o segment belirliyordur.</div>`;

  const uyarili = taniLar.filter(x => x.t && x.t.uyarilar.length);
  if (uyarili.length) {
    h += `<h3 class="res">⚠ Profil Uyarıları</h3>`;
    uyarili.forEach(x => {
      h += `<div class="small err" style="margin-bottom:6px"><b>${x.ad}</b><ul style="margin-left:18px">` +
        x.t.uyarilar.map(u => `<li>${u}</li>`).join("") + `</ul></div>`;
    });
    h += `<div class="small">Çözüm: kot profili gerçeği yansıtmıyorsa <i>Öteleme süresi</i> alanına
      elle makul bir değer girin, ya da havzayı daha ince DEM çözünürlüğüyle (Copernicus /
      daha küçük pencere) yeniden çözün.</div>`;
  } else {
    h += `<div class="small" style="color:#3b7a4e">✓ Kot profillerinde anormallik bulunmadı.</div>`;
  }

  h += `<h3 class="res">Thiessen İstasyonları ve Ağırlıkları</h3><table class="tbl">
    <tr><th>Havza</th><th>İstasyonlar (ağırlık)</th></tr>`;
  satirlar.forEach(r => {
    const t = r.c.thiessen || [];
    h += `<tr><td>${r.ad}</td><td style="text-align:left">` +
      (t.length ? t.map(x => `${x.name} %${(x.agirlik * 100).toFixed(1)}`).join(" · ") : "—") +
      `</td></tr>`;
  });
  h += `</table>`;

  const RPL = [2, 5, 10, 25, 50, 100];
  h += `<h3 class="res">Ağırlıklı 24 Saatlik Yağış (mm)</h3><table class="tbl">
    <tr><th>Havza</th>` + RPL.map(t => `<th>P${t}</th>`).join("") + `<th>OEY</th></tr>`;
  satirlar.forEach(r => {
    const g = r.c.girdi;
    h += `<tr><td>${r.ad}</td>` + RPL.map(t => `<td>${fmt((g.P24 || {})[t], 1)}</td>`).join("") +
      `<td>${fmt(g.P24_OET, 1)}</td></tr>`;
  });
  h += `</table>`;

  h += `<h3 class="res">Öteleme</h3><div class="small">
    Kullanılan öteleme süresi: <b>${fmt(S.multiSonuc.rt.lag_saat, 2)} sa</b>
    (ara havza Kirpich T<sub>c</sub>: ${fmt(md.ara.Tc_saat, 2)} sa).
    Değiştirmek için sol paneldeki <i>Öteleme süresi</i> alanını doldurup
    <i>② Hesapla ve Ötele</i>'yi tekrar çalıştırın.</div>`;

  $("parBody").innerHTML = h;
  $("parWrap").classList.remove("hidden");

  // profil grafiği (x: çıkıştan mesafe km, y: kot m) — her alt havza bir seri
  const RENK = ["#1565c0", "#e65100", "#2e7d32", "#7b1fa2", "#c73e3a", "#00838f"];
  const ds = [];
  satirlar.forEach((r, k) => {
    const e = r.c.girdi.elevations || [], L = r.c.girdi.L_km;
    if (e.length !== 11 || !(L > 0)) return;
    const t = profilTani(e, L);
    const noktalar = e.map((v, i) => ({ x: +(L * i / 10).toFixed(3), y: v }));
    ds.push({
      label: r.ad + (t && t.uyarilar.length ? " ⚠" : ""),
      data: noktalar, borderColor: RENK[k % RENK.length],
      backgroundColor: RENK[k % RENK.length],
      borderWidth: 2, tension: 0.1,
      // eğimi belirleyen (payı en yüksek) segmentin uçlarını büyük göster
      pointRadius: noktalar.map((_, i) =>
        (t && t.enBuyukPay > 0.35 && (i === t.enBuyukIdx || i === t.enBuyukIdx + 1)) ? 6 : 3),
      pointBackgroundColor: noktalar.map((_, i) =>
        (t && t.enBuyukPay > 0.35 && (i === t.enBuyukIdx || i === t.enBuyukIdx + 1))
          ? "#c73e3a" : RENK[k % RENK.length]),
    });
  });
  if (parChart) parChart.destroy();
  if (ds.length) {
    parChart = new Chart($("parChartC"), {
      type: "line", data: { datasets: ds },
      options: {
        animation: false, maintainAspectRatio: false, parsing: false,
        plugins: {
          legend: { position: "bottom" },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y.toFixed(1)} m @ ${c.parsed.x} km` } },
        },
        scales: {
          x: { type: "linear", title: { display: true, text: "Çıkıştan mesafe (km)" } },
          y: { title: { display: true, text: "Kot (m)" } },
        },
      },
    });
  }
}
$("btnClosePar").onclick = () => $("parWrap").classList.add("hidden");

function renderMultiResults() {
  const { md, araC, membaC, rt, methods } = S.multiSonuc;
  // Hazne atanmışsa: varsayılan görünüm rezervuarlı; rezervuarsız çözüm de saklanır
  const rezVar = !!rt.rezervuarli;
  if (S.multiShowRes == null) S.multiShowRes = true;
  const Y = (rezVar && !S.multiShowRes) ? rt.yontemler_rezervuarsiz : rt.yontemler;
  // 1) alt havza tablosu
  let h = `<h3 class="res">Alt Havzalar</h3><table class="tbl">
    <tr><th>Havza</th><th>A (km²)</th><th>L (km)</th><th>Lc</th><th>CN</th><th>Bölge</th><th>Tc (sa)</th><th>DSİ Q100</th></tr>`;
  const rowFor = (ad, sub, comp, tc, bold) => {
    const t = `<td>${fmt(sub.alan_km2, 2)}</td><td>${fmt(sub.L_km, 2)}</td><td>${fmt(sub.Lc_km, 2)}</td>
      <td>${fmt(comp.cn.CN2, 0)}</td><td>${(sub.yzd_bolge && sub.yzd_bolge.bolge) || "—"}</td>
      <td>${fmt(tc, 2)}</td><td>${fmt(_envPeak(comp.res, "100"), 1)}</td>`;
    return `<tr><td>${bold ? "<b>" + ad + "</b>" : ad}</td>${t}</tr>`;
  };
  membaC.forEach((x, i) => h += rowFor("Memba " + (i + 1), x.mb, x, x.mb.Tc_saat));
  h += rowFor("Ara havza", md.ara, araC, md.ara.Tc_saat, true);
  h += `</table>`;
  if (md.uyari && md.uyari.length) h += `<div class="small err">⚠ ${md.uyari.join("; ")}</div>`;
  // kot profili anormallikleri (Tc/öteleme süresini şişirebilir)
  const _tani = membaC.map((x, i) => ({ ad: "Memba " + (i + 1), t: profilTani(x.girdi.elevations, x.girdi.L_km) }))
    .concat([{ ad: "Ara havza", t: profilTani(araC.girdi.elevations, araC.girdi.L_km) }])
    .filter(x => x.t && x.t.uyarilar.length);
  if (_tani.length) h += `<div class="small err">⚠ Kot profili şüpheli: ${_tani.map(x => x.ad).join(", ")} — T<sub>c</sub> ve öteleme süresi olduğundan büyük çıkabilir. Ayrıntı için <b>📐 Fiziksel Parametreler</b>.</div>`;

  // 2) mansap pikleri — yöntem × tekerrür
  if (rezVar) {
    const rl = rt.yontemler, rs = rt.yontemler_rezervuarsiz;
    h += `<div class="mstep"><b>🏞 Memba haznesi etkin</b> — mansap hidrografı sönümlenmiş memba çıkışıyla hesaplandı.</div>
      <div class="rain-tools"><label class="inline"><input type="checkbox" id="multiResToggle" ${S.multiShowRes ? "checked" : ""} style="width:auto;margin-right:4px">Rezervuarlı sonucu göster</label>
      <button id="btnClearMultiRes" class="small-btn">Hazne atamalarını kaldır</button></div>`;
    h += `<table class="tbl"><tr><th>Yöntem</th><th>Q100 rezervuarsız</th><th>Q100 rezervuarlı</th><th>Sönümleme</th></tr>`;
    methods.forEach(m => {
      const a = rs[m] && rs[m].pikler["100"], b = rl[m] && rl[m].pikler["100"];
      if (a == null || b == null) return;
      h += `<tr><td>${M_LABEL[m]}</td><td>${fmt(a,1)}</td><td><b>${fmt(b,1)}</b></td><td>%${fmt((1-b/a)*100,1)}</td></tr>`;
    });
    h += `</table>`;
  }
  h += `<h3 class="res">Mansap Taşkın Pikleri (öteleme=${fmt(md.ara.Tc_saat, 2)} sa, m³/s)</h3>
    <table class="tbl"><tr><th>Yöntem</th>` + MRP.map(rp => `<th>Q${rp}</th>`).join("") + `</tr>`;
  methods.forEach(m => {
    const y = Y[m]; if (!y) return;
    const syn = (m === "mockus" || m === "rasyonel") ? " *" : "";
    h += `<tr><td>${M_LABEL[m]}${syn}</td>` +
      MRP.map(rp => `<td>${y.pikler[rp] == null ? "—" : fmt(y.pikler[rp], 1)}</td>`).join("") + `</tr>`;
  });
  h += `</table><div class="small">* Mockus ve Rasyonel pik yöntemidir; öteleme üçgen hidrografla yapılır.
    DSİ ve Snyder gerçek süperpozisyon hidrograflarıdır.</div>`;

  // 3) Q100 bileşen dökümü (seçili ilk gerçek yöntem)
  const dm = methods.includes("dsi") ? "dsi" : methods[0];
  const comp = Y[dm] && Y[dm].bilesenler["100"];
  if (comp) h += `<div class="small">${M_LABEL[dm]} Q100 bileşen: ara ${fmt(comp.ara_pik, 1)} +
    memba ${comp.memba_pikleri.map(v => fmt(v, 1)).join(", ")} (ötelenmiş) → ${fmt(Y[dm].pikler["100"], 1)} m³/s</div>`;

  h += `<div class="export-row" style="align-items:center">
    <button id="btnMcmp" class="primary">⚖ Sonuç ve Karşılaştırma (tam ekran)</button>
    <button id="btnResMulti" class="primary">🏞 Rezervuar Ötelemesi</button>
    <button id="btnPar" class="primary">📐 Fiziksel Parametreler</button>
    <label class="inline" style="flex-direction:row;gap:4px">Grafik yöntem
      <select id="multiChartM">${methods.map(m => `<option value="${m}">${M_LABEL[m]}</option>`).join("")}</select></label>
    <button id="btnMultiChart" class="primary">📈 Mansap hidrografları</button>
    <button id="btnMultiCsv">⬇ CSV</button></div>`;
  $("multiResults").innerHTML = h;
  if (rezVar) {
    const tg = $("multiResToggle");
    if (tg) tg.onchange = () => { S.multiShowRes = tg.checked; renderMultiResults(); };
    const cl = $("btnClearMultiRes");
    if (cl) cl.onclick = async () => { S.multiRes = {}; await reRouteMulti(); };
  }
  $("btnMcmp").onclick = openMcmp;
  $("btnResMulti").onclick = openReservoir;
  $("btnPar").onclick = openParams;
  $("btnMultiChart").onclick = () => showMultiChart($("multiChartM").value);
  $("btnMultiCsv").onclick = exportMultiCsv;
}

/* ---- Çok parçalı: bileşen + yöntem karşılaştırma tam ekran ---- */
let mcmpChart = null;
const mcmpState = { tab: "bilesen", rp: "100", method: "dsi" };
const M_COLORS = { dsi: "#2a9d8f", snyder: "#c73e3a", mockus: "#e07b3a", rasyonel: "#7b1fa2" };

function openMcmp() {
  const { methods } = S.multiSonuc;
  mcmpState.method = methods.includes("dsi") ? "dsi" : methods[0];
  $("mcmpMethod").innerHTML = methods.map(m => `<option value="${m}">${M_LABEL[m]}</option>`).join("");
  $("mcmpMethod").value = mcmpState.method;
  $("mcmpMethod").onchange = () => { mcmpState.method = $("mcmpMethod").value; renderMcmp(); };
  $("mcmpRP").onchange = () => { mcmpState.rp = $("mcmpRP").value; renderMcmp(); };
  document.querySelectorAll(".mcmp-tab").forEach(b => b.onclick = () => {
    document.querySelectorAll(".mcmp-tab").forEach(x => x.classList.remove("active"));
    b.classList.add("active"); mcmpState.tab = b.dataset.tab; renderMcmp();
  });
  $("mcmpWrap").classList.remove("hidden");
  renderMcmp();
}
$("btnCloseMcmp").onclick = () => $("mcmpWrap").classList.add("hidden");

function mcmpRpOptions() {
  // bileşen/hidro sekmesinde yöntemde mevcut tekerrürler
  const y = S.multiSonuc.rt.yontemler[mcmpState.method];
  const rps = MRP.filter(rp => (S.multiSonuc.rt.yontemler[mcmpState.method]?.hidrograflar || {})[rp]);
  return (mcmpState.tab === "pik") ? MRP : (rps.length ? rps : MRP);
}
function renderMcmp() {
  const opts = mcmpRpOptions();
  if (!opts.includes(mcmpState.rp)) mcmpState.rp = opts.includes("100") ? "100" : opts[0];
  $("mcmpRP").innerHTML = opts.map(rp => `<option value="${rp}" ${rp === mcmpState.rp ? "selected" : ""}>Q${rp}</option>`).join("");
  document.querySelector(".mcmp-method").style.display = mcmpState.tab === "bilesen" ? "" : "none";
  if (mcmpState.tab === "bilesen") renderMcmpBilesen();
  else if (mcmpState.tab === "pik") renderMcmpPik();
  else renderMcmpHidro();
}

function _mkChart(datasets, title, parsing) {
  if (mcmpChart) mcmpChart.destroy();
  mcmpChart = new Chart($("mcmpChart"), {
    type: parsing === "bar" ? "bar" : "line",
    data: parsing === "bar" ? datasets : { datasets },
    options: {
      animation: false, maintainAspectRatio: false, parsing: parsing === "bar" ? undefined : false,
      plugins: { legend: { position: "bottom", display: parsing !== "bar" }, title: { display: true, text: title } },
      scales: parsing === "bar"
        ? { y: { title: { display: true, text: "Q (m³/s)" }, beginAtZero: true } }
        : { x: { type: "linear", title: { display: true, text: "T (saat)" } }, y: { title: { display: true, text: "Q (m³/s)" }, beginAtZero: true } },
    },
  });
}

// Bileşenler: ara + ötelenmiş membalar + mansap (toplam), seçili yöntem + tekerrür
function renderMcmpBilesen() {
  const { rt, md } = S.multiSonuc, m = mcmpState.method, rp = mcmpState.rp;
  const y = rt.yontemler[m], b = y.bilesenler[rp], dt = y.dt, shift = y.shift_adim;
  const ds = [];
  ds.push({ label: "Ara havza", data: b.ara_h.map((v, i) => ({ x: i * dt, y: v })), borderColor: "#2a9d8f", borderWidth: 1.6, pointRadius: 0, tension: .25 });
  b.memba_hs.forEach((uh, k) => ds.push({
    label: `Memba ${k + 1} (ötelenmiş ${fmt(md.ara.Tc_saat, 1)} sa)`,
    data: uh.map((v, i) => ({ x: (i + shift) * dt, y: v })),
    borderColor: "#1e88e5", borderWidth: 1.4, borderDash: [5, 3], pointRadius: 0, tension: .25,
  }));
  ds.push({ label: "MANSAP (toplam)", data: y.hidrograflar[rp].map((v, i) => ({ x: i * dt, y: v })), borderColor: "#c73e3a", borderWidth: 2.2, pointRadius: 0, tension: .25 });
  _mkChart(ds, `${M_LABEL[m]} — Q${rp}: bileşenler ve süperpozisyon`);

  // koordinat tablosu (additif döküm): T | Ara | Memba_k(ötel.) | Mansap
  const comb = y.hidrograflar[rp];
  let h = `<h3 class="res">Koordinatlar (Q${rp}, ${M_LABEL[m]})</h3>
    <button id="btnMcmpCsv" class="small-btn">⬇ CSV</button>
    <table class="tbl"><tr><th>T (sa)</th><th>Ara</th>` +
    b.memba_hs.map((_, k) => `<th>Memba ${k + 1}↦</th>`).join("") + `<th>Mansap</th></tr>`;
  const rows = [];
  for (let i = 0; i < comb.length; i++) {
    const ara = b.ara_h[i] ?? "";
    const mem = b.memba_hs.map(uh => (i - shift >= 0 && i - shift < uh.length) ? uh[i - shift] : 0);
    rows.push([(i * dt).toFixed(1), ara === "" ? "" : (+ara).toFixed(2), ...mem.map(v => v.toFixed(2)), comb[i].toFixed(2)]);
    h += `<tr><td>${fmt(i * dt, 1)}</td><td>${ara === "" ? "—" : fmt(ara, 2)}</td>` +
      mem.map(v => `<td>${fmt(v, 2)}</td>`).join("") + `<td><b>${fmt(comb[i], 2)}</b></td></tr>`;
  }
  h += `</table>`;
  $("mcmpTable").innerHTML = h;
  $("btnMcmpCsv").onclick = () => {
    const head = ["T(sa)", "Ara", ...b.memba_hs.map((_, k) => "Memba" + (k + 1) + "_otel"), "Mansap"];
    download(`bilesen_Q${rp}_${m}.csv`, [head, ...rows].map(r => r.join(";")).join("\n"));
  };
}

// Yöntem pik: seçili tekerrürde yöntemler bar + yöntem×tekerrür tablo
function renderMcmpPik() {
  const { rt, methods } = S.multiSonuc, rp = mcmpState.rp;
  const labels = methods.map(m => M_LABEL[m]);
  const data = methods.map(m => (rt.yontemler[m].pikler || {})[rp] ?? null);
  _mkChart({ labels, datasets: [{ label: `Q${rp} mansap piki`, data, backgroundColor: methods.map(m => M_COLORS[m]) }] },
    `Mansap Q${rp} pik debileri (öteleme sonrası)`, "bar");
  let h = `<h3 class="res">Mansap Pikleri — yöntem × tekerrür (m³/s)</h3>
    <table class="tbl"><tr><th>Yöntem</th>` + MRP.map(t => `<th>Q${t}</th>`).join("") + `</tr>`;
  methods.forEach(m => {
    const p = rt.yontemler[m].pikler || {};
    h += `<tr><td style="border-left:4px solid ${M_COLORS[m]}">${M_LABEL[m]}</td>` +
      MRP.map(t => `<td class="${t === rp ? "max" : ""}">${p[t] == null ? "—" : fmt(p[t], 1)}</td>`).join("") + `</tr>`;
  });
  h += `</table><div class="small">Mockus/Rasyonel üçgen hidrografla ötelenmiştir. Rasyonel'de OET yoktur.</div>`;
  $("mcmpTable").innerHTML = h;
}

// Yöntem hidrograf: seçili tekerrürde yöntemlerin mansap hidrografları üst üste + koordinat
function renderMcmpHidro() {
  const { rt, methods } = S.multiSonuc, rp = mcmpState.rp;
  const ds = [];
  const series = [];
  methods.forEach(m => {
    const y = rt.yontemler[m]; const arr = (y.hidrograflar || {})[rp]; if (!arr) return;
    const dt = y.dt, pts = arr.map((v, i) => ({ x: i * dt, y: v }));
    ds.push({ label: M_LABEL[m], data: pts, borderColor: M_COLORS[m], borderWidth: 1.8, pointRadius: 0, tension: .25 });
    series.push({ m, pts });
  });
  _mkChart(ds, `Mansap Q${rp} taşkın hidrografları — yöntem karşılaştırması`);
  // koordinat tablosu: ortak zaman ekseni (1 sa) interpolasyon
  const maxT = Math.max(...series.map(s => s.pts[s.pts.length - 1].x), 0);
  const step = maxT > 60 ? 2 : 1;
  let h = `<h3 class="res">Koordinatlar (Q${rp})</h3><button id="btnMcmpCsv2" class="small-btn">⬇ CSV</button>
    <table class="tbl"><tr><th>T (sa)</th>` + series.map(s => `<th>${M_LABEL[s.m]}</th>`).join("") + `</tr>`;
  const rows = [];
  for (let t = 0; t <= maxT + 1e-9; t += step) {
    const vals = series.map(s => cmpInterp(s.pts, t));
    rows.push([t.toFixed(1), ...vals.map(v => v == null ? "" : v.toFixed(2))]);
    h += `<tr><td>${fmt(t, 1)}</td>` + vals.map(v => `<td>${v == null ? "—" : fmt(v, 2)}</td>`).join("") + `</tr>`;
  }
  h += `</table>`;
  $("mcmpTable").innerHTML = h;
  $("btnMcmpCsv2").onclick = () => {
    const head = ["T(sa)", ...series.map(s => M_LABEL[s.m])];
    download(`mansap_hidrograf_Q${rp}.csv`, [head, ...rows].map(r => r.join(";")).join("\n"));
  };
}

function exportMultiCsv() {
  const { rt, methods } = S.multiSonuc;
  const rows = [["Yontem", ...MRP.map(rp => "Q" + rp)]];
  methods.forEach(m => {
    const y = rt.yontemler[m]; if (!y) return;
    rows.push([M_LABEL[m], ...MRP.map(rp => y.pikler[rp] == null ? "" : y.pikler[rp].toFixed(2))]);
  });
  download("mansap_pikleri_yontemler.csv", rows.map(r => r.join(";")).join("\n"));
}

function showMultiChart(method) {
  const y = S.multiSonuc.rt.yontemler[method];
  if (!y) return;
  $("chartwrap").classList.remove("hidden");
  $("chartDur").innerHTML = `<option>${M_LABEL[method]} — mansap hidrografları (öteleme sonrası)</option>`;
  $("chartDur").onchange = null;
  const colors = { "2": "#9db5b2", "5": "#64b5aa", "10": "#2a9d8f", "25": "#d9a441", "50": "#e07b3a", "100": "#c73e3a", "OET": "#5e2d48" };
  const dt = y.dt || 0.5;
  const rps = MRP.filter(rp => y.hidrograflar[rp]);
  const ds = rps.map(rp => ({ label: "Q" + rp, data: y.hidrograflar[rp], borderColor: colors[rp], borderWidth: 1.6, pointRadius: 0, tension: .25 }));
  const n = Math.max(...rps.map(rp => y.hidrograflar[rp].length));
  const labels = Array.from({ length: n }, (_, i) => (i * dt).toFixed(1));
  if (chart) chart.destroy();
  chart = new Chart($("chart"), {
    type: "line", data: { labels, datasets: ds },
    options: {
      animation: false, maintainAspectRatio: false,
      scales: { x: { title: { display: true, text: "T (saat)" } }, y: { title: { display: true, text: "Q (m³/s)" }, beginAtZero: true } },
      plugins: { legend: { position: "bottom", labels: { boxWidth: 18 } } },
    },
  });
}

/* ================= YÖNTEM KARŞILAŞTIRMA ================= */
const CMP_COLORS = { dsi: "#2a9d8f", mockus: "#e07b3a", rasyonel: "#7b1fa2", snyder: "#c73e3a" };
const CMP_LABELS = { dsi: "DSİ Sentetik", mockus: "Mockus", rasyonel: "Rasyonel", snyder: "Snyder" };
const CMP_RPS = ["2", "5", "10", "25", "50", "100", "500", "1000", "10000", "OET"];
const CMP_HYDRO_RPS = ["2", "5", "10", "25", "50", "100", "OET"]; // gerçek/üçgen hidrograf olanlar
let cmpChart = null, cmpState = { tab: "pik", rp: "100", methods: {}, K: "K1" };

function cmpAvailable() {
  const r = S.sonuc, m = {};
  if (r.kabulet) m.dsi = true;
  if (r.mockus) m.mockus = true;
  if (r.rasyonel) m.rasyonel = true;
  if (r.snyder) m.snyder = true;
  return m;
}

// bir yöntem + tekerrür için pik debi (m³/s); yoksa null
function cmpPeak(method, rp) {
  const r = S.sonuc;
  if (method === "dsi") {           // KABULET zarfı: süreler içinde en büyük
    let mx = null;
    DURS.forEach(d => { const v = r.kabulet[d]?.[rp]; if (v != null) mx = mx == null ? v : Math.max(mx, v); });
    return mx;
  }
  if (method === "snyder") return r.snyder?.pikler?.[rp] ?? null;
  if (method === "mockus") {
    const s = r.mockus.sonuclar[cmpState.K];
    if (rp === "OET") return s.Q_OET;
    if (["500", "1000", "10000"].includes(rp)) return s.Q_ext?.[rp];
    return s.Q?.[rp];
  }
  if (method === "rasyonel") {
    if (rp === "OET") return null;
    if (["500", "1000", "10000"].includes(rp)) return r.rasyonel.Q_ext?.[rp];
    return r.rasyonel.Q?.[rp];
  }
  return null;
}

// bir yöntem + tekerrür için hidrograf {points:[{x,y}], synthetic:bool, note}
function cmpHydro(method, rp) {
  const r = S.sonuc, qbaz = r.girdi_ozeti?.Qbaz || 0;
  if (method === "dsi") {
    if (!CMP_HYDRO_RPS.includes(rp)) return null;
    let best = null, bestPk = -1;
    DURS.forEach(d => { const pk = r.kabulet[d]?.[rp]; if (pk != null && pk > bestPk) { bestPk = pk; best = d; } });
    const arr = r.dsi.hidrograflar[best]?.[rp]; if (!arr) return null;
    return { points: arr.map((y, i) => ({ x: i * 0.5, y })), synthetic: false, note: `hakim süre ${best} sa` };
  }
  if (method === "snyder") {
    const arr = r.snyder?.hidrograflar?.[rp]; if (!arr) return null;
    return { points: arr.map((y, i) => ({ x: i, y })), synthetic: false, note: "saatlik" };
  }
  if (method === "mockus") {
    const pk = cmpPeak("mockus", rp); if (pk == null) return null;
    const Tp = r.mockus.Tp, base = qbaz, top = rp === "OET" ? pk + qbaz : pk; // OET'te baz akım yok
    const tb = 2.67 * Tp;
    return { points: [{ x: 0, y: base }, { x: Tp, y: top }, { x: tb, y: base }], synthetic: true, note: "üçgen (Tp, SCS taban)" };
  }
  if (method === "rasyonel") {
    const pk = cmpPeak("rasyonel", rp); if (pk == null) return null;
    const Tc = r.rasyonel.Tc_saat, Tb = Math.max(r.rasyonel.Tb_saat, 2 * Tc);
    return { points: [{ x: 0, y: qbaz }, { x: Tc, y: qbaz + pk }, { x: Tb, y: qbaz }], synthetic: true, note: "üçgen (Tc–Tb)" };
  }
  return null;
}

function openCompare() {
  const avail = cmpAvailable();
  cmpState.methods = {};
  Object.keys(avail).forEach(k => cmpState.methods[k] = true);
  // tekerrür seçici
  const rpSel = $("cmpRP");
  rpSel.innerHTML = CMP_RPS.map(t => `<option value="${t}" ${t === cmpState.rp ? "selected" : ""}>Q${t}</option>`).join("");
  rpSel.onchange = () => { cmpState.rp = rpSel.value; renderCompare(); };
  $("cmpK").onchange = () => { cmpState.K = $("cmpK").value; renderCompare(); };
  $("cmpK").parentElement.style.display = avail.mockus ? "" : "none";
  // yöntem onay kutuları
  $("cmpMethods").innerHTML = Object.keys(avail).map(k =>
    `<label><input type="checkbox" data-m="${k}" checked>
      <span class="swatch" style="background:${CMP_COLORS[k]}"></span>${CMP_LABELS[k]}</label>`).join("");
  $("cmpMethods").querySelectorAll("input").forEach(inp =>
    inp.onchange = () => { cmpState.methods[inp.dataset.m] = inp.checked; renderCompare(); });
  // sekmeler
  document.querySelectorAll(".cmp-tab").forEach(b => b.onclick = () => {
    document.querySelectorAll(".cmp-tab").forEach(x => x.classList.remove("active"));
    b.classList.add("active"); cmpState.tab = b.dataset.tab; renderCompare();
  });
  $("cmpWrap").classList.remove("hidden");
  renderCompare();
}
$("btnCloseCmp").onclick = () => $("cmpWrap").classList.add("hidden");

function renderCompare() {
  const active = Object.keys(cmpState.methods).filter(k => cmpState.methods[k]);
  document.querySelector(".cmp-mockusk").style.display =
    (active.includes("mockus")) ? "" : "none";
  // hidrograf sekmesinde yalnız gerçek hidrografı olan tekerrürler seçilebilir
  const opts = cmpState.tab === "hidro" ? CMP_HYDRO_RPS : CMP_RPS;
  if (!opts.includes(cmpState.rp)) cmpState.rp = "100";
  const rpSel = $("cmpRP");
  rpSel.innerHTML = opts.map(t => `<option value="${t}" ${t === cmpState.rp ? "selected" : ""}>Q${t}</option>`).join("");
  if (cmpState.tab === "pik") renderCmpPeaks(active);
  else renderCmpHydro(active);
}

function renderCmpPeaks(active) {
  // grafik: seçili tekerrür için yöntem bazında bar
  const rp = cmpState.rp;
  const labels = active.map(m => CMP_LABELS[m]);
  const data = active.map(m => cmpPeak(m, rp));
  if (cmpChart) cmpChart.destroy();
  cmpChart = new Chart($("cmpChart"), {
    type: "bar",
    data: { labels, datasets: [{ label: `Q${rp} piki (m³/s)`, data, backgroundColor: active.map(m => CMP_COLORS[m]) }] },
    options: {
      animation: false, maintainAspectRatio: false,
      plugins: { legend: { display: false }, title: { display: true, text: `Q${rp} pik debileri` } },
      scales: { y: { title: { display: true, text: "Q (m³/s)" }, beginAtZero: true } },
    },
  });
  // tablo: yöntem × tüm tekerrürler
  let h = `<table class="tbl"><tr><th>Yöntem</th>` + CMP_RPS.map(t => `<th>Q${t}</th>`).join("") + `</tr>`;
  active.forEach(m => {
    h += `<tr><td style="border-left:4px solid ${CMP_COLORS[m]}">${CMP_LABELS[m]}${m === "mockus" ? " (" + cmpState.K + ")" : ""}</td>` +
      CMP_RPS.map(t => { const v = cmpPeak(m, t); return `<td class="${t === rp ? "max" : ""}">${v == null ? "—" : fmt(v, 1)}</td>`; }).join("") + `</tr>`;
  });
  // yöntemler arası oran (min-maks) satırı
  h += `<tr><td><b>maks/min</b></td>` + CMP_RPS.map(t => {
    const vs = active.map(m => cmpPeak(m, t)).filter(v => v != null && v > 0);
    if (vs.length < 2) return `<td>—</td>`;
    return `<td>${fmt(Math.max(...vs) / Math.min(...vs), 2)}×</td>`;
  }).join("") + `</tr></table>
    <div class="small">Değerler m³/s. DSİ = süreler içindeki en büyük pik (KABULET zarfı).
    Mockus K katsayısı üstten seçilir. Rasyonel'de OET yoktur.</div>`;
  $("cmpTable").innerHTML = h;
}

function renderCmpHydro(active) {
  const rp = cmpState.rp;
  const ds = [];
  active.forEach(m => {
    const hy = cmpHydro(m, rp);
    if (!hy) return;
    ds.push({
      label: CMP_LABELS[m] + (hy.synthetic ? " ⚠" : ""), data: hy.points,
      borderColor: CMP_COLORS[m], backgroundColor: CMP_COLORS[m],
      borderWidth: 1.8, borderDash: hy.synthetic ? [6, 4] : [], pointRadius: 0, tension: hy.synthetic ? 0 : .25,
    });
  });
  if (cmpChart) cmpChart.destroy();
  cmpChart = new Chart($("cmpChart"), {
    type: "line",
    data: { datasets: ds },
    options: {
      animation: false, maintainAspectRatio: false, parsing: false,
      plugins: { legend: { position: "bottom" }, title: { display: true, text: `Q${rp} taşkın hidrografları` } },
      scales: {
        x: { type: "linear", title: { display: true, text: "T (saat)" } },
        y: { title: { display: true, text: "Q (m³/s)" }, beginAtZero: true },
      },
    },
  });
  // tablo: pik ve pike varış özeti
  let h = `<table class="tbl"><tr><th>Yöntem</th><th>Pik Q</th><th>Pike varış</th><th>Tip</th></tr>`;
  active.forEach(m => {
    const hy = cmpHydro(m, rp);
    if (!hy) { h += `<tr><td>${CMP_LABELS[m]}</td><td colspan="3">—</td></tr>`; return; }
    let pk = -1, tpk = 0;
    hy.points.forEach(p => { if (p.y > pk) { pk = p.y; tpk = p.x; } });
    h += `<tr><td style="border-left:4px solid ${CMP_COLORS[m]}">${CMP_LABELS[m]}</td>` +
      `<td>${fmt(pk, 1)}</td><td>${fmt(tpk, 1)} sa</td><td>${hy.synthetic ? "üçgen*" : "gerçek"}</td></tr>`;
  });
  h += `</table><div class="small">⚠/* = Mockus ve Rasyonel pik yöntemleridir; hidrografları
    üçgen yaklaşımla (kesikli çizgi) gösterilir. DSİ ve Snyder gerçek süperpozisyon
    hidrograflarıdır. Q500/1000/10000 yalnız pik olduğundan burada yoktur.</div>`;

  // ---- hidrograf koordinatları (ortak zaman eksenine interpole) ----
  const series = active.map(m => ({ m, hy: cmpHydro(m, rp) })).filter(x => x.hy);
  if (series.length) {
    const maxT = Math.max(...series.map(s => s.hy.points[s.hy.points.length - 1].x));
    const dt = maxT > 60 ? 2 : 1;
    S.cmpCoords = { rp, dt, headers: ["T (saat)", ...series.map(s => `${CMP_LABELS[s.m]} Q${rp} (m3/s)`)], rows: [] };
    let ch = `<h3 class="res" style="margin-top:10px">Hidrograf Koordinatları (Q${rp})</h3>
      <div class="export-row"><button id="btnCmpCsv">⬇ Koordinat CSV</button>
      <span class="small">interpolasyon adımı ${dt} sa</span></div>
      <table class="tbl"><tr><th>T (saat)</th>` +
      series.map(s => `<th style="border-bottom:3px solid ${CMP_COLORS[s.m]}">${CMP_LABELS[s.m]}</th>`).join("") + `</tr>`;
    for (let t = 0; t <= maxT + 1e-9; t += dt) {
      const vals = series.map(s => cmpInterp(s.hy.points, t));
      S.cmpCoords.rows.push([t.toFixed(1), ...vals.map(v => v == null ? "" : v.toFixed(2))]);
      ch += `<tr><td>${fmt(t, 1)}</td>` +
        vals.map(v => `<td>${v == null ? "—" : fmt(v, 2)}</td>`).join("") + `</tr>`;
    }
    ch += `</table><div class="small">Değerler m³/s. Farklı zaman adımlı yöntemler ortak
      eksene doğrusal interpolasyonla hizalanmıştır.</div>`;
    h += ch;
  }
  $("cmpTable").innerHTML = h;
  const csvBtn = $("btnCmpCsv");
  if (csvBtn) csvBtn.onclick = exportCmpCoords;
}

// bir hidrografı (noktalar) t anında doğrusal interpole eder; aralık dışında null
function cmpInterp(points, t) {
  if (!points.length) return null;
  if (t < points[0].x - 1e-9 || t > points[points.length - 1].x + 1e-9) return null;
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i].x + 1e-9) {
      const a = points[i - 1], b = points[i];
      if (b.x === a.x) return b.y;
      return a.y + (b.y - a.y) * (t - a.x) / (b.x - a.x);
    }
  }
  return points[points.length - 1].y;
}

function exportCmpCoords() {
  if (!S.cmpCoords) return;
  const rows = [S.cmpCoords.headers, ...S.cmpCoords.rows];
  download(`hidrograf_koordinatlari_Q${S.cmpCoords.rp}.csv`,
    rows.map(r => r.join(";")).join("\n"));
}

/* ---------------- hidrograf grafiği ---------------- */
let chart = null;
function showChart(dur) {
  $("chartwrap").classList.remove("hidden");
  const sel = $("chartDur");
  sel.innerHTML = DURS.map(d => `<option value="${d}" ${d === dur ? "selected" : ""}>${d} saat</option>`).join("");
  sel.onchange = () => showChart(+sel.value);
  const hy = S.sonuc.dsi.hidrograflar[dur];
  const colors = { "2": "#9db5b2", "5": "#64b5aa", "10": "#2a9d8f", "25": "#d9a441", "50": "#e07b3a", "100": "#c73e3a", "OET": "#5e2d48" };
  const dt = 0.5;
  const n = Math.max(...RPS.map(rp => hy[rp].length));
  const labels = Array.from({ length: n }, (_, i) => (i * dt).toFixed(1));
  const ds = RPS.map(rp => ({
    label: "Q" + rp, data: hy[rp], borderColor: colors[rp], borderWidth: 1.6,
    pointRadius: 0, tension: .25,
  }));
  if (chart) chart.destroy();
  chart = new Chart($("chart"), {
    type: "line", data: { labels, datasets: ds },
    options: {
      animation: false, maintainAspectRatio: false,
      scales: { x: { title: { display: true, text: "T (saat)" } }, y: { title: { display: true, text: "Q (m³/s)" } } },
      plugins: { legend: { position: "bottom", labels: { boxWidth: 18 } } },
    },
  });
}
const SNY_RPS = ["2", "5", "10", "25", "50", "100", "OET"];
function showSnyderChart() {
  $("chartwrap").classList.remove("hidden");
  const sel = $("chartDur");
  sel.innerHTML = `<option>Snyder taşkın hidrografları (saatlik)</option>`;
  sel.onchange = null;
  const hy = S.sonuc.snyder.hidrograflar;
  const colors = { "2": "#9db5b2", "5": "#64b5aa", "10": "#2a9d8f", "25": "#d9a441", "50": "#e07b3a", "100": "#c73e3a", "OET": "#5e2d48" };
  const n = Math.max(...SNY_RPS.map(rp => hy[rp].length));
  const labels = Array.from({ length: n }, (_, i) => i.toString());
  const ds = SNY_RPS.map(rp => ({
    label: "Q" + rp, data: hy[rp], borderColor: colors[rp], borderWidth: 1.6,
    pointRadius: 0, tension: .25,
  }));
  if (chart) chart.destroy();
  chart = new Chart($("chart"), {
    type: "line", data: { labels, datasets: ds },
    options: {
      animation: false, maintainAspectRatio: false,
      scales: { x: { title: { display: true, text: "T (saat)" } }, y: { title: { display: true, text: "Q (m³/s)" } } },
      plugins: { legend: { position: "bottom", labels: { boxWidth: 18 } } },
    },
  });
}
$("btnCloseChart").onclick = () => $("chartwrap").classList.add("hidden");
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const rw = $("resWrap");
    if (rw && !rw.classList.contains("hidden")) { rw.classList.add("hidden"); return; }
    const mcmp = $("mcmpWrap");
    if (mcmp && !mcmp.classList.contains("hidden")) { mcmp.classList.add("hidden"); return; }
    const cmp = $("cmpWrap");
    if (cmp && !cmp.classList.contains("hidden")) { cmp.classList.add("hidden"); return; }
    const cw = $("chartwrap");
    if (cw && !cw.classList.contains("hidden")) { cw.classList.add("hidden"); return; }
  }
});

/* ---------------- dışa aktarım / proje ---------------- */
function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  a.download = name; a.click();
}
function exportCSV() {
  const r = S.sonuc;
  let rows = [["T(yil)", ...DURS.map(d => d + "sa")]];
  [...RPS, "500", "1000", "10000"].forEach(rp =>
    rows.push([rp, ...DURS.map(d => fmt(r.kabulet[d][rp], 3))]));
  download("kabulet.csv", rows.map(x => x.join(";")).join("\n"));
}

/* ---------------- havza silme (haritadan tıkla) ---------------- */
function clearSingleBasin() {
  // durum
  S.outlet = null; S.havza = null; S.dere = null; S.kanal = null;
  S.kotlar = Array(11).fill("");
  S.thiessen = []; S.istasyonlar = []; S.yzdBolge = null;
  S.stBase = null; S.stExclude = new Set(); S.stExtra = []; S.stPlace = false;
  S.rainValues = {}; S.P24w = null; S.OETw = null; S.yagis = [];
  S.sonuc = null; S.girdi = null; S.dplvList = null;
  S.resPoints = null; S.resSonuc = null;
  if (S.resMarker) { S.resMarker.remove(); S.resMarker = null; }
  // harita katmanları
  ["havza", "dere", "kanal", "thiessen", "markers"].forEach(k => layers[k].clearLayers());
  // giriş alanları
  ["inpA", "inpL", "inpLc", "inpCN3"].forEach(id => { if ($(id)) $(id).value = ""; });
  $("inpCN2").value = "75";
  $("yzdInfo").textContent = "";
  ["cnTable", "thTable", "results"].forEach(id => { if ($(id)) $(id).innerHTML = ""; });
  ["delinStatus", "cnStatus", "thStatus", "compStatus", "rainStatus"].forEach(id => { if ($(id)) setStatus(id, "", ""); });
  document.querySelectorAll(".step").forEach(s => s.classList.remove("done"));
  renderKotlar(); renderRainTable(); renderDplvGrid(); updateComputeReady();
  // çok parçalı: mansap tek havza outlet'ine bağlıysa onu da düşür
  if (S.multi) { if (S.multi.mansapAuto) { S.multi.mansap = null; S.multi.mansapAuto = false; } invalidateMultiSolve(); }
  activateStep(1);
  setStatus("delinStatus", "Havza ve bağlı tüm veriler silindi. Yeni outlet seçebilirsiniz.", "");
}
function onHavzaClick() {
  if (!S.havza) return;
  if (!confirm("Bu havzayı ve ona bağlı TÜM verileri (parametreler, CN, Thiessen, yağış, hidrograflar) silmek istiyor musunuz?")) return;
  clearSingleBasin();
}
function onMultiPolyClick(p) {
  if (!p) return;
  if (p.kind === "memba") {
    const i = +p.i || 0;
    if (!confirm(`Memba ${i + 1} havzasını silmek istiyor musunuz? Ara havza yeniden hesaplanacak; bu membaya bağlı sonuçlar silinecek.`)) return;
    S.multi.membalar.splice(i, 1);
    S.multiSonuc = null; $("multiResults").innerHTML = "";
    invalidateMultiSolve();
    multiLayers.poly.clearLayers();
    renderMultiPoints();
    if (S.multi.membalar.length) $("btnSolveDelin").click();   // ara havzayı yeniden çöz
    else setStatus("multiStatus", "Memba silindi. En az bir memba ekleyip tekrar çözün.", "");
  } else if (p.kind === "ara") {
    if (!confirm("Ara havza mansap−membalardan otomatik türetilir, tek başına silinemez. Tüm çok parçalı çözümü temizlemek ister misiniz?")) return;
    S.multiMd = null; S.multiSonuc = null;
    multiLayers.poly.clearLayers(); $("multiResults").innerHTML = "";
    invalidateMultiSolve();
    setStatus("multiStatus", "Çok parçalı çözüm temizlendi.", "");
  }
}

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
  const durumS = { ...S, sonuc: null, dplvList: null, infoLayers: [], rasterLayers: [] };
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
  renderKotlar();
  renderRainTable();
  renderDplvGrid();
  updateComputeReady();
  if (S.havza) {
    layers.havza.clearLayers(); layers.havza.addData(S.havza);
    layers.dere.clearLayers(); if (S.dere) layers.dere.addData(S.dere);
    layers.kanal.clearLayers(); if (S.kanal) layers.kanal.addData(S.kanal);
    map.fitBounds(layers.havza.getBounds());
  }
};
loadProjects();
