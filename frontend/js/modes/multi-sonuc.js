import { S } from "../core/state.js";
import { fmt } from "../core/format.js";
import { $, download } from "../ui/dom.js";
import { M_LABEL } from "../core/constants.js";
import { cmpInterp } from "../wizard/grafik.js";

let _multiChart = null;

const MRP = ["2", "5", "10", "25", "50", "100", "OET"];
/* === extracted to core/constants.js M_LABEL === */function _envPeak(res, rp) {
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
    h += `<tr><td>${x.ad}</td>` + x.t.paylar.map((p) =>
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
    if (cl) cl.onclick = async () => { S.multiRes = {}; const m = await import("./multi.js"); await m.reRouteMulti(); };
  }
  $("btnMcmp").onclick = openMcmp;
  $("btnResMulti").onclick = async () => { const m = await import("./rezervuar.js"); m.openReservoir(); };
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
  if (_multiChart) _multiChart.destroy();
  _multiChart = new Chart($("chart"), {
    type: "line", data: { labels, datasets: ds },
    options: {
      animation: false, maintainAspectRatio: false,
      scales: { x: { title: { display: true, text: "T (saat)" } }, y: { title: { display: true, text: "Q (m³/s)" }, beginAtZero: true } },
      plugins: { legend: { position: "bottom", labels: { boxWidth: 18 } } },
    },
  });
}



export { MRP, _envPeak, profilTani, parChart, openParams, renderMultiResults, mcmpChart, mcmpState, M_COLORS, openMcmp, mcmpRpOptions, renderMcmp, _mkChart, renderMcmpBilesen, renderMcmpPik, renderMcmpHidro, exportMultiCsv, showMultiChart };
