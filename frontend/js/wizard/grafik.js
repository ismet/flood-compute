/**
 * @fileoverview Grafik ve karşılaştırma — chartwrap, cmp, hidrograf çizimleri.
 * @module wizard/grafik
 * Owns: S.cmpCoords (cmpState module-local)
 * Exports: chartwrap helpers, cmpInterp, openCompare, showChart, showSnyderChart, cmpPeak
 * Notes: Rank 2 (wizard). CMP_* lokal.
 */

import { S } from "../core/state.js";
import { $ } from "../ui/dom.js";
import { fmt } from "../core/format.js";
import { download } from "../ui/dom.js";
import { DURS, RPS, CMP_LABELS, CMP_RPS } from "../core/constants.js";

/* ================= YÖNTEM KARŞILAŞTIRMA ================= */
const CMP_COLORS = { dsi: "#2a9d8f", mockus: "#e07b3a", rasyonel: "#7b1fa2", snyder: "#c73e3a" };
/* === extracted to core/constants.js CMP_LABELS === */ /* === extracted to core/constants.js CMP_RPS === */ const CMP_HYDRO_RPS =
  ["2", "5", "10", "25", "50", "100", "OET"]; // gerçek/üçgen hidrograf olanlar
let cmpChart = null,
  cmpState = { tab: "pik", rp: "100", methods: {}, K: "K1" };

function cmpAvailable() {
  const r = S.sonuc,
    m = {};
  if (r.kabulet) m.dsi = true;
  if (r.mockus) m.mockus = true;
  if (r.rasyonel) m.rasyonel = true;
  if (r.snyder) m.snyder = true;
  return m;
}

// bir yöntem + tekerrür için pik debi (m³/s); yoksa null
function cmpPeak(method, rp) {
  const r = S.sonuc;
  if (method === "dsi") {
    // KABULET zarfı: süreler içinde en büyük
    let mx = null;
    DURS.forEach((d) => {
      const v = r.kabulet[d]?.[rp];
      if (v != null) mx = mx == null ? v : Math.max(mx, v);
    });
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
  const r = S.sonuc,
    qbaz = r.girdi_ozeti?.Qbaz || 0;
  if (method === "dsi") {
    if (!CMP_HYDRO_RPS.includes(rp)) return null;
    let best = null,
      bestPk = -1;
    DURS.forEach((d) => {
      const pk = r.kabulet[d]?.[rp];
      if (pk != null && pk > bestPk) {
        bestPk = pk;
        best = d;
      }
    });
    const arr = r.dsi.hidrograflar[best]?.[rp];
    if (!arr) return null;
    return { points: arr.map((y, i) => ({ x: i * 0.5, y })), synthetic: false, note: `hakim süre ${best} sa` };
  }
  if (method === "snyder") {
    const arr = r.snyder?.hidrograflar?.[rp];
    if (!arr) return null;
    return { points: arr.map((y, i) => ({ x: i, y })), synthetic: false, note: "saatlik" };
  }
  if (method === "mockus") {
    const pk = cmpPeak("mockus", rp);
    if (pk == null) return null;
    const Tp = r.mockus.Tp,
      base = qbaz,
      top = rp === "OET" ? pk + qbaz : pk; // OET'te baz akım yok
    const tb = 2.67 * Tp;
    return {
      points: [
        { x: 0, y: base },
        { x: Tp, y: top },
        { x: tb, y: base },
      ],
      synthetic: true,
      note: "üçgen (Tp, SCS taban)",
    };
  }
  if (method === "rasyonel") {
    const pk = cmpPeak("rasyonel", rp);
    if (pk == null) return null;
    const Tc = r.rasyonel.Tc_saat,
      Tb = Math.max(r.rasyonel.Tb_saat, 2 * Tc);
    return {
      points: [
        { x: 0, y: qbaz },
        { x: Tc, y: qbaz + pk },
        { x: Tb, y: qbaz },
      ],
      synthetic: true,
      note: "üçgen (Tc–Tb)",
    };
  }
  return null;
}

function openCompare() {
  if (!S.sonuc) return;
  const avail = cmpAvailable();
  if (!Object.keys(avail).length) return;
  // idempotent on spam: if already open and not requested to re-render, still refresh data
  // but keep rendering to reflect latest S.sonuc (e.g., after compute while on 6)
  cmpState.methods = {};
  Object.keys(avail).forEach((k) => (cmpState.methods[k] = true));
  // tekerrür seçici
  const rpSel = $("cmpRP");
  rpSel.innerHTML = CMP_RPS.map(
    (t) => `<option value="${t}" ${t === cmpState.rp ? "selected" : ""}>Q${t}</option>`,
  ).join("");
  rpSel.onchange = () => {
    cmpState.rp = rpSel.value;
    renderCompare();
  };
  $("cmpK").onchange = () => {
    cmpState.K = $("cmpK").value;
    renderCompare();
  };
  $("cmpK").parentElement.style.display = avail.mockus ? "" : "none";
  // yöntem onay kutuları
  $("cmpMethods").innerHTML = Object.keys(avail)
    .map(
      (k) =>
        `<label><input type="checkbox" data-m="${k}" checked>
      <span class="swatch" style="background:${CMP_COLORS[k]}"></span>${CMP_LABELS[k]}</label>`,
    )
    .join("");
  $("cmpMethods")
    .querySelectorAll("input")
    .forEach(
      (inp) =>
        (inp.onchange = () => {
          cmpState.methods[inp.dataset.m] = inp.checked;
          renderCompare();
        }),
    );
  // sekmeler
  document.querySelectorAll(".cmp-tab").forEach(
    (b) =>
      (b.onclick = () => {
        document.querySelectorAll(".cmp-tab").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        cmpState.tab = b.dataset.tab;
        renderCompare();
      }),
  );
  $("cmpWrap").classList.remove("hidden");
  renderCompare();
}
$("btnCloseCmp").onclick = () => $("cmpWrap").classList.add("hidden");

function renderCompare() {
  const active = Object.keys(cmpState.methods).filter((k) => cmpState.methods[k]);
  document.querySelector(".cmp-mockusk").style.display = active.includes("mockus") ? "" : "none";
  // hidrograf sekmesinde yalnız gerçek hidrografı olan tekerrürler seçilebilir
  const opts = cmpState.tab === "hidro" ? CMP_HYDRO_RPS : CMP_RPS;
  if (!opts.includes(cmpState.rp)) cmpState.rp = "100";
  const rpSel = $("cmpRP");
  rpSel.innerHTML = opts
    .map((t) => `<option value="${t}" ${t === cmpState.rp ? "selected" : ""}>Q${t}</option>`)
    .join("");
  if (cmpState.tab === "pik") renderCmpPeaks(active);
  else renderCmpHydro(active);
}

function renderCmpPeaks(active) {
  // grafik: seçili tekerrür için yöntem bazında bar
  const rp = cmpState.rp;
  const labels = active.map((m) => CMP_LABELS[m]);
  const data = active.map((m) => cmpPeak(m, rp));
  if (cmpChart) cmpChart.destroy();
  cmpChart = new Chart($("cmpChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: `Q${rp} piki (m³/s)`, data, backgroundColor: active.map((m) => CMP_COLORS[m]) }],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, title: { display: true, text: `Q${rp} pik debileri` } },
      scales: { y: { title: { display: true, text: "Q (m³/s)" }, beginAtZero: true } },
    },
  });
  // tablo: yöntem × tüm tekerrürler
  let h = `<table class="tbl"><tr><th>Yöntem</th>` + CMP_RPS.map((t) => `<th>Q${t}</th>`).join("") + `</tr>`;
  active.forEach((m) => {
    h +=
      `<tr><td style="border-left:4px solid ${CMP_COLORS[m]}">${CMP_LABELS[m]}${m === "mockus" ? " (" + cmpState.K + ")" : ""}</td>` +
      CMP_RPS.map((t) => {
        const v = cmpPeak(m, t);
        return `<td class="${t === rp ? "max" : ""}">${v == null ? "—" : fmt(v, 1)}</td>`;
      }).join("") +
      `</tr>`;
  });
  // yöntemler arası oran (min-maks) satırı
  h +=
    `<tr><td><b>maks/min</b></td>` +
    CMP_RPS.map((t) => {
      const vs = active.map((m) => cmpPeak(m, t)).filter((v) => v != null && v > 0);
      if (vs.length < 2) return `<td>—</td>`;
      return `<td>${fmt(Math.max(...vs) / Math.min(...vs), 2)}×</td>`;
    }).join("") +
    `</tr></table>
    <div class="small">Değerler m³/s. DSİ = süreler içindeki en büyük pik (KABULET zarfı).
    Mockus K katsayısı üstten seçilir. Rasyonel'de OET yoktur.</div>`;
  $("cmpTable").innerHTML = h;
}

function renderCmpHydro(active) {
  const rp = cmpState.rp;
  const ds = [];
  active.forEach((m) => {
    const hy = cmpHydro(m, rp);
    if (!hy) return;
    ds.push({
      label: CMP_LABELS[m] + (hy.synthetic ? " ⚠" : ""),
      data: hy.points,
      borderColor: CMP_COLORS[m],
      backgroundColor: CMP_COLORS[m],
      borderWidth: 1.8,
      borderDash: hy.synthetic ? [6, 4] : [],
      pointRadius: 0,
      tension: hy.synthetic ? 0 : 0.25,
    });
  });
  if (cmpChart) cmpChart.destroy();
  cmpChart = new Chart($("cmpChart"), {
    type: "line",
    data: { datasets: ds },
    options: {
      animation: false,
      maintainAspectRatio: false,
      parsing: false,
      plugins: { legend: { position: "bottom" }, title: { display: true, text: `Q${rp} taşkın hidrografları` } },
      scales: {
        x: { type: "linear", title: { display: true, text: "T (saat)" } },
        y: { title: { display: true, text: "Q (m³/s)" }, beginAtZero: true },
      },
    },
  });
  // tablo: pik ve pike varış özeti
  let h = `<table class="tbl"><tr><th>Yöntem</th><th>Pik Q</th><th>Pike varış</th><th>Tip</th></tr>`;
  active.forEach((m) => {
    const hy = cmpHydro(m, rp);
    if (!hy) {
      h += `<tr><td>${CMP_LABELS[m]}</td><td colspan="3">—</td></tr>`;
      return;
    }
    let pk = -1,
      tpk = 0;
    hy.points.forEach((p) => {
      if (p.y > pk) {
        pk = p.y;
        tpk = p.x;
      }
    });
    h +=
      `<tr><td style="border-left:4px solid ${CMP_COLORS[m]}">${CMP_LABELS[m]}</td>` +
      `<td>${fmt(pk, 1)}</td><td>${fmt(tpk, 1)} sa</td><td>${hy.synthetic ? "üçgen*" : "gerçek"}</td></tr>`;
  });
  h += `</table><div class="small">⚠/* = Mockus ve Rasyonel pik yöntemleridir; hidrografları
    üçgen yaklaşımla (kesikli çizgi) gösterilir. DSİ ve Snyder gerçek süperpozisyon
    hidrograflarıdır. Q500/1000/10000 yalnız pik olduğundan burada yoktur.</div>`;

  // ---- hidrograf koordinatları (ortak zaman eksenine interpole) ----
  const series = active.map((m) => ({ m, hy: cmpHydro(m, rp) })).filter((x) => x.hy);
  if (series.length) {
    const maxT = Math.max(...series.map((s) => s.hy.points[s.hy.points.length - 1].x));
    const dt = maxT > 60 ? 2 : 1;
    S.cmpCoords = { rp, dt, headers: ["T (saat)", ...series.map((s) => `${CMP_LABELS[s.m]} Q${rp} (m3/s)`)], rows: [] };
    let ch =
      `<h3 class="res" style="margin-top:10px">Hidrograf Koordinatları (Q${rp})</h3>
      <div class="export-row"><button id="btnCmpCsv">⬇ Koordinat CSV</button>
      <span class="small">interpolasyon adımı ${dt} sa</span></div>
      <table class="tbl"><tr><th>T (saat)</th>` +
      series.map((s) => `<th style="border-bottom:3px solid ${CMP_COLORS[s.m]}">${CMP_LABELS[s.m]}</th>`).join("") +
      `</tr>`;
    for (let t = 0; t <= maxT + 1e-9; t += dt) {
      const vals = series.map((s) => cmpInterp(s.hy.points, t));
      S.cmpCoords.rows.push([t.toFixed(1), ...vals.map((v) => (v == null ? "" : v.toFixed(2)))]);
      ch += `<tr><td>${fmt(t, 1)}</td>` + vals.map((v) => `<td>${v == null ? "—" : fmt(v, 2)}</td>`).join("") + `</tr>`;
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
      const a = points[i - 1],
        b = points[i];
      if (b.x === a.x) return b.y;
      return a.y + ((b.y - a.y) * (t - a.x)) / (b.x - a.x);
    }
  }
  return points[points.length - 1].y;
}

function exportCmpCoords() {
  if (!S.cmpCoords) return;
  const rows = [S.cmpCoords.headers, ...S.cmpCoords.rows];
  download(`hidrograf_koordinatlari_Q${S.cmpCoords.rp}.csv`, rows.map((r) => r.join(";")).join("\n"));
}

/* ---------------- hidrograf grafiği ---------------- */
let chart = null;
function showChart(dur) {
  $("chartwrap").classList.remove("hidden");
  const sel = $("chartDur");
  sel.innerHTML = DURS.map((d) => `<option value="${d}" ${d === dur ? "selected" : ""}>${d} saat</option>`).join("");
  sel.onchange = () => showChart(+sel.value);
  const hy = S.sonuc.dsi.hidrograflar[dur];
  const colors = {
    2: "#9db5b2",
    5: "#64b5aa",
    10: "#2a9d8f",
    25: "#d9a441",
    50: "#e07b3a",
    100: "#c73e3a",
    OET: "#5e2d48",
  };
  const dt = 0.5;
  const n = Math.max(...RPS.map((rp) => hy[rp].length));
  const labels = Array.from({ length: n }, (_, i) => (i * dt).toFixed(1));
  const ds = RPS.map((rp) => ({
    label: "Q" + rp,
    data: hy[rp],
    borderColor: colors[rp],
    borderWidth: 1.6,
    pointRadius: 0,
    tension: 0.25,
  }));
  if (chart) chart.destroy();
  chart = new Chart($("chart"), {
    type: "line",
    data: { labels, datasets: ds },
    options: {
      animation: false,
      maintainAspectRatio: false,
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
  const colors = {
    2: "#9db5b2",
    5: "#64b5aa",
    10: "#2a9d8f",
    25: "#d9a441",
    50: "#e07b3a",
    100: "#c73e3a",
    OET: "#5e2d48",
  };
  const n = Math.max(...SNY_RPS.map((rp) => hy[rp].length));
  const labels = Array.from({ length: n }, (_, i) => i.toString());
  const ds = SNY_RPS.map((rp) => ({
    label: "Q" + rp,
    data: hy[rp],
    borderColor: colors[rp],
    borderWidth: 1.6,
    pointRadius: 0,
    tension: 0.25,
  }));
  if (chart) chart.destroy();
  chart = new Chart($("chart"), {
    type: "line",
    data: { labels, datasets: ds },
    options: {
      animation: false,
      maintainAspectRatio: false,
      scales: { x: { title: { display: true, text: "T (saat)" } }, y: { title: { display: true, text: "Q (m³/s)" } } },
      plugins: { legend: { position: "bottom", labels: { boxWidth: 18 } } },
    },
  });
}
$("btnCloseChart").onclick = () => $("chartwrap").classList.add("hidden");

export { openCompare, showChart, showSnyderChart, cmpPeak, cmpInterp, cmpHydro, cmpAvailable };
