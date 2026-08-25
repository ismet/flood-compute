import { $ , setStatus } from "../ui/dom.js";
import { api } from "../core/api.js";
import { map, layers } from "./init.js";

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

/* Haritaya tıklayınca değerleri oku. Diğer tıklama kipleri (outlet seçimi,
   ara havza noktası, istasyon ekleme) önceliklidir — onlar açıkken sorgu
   yapılmaz, yoksa kullanıcı outlet seçerken karşısına balon çıkardı.        */
map.on("click", async (ev) => {
  if (!$("yagisAc").checked || !yagisBilgi || !yagisBilgi.var) return;
  if (picking || S.stPlace || (S.multi && S.multi.place)) return;
  if (S.mode && S.mode !== "wizard") return;

  const { lat, lng } = ev.latlng;
  const balon = L.popup({ maxWidth: 280 })
    .setLatLng(ev.latlng)
    .setContent("okunuyor…")
    .openOn(map);
  try {
    const q = new URLSearchParams({ lat, lon: lng });
    const r = await api("/api/yagis-nokta?" + q.toString());
    const secili = $("yagisKatman").value;
    const sat = (k, ad, br = "mm/yıl") => r[k] == null ? ""
      : `<tr${k === secili ? ' style="font-weight:700"' : ""}><td>${ad}</td>`
        + `<td style="text-align:right;padding-left:10px">${fmt(r[k], 0)}</td>`
        + `<td class="small" style="padding-left:4px">${br}</td></tr>`;
    balon.setContent(
      `<b>${fmt(lat, 4)}, ${fmt(lng, 4)}</b><table class="small">`
      + sat("yagis", "Yağış P") + sat("pet", "PET") + sat("aet", "AET")
      + sat("net", "Net yağış")
      + (r.yagis && r.net != null
          ? `<tr><td>akış katsayısı</td><td style="text-align:right;padding-left:10px">`
            + `${fmt(r.net / r.yagis, 2)}</td><td></td></tr>` : "")
      + "</table>"
      + '<span class="small">CHELSA v2.1 · 1981–2010 · ~1 km piksel</span>');
  } catch (e) {
    balon.setContent(`<span class="small">Okunamadı: ${e.message}</span>`);
  }
});

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

