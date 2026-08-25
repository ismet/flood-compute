/**
 * @fileoverview İklim katmanı (CHELSA P/PET/net) — WMS/XYZ ve havza ortalaması.
 * @module map/yagis-katman
 * Owns: S.yagisHavza
 * Exports: havzaOrtalamasiGoster (wizard/havza çıkarım sonrası kendiliğinden çağırır)
 * Notes: Rank 2 (map).
 */

import { S } from "../core/state.js";
import { fmt, _esc } from "../core/format.js";
import { $ } from "../ui/dom.js";
import { api } from "../core/api.js";
import { map, layers } from "./init.js";

/* ---- yıllık toplam yağış katmanı (CHELSA v2.1, ~1 km) ----
   Altlık değil tematik harita: renk merdiveniyle çizilir. Asıl işe yarayan
   büyüklük havzanın ALANSAL ortalaması — dağlık havzada tek nokta yanıltır. */
let yagisBilgi = null;
layers.yagis = null;

const yagisKatmanBilgi = (k) => ((yagisBilgi && yagisBilgi.katmanlar) || []).find((x) => x.anahtar === k);

function yagisLejantCiz(k) {
  const b = yagisKatmanBilgi(k);
  if (!b) {
    $("yagisLejant").innerHTML = "";
    return;
  }
  let onceki = 0;
  const koyu = k === "pet" ? 1150 : k === "net" ? 250 : 500;
  $("yagisLejant").innerHTML =
    `<b>${_esc(b.kisa)} (mm/yıl)</b> ` +
    b.lejant
      .map((l) => {
        const et = l.deger >= 10000 ? `${onceki}+` : `${onceki}–${l.deger}`;
        onceki = l.deger;
        return (
          `<span style="display:inline-block;padding:0 4px;margin:1px;` +
          `background:${l.renk};color:${l.deger > koyu ? "#fff" : "#000"};` +
          `border-radius:2px">${et}</span>`
        );
      })
      .join("");
}

function yagisKatmanUygula() {
  const k = $("yagisKatman").value;
  if (layers.yagis) layers.yagis.remove();
  layers.yagis = L.tileLayer(`/api/yagis/${k}/{z}/{x}/{y}.png`, {
    opacity: (+$("yagisOpak").value || 75) / 100,
    maxZoom: 18,
    crossOrigin: true,
    attribution: "İklim: CHELSA v2.1",
  });
  if ($("yagisAc").checked) layers.yagis.addTo(map);
  yagisLejantCiz(k);
  const b = yagisKatmanBilgi(k);
  if (b) {
    $("yagisInfo").innerHTML =
      `<b>${_esc(b.ad)}</b> — ${_esc(b.kaynak)} · ${_esc(b.donem)} · ` +
      `~${b.cozunurluk_m} m piksel · ${b.lisans}` +
      (b.yontem ? ` · ${b.yontem}` : "");
  }
}

$("yagisAc").onchange = () => {
  $("yagisOpak").classList.toggle("hidden", !$("yagisAc").checked);
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
$("yagisOpak").classList.toggle("hidden", !$("yagisAc").checked);

export async function havzaOrtalamasiGoster() {
  // düğme artık gizli: çıkarım bittiğinde wizard/havza kendiliğinden çağırır.
  // Havza yoksa veya iklim verisi yoksa sessizce çık (otomatik çağrı yolunda
  // "Önce havzayı çıkarın" uyarısının boşuna yazılmaması için).
  if (!S.havza || !yagisBilgi || !yagisBilgi.var) return;
  $("yagisInfo").textContent = "Havza ortalamaları hesaplanıyor…";
  try {
    const g = S.havza.features ? S.havza.features[0].geometry : S.havza.geometry || S.havza;
    const r = await api("/api/yagis-havza", { geometri: g });
    S.yagisHavza = r;
    const sat = (k, ad) =>
      r[k]
        ? `<tr><td>${ad}</td><td style="text-align:right"><b>${fmt(r[k].ortalama_mm, 0)}</b></td>` +
          `<td style="text-align:right">${fmt(r[k].medyan_mm, 0)}</td>` +
          `<td style="text-align:right">${fmt(r[k].en_az_mm, 0)}–${fmt(r[k].en_cok_mm, 0)}</td>` +
          `<td style="text-align:right">±${fmt(r[k].std_mm, 0)}</td></tr>`
        : "";
    $("yagisInfo").innerHTML =
      '<table class="tbl small"><tr><th></th>' +
      "<th>mm/yıl</th><th>medyan</th><th>aralık</th><th>sapma</th></tr>" +
      sat("yagis", "Yağış") +
      "</table>";
  } catch (e) {
    $("yagisInfo").textContent = "Hesaplanamadı: " + e.message;
  }
}
$("btnYagisHavza").onclick = havzaOrtalamasiGoster;

/* Haritaya tıklayınca değerleri oku. Diğer tıklama kipleri (outlet seçimi,
   ara havza noktası, istasyon ekleme) önceliklidir — onlar açıkken sorgu
   yapılmaz, yoksa kullanıcı outlet seçerken karşısına balon çıkardı.        */
map.on("click", async (ev) => {
  if (!$("yagisAc").checked || !yagisBilgi || !yagisBilgi.var) return;
  if ($("btnPick")?.classList.contains("picking") || (S.multi && S.multi.place)) return;
  if (S.mode && S.mode !== "wizard") return;

  const { lat, lng } = ev.latlng;
  const balon = L.popup({ maxWidth: 280 }).setLatLng(ev.latlng).setContent("okunuyor…").openOn(map);
  try {
    const q = new URLSearchParams({ lat, lon: lng });
    const r = await api("/api/yagis-nokta?" + q.toString());
    const secili = $("yagisKatman").value;
    const sat = (k, ad, br = "mm/yıl") =>
      r[k] == null
        ? ""
        : `<tr${k === secili ? ' style="font-weight:700"' : ""}><td>${ad}</td>` +
          `<td style="text-align:right;padding-left:10px">${fmt(r[k], 0)}</td>` +
          `<td class="small" style="padding-left:4px">${br}</td></tr>`;
    balon.setContent(
      `<b>${fmt(lat, 4)}, ${fmt(lng, 4)}</b><table class="small">` +
        sat("yagis", "Yağış P") +
        sat("pet", "PET") +
        sat("aet", "AET") +
        sat("net", "Net yağış") +
        (r.yagis && r.net != null
          ? `<tr><td>akış katsayısı</td><td style="text-align:right;padding-left:10px">` +
            `${fmt(r.net / r.yagis, 2)}</td><td></td></tr>`
          : "") +
        "</table>" +
        '<span class="small">CHELSA v2.1 · 1981–2010 · ~1 km piksel</span>',
    );
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
      $("yagisInfo").textContent = "veri yok — tools/yagis_haritasi_indir.py ile üretin";
      return;
    }
    $("yagisKatman").innerHTML = yagisBilgi.katmanlar
      .map((k) => `<option value="${k.anahtar}">${k.ad}</option>`)
      .join("");
    $("yagisKatman").value = yagisBilgi.varsayilan;
    $("yagisOpak").classList.toggle("hidden", !$("yagisAc").checked);
  } catch (e) {
    /* uç yoksa sessiz geç */
  }
})();
