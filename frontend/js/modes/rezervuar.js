/**
 * @fileoverview Rezervuar öteleme UI + memba atama (Storage-Indication).
 * @module modes/rezervuar
 * Owns: S.resDefaults, S.resConDefaults, S.resPoints, S.resSonuc, S.resMarker, S.resVolGrid, S.ratGrid; S.multiRes[i] cross-write
 * Exports: openReservoir
 * Notes:
 *  - Allowed pull (§3.1): rezervuar→multi (reRouteMulti)
 *  - Rank 2 (modes).
 */

import { S } from "../core/state.js";
import { api } from "../core/api.js";
import { fmt, _esc } from "../core/format.js";
import { $, download } from "../ui/dom.js";
import { map } from "../map/init.js";
import { M_LABEL } from "../core/constants.js";
import { makePasteGrid, readGridNums } from "../ui/paste-grid.js";
import { reRouteMulti } from "./multi.js";

/* ================= REZERVUAR (HAZNE) ÖTELEMESİ ================= */

async function loadReservoirDefaults() {
  try {
    S.resDefaults = await api("/api/reservoir-defaults");
  } catch (e) {
    S.resDefaults = null;
  }
  try {
    S.resConDefaults = await api("/api/reservoir-controlled-defaults");
  } catch (e) {
    S.resConDefaults = null;
  }
}
loadReservoirDefaults();

const RES_RP = ["2", "5", "10", "25", "50", "100", "OET"];

// Rezervuar atanabilecek noktalar: outlet (tek havza), memba/mansap (ara havza)
function reservoirPoints() {
  const pts = [];
  if (S.sonuc && S.sonuc.dsi && S.outlet)
    pts.push({
      ad: "Outlet (havza çıkışı)",
      ll: { lat: S.outlet.snap_lat ?? S.outlet.lat, lon: S.outlet.snap_lon ?? S.outlet.lon },
      kind: "compute",
      res: S.sonuc,
    });
  if (S.multiSonuc) {
    const md = S.multiSonuc.md;
    S.multiSonuc.membaC.forEach((x, i) => {
      const o = md.membalar[i].outlet;
      pts.push({
        ad: "Memba " + (i + 1),
        ll: { lat: o.snap_lat ?? o.lat, lon: o.snap_lon ?? o.lon },
        kind: "compute",
        res: x.res,
        membaIndex: i,
      });
    });
    const mo = md.mansap.outlet;
    pts.push({
      ad: "Mansap (ötelenmiş)",
      ll: { lat: mo.snap_lat ?? mo.lat, lon: mo.snap_lon ?? mo.lon },
      kind: "routed",
      rt: S.multiSonuc.rt,
    });
  }
  return pts;
}
function reservoirMethods(pt) {
  if (pt.kind === "routed") return Object.keys(pt.rt.yontemler);
  const m = ["dsi"];
  if (pt.res.snyder) m.push("snyder");
  return m;
}
function reservoirInflow(pt, method, rp) {
  if (pt.kind === "routed") {
    const y = pt.rt.yontemler[method];
    return y && y.hidrograflar[rp] ? { data: y.hidrograflar[rp], dt: y.dt || 0.5 } : null;
  }
  if (method === "dsi") {
    let best = null,
      pk = -1;
    [2, 4, 6, 8, 12, 18, 24].forEach((d) => {
      const v = pt.res.kabulet[d] && pt.res.kabulet[d][rp];
      if (v != null && v > pk) {
        pk = v;
        best = d;
      }
    });
    return best != null ? { data: pt.res.dsi.hidrograflar[best][rp], dt: 0.5, note: `hakim ${best} sa` } : null;
  }
  if (method === "snyder" && pt.res.snyder) return { data: pt.res.snyder.hidrograflar[rp], dt: 1 };
  return null;
}

export function openReservoir() {
  const pts = reservoirPoints();
  if (!pts.length) {
    alert("Önce bir hidrograf hesaplayın (Tek Havza → HESAPLA, veya Ara Havza → Hesapla ve Ötele)");
    return;
  }
  S.resPoints = pts;
  $("resPoint").innerHTML = pts.map((p, i) => `<option value="${i}">${p.ad}</option>`).join("");
  const fillMethodRP = () => {
    const pt = pts[+$("resPoint").value];
    const ms = reservoirMethods(pt);
    $("resMethod").innerHTML = ms.map((m) => `<option value="${m}">${M_LABEL[m]}</option>`).join("");
    $("resRP").innerHTML = RES_RP.map((rp) => `<option value="${rp}">Q${rp}</option>`).join("");
    $("resRP").value = "100";
    showResMarker(pt);
  };
  $("resPoint").onchange = fillMethodRP;
  fillMethodRP();
  // rezervuar varsayılanları
  const D = S.resDefaults,
    K = S.resConDefaults;
  if (D) {
    $("resKret").value = D.kret_kotu;
    $("resYtk").value = D.yaklasim_taban_kotu;
    $("resApron").value = D.apron_giris_acisi_derece || 0;
    $("resL").value = 40;
    $("resC").value = 2.1;
  }
  if (K) {
    $("resSill").value = K.esik_kotu;
    $("resLef").value = K.lef;
    $("resH0").value = K.nss;
    $("resHmax").value = K.nss + 3;
    $("resW1").value = K.taban_debi_W1;
  }
  // rating grid (bir kez kur, kalıcı) — He, Q kopyala-yapıştır
  S.ratGrid = makePasteGrid(
    "resRatingGrid",
    "btnResRatAdd",
    "btnResRatClear",
    ["He (m)", "Q (m³/s)"],
    (D && D.dolusavak_rating.veri) || [],
  );
  const buildGrids = () => {
    const kap = $("resType").value === "kapakli";
    $("resUncon").classList.toggle("hidden", kap);
    $("resCon").classList.toggle("hidden", !kap);
    const volDef = kap ? K && K.hacim_satih.veri : D && D.hacim_satih.veri;
    S.volGrid = makePasteGrid(
      "resVolGrid",
      "btnResVolAdd",
      "btnResVolClear",
      kap ? ["Kot (m)", "Hacim (hm³)"] : ["Kot (m)", "Alan (km²)", "Hacim (hm³)"],
      volDef || [],
    );
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
    const P = +$("resKret").value - +$("resYtk").value;
    $("resPhInfo").innerHTML =
      auto && isFinite(P) && P > 0
        ? `P = kret − yak.taban = <b>${P.toFixed(1)} m</b> → C, USBR P/h eğrisinden türetilir`
        : auto
          ? "P için kret ve yak. taban kotu girin"
          : "";
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
  if (!pt || !pt.ll) {
    $("resPointInfo").textContent = "";
    return;
  }
  if (S.resMarker) S.resMarker.remove();
  // rezervuar atanan nokta mor gösterilir; canlı katman projeye kaydedilmez
  // (proje.js buildDurumS strip eder)
  S.resMarker = L.circleMarker([pt.ll.lat, pt.ll.lon], {
    radius: 9,
    color: "#6a1b9a",
    weight: 3,
    fillColor: "#9c27b0",
    fillOpacity: 0.85,
  })
    .addTo(map)
    .bindTooltip("🏞 Rezervuar: " + pt.ad, { permanent: false });
  $("resPointInfo").innerHTML =
    `🏞 Rezervuar <b>${pt.ad}</b> noktasına atandı (${pt.ll.lat.toFixed(4)}, ${pt.ll.lon.toFixed(4)}). Bu noktadaki hidrograf haznede ötelenecek. <span style="color:#6a1b9a">●</span> nokta harita üzerinde <b>mor</b> ile işaretlendi.`;
}

/* ---- Genel editlenebilir + kopyala-yapıştır tablo fabrikası ---- */
/* === extracted to ui/paste-grid.js makePasteGrid === */ /* === extracted to ui/paste-grid.js readGridNums === */
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
        inflow: src.data,
        dt_saat: src.dt,
        hacim_satih: vol,
        esik_kotu: +$("resSill").value,
        lef: +$("resLef").value,
        baslangic_kotu: +$("resH0").value,
        maks_su_kotu: +$("resHmax").value,
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
      } else {
        body.yaklasim_taban_kotu = +$("resYtk").value;
        body.apron_giris_acisi = +$("resApron").value || 0;
        body.kret_uzunlugu = +$("resL").value || 40;
        body.debi_katsayisi = $("resCauto").checked ? null : +$("resC").value || 2.1;
      }
      r = await api("/api/reservoir-route", body);
    }
    const label = `${pt.ad} — ${M_LABEL[$("resMethod").value]} Q${$("resRP").value}${src.note ? " (" + src.note + ")" : ""}`;
    S.resSonuc = { r, src, label };
    renderReservoir();
  } catch (e) {
    $("resTable").innerHTML = `<div class="small err">Hata: ${e.message}</div>`;
  }
}

/* ---- Çok parçalı: memba noktasına hazne atama ----
   Hazne, o memba noktasının çıkışını sönümler; sönümlenmiş hidrograf
   mansaba taşındığı için aşağıdaki tüm noktaları etkiler.                  */
function buildResCfg() {
  const kap = $("resType").value === "kapakli";
  const vol = readGridNums(S.volGrid, kap ? 2 : 3);
  if (vol.length < 2) throw new Error("Kot–Hacim tablosu geçersiz (en az 2 dolu satır)");
  if (kap) {
    return {
      tip: "kapakli",
      hacim_satih: vol,
      esik_kotu: +$("resSill").value,
      lef: +$("resLef").value,
      baslangic_kotu: +$("resH0").value,
      maks_su_kotu: +$("resHmax").value,
      taban_debi: +$("resW1").value || 0,
      kapak_adedi: Math.max(1, +$("resNgate").value || 1),
      pik_sonrasi_bosalt: $("resDrain").checked,
    };
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
    cfg.debi_katsayisi = $("resCauto").checked ? null : +$("resC").value || 2.1;
  }
  return cfg;
}
async function assignReservoirToMemba() {
  const st = $("resMultiStatus");
  try {
    const pt = S.resPoints[+$("resPoint").value];
    if (!pt || pt.membaIndex == null) throw new Error("Bu özellik yalnız çok parçalı moddaki MEMBA noktaları içindir");
    if (!S.multiSonuc) throw new Error("Önce Ara Havza → ② Hesapla ve Ötele");
    S.multiRes = S.multiRes || {};
    S.multiRes[pt.membaIndex] = buildResCfg();
    st.textContent = "Hazne atandı, mansap yeniden ötelenıyor…";
    await reRouteMulti();
    st.textContent = `✓ ${pt.ad} noktasına hazne atandı; mansap hidrografı güncellendi.`;
  } catch (e) {
    st.textContent = "Hata: " + e.message;
  }
}
// atanmış hazneleri kullanarak ötelemeyi yeniden yapar (havzalar yeniden hesaplanmaz)

let resChart = null;
function renderReservoir() {
  const { r, label } = S.resSonuc,
    o = r.ozet;
  const src = { label };
  const kap = r._kapakli;
  const lab = r.t.map((t) => t.toFixed(1));
  const ds = [
    { label: "Giriş I", data: r.giris, borderColor: "#e07b3a", borderWidth: 1.8, pointRadius: 0, tension: 0.25 },
    {
      label: "Çıkış O (ötelenmiş)",
      data: r.cikis,
      borderColor: "#2a9d8f",
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.25,
    },
    {
      label: "Su kotu (m)",
      data: r.su_kotu,
      borderColor: "#7b1fa2",
      borderWidth: 1.2,
      borderDash: [4, 3],
      pointRadius: 0,
      yAxisID: "y2",
    },
  ];
  if (kap)
    ds.push({
      label: "Kapak açıklığı (m)",
      data: r.kapak_acikligi,
      borderColor: "#c73e3a",
      borderWidth: 1.2,
      borderDash: [2, 2],
      pointRadius: 0,
      yAxisID: "y3",
    });
  if (resChart) resChart.destroy();
  resChart = new Chart($("resChart"), {
    type: "line",
    data: { labels: lab, datasets: ds },
    options: {
      animation: false,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        title: { display: true, text: `${kap ? "Kapaklı (optimize) hazne" : "Hazne"} ötelemesi — ${src.label}` },
      },
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
    if (o.asim_uyarisi)
      h += `<tr><td colspan="2" class="small err">⚠ Depolama yetersiz: pass-through (O=I) bile maks kotu aşıyor; başlangıç kotunu düşürün veya maks kotu yükseltin.</td></tr>`;
    if (o.girdi_uyarisi) h += `<tr><td colspan="2" class="small err">⚠ ${o.girdi_uyarisi}</td></tr>`;
  } else {
    h += `<tr><td>Pik gecikmesi</td><td>${fmt(o.gecikme_saat, 0)} sa</td></tr>
    <tr><td>Maks su kotu</td><td><b>${fmt(o.maks_su_kotu, 2)}</b> m (kret+${fmt(o.maks_He, 2)} m)</td></tr>`;
    if (o.girdi_uyarisi)
      h += `<tr><td colspan="2" class="small err">⚠ ${_esc(o.girdi_uyarisi)}</td></tr>`;
    if (r.dolusavak_C && r.dolusavak_C.length) {
      // maks He'ye en yakın türetilen C (fiili tepe koşulu)
      const cAtPeak = r.dolusavak_C.reduce((a, b) => (Math.abs(b[0] - o.maks_He) < Math.abs(a[0] - o.maks_He) ? b : a));
      h += `<tr><td>Yaklaşım yüks. P</td><td>${fmt(r.yaklasim_P, 1)} m</td></tr>
      <tr><td>C (P/h, USBR)</td><td><b>${fmt(cAtPeak[1], 3)}</b> @ He=${fmt(cAtPeak[0], 2)} m
        <span class="small">(He=0.1→C=${fmt(r.dolusavak_C[0][1], 2)})</span></td></tr>`;
    }
  }
  h += `</table>`;
  if (kap)
    h += `<div class="small">Kapaklar; su kotu ≤ maks, çıkış ≤ giriş kısıtlarıyla çıkış piki minimum olacak şekilde
    işletilir (pik-tavan/peak-shaving; başlangıç–maks kotu arası depolama kullanılır).</div>`;
  h += `<button id="btnResCsv" class="small-btn">⬇ CSV (koordinatlar)</button>
    <table class="tbl"><tr><th>T (sa)</th><th>Giriş</th><th>Çıkış</th><th>Su kotu</th>${kap ? "<th>Kapak (m)</th>" : ""}</tr>`;
  const step = r.t.length > 80 ? 2 : 1;
  for (let i = 0; i < r.t.length; i += step)
    h += `<tr><td>${fmt(r.t[i], 1)}</td><td>${fmt(r.giris[i], 1)}</td><td>${fmt(r.cikis[i], 1)}</td><td>${fmt(r.su_kotu[i], 2)}</td>${kap ? `<td>${fmt(r.kapak_acikligi[i], 3)}</td>` : ""}</tr>`;
  h += `</table>`;
  $("resTable").innerHTML = h;
  $("btnResCsv").onclick = () => {
    const head = ["T_sa", "Giris_m3s", "Cikis_m3s", "SuKotu_m"];
    if (kap) head.push("Kapak_m");
    const rows = [head];
    for (let i = 0; i < r.t.length; i++) {
      const row = [r.t[i].toFixed(1), r.giris[i].toFixed(2), r.cikis[i].toFixed(2), r.su_kotu[i].toFixed(3)];
      if (kap) row.push(r.kapak_acikligi[i].toFixed(3));
      rows.push(row);
    }
    download(`hazne_oteleme_${src.label.replace(/[^\w]/g, "_")}.csv`, rows.map((x) => x.join(";")).join("\n"));
  };
}

export {
  loadReservoirDefaults,
  RES_RP,
  reservoirPoints,
  reservoirMethods,
  reservoirInflow,
  showResMarker,
  runReservoir,
  buildResCfg,
  assignReservoirToMemba,
  resChart,
  renderReservoir,
};
