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
      const next = document.querySelector(`.step[data-step="${n < 1 ? 6 : n > 6 ? 1 : n}"]`);
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
});
map.on("click", (ev) => {
  if (S.multi && S.multi.place) { multiAddPoint(ev.latlng); return; }
});
map.on("click", async (ev) => {
  if (!picking) return;
  picking = false;
  $("btnPick").classList.remove("picking");
  map.getContainer().style.cursor = "";
  setStatus("delinStatus", "Havza çıkarılıyor… (DEM işleniyor, birkaç saniye sürebilir)", "loading");
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
    setStatus("delinStatus",
      `Havza: ${r.alan_km2} km² | L=${r.L_km} km | Lc=${r.Lc_km} km` +
      (r.kenar_uyarisi ? "\n⚠ Havza pencere kenarına değiyor, sonuçları kontrol edin!" : "") +
      yzdMsg, "ok");
    markDone(1);
    updateComputeReady();
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
  setStatus("thStatus", "Thiessen hesaplanıyor…", "loading");
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
  setStatus("thStatus", "Varsayılan istasyonlar yükleniyor…", "loading");
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
  setStatus("thStatus", "İstasyonlar okunuyor…", "loading");
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
    <span class="small">veya her satırda MGM istasyonu seçerek P2–P100'ü doldurun (OEY elle girilir)</span></div>
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
  }
  if (r.kar) h += `<div class="small">Kar erimesi piki: ${fmt(r.kar.Qkar_pik, 1)} m³/s (OET hidrografına eklendi)</div>`;

  h += `<h3 class="res">Tekerrür yılı ara (Yıl_Ara)</h3>
    <div class="grid2"><label>Debi (m³/s)<input id="yilQ" type="number" step="0.1"></label>
    <button id="btnYil">Ara</button></div><div id="yilRes" class="status"></div>
    <div class="export-row"><button id="btnCompare" class="primary">⚖ Yöntemleri Karşılaştır</button>
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
      <span id="repStatus" class="small"></span>
    </div>`;
  el.innerHTML = h;
  // dahil kutuları değişince seçilen-yöntem menüsünü güncel tut
  document.querySelectorAll(".repMethod").forEach(cb => cb.onchange = syncRepSecili);

  $("btnChart").onclick = () => showChart(+$("selDur").value);
  $("btnCompare").onclick = () => openCompare();
  $("btnReport").onclick = downloadReport;
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
    if (!resp.ok) {
      let msg = resp.statusText;
      try { msg = (await resp.json()).hata || msg; } catch (e) {}
      throw new Error(msg);
    }
    const blob = await resp.blob();
    const cd = resp.headers.get("content-disposition") || "";
    let name = "Taskin_Bolum.docx";
    const idx = cd.indexOf("filename=");
    if (idx >= 0) name = cd.slice(idx + 9).replace(/["';]/g, "").trim() || name;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    $("repStatus").textContent = "✓ İndirildi: " + name;
  } catch (e) { $("repStatus").textContent = "Hata: " + e.message; }
}

/* ================= ARA HAVZA (ÇOK PARÇALI) ================= */
S.multi = { mansap: null, membalar: [], place: null };
const multiLayers = {
  poly: L.geoJSON(null, { style: f => ({ color: f.properties && f.properties.c || "#7b1fa2", weight: 2, fillOpacity: .12 }) }).addTo(map),
  pts: L.layerGroup().addTo(map),
};
multiLayers.poly.remove(); multiLayers.pts.remove(); // varsayılan gizli

function setMode(mode) {
  S.mode = mode;
  const multi = mode === "multi";
  $("modeWizard").classList.toggle("active", !multi);
  $("modeMulti").classList.toggle("active", multi);
  $("steps").classList.toggle("hidden", multi);
  if (multi) document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
  $("multiMode").classList.toggle("hidden", !multi);
  $("rainDock").classList.add("hidden");
  if (multi) { multiLayers.poly.addTo(map); multiLayers.pts.addTo(map); drawMultiPoints(); }
  else {
    multiLayers.poly.remove(); multiLayers.pts.remove();
    document.querySelector('.step[data-step="1"]').click();
  }
}
$("modeWizard").onclick = () => setMode("wizard");
$("modeMulti").onclick = () => setMode("multi");

$("btnAddMansap").onclick = () => { S.multi.place = "mansap"; multiHint("Haritada MANSAP (çıkış) noktasına tıklayın"); };
$("btnAddMemba").onclick = () => { S.multi.place = "memba"; multiHint("Haritada bir MEMBA (üst havza çıkışı) noktasına tıklayın"); };
function multiHint(msg) { setStatus("multiStatus", msg, ""); map.getContainer().style.cursor = "crosshair"; }

function multiAddPoint(latlng) {
  const p = { lat: +latlng.lat.toFixed(6), lon: +latlng.lng.toFixed(6) };
  if (S.multi.place === "mansap") S.multi.mansap = p;
  else S.multi.membalar.push(p);
  S.multi.place = null;
  map.getContainer().style.cursor = "";
  setStatus("multiStatus", "", "");
  renderMultiPoints();
}

function renderMultiPoints() {
  let h = "";
  if (S.multi.mansap)
    h += `<div class="mpt-row"><span class="dot" style="background:#c73e3a"></span>
      Mansap: ${S.multi.mansap.lat.toFixed(4)}, ${S.multi.mansap.lon.toFixed(4)}
      <button data-t="mansap">✕</button></div>`;
  S.multi.membalar.forEach((m, i) => {
    h += `<div class="mpt-row"><span class="dot" style="background:#1e88e5"></span>
      Memba ${i + 1}: ${m.lat.toFixed(4)}, ${m.lon.toFixed(4)}
      <button data-t="memba" data-i="${i}">✕</button></div>`;
  });
  $("multiPoints").innerHTML = h || `<div class="small">Henüz nokta eklenmedi.</div>`;
  $("multiPoints").querySelectorAll("button").forEach(b => b.onclick = () => {
    if (b.dataset.t === "mansap") S.multi.mansap = null;
    else S.multi.membalar.splice(+b.dataset.i, 1);
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

// bir alt havza poligonunu (multi-delineate çıktısı) tam otomatik hesaplar
async function autoComputeSub(sub, qbazTotal, aMansap) {
  const w = await api("/api/thiessen", { havza_geojson: sub.havza_geojson, istasyonlar: S.istasyonlar });
  const act = w.sonuc.filter(t => t.agirlik > 0);
  const T = [2, 5, 10, 25, 50, 100];
  const P24 = {}; let OET = 0, oetOk = true;
  T.forEach((tt, j) => {
    P24[tt] = act.reduce((a, t) => {
      const rv = S.rainValues[t.name]; return a + (rv ? t.agirlik * rv[j] : 0);
    }, 0);
  });
  act.forEach(t => { const rv = S.rainValues[t.name]; if (!rv || rv[6] == null) oetOk = false; else OET += t.agirlik * rv[6]; });
  const cn = await api("/api/cn", { havza_geojson: sub.havza_geojson, zemin_grubu: $("multiSoil").value });
  const girdi = {
    ad: "alt", A_km2: sub.alan_km2, L_km: sub.L_km, Lc_km: sub.Lc_km,
    CN2: cn.CN2, CN3: cn.CN3, region: (sub.yzd_bolge && sub.yzd_bolge.bolge) || "B",
    elevations: sub.kotlar, Qbaz: qbazTotal * (sub.alan_km2 / aMansap),
    P24, P24_OET: oetOk ? OET : 0, dplv_ratios: dplvRatios(),
  };
  const res = await api("/api/compute", { girdi });
  return { girdi, res, cn, thiessen: act };
}

$("btnSolveMulti").onclick = async () => {
  try {
    if (!S.multi.mansap) throw new Error("Mansap noktası seçin");
    if (!S.multi.membalar.length) throw new Error("En az bir memba noktası ekleyin");
    if (!S.istasyonlar || !S.istasyonlar.length) throw new Error("Önce Adım 4'te istasyonları yükleyin");
    if (!S.rainValues || !Object.keys(S.rainValues).length) throw new Error("Önce Adım 5'te yağışları girin");
    if (!S.dplvList) throw new Error("DPLV listesi yüklenmedi");
    setStatus("multiStatus", "Ara havza çıkarılıyor… (DEM işleniyor)", "loading");
    const md = await api("/api/multi-delineate", {
      mansap: S.multi.mansap, membalar: S.multi.membalar, river_km2: +$("multiRivThr").value || 1,
    });
    // poligonları çiz
    multiLayers.poly.clearLayers();
    const addPoly = (gj, c) => { gj = JSON.parse(JSON.stringify(gj)); multiLayers.poly.addData({ type: "Feature", properties: { c }, geometry: gj }); };
    addPoly(md.ara.havza_geojson, "#2a9d8f");
    md.membalar.forEach(mb => addPoly(mb.havza_geojson, "#1e88e5"));
    map.fitBounds(multiLayers.poly.getBounds(), { padding: [30, 30] });

    const qbaz = +$("multiQbaz").value || 0, aMansap = md.mansap.alan_km2;
    setStatus("multiStatus", "Alt havzalar hesaplanıyor (CN, Thiessen, hidrograf)…", "loading");
    const araC = await autoComputeSub(md.ara, qbaz, aMansap);
    const membaC = [];
    for (const mb of md.membalar) membaC.push({ mb, ...(await autoComputeSub(mb, qbaz, aMansap)) });

    setStatus("multiStatus", `Öteleme (ara T_c=${fmt(md.ara.Tc_saat, 2)} sa)…`, "loading");
    const rt = await api("/api/route", {
      ara_sonuc: araC.res, memba_sonuclari: membaC.map(x => x.res), lag_saat: md.ara.Tc_saat,
    });
    S.multiSonuc = { md, araC, membaC, rt };
    renderMultiResults();
    setStatus("multiStatus", "Tamamlandı", "ok");
  } catch (e) { setStatus("multiStatus", "Hata: " + e.message, "err"); }
};

const MRP = ["2", "5", "10", "25", "50", "100", "OET"];
function _envPeak(res, rp) {
  let mx = null;
  ["2", "4", "6", "8", "12", "18", "24"].forEach(d => { const v = res.kabulet[d] && res.kabulet[d][rp]; if (v != null) mx = mx == null ? v : Math.max(mx, v); });
  return mx;
}
function renderMultiResults() {
  const { md, araC, membaC, rt } = S.multiSonuc;
  let h = `<h3 class="res">Alt Havzalar</h3><table class="tbl">
    <tr><th>Havza</th><th>A (km²)</th><th>L (km)</th><th>Lc</th><th>CN</th><th>Bölge</th><th>Tc (sa)</th><th>Q100 pik</th></tr>`;
  const rowFor = (ad, sub, comp, tc) =>
    `<tr><td>${ad}</td><td>${fmt(sub.alan_km2, 2)}</td><td>${fmt(sub.L_km, 2)}</td><td>${fmt(sub.Lc_km, 2)}</td>
     <td>${fmt(comp.cn.CN2, 0)}</td><td>${(sub.yzd_bolge && sub.yzd_bolge.bolge) || "—"}</td>
     <td>${fmt(tc, 2)}</td><td>${fmt(_envPeak(comp.res, "100"), 1)}</td></tr>`;
  membaC.forEach((x, i) => h += rowFor("Memba " + (i + 1), x.mb, x, x.mb.Tc_saat));
  h += rowFor("Ara havza", md.ara, araC, md.ara.Tc_saat);
  h += `<tr><td colspan="7"><b>Mansap (toplam)</b> — A=${fmt(md.mansap.alan_km2, 2)} km²,
     öteleme=${fmt(md.ara.Tc_saat, 2)} sa (${rt.shift_adim} adım)</td>
     <td><b>${fmt(rt.pikler["100"], 1)}</b></td></tr></table>`;
  if (md.uyari && md.uyari.length) h += `<div class="small">⚠ ${md.uyari.join("; ")}</div>`;

  h += `<h3 class="res">Mansap Taşkın Pikleri (öteleme sonrası, m³/s)</h3><table class="tbl"><tr>` +
    MRP.map(rp => `<th>Q${rp}</th>`).join("") + `</tr><tr>` +
    MRP.map(rp => `<td>${fmt(rt.pikler[rp], 1)}</td>`).join("") + `</tr>
    <tr class="small"><td colspan="${MRP.length}">Bileşen (Q100): ara ${fmt(rt.bilesenler["100"].ara_pik, 1)} + memba ` +
    rt.bilesenler["100"].memba_pikleri.map(v => fmt(v, 1)).join(", ") + ` (ötelenmiş) → ${fmt(rt.pikler["100"], 1)}</td></tr></table>
    <div class="export-row"><button id="btnMultiChart" class="primary">📈 Mansap hidrografları</button>
    <button id="btnMultiCsv">⬇ CSV</button></div>`;
  $("multiResults").innerHTML = h;
  $("btnMultiChart").onclick = showMultiChart;
  $("btnMultiCsv").onclick = () => {
    const rows = [["T(saat)", ...MRP.map(rp => "Q" + rp)]];
    const n = Math.max(...MRP.map(rp => rt.hidrograflar[rp].length));
    for (let i = 0; i < n; i++) rows.push([(i * 0.5).toFixed(1), ...MRP.map(rp => (rt.hidrograflar[rp][i] ?? "").toString())]);
    download("mansap_hidrograflari.csv", rows.map(r => r.join(";")).join("\n"));
  };
}

function showMultiChart() {
  const rt = S.multiSonuc.rt;
  $("chartwrap").classList.remove("hidden");
  $("chartDur").innerHTML = `<option>Mansap taşkın hidrografları (öteleme sonrası)</option>`;
  $("chartDur").onchange = null;
  const colors = { "2": "#9db5b2", "5": "#64b5aa", "10": "#2a9d8f", "25": "#d9a441", "50": "#e07b3a", "100": "#c73e3a", "OET": "#5e2d48" };
  const ds = MRP.map(rp => ({ label: "Q" + rp, data: rt.hidrograflar[rp], borderColor: colors[rp], borderWidth: 1.6, pointRadius: 0, tension: .25 }));
  const n = Math.max(...MRP.map(rp => rt.hidrograflar[rp].length));
  const labels = Array.from({ length: n }, (_, i) => (i * 0.5).toFixed(1));
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

$("btnSave").onclick = async () => {
  const ad = $("projName").value.trim();
  if (!ad) return alert("Proje adı girin");
  const fields = {};
  ["inpA", "inpL", "inpLc", "inpRegion", "inpQbaz", "inpCN2", "inpCN3", "inpSoil",
   "inpDplv", "karTemps", "karA", "karH", "karHist", "inpC100", "inpUs",
   "inpCt", "inpCp", "inpW50", "inpW75", "inpYald"]
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
  updateComputeReady();
  if (S.havza) { layers.havza.clearLayers(); layers.havza.addData(S.havza); map.fitBounds(layers.havza.getBounds()); }
};
loadProjects();
