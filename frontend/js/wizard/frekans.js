import { S } from "../core/state.js";
import { api } from "../core/api.js";
import { fmt } from "../core/format.js";
import { $, setStatus } from "../ui/dom.js";
import { map, layers } from "../map/init.js";

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
/* Grubbs-Beck aykırı testi + aykırısız karşılaştırma.
   Aykırılar OTOMATİK ATILMAZ. Bulletin 17B, yüksek aykırıyı hatalı olduğu
   kanıtlanmadıkça seride tutmayı söyler: o değer üst kuyruk hakkındaki en
   bilgilendirici gözlemdir ve atılması tasarım debisini emniyetsiz tarafa
   çeker. Burada iki sonuç yan yana konur, karar mühendisindir. */
function tfaAykiriBlok(o) {
  const a = o.aykiri;
  if (!a) return "";
  if (!a.uygulanabilir)
    return `<p class="small">Aykırı değer testi (Grubbs-Beck) uygulanamadı: ${a.neden}</p>`;
  const y = a.yuksek || [], d = a.dusuk || [];
  let h = `<p class="small"><b>Aykırı değer testi (Grubbs-Beck, Bulletin 17B)</b> — `
    + `n=${a.n}, K<sub>n</sub>=${fmt(a.kn, 3)}, `
    + `üst sınır ${fmt(a.ust_sinir, 1)} · alt sınır ${fmt(a.alt_sinir, 1)} m³/s</p>`;
  if (!y.length && !d.length)
    return h + `<p class="small">Aykırı değer yok — seri sınırlar içinde.</p>`;
  h += `<p class="small">`
    + (y.length ? `<b>Yüksek aykırı:</b> ${y.map(v => fmt(v, 1)).join(", ")} m³/s. ` : "")
    + (d.length ? `<b>Düşük aykırı:</b> ${d.map(v => fmt(v, 1)).join(", ")} m³/s. ` : "")
    + `</p>`;
  if (y.length) h += `<div class="warn small">⚠ ${a.uyari}</div>`;

  const ay = o.aykirisiz;
  if (o.aykirisiz_hata) return h + `<p class="small">${o.aykirisiz_hata}</p>`;
  if (!ay) return h + `<p class="small">Aykırısız sonucu görmek için `
    + `"aykırıları çıkarıp karşılaştır" kutusunu işaretleyin.</p>`;

  const T = o.tekerrur, bas = (t) => `<th style="text-align:right">${t}</th>`;
  const sag = (v) => `<td style="text-align:right">${fmt(v, 1)}</td>`;
  h += `<p class="small"><b>Aykırılı ↔ aykırısız karşılaştırma (kabul edilen dağılım)</b></p>`
    + `<table class="tbl small"><tr><th>Durum</th><th>n</th><th>Dağılım</th>`
    + T.map(bas).join("") + `</tr>`
    + `<tr><td>aykırılı</td><td>${o.parametreler.yil_sayisi}</td>`
    + `<td>${o.kabul_edilen_adi}</td>` + (o.kabul_edilen_q || []).map(sag).join("") + `</tr>`
    + `<tr><td>aykırısız</td><td>${ay.parametreler.yil_sayisi}</td>`
    + `<td>${ay.kabul_edilen_adi}</td>` + (ay.kabul_edilen_q || []).map(sag).join("") + `</tr>`
    + `<tr class="sel"><td colspan="3"><b>fark</b></td>`
    + T.map((t, i) => {
        const a1 = (o.kabul_edilen_q || [])[i], a2 = (ay.kabul_edilen_q || [])[i];
        if (a1 == null || a2 == null || !a1) return `<td></td>`;
        const p = (a2 / a1 - 1) * 100;
        return `<td style="text-align:right">${p >= 0 ? "+" : ""}${p.toFixed(1)}%</td>`;
      }).join("") + `</tr></table>`;
  return h;
}

function tfaCiz(o) {
  const T = o.tekerrur;
  const bas = (h) => `<th style="text-align:right">${h}</th>`;
  let h = `<h3 class="small">${o.istasyon}</h3>`;

  // Elenen kayıtlar sonucun EN BAŞINDA gösterilir. Sessizce elemek, sessizce
  // dahil etmek kadar kötü olurdu: D24A029'un bozuk 1981 kaydı Q100'ü 1301
  // yerine 7314 m³/s yapıyordu ve bunu kimse görmüyordu.
  const el = o.elenen_kayitlar || [];
  if (el.length) {
    h += `<div class="warn small"><b>⚠ ${el.length} kayıt analiz dışı bırakıldı</b>`
      + ` — fiziksel olarak olanaksız bulundu (eski yıllıkların çıkarımında bozulmuş):<ul>`
      + el.map(k => `<li><b>${k.yil}: ${fmt(k.q, 1)} m³/s</b> — ${k.sebep}</li>`).join("")
      + `</ul>Analize dahil etmek isterseniz "olanaksız kayıtları at" kutusunu kaldırın;`
      + ` sonuç büyük olasılıkla aşırı yüksek çıkar.</div>`;
  }
  h += tfaAykiriBlok(o);

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
      olanaksizi_at: $("tfaOlanaksizAt") ? $("tfaOlanaksizAt").checked : true,
      aykiri_disla: $("tfaAykiriAt") ? $("tfaAykiriAt").checked : false,
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
   Sonuç, 3. adımdaki OET yağış satırına yazılınca QOET (muhtemel maksimum
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
      + "↧ Bu değeri 3. adımdaki OET yağışına yaz</button></div>";
    $("btnMmyOet").onclick = () => {
      const hedef = document.querySelector('[data-rain-oet], #inpP24OET');
      if (hedef) { hedef.value = fmt(o.mmy, 1); setStatus("mmyStatus", "OET yağışı güncellendi.", "ok"); }
      else {
        navigator.clipboard?.writeText(fmt(o.mmy, 1));
        setStatus("mmyStatus", `MMY = ${fmt(o.mmy, 1)} mm panoya kopyalandı — `
          + "3. adımdaki yağış tablosunda OET satırına yapıştırın.", "ok");
      }
    };
    setStatus("mmyStatus", `MMY = ${fmt(o.mmy, 1)} mm `
      + `(N=${o.yil_sayisi}, Km=${fmt(o.km, 3)}).`, "ok");
  } catch (e) {
    setStatus("mmyStatus", "MMY hesaplanamadı: " + e.message, "err");
  }
};

export { agiYukle, agiListele, agiSec, agiKatmanAc, tfaAykiriBlok, tfaCiz, btfaHomojenCiz, btfaCiz };
