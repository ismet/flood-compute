/**
 * @fileoverview Kotlar, CN (CORINE), zemin grubu, YZD, rasyonel C bloğu.
 * @module wizard/cn
 * Owns: S.cnSonuc, S.zemin, S.rasyonelCKaynak, S.cSecim
 * Exports: renderKotlar, renderCnSonuc, renderRasyonelC, zeminGrubunuBelirle
 * Notes: Rank 2 (wizard). zeminGrubunuBelirle havza sonrası otomatik çağrılır.
 */

import { S } from "../core/state.js";
import { _esc } from "../core/format.js";
import { markDone, updateComputeReady } from "./steps.js";
import { $, setStatus } from "../ui/dom.js";
import { api } from "../core/api.js";

export function renderKotlar() {
  const g = $("kotlar");
  g.innerHTML = "";
  for (let i = 0; i < 11; i++) {
    const lab = document.createElement("label");
    lab.textContent = `H${i}`;
    if (i === 0) lab.title = "outlet";
    else if (i === 10) lab.title = "memba";
    const inp = document.createElement("input");
    inp.type = "number";
    inp.step = "0.1";
    if (i === 0) inp.setAttribute("aria-label", "H0 outlet");
    else if (i === 10) inp.setAttribute("aria-label", "H10 memba");
    inp.value = S.kotlar[i];
    inp.oninput = () => {
      S.kotlar[i] = +inp.value;
    };
    lab.appendChild(inp);
    g.appendChild(lab);
  }
}
renderKotlar();
$("btnCN").onclick = async () => {
  if (!S.havza) return setStatus("cnStatus", "Önce havzayı çıkarın (Adım 1)", "err");
  setStatus("cnStatus", "CORINE kesiliyor…", "loading");
  try {
    const r = await api("/api/cn", { havza_geojson: S.havza, zemin_grubu: $("inpSoil").value });
    $("inpCN2").value = r.CN2;
    $("inpCN3").value = r.CN3;
    S.cnSonuc = r;
    renderCnSonuc(r);
    setStatus("cnStatus", `Ağırlıklı CN(II)=${r.CN2}  CN(III)=${r.CN3}\nVeri kaynağı: ${r.kaynak}`, "ok");
    markDone(2);
  } catch (e) {
    setStatus("cnStatus", "Hata: " + e.message, "err");
  }
};
export function renderCnSonuc(r) {
  let h =
    `<table class="tbl"><tr><th></th><th>Kod</th><th>Sınıf</th><th>Oran</th>` +
    `<th>CN</th><th>C</th><th>C aralığı</th></tr>`;
  r.dokum.forEach((d) => {
    const kutu = d.c_renk
      ? `<span style="display:inline-block;width:11px;height:11px;border:1px solid #b5b0a8;background:${_esc(d.c_renk)}"></span>`
      : "";
    const cOrt = d.c_ort == null ? "—" : `<b>${d.c_ort.toFixed(2)}</b>${d.c_tablo ? "" : " *"}`;
    const aralik = d.c_min == null ? "—" : `${d.c_min.toFixed(2)}–${d.c_max.toFixed(2)}`;
    h +=
      `<tr><td>${kutu}</td><td>${_esc(d.kod)}</td><td>${_esc(d.ad)}</td>` +
      `<td>${(d.oran * 100).toFixed(1)}%</td><td>${d.cn}</td>` +
      `<td>${cOrt}</td><td>${aralik}</td></tr>`;
  });
  h += `</table>`;
  $("cnTable").innerHTML = h;
  renderRasyonelC(r);
}
export const RASYONEL_C_HINT = `<span class="small">CORINE'den akış katsayısı C türetmek için
  Adım 2'de <b>CN hesapla</b>'yı çalıştırın.</span>`;
export function renderRasyonelC(r) {
  const el = $("rasyonelCBox");
  if (!el) return;
  const c = r && r.rasyonel_C;
  if (!c) {
    // rasyonel_C, havzadaki hiçbir sınıf C matrisiyle eşleşmezse null gelir
    el.innerHTML = r
      ? `<span class="small">Bu havzadaki CORINE sınıfları C eşleştirme matrisiyle
           eşleşmedi; akış katsayısı türetilemedi — C100 girdisiyle hesaplanır.</span>`
      : RASYONEL_C_HINT;
    return;
  }
  const turetilmis =
    c.turetilmis_orani > 0
      ? `<div class="small">* Alanın %${(c.turetilmis_orani * 100).toFixed(1)}'i eşleştirme
         matrisinde yer almayan CORINE sınıfı; en yakın sınıftan türetildi.</div>`
      : "";
  el.innerHTML = `<div style="margin-top:6px;padding:6px;border:1px solid #d8d3cc;border-radius:4px">
    <b>Rasyonel yöntem akış katsayısı C</b> <span class="small">(CORINE'den alansal ağırlıklı)</span>
    <div style="margin:3px 0">alt <b>${c.C_min.toFixed(3)}</b> ·
      <span title="Tablodaki 'önerilen ortalama' değerlerin alansal ağırlıklı ortalaması — aralığın orta noktası değildir">önerilen
      <b>${c.C_orta.toFixed(3)}</b></span> · üst <b>${c.C_max.toFixed(3)}</b></div>
    <label class="inline">Kullanılacak
      <select id="cSecim">
        <option value="C_min">alt — ${c.C_min.toFixed(3)}</option>
        <option value="C_orta">önerilen — ${c.C_orta.toFixed(3)}</option>
        <option value="C_max">üst — ${c.C_max.toFixed(3)}</option>
      </select></label>
    ${turetilmis}
    <div class="small">⚠ Tablo değerleri <b>genel</b> rasyonel C'dir; seçtiğiniz değer
      yukarıdaki <b>C100</b> alanına yazılır (T=100 katsayısı) ve küçük tekerrürlere
      C<sub>T</sub>=C100·(T/100)<sup>üs</sup> ile ölçeklenir. Değeri mühendislik kararınızla gözden geçirin.</div>
  </div>`;
  // kaydedilmiş tercih geri gelir; programatik atama change tetiklemez → yazma yok
  $("cSecim").value = S.cSecim && c[S.cSecim] != null ? S.cSecim : "C_orta";
  $("cSecim").onchange = () => {
    const anahtar = $("cSecim").value;
    const deger = c[anahtar];
    $("inpC100").value = deger.toFixed(3);
    // outer group (new) + hide-sync inner for one-release compat
    const rOuter = document.querySelector('.hesapYontem[data-m="rasyonel"]');
    if (rOuter) {
      rOuter.checked = true;
      if (S.seciliYontemler instanceof Set) S.seciliYontemler.add("rasyonel");
      const rb = $("rasyonelBox");
      if (rb) { rb.classList.remove("hidden"); rb.open = true; }
    }
    if ($("inpRasyonel")) $("inpRasyonel").checked = true;
    S.cSecim = anahtar;
    S.rasyonelCKaynak = { deger, secim: anahtar, kaynak: r.kaynak };
    updateComputeReady();
    // live-filter overlay if already computed
    if (S.sonuc) import("./hesap.js").then((m) => m.renderHesapDock()).catch(() => {});
  };
}
renderRasyonelC(null);
export async function zeminGrubunuBelirle() {
  const el = $("zeminInfo");
  if (!S.havza) return;
  try {
    const r = await api("/api/zemin-grubu", { havza_geojson: S.havza });
    if (!r.var) {
      el.innerHTML = `<span class="warn">⚠ Zemin grubu katmanı kurulu değil — grup topraktan
        belirlenemedi, listede <b>${_esc($("inpSoil").value)}</b> duruyor (varsayılan). Elle kontrol edin.
        (<code>python tools/zemin_grubu_uret.py</code>)</span>`;
      return;
    }
    S.zemin = r;
    $("inpSoil").value = r.grup;
    const d = Object.entries(r.dagilim)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${_esc(k)}=%${v}`)
      .join(" · ");
    el.innerHTML =
      `🌍 Otomatik: <b>${_esc(r.grup)}</b> (havzanın %${r.pay_yuzde}'si) — ${d}` +
      `<br><span class="small">${_esc(r.yontem)}; Ksat ${_esc(r.ksat_araligi_mm_sa)} mm/sa` +
      (r.kararsiz ? ` · <span class="warn">⚠ baskın grup zayıf, havza karışık — elle kontrol edin</span>` : "") +
      `<br>⚠ ${_esc(r.uyari)}</span>`;
  } catch (e) {
    // Sessizce varsayılana düşmek, bu parametrede kabul edilemez: hangi grubun
    // kullanıldığı ve topraktan mı geldiği her hâlde yazılmalı.
    el.innerHTML = `<span class="warn">⚠ Zemin grubu belirlenemedi (${_esc(e.message)}) —
      listede <b>${_esc($("inpSoil").value)}</b> duruyor (varsayılan, ölçümden gelmiyor). Elle kontrol edin.</span>`;
  }
}
