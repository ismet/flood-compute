import { S } from "../core/state.js";
import { $, setStatus } from "../ui/dom.js";
import { api } from "../core/api.js";
import { mgmNorm } from "../core/format.js";
import { map, layers } from "../map/init.js";
import { markDone, updateComputeReady } from "./steps.js";

// layers.thiessen OWNER-CREATED (registry-bag)
if (layers.thiessen) {
  try {
    map.removeLayer(layers.thiessen);
  } catch (e) {}
}
layers.thiessen = L.geoJSON(null, {
  style: { color: "#7d6e4f", weight: 1.5, fillOpacity: 0.05, dashArray: "3 3" },
}).addTo(map);

// Thiessen style will be updated via recolorThiessen (dynamic)
export const RAIN_BLUES = [
  "#e3f2fd",
  "#bbdefb",
  "#90caf9",
  "#64b5f6",
  "#42a5f5",
  "#2196f3",
  "#1e88e5",
  "#1976d2",
  "#1565c0",
  "#0d47a1",
];
export function rainRange() {
  // seçili sütunda dolu değeri olan aktif istasyonlardan min/max
  const c = S.rainColorCol ?? 5;
  const vals = (S.thiessen || [])
    .filter((t) => t.agirlik > 0)
    .map((t) => ((S.rainValues && S.rainValues[t.name]) || [])[c])
    .filter((v) => v != null && !isNaN(v))
    .map(Number);
  if (!vals.length) return null;
  return { min: Math.min(...vals), max: Math.max(...vals), n: vals.length, col: c };
}
export function rainColor(name) {
  const rng = rainRange();
  if (!rng) return null;
  const v = ((S.rainValues && S.rainValues[name]) || [])[rng.col];
  if (v == null || isNaN(v)) return null;
  const t = rng.max > rng.min ? (v - rng.min) / (rng.max - rng.min) : 0.6;
  return RAIN_BLUES[Math.min(RAIN_BLUES.length - 1, Math.max(0, Math.round(t * (RAIN_BLUES.length - 1))))];
}
export function thiessenStyle(f) {
  const ad = f && f.properties && f.properties.name;
  const col = ad ? rainColor(ad) : null;
  if (!col) return { color: "#7d6e4f", weight: 1.5, fillOpacity: 0.05, dashArray: "3 3" };
  return { color: "#0d47a1", weight: 1.5, fillColor: col, fillOpacity: 0.65, dashArray: null };
}
export function recolorThiessen() {
  if (layers.thiessen) layers.thiessen.setStyle(thiessenStyle);
  renderRainLegend();
}
export function renderRainLegend() {
  const el = $("rainLegend");
  if (!el) return;
  const rng = rainRange();
  if (!rng) {
    el.innerHTML = "";
    return;
  }
  const etiket = RAIN_COLS[rng.col] === "OEY" ? "OEY" : "P" + RAIN_COLS[rng.col];
  el.innerHTML =
    `<span class="small">Alan boyaması — ${etiket} yağışı (mm):</span>
    <span class="small">${rng.min.toFixed(1)}</span>` +
    RAIN_BLUES.map((c) => `<i style="background:${c}"></i>`).join("") +
    `<span class="small">${rng.max.toFixed(1)}</span>
     <span class="small">(${rng.n} istasyon)</span>`;
}
export const RAIN_COLS = ["2", "5", "10", "25", "50", "100", "OEY"];
export const activeStations = () => S.thiessen.filter((t) => t.agirlik > 0);
export function renderRainTable() {
  const w = activeStations();
  const div = $("rainGrid");
  if (!w.length) {
    div.innerHTML = `<div class="small">Önce yukarıdaki Thiessen ağırlıklarını hesaplayın.</div>`;
    return;
  }
  if (!S.rainValues) S.rainValues = {};
  if (!S.rainMeta) S.rainMeta = {};
  mgmDbListesi(); // elle seçim listesini havza çevresinden hazırla
  let h =
    `<div class="rain-tools"><button id="btnMgmAuto" class="small-btn">📊 Ölçümden hesapla (MGM eşleştir)</button>
    <span class="small">P2–P100, MGM istasyonunun yıllık en büyük günlük yağışlarından
      frekans analiziyle hesaplanır (NTFA ile aynı hesap). OEY elle girilir.</span>
    <label class="inline" title="Haritadaki Thiessen alanları, seçilen tekerrürün yağışına göre mavi tonlarıyla boyanır (az yağış açık, çok yağış koyu).">Alan boyaması
      <select id="rainColorCol">` +
    RAIN_COLS.map(
      (c, i) =>
        `<option value="${i}"${i === (S.rainColorCol ?? 5) ? " selected" : ""}>${c === "OEY" ? "OEY" : "P" + c}</option>`,
    ).join("") +
    `</select></label></div>
    <div id="rainLegend" class="rain-legend"></div>
    <table class="tbl rain st"><tr><th colspan="10">Yinelenmeli Yağışlar (24 Saatlik)</th></tr>
    <tr><th>İstasyon (w)</th><th>MGM istasyonu</th><th title="Frekans analizinin kaç yıllık seriye dayandığı ve kabul edilen dağılım">kaynak</th>` +
    RAIN_COLS.map((c) => `<th>${c}</th>`).join("") +
    `</tr>`;
  w.forEach((t, r) => {
    const vals = S.rainValues[t.name] || [];
    const m = S.rainMeta[t.name];
    // Hangi P24'ün nereden geldiği satırda görünür: kaç yıllık ölçüm, hangi
    // dağılım, eşleşme koordinatla mı adla mı kuruldu. Eşleşme sessiz olursa
    // 30 km ötedeki bir istasyonun yağışı fark edilmeden havzaya girer.
    const kaynak = m
      ? `<span class="small" title="${m.dagilim || ""}${m.mesafe_km != null ? " · " + m.mesafe_km + " km" : ""}">` +
        `${m.yil_sayisi} yıl · ${(m.dagilim || "").split(" ")[0]}` +
        (m.yontem === "ad" ? " ⚠ad" : "") +
        `</span>`
      : `<span class="small">—</span>`;
    h += `<tr><td>${t.name} (${(t.agirlik * 100).toFixed(0)}%)</td>
      <td><input class="mgm-pick" list="mgmDbList" data-r="${r}" placeholder="MGM ara…" value="${t._mgmAd || ""}"></td>
      <td>${kaynak}</td>`;
    for (let c = 0; c < 7; c++) {
      const v = vals[c] ?? "";
      h += `<td><input class="rain-cell" data-r="${r}" data-c="${c}" value="${v}"></td>`;
    }
    h += `</tr>`;
  });
  h +=
    `<tr class="sel"><td colspan="3"><b>Ağırlıklı</b></td>` +
    RAIN_COLS.map((c, i) => `<td id="rw${i}"></td>`).join("") +
    `</tr></table>`;
  div.innerHTML = h;
  div.querySelectorAll(".rain-cell").forEach((inp) => {
    inp.addEventListener("input", readRainGrid);
    inp.addEventListener("paste", onRainPaste);
  });
  const sel = $("rainColorCol");
  if (sel)
    sel.onchange = () => {
      S.rainColorCol = +sel.value;
      recolorThiessen();
    };
  recolorThiessen();
  div.querySelectorAll(".mgm-pick").forEach((inp) =>
    inp.addEventListener("change", async () => {
      const r = +inp.dataset.r;
      const kod = (inp.value.match(/\(([^)]+)\)\s*$/) || [])[1];
      const st = kod
        ? (S.mgmDbYakin || []).find((s) => s.kod === kod)
        : (S.mgmDbYakin || []).find((s) => mgmNorm(s.ad) === mgmNorm(inp.value));
      if (!st) {
        setStatus("rainStatus", `"${inp.value}" listede yok — havza çevresindeki istasyonlardan seçin`, "err");
        return;
      }
      try {
        await mgmSatirBagla(w[r], r, st.kod);
        renderRainTable();
        setStatus("rainStatus", `${st.ad}: ${st.yil_sayisi} yıllık ölçümden hesaplandı`, "ok");
      } catch (e) {
        setStatus("rainStatus", e.message, "err");
      }
    }),
  );
  $("btnMgmAuto").onclick = mgmOtomatikEslestir;
  recalcRain();
}
export async function mgmOtomatikEslestir() {
  const w = activeStations();
  if (!w.length) return;
  setStatus("rainStatus", "MGM istasyonları eşleştiriliyor ve frekans analizi yapılıyor…", "");
  try {
    const d = await api("/api/mgm-eslestir", {
      // kod varsa istasyon zaten MGM veri tabanından geliyor (Yağış adımının
      // varsayılan Thiessen kümesi) — arama değil kimlik eşleşmesi. Koordinat/ad
      // araması yalnız yüklenen KMZ ve elle konan noktalar için gerekir.
      istasyonlar: w.map((t) => ({ ad: t.name, lat: t.lat, lon: t.lon, kod: t.kod })),
      en_az_yil: 10,
      en_cok_km: 25,
      hesapla: true,
    });
    S.rainMeta = S.rainMeta || {};
    let n = 0,
      uzak = 0,
      adla = 0,
      hatali = [];
    d.eslesme.forEach((k, r) => {
      if (!k.eslesen || !k.frekans || !k.frekans.P24) {
        if (k.eslesen) hatali.push(k.ad);
        return;
      }
      w[r]._mgmKod = k.eslesen.kod;
      w[r]._mgmAd = `${k.eslesen.ad} (${k.eslesen.kod})`;
      S.rainMeta[w[r].name] = {
        yil_sayisi: k.frekans.yil_sayisi,
        dagilim: k.frekans.dagilim,
        yontem: k.yontem,
        mesafe_km: k.mesafe_km,
      };
      S.rainValues[w[r].name] = ["2", "5", "10", "25", "50", "100"]
        .map((t) => k.frekans.P24[t])
        .concat([S.rainValues[w[r].name]?.[6] ?? ""]);
      n++;
      if (k.yontem === "ad") adla++;
      if (k.mesafe_km != null && k.mesafe_km > 10) uzak++;
    });
    renderRainTable();
    const notlar = [];
    if (adla) notlar.push(`${adla} tanesi yalnız ADLA eşleşti (koordinat tutmadı) — denetleyin`);
    if (uzak) notlar.push(`${uzak} tanesi 10 km'den uzak`);
    if (hatali.length) notlar.push(`${hatali.length} istasyonun serisi frekans için kısa`);
    setStatus(
      "rainStatus",
      n
        ? `${n}/${w.length} istasyon ölçümden hesaplandı. OEY elle girilir.` +
            (notlar.length ? " — " + notlar.join("; ") : "")
        : "Eşleşme bulunamadı — satırlardan elle MGM istasyonu seçin",
      n ? "ok" : "err",
    );
  } catch (e) {
    setStatus("rainStatus", e.message, "err");
  }
}
export function onRainPaste(e) {
  const text = (e.clipboardData || window.clipboardData).getData("text");
  if (!text || (!text.includes("\t") && !text.includes("\n"))) return; // tek değer: normal yapıştır
  e.preventDefault();
  const block = text
    .replace(/\r/g, "")
    .split("\n")
    .filter((x) => x.trim() !== "")
    .map((row) => row.split("\t"));
  const r0 = +e.target.dataset.r,
    c0 = +e.target.dataset.c;
  block.forEach((cols, dr) =>
    cols.forEach((val, dc) => {
      const cell = document.querySelector(`.rain-cell[data-r="${r0 + dr}"][data-c="${c0 + dc}"]`);
      if (cell) cell.value = val.trim();
    }),
  );
  readRainGrid();
}
export function readRainGrid() {
  const w = activeStations();
  S.rainValues = {};
  document.querySelectorAll(".rain-cell").forEach((inp) => {
    const r = +inp.dataset.r,
      c = +inp.dataset.c;
    if (!w[r]) return;
    const name = w[r].name;
    if (!S.rainValues[name]) S.rainValues[name] = Array(7).fill(null);
    const t = inp.value.trim().replace(",", ".");
    S.rainValues[name][c] = t === "" || isNaN(+t) ? null : +t;
  });
  recalcRain();
}
export function recalcRain() {
  recolorThiessen();
  const w = activeStations();
  const sums = Array(7).fill(null);
  for (let c = 0; c < 7; c++) {
    let s = 0,
      valid = w.length > 0;
    w.forEach((t) => {
      const v = ((S.rainValues && S.rainValues[t.name]) || [])[c];
      if (v == null) valid = false;
      else s += t.agirlik * v;
    });
    if (valid) sums[c] = s;
  }
  const ok = sums.slice(0, 6).every((v) => v != null);
  S.P24w = ok ? { 2: sums[0], 5: sums[1], 10: sums[2], 25: sums[3], 50: sums[4], 100: sums[5] } : null;
  S.OETw = sums[6];
  for (let i = 0; i < 7; i++) {
    const el = $("rw" + i);
    if (el) el.innerHTML = sums[i] == null ? "—" : `<b>${sums[i].toFixed(2)}</b>`;
  }
  if (ok) {
    setStatus(
      "rainStatus",
      S.OETw == null ? "⚠ OEY sütunu boş: OET/QOET hesapları 0 kabul edilir" : "Ağırlıklı yağışlar hazır",
      S.OETw == null ? "err" : "ok",
    );
    markDone(3);
  } else if (w.length) {
    setStatus("rainStatus", "Tüm istasyonlar için P2..P100 değerlerini girin", "");
  }
  updateComputeReady();
}
export async function mgmDbListesi() {
  if (S.mgmDbYakin || !S.havza) return S.mgmDbYakin || [];
  const c = S.havza.coordinates || [];
  const pts = S.havza.type === "MultiPolygon" ? c.flat(2) : c.flat(1);
  const lats = pts.map((p) => p[1]),
    lons = pts.map((p) => p[0]);
  const t = 1.0; // ~110 km — havza dışındaki yakın istasyonlar da seçilebilsin
  try {
    const d = await api(
      `/api/mgm?bati=${Math.min(...lons) - t}&guney=${Math.min(...lats) - t}` +
        `&dogu=${Math.max(...lons) + t}&kuzey=${Math.max(...lats) + t}&en_az_yil=10`,
    );
    S.mgmDbYakin = d.istasyonlar || [];
  } catch (e) {
    S.mgmDbYakin = [];
  }
  let dl = document.getElementById("mgmDbList");
  if (!dl) {
    dl = document.createElement("datalist");
    dl.id = "mgmDbList";
    document.body.appendChild(dl);
  }
  dl.innerHTML = S.mgmDbYakin
    .map((s) => `<option value="${s.ad} (${s.kod})">${s.il} · ${s.yil_sayisi} yıl</option>`)
    .join("");
  return S.mgmDbYakin;
}
export function fillRainRowFromP24(r, P24) {
  ["2", "5", "10", "25", "50", "100"].forEach((k, c) => {
    const cell = document.querySelector(`.rain-cell[data-r="${r}"][data-c="${c}"]`);
    if (cell && P24 && P24[k] != null) cell.value = P24[k];
  });
  readRainGrid();
}
export async function mgmSatirBagla(t, r, kod) {
  const f = await api("/api/mgm-frekans", { kod });
  t._mgmKod = kod;
  // "AD (KOD)" biçimi otomatik eşleştirmeyle aynı: satır yeniden seçildiğinde
  // ayrıştırıcı kodu buradan okuyor, ad tek başına belirsiz olabiliyor.
  t._mgmAd = `${(f.istasyon_bilgi || {}).ad || kod} (${kod})`;
  t._mgmBilgi = { yil_sayisi: f.parametreler.yil_sayisi, dagilim: f.kabul_edilen_adi, yontem: "elle" };
  S.rainMeta = S.rainMeta || {};
  S.rainMeta[t.name] = t._mgmBilgi;
  fillRainRowFromP24(r, f.P24);
  return f;
}
