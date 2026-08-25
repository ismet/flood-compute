/**
 * @fileoverview Su potansiyeli — AGİ günlük akımlar, periyot, tamamlama, taşıma.
 * @module modes/su
 * Owns: S.suSecili, S.suListe, S.suPeriyot, S.suTamam
 * Exports: suBaslat, suHavzaGuncelle
 * Notes:
 *  - Push reaction: onHavzaChanged(suHavzaGuncelle) ile havza değişimini dinler (§3.1 tek izinli push).
 *  - Rank 2 (modes).
 */

import { S, onHavzaChanged } from "../core/state.js";
import { api } from "../core/api.js";
import { fmt } from "../core/format.js";
import { $, setStatus } from "../ui/dom.js";
import { map, layers } from "../map/init.js";

/* ---------------- SU POTANSİYELİ ----------------
   Günlük akım serilerinden hacim odaklı değerlendirme. Taşkın tarafındaki
   AGİ katmanından ayrı bir veri tabanı (2909 istasyon, 1934-2015).        */
layers.su = L.layerGroup();
S.suSecili = new Set(); // periyot/regresyona girecek istasyonlar
S.suListe = [];

function suIsaretle() {
  layers.su.eachLayer((l) => {
    if (!l.su) return;
    const sec = S.suSecili.has(l.su.kod);
    const hedef = $("suHedef").value === l.su.kod;
    l.setStyle({
      radius: hedef ? 9 : sec ? 7 : 5,
      color: hedef ? "#000" : sec ? "#00695c" : "#78909c",
      weight: hedef ? 3 : sec ? 2.5 : 1.2,
      fillColor: l.su.icinde ? "#26a69a" : "#90a4ae",
      fillOpacity: 0.85,
    });
  });
  $("btnSuPeriyot").disabled = S.suSecili.size < 1;
  $("btnSuTamamla").disabled = !$("suHedef").value;
}

function suHedefDoldur() {
  const sec = $("suHedef"),
    onceki = sec.value;
  sec.innerHTML =
    '<option value="">— seçin —</option>' +
    S.suListe
      .filter((s) => S.suSecili.has(s.kod))
      .map(
        (s) =>
          `<option value="${s.kod}">${s.kod} — ${(s.ad || "").replace(/_/g, " ")}` +
          `${s.alan_km2 ? " (" + fmt(s.alan_km2, 0) + " km²)" : ""}</option>`,
      )
      .join("");
  sec.value = S.suSecili.has(onceki) ? onceki : "";
  suIsaretle();
}

function suHavzaGuncelle() {
  const a = +$("inpA").value;
  if (a && !$("suAlan").value) $("suAlan").value = a;
  $("suHavzaInfo").innerHTML = S.havza
    ? `Havza çıkarıldı — alan <b>${fmt(a, 2)} km²</b>` +
      (S.outlet
        ? ` · outlet ${fmt(S.outlet.snap_lat ?? S.outlet.lat, 5)}, ` + `${fmt(S.outlet.snap_lon ?? S.outlet.lon, 5)}`
        : "")
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
      $("suInfo").textContent =
        `${b.istasyon.toLocaleString("tr")} istasyon · ` +
        `${b.gun.toLocaleString("tr")} günlük kayıt · ${b.ilk_tarih}…${b.son_tarih}`;
    }
  } catch (e) {
    /* uç yoksa sessiz geç */
  }
}

/* 1) havza — taşkın modundaki çıkarımın aynısını kullanır */
$("btnSuHavza").onclick = () => {
  $("btnPick").click();
};

/* 3) civardaki AGİ'ler */
$("btnSuGetir").onclick = async () => {
  setStatus("suStatus", "AGİ'ler getiriliyor…", "loading");
  try {
    let r;
    if (S.havza) {
      r = await api("/api/su-havza", {
        geometri: S.havza.features ? S.havza.features[0].geometry : S.havza.geometry || S.havza,
        tampon_derece: +$("suTampon").value || 0,
        en_az_yil: +$("suEnAzYil").value || 5,
      });
    } else {
      const b = map.getBounds();
      const q = new URLSearchParams({
        bati: b.getWest(),
        guney: b.getSouth(),
        dogu: b.getEast(),
        kuzey: b.getNorth(),
        en_az_yil: +$("suEnAzYil").value || 5,
      });
      r = await api("/api/su-istasyon?" + q.toString());
    }
    S.suListe = r.istasyonlar;
    S.suSecili = new Set(r.istasyonlar.filter((s) => s.alan_km2).map((s) => s.kod));
    layers.su.clearLayers();
    r.istasyonlar.forEach((s) => {
      if (s.lat == null || s.lon == null) return;
      const m = L.circleMarker([s.lat, s.lon], { radius: 5 });
      m.su = s;
      m.bindTooltip(`${s.kod} — ${(s.ad || "").replace(/_/g, " ")}`, { sticky: true });
      m.on("click", () => {
        if (S.suSecili.has(s.kod)) S.suSecili.delete(s.kod);
        else S.suSecili.add(s.kod);
        suListele();
      });
      m.addTo(layers.su);
    });
    suListele();
    const ic = r.istasyonlar.filter((s) => s.icinde).length;
    setStatus(
      "suStatus",
      `${r.istasyonlar.length} istasyon` +
        (S.havza ? ` (${ic} tanesi havza içinde)` : "") +
        " — analize girecekleri işaretleyin.",
      "ok",
    );
  } catch (e) {
    setStatus("suStatus", "AGİ'ler getirilemedi: " + e.message, "err");
  }
};

function suListele() {
  const sat = (s) =>
    `<tr><td><input type="checkbox" class="su-cb" data-kod="${s.kod}"` +
    `${S.suSecili.has(s.kod) ? " checked" : ""}` +
    `${s.alan_km2 ? "" : " disabled title='yağış alanı yok — havzaya taşınamaz'"}></td>` +
    `<td>${s.kod}</td><td>${(s.ad || "").replace(/_/g, " ")}</td>` +
    `<td>${s.icinde ? "içinde" : "çevre"}</td>` +
    `<td style="text-align:right">${(s.veri_gun / 365).toFixed(0)}</td>` +
    `<td style="text-align:right">${s.alan_km2 ? fmt(s.alan_km2, 1) : "—"}</td>` +
    `<td style="text-align:right">${s.q_ort != null ? fmt(s.q_ort, 2) : "—"}</td></tr>`;
  $("suListe").innerHTML = S.suListe.length
    ? '<table class="tbl small"><tr><th>✓</th><th>Kod</th><th>Ad</th><th>Konum</th>' +
      "<th>Yıl</th><th>A (km²)</th><th>Q<sub>ort</sub></th></tr>" +
      S.suListe.map(sat).join("") +
      "</table>"
    : '<p class="small">Bu alanda yeterli uzunlukta istasyon yok.</p>';
  $("suListe")
    .querySelectorAll(".su-cb")
    .forEach((cb) => {
      cb.onclick = () => {
        if (cb.checked) S.suSecili.add(cb.dataset.kod);
        else S.suSecili.delete(cb.dataset.kod);
        suHedefDoldur();
      };
    });
  suHedefDoldur();
}

/* 4) ölçüm periyotları + korelasyon */
$("btnSuPeriyot").onclick = async () => {
  const ilk = +$("suIlkYil").value,
    son = +$("suSonYil").value;
  if (!(ilk && son && son >= ilk)) return setStatus("suStatus", "Geçerli bir yıl aralığı girin.", "err");
  setStatus("suStatus", "Periyotlar çıkarılıyor…", "loading");
  try {
    const r = await api("/api/su-periyot", { kodlar: [...S.suSecili], ilk_yil: ilk, son_yil: son });
    S.suPeriyot = r;
    const t = r.tablo;
    const renk = { tam: "#2e7d32", eksik: "#f9a825", yok: "#e0e0e0" };
    let h =
      '<p class="small"><b>Ölçüm periyotları</b> — ' +
      '<span style="color:#2e7d32">■</span> tam yıl · ' +
      '<span style="color:#f9a825">■</span> eksik (kısmi gözlem) · ' +
      '<span style="color:#bdbdbd">■</span> veri yok</p>' +
      '<div style="overflow-x:auto"><table class="tbl small"><tr><th>İstasyon</th>' +
      t.yillar.map((y) => `<th style="writing-mode:vertical-rl;font-weight:400">${y}</th>`).join("") +
      "<th>tam</th><th>eksik</th></tr>";
    t.istasyonlar.forEach((s) => {
      h +=
        `<tr><td title="${(s.ad || "").replace(/_/g, " ")}">${s.kod}</td>` +
        s.yillar
          .map(
            (y) =>
              `<td title="${y.yil}: ${y.durum}${y.q != null ? " · " + fmt(y.q, 2) + " m³/s, " + y.gun + " gün" : ""}"` +
              ` style="background:${renk[y.durum]};padding:0 3px"></td>`,
          )
          .join("") +
        `<td style="text-align:right">${s.tam_yil}</td>` +
        `<td style="text-align:right">${s.eksik_yil}</td></tr>`;
    });
    h += "</table></div>";

    const ky = r.korelasyon.filter((k) => k.r2 != null).sort((a, b) => b.r2 - a.r2);
    if (ky.length) {
      h +=
        '<p class="small"><b>İstasyon çiftleri arasındaki ilişki</b> ' +
        "(yıllık ortalama akım regresyonu, en iyi 12)</p><table class='tbl small'>" +
        "<tr><th>A</th><th>B</th><th>ortak yıl</th><th>r</th><th>r²</th></tr>" +
        ky
          .slice(0, 12)
          .map(
            (k) =>
              `<tr><td>${k.a}</td><td>${k.b}</td>` +
              `<td style="text-align:right">${k.ortak_yil}</td>` +
              `<td style="text-align:right">${fmt(k.r, 3)}</td>` +
              `<td style="text-align:right">${fmt(k.r2, 3)}</td></tr>`,
          )
          .join("") +
        "</table>";
    }
    $("suPeriyot").innerHTML = h;
    const eksikToplam = t.istasyonlar.reduce((a, s) => a + s.eksik_yil, 0);
    setStatus(
      "suStatus",
      `${t.istasyonlar.length} istasyon × ${t.yillar.length} yıl — ` +
        `toplam ${eksikToplam} eksik yıl. Temsil AGİ'sini seçip tamamlayın.`,
      "ok",
    );
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
      hedef,
      vericiler: [...S.suSecili],
      ilk_yil: +$("suIlkYil").value,
      son_yil: +$("suSonYil").value,
      en_az_r2: +$("suR2").value || 0.5,
      havza_alani_km2: alan || null,
      us: +$("suUs").value || 1,
    });
    S.suTamam = o;
    const i = o.istasyon;
    let h =
      `<h3 class="small">${i.kod} — ${(i.ad || "").replace(/_/g, " ")}` +
      `${i.alan_km2 ? " (" + fmt(i.alan_km2, 1) + " km²)" : ""}</h3>`;

    const il = Object.entries(o.iliskiler).sort((a, b) => b[1].r2 - a[1].r2);
    h += '<p class="small"><b>Kabul edilen ilişkiler</b> (eksik yıl doldurmada ' + "kullanılma sırası)</p>";
    h += il.length
      ? '<table class="tbl small"><tr><th>Verici</th><th>r²</th><th>ortak yıl</th>' +
        "<th>bağıntı</th></tr>" +
        il
          .map(
            ([k, v]) =>
              `<tr><td>${k}</td>` +
              `<td style="text-align:right">${fmt(v.r2, 3)}</td>` +
              `<td style="text-align:right">${v.ortak_yil}</td>` +
              `<td>Q = ${fmt(v.kesim, 3)} + ${fmt(v.egim, 4)}·Q<sub>${k}</sub></td></tr>`,
          )
          .join("") +
        "</table>"
      : '<p class="small">r² eşiğini geçen ilişki yok — eşiği düşürün ya da başka ' + "istasyon işaretleyin.</p>";

    h +=
      `<p class="small"><b>Yıllık seri</b> — ${o.gozlem} gözlem, ` +
      `${o.dolduruldu} regresyonla dolduruldu` +
      (o.bos ? `, <b>${o.bos} yıl boş kaldı</b>` : "") +
      "</p>" +
      '<div style="overflow-x:auto"><table class="tbl small"><tr><th>Su yılı</th>' +
      o.seri.map((s) => `<th style="font-weight:400">${s.yil}</th>`).join("") +
      "</tr>" +
      "<tr><td>Q (m³/s)</td>" +
      o.seri
        .map(
          (s) =>
            `<td style="text-align:right;${
              s.kaynak === "gözlem" ? "" : s.q == null ? "background:#ffcdd2" : "background:#fff9c4"
            }"` +
            ` title="${
              s.kaynak === "gözlem"
                ? "gözlem"
                : s.kaynak
                  ? s.kaynak + " ile dolduruldu (r²=" + fmt(s.r2, 3) + ")"
                  : "veri yok"
            }">${s.q == null ? "—" : fmt(s.q, 2)}</td>`,
        )
        .join("") +
      "</tr></table></div>";

    if (o.outlet) {
      const u = o.outlet;
      h +=
        `<p class="small"><b>Havza çıkışına taşınmış potansiyel</b> — ` +
        `(${fmt(u.havza_alani_km2, 1)} / ${fmt(u.kaynak_alan_km2, 1)})` +
        `<sup>${fmt(u.us, 2)}</sup> = ${fmt(u.oran, 4)}</p><table class="tbl small">` +
        `<tr><td>Ortalama akım Q<sub>ort</sub></td><td><b>${fmt(u.q_ort, 3)}</b> m³/s</td></tr>` +
        `<tr><td>Yıllık hacim</td><td><b>${fmt(u.yillik_hacim_hm3, 2)}</b> hm³/yıl</td></tr>` +
        `<tr><td>Özgül verim</td><td>${fmt(u.ozgul_verim_ls_km2, 2)} L/s/km²</td></tr>` +
        `<tr><td>Yıllık verim</td><td>${fmt(u.yillik_verim_mm, 0)} mm</td></tr>` +
        `<tr><td>Kullanılan yıl</td><td>${u.yil_sayisi}</td></tr></table>`;
    }
    $("suSonuc").innerHTML = h;
    setStatus(
      "suStatus",
      o.outlet
        ? `Havza çıkışı: Q_ort = ${fmt(o.outlet.q_ort, 3)} m³/s · ` + `${fmt(o.outlet.yillik_hacim_hm3, 2)} hm³/yıl.`
        : `${o.gozlem} gözlem + ${o.dolduruldu} dolduruldu (havza alanı girilmedi).`,
      "ok",
    );
  } catch (e) {
    setStatus("suStatus", "Tamamlanamadı: " + e.message, "err");
  }
};

onHavzaChanged(suHavzaGuncelle);

export { suIsaretle, suHedefDoldur, suHavzaGuncelle, suBaslat, suListele };
