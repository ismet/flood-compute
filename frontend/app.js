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

/* ---------------- harita ---------------- */
const map = L.map("map").setView([39.2, 32.8], 6);
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
const sat = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { maxZoom: 19, attribution: "Esri World Imagery" });
L.control.layers({ "Harita": osm, "Uydu": sat }).addTo(map);
const layers = {
  havza: L.geoJSON(null, { style: { color: "#0d5c63", weight: 2, fillOpacity: .08 } }).addTo(map),
  dere: L.geoJSON(null, { style: { color: "#3b8ea5", weight: 1.5 } }).addTo(map),
  kanal: L.geoJSON(null, { style: { color: "#c73e3a", weight: 2.5, dashArray: "6 4" } }).addTo(map),
  thiessen: L.geoJSON(null, { style: { color: "#7d6e4f", weight: 1.5, fillOpacity: .05, dashArray: "3 3" } }).addTo(map),
  markers: L.layerGroup().addTo(map),
};

/* ---------------- adım gezinme ---------------- */
document.querySelectorAll(".step").forEach(b => b.onclick = () => {
  document.querySelectorAll(".step").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  document.querySelectorAll(".page").forEach(p =>
    p.classList.toggle("hidden", p.dataset.page !== b.dataset.step));
  // Adım 4'e ilk girişte varsayılan KMZ ile Thiessen'i otomatik hesapla
  if (b.dataset.step === "4" && S.havza && !S.thiessen.length) useDefaultStations();
  // Adım 5'e girişte yağış tablosunu istasyonlara göre kur; alt paneli göster
  $("rainDock").classList.toggle("hidden", b.dataset.step !== "5");
  if (b.dataset.step === "5") { renderRainTable(); renderDplvGrid(); }
  // Küçük havzada rasyonel seçeneğini öne çıkar
  if (b.dataset.step === "6" && +$("inpA").value > 0 && +$("inpA").value <= 1) {
    $("inpRasyonel").checked = true;
    $("rasyonelBox").open = true;
  }
});
const markDone = (n) => document.querySelector(`.step[data-step="${n}"]`).classList.add("done");
const setStatus = (id, msg, cls = "") => { const e = $(id); e.textContent = msg; e.className = "status " + cls; };

/* ---------------- ADIM 1: havza ---------------- */
let picking = false;
$("btnPick").onclick = () => {
  picking = !picking;
  $("btnPick").classList.toggle("picking", picking);
  map.getContainer().style.cursor = picking ? "crosshair" : "";
};
map.on("click", async (ev) => {
  if (!picking) return;
  picking = false;
  $("btnPick").classList.remove("picking");
  map.getContainer().style.cursor = "";
  setStatus("delinStatus", "Havza çıkarılıyor… (ilk seferde DEM indirme birkaç dakika sürebilir)");
  try {
    const r = await api("/api/delineate", {
      lat: ev.latlng.lat, lon: ev.latlng.lng, river_km2: +$("inpRivThr").value || 1,
    });
    S.outlet = r.outlet; S.havza = r.havza_geojson; S.kotlar = r.kotlar.slice();
    $("inpA").value = r.alan_km2; $("inpL").value = r.L_km; $("inpLc").value = r.Lc_km;
    layers.havza.clearLayers(); layers.havza.addData(r.havza_geojson);
    layers.dere.clearLayers(); if (r.dere_geojson) layers.dere.addData(r.dere_geojson);
    layers.kanal.clearLayers(); layers.kanal.addData(r.ana_kanal_geojson);
    layers.markers.clearLayers();
    L.marker([r.outlet.snap_lat, r.outlet.snap_lon]).addTo(layers.markers).bindPopup("Outlet");
    map.fitBounds(layers.havza.getBounds(), { padding: [30, 30] });
    renderKotlar();
    setStatus("delinStatus",
      `Havza: ${r.alan_km2} km² | L=${r.L_km} km | Lc=${r.Lc_km} km` +
      (r.kenar_uyarisi ? "\n⚠ Havza pencere kenarına değiyor, sonuçları kontrol edin!" : ""), "ok");
    markDone(1);
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
  setStatus("cnStatus", "CORINE kesiliyor… (yerel raster yoksa EEA'dan indirilir, birkaç saniye)");
  try {
    const r = await api("/api/cn", { havza_geojson: S.havza, zemin_grubu: $("inpSoil").value });
    $("inpCN2").value = r.CN2; $("inpCN3").value = r.CN3;
    let h = `<table class="tbl"><tr><th>Kod</th><th>Sınıf</th><th>Oran</th><th>CN</th></tr>`;
    r.dokum.forEach(d => h += `<tr><td>${d.kod}</td><td>${d.ad}</td><td>${(d.oran * 100).toFixed(1)}%</td><td>${d.cn}</td></tr>`);
    $("cnTable").innerHTML = h + "</table>";
    setStatus("cnStatus", `Ağırlıklı CN(II)=${r.CN2}  CN(III)=${r.CN3}\nVeri kaynağı: ${r.kaynak}`, "ok");
    markDone(3);
  } catch (e) { setStatus("cnStatus", "Hata: " + e.message, "err"); }
};

/* ---------------- ADIM 4: Thiessen ---------------- */
async function runThiessen(stations, kaynak) {
  if (!S.havza) return setStatus("thStatus", "Önce havzayı çıkarın (Adım 1)", "err");
  setStatus("thStatus", "Thiessen hesaplanıyor…");
  try {
    S.istasyonlar = stations;
    const r2 = await api("/api/thiessen", { havza_geojson: S.havza, istasyonlar: S.istasyonlar });
    S.thiessen = r2.sonuc;
    layers.thiessen.clearLayers();
    layers.markers.clearLayers();
    if (S.outlet) L.marker([S.outlet.snap_lat, S.outlet.snap_lon]).addTo(layers.markers).bindPopup("Outlet");
    const aktif = S.thiessen.filter(t => t.agirlik > 0);
    let h = `<table class="tbl"><tr><th>İstasyon</th><th>Ağırlık</th><th>Alan (km²)</th></tr>`;
    aktif.forEach(t => {
      if (t.poligon_geojson) layers.thiessen.addData(t.poligon_geojson);
      L.circleMarker([t.lat, t.lon], { radius: 6, color: "#7d6e4f", fillOpacity: .8 })
        .addTo(layers.markers).bindPopup(`${t.name} (w=${(t.agirlik * 100).toFixed(1)}%)`);
      h += `<tr class="sel"><td>${t.name}</td><td>${(t.agirlik * 100).toFixed(1)}%</td><td>${t.alan_km2}</td></tr>`;
    });
    $("thTable").innerHTML = h + "</table>";
    setStatus("thStatus",
      `${kaynak}: ${stations.length} istasyondan ${aktif.length} tanesi havzada pay alıyor`, "ok");
    markDone(4);
    renderRainTable();
  } catch (e) { setStatus("thStatus", "Hata: " + e.message, "err"); }
}

async function useDefaultStations() {
  setStatus("thStatus", "Varsayılan istasyonlar yükleniyor…");
  try {
    const r = await api("/api/stations/default");
    if (!r.istasyonlar.length)
      return setStatus("thStatus", "Varsayılan KMZ bulunamadı (data/stations/)", "err");
    await runThiessen(r.istasyonlar, r.dosya);
  } catch (e) { setStatus("thStatus", "Hata: " + e.message, "err"); }
}
$("btnDefaultSt").onclick = useDefaultStations;

$("kmzFile").onchange = async () => {
  const f = $("kmzFile").files[0];
  if (!f) return;
  setStatus("thStatus", "İstasyonlar okunuyor…");
  try {
    const fd = new FormData(); fd.append("file", f);
    const r1 = await api("/api/stations", fd, true);
    await runThiessen(r1.istasyonlar, f.name);
  } catch (e) { setStatus("thStatus", "Hata: " + e.message, "err"); }
};

/* ---------------- ADIM 5: yağış ---------------- */
const DPLV_LABELS = ["5dk", "10dk", "15dk", "30dk", "1sa", "2sa", "3sa", "4sa",
                     "5sa", "6sa", "8sa", "12sa", "18sa", "24sa"];

async function loadDplv() {
  const d = await api("/api/dplv");
  S.dplvList = d;
  const sel = $("inpDplv");
  d.stations.forEach((s, i) => {
    const o = document.createElement("option"); o.value = i; o.textContent = s.name;
    sel.appendChild(o);
  });
  sel.onchange = () => {
    S.dplvValues = S.dplvList.stations[+sel.value].ratios.slice();
    renderDplvGrid();
  };
  if (!S.dplvValues) S.dplvValues = d.stations[0].ratios.slice();
  renderDplvGrid();
}
loadDplv();

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
  let h = `<table class="tbl rain st"><tr><th colspan="8">Yinelenmeli Yağışlar (24 Saatlik)</th></tr>
    <tr><th>İstasyon (w)</th>` + RAIN_COLS.map(c => `<th>${c}</th>`).join("") + `</tr>`;
  w.forEach((t, r) => {
    const vals = S.rainValues[t.name] || [];
    h += `<tr><td>${t.name} (${(t.agirlik * 100).toFixed(0)}%)</td>`;
    for (let c = 0; c < 7; c++) {
      const v = vals[c] ?? "";
      h += `<td><input class="rain-cell" data-r="${r}" data-c="${c}" value="${v}"></td>`;
    }
    h += `</tr>`;
  });
  h += `<tr class="sel"><td><b>Ağırlıklı</b></td>` +
    RAIN_COLS.map((c, i) => `<td id="rw${i}"></td>`).join("") + `</tr></table>`;
  div.innerHTML = h;
  div.querySelectorAll(".rain-cell").forEach(inp => {
    inp.addEventListener("input", readRainGrid);
    inp.addEventListener("paste", onRainPaste);
  });
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
}

function dplvRatios() {
  if (S.dplvValues && S.dplvValues.every(v => v != null)) return S.dplvValues;
  return S.dplvList.stations[+$("inpDplv").value].ratios;
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
    setStatus("compStatus", "Hesaplanıyor…");
    S.sonuc = await api("/api/compute", {
      girdi, kar,
      rasyonel: $("inpRasyonel").checked,
      c100: +$("inpC100").value || 0.45,
      us: +$("inpUs").value || 0.2,
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
  if (r.kar) h += `<div class="small">Kar erimesi piki: ${fmt(r.kar.Qkar_pik, 1)} m³/s (OET hidrografına eklendi)</div>`;

  h += `<h3 class="res">Tekerrür yılı ara (Yıl_Ara)</h3>
    <div class="grid2"><label>Debi (m³/s)<input id="yilQ" type="number" step="0.1"></label>
    <button id="btnYil">Ara</button></div><div id="yilRes" class="status"></div>
    <div class="export-row"><button id="btnCSV">⬇ CSV</button><button id="btnJSON">⬇ JSON</button></div>`;
  el.innerHTML = h;

  $("btnChart").onclick = () => showChart(+$("selDur").value);
  $("btnYil").onclick = () => {
    const d = $("selDur").value, q = +$("yilQ").value;
    const t = api("/api/yil-ara", { q, q10: r.kabulet[d]["10"], q100: r.kabulet[d]["100"] })
      .then(x => $("yilRes").textContent =
        `T ≈ ${x.tekerrur_yili ? x.tekerrur_yili.toFixed(1) : "—"} yıl (${d} sa hidrografına göre)`);
  };
  $("btnCSV").onclick = exportCSV;
  $("btnJSON").onclick = () => download("taskin_sonuc.json", JSON.stringify(S.sonuc, null, 1));
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
$("btnCloseChart").onclick = () => $("chartwrap").classList.add("hidden");

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

$("btnSave").onclick = async () => {
  const ad = $("projName").value.trim();
  if (!ad) return alert("Proje adı girin");
  const fields = {};
  ["inpA", "inpL", "inpLc", "inpRegion", "inpQbaz", "inpCN2", "inpCN3", "inpSoil",
   "inpDplv", "karTemps", "karA", "karH", "karHist", "inpC100", "inpUs"]
    .forEach(id => fields[id] = $(id).value);
  await api("/api/project/save", { ad, durum: { S: { ...S, sonuc: null, dplvList: null }, fields } });
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
  Object.assign(S, d.S);
  Object.entries(d.fields).forEach(([id, v]) => { if ($(id)) $(id).value = v; });
  $("projName").value = ad;
  renderKotlar();
  renderRainTable();
  renderDplvGrid();
  if (S.havza) { layers.havza.clearLayers(); layers.havza.addData(S.havza); map.fitBounds(layers.havza.getBounds()); }
};
loadProjects();
