/**
 * @fileoverview Muhtemel Maksimum Yağış (MMY) — Hershfield yöntemi.
 * @module wizard/mmy
 * Owns: S.mmy
 * Exports: — (self-wiring)
 * Notes:
 *  - Rank 2 (wizard). Allowed pull mmy→rain (recalcRain — OET ELLE bridge) (§3.1).
 *  - Lazy-loaded on first activateStep(3) via dynamic import in app.js.
 *  - Sonuç 3. adımın sonundaki OET (elle) alanına yazılınca QOET mevcut hesap zinciriyle üretilir.
 */

import { S } from "../core/state.js";
import { api } from "../core/api.js";
import { fmt, _esc } from "../core/format.js";
import { $, setStatus } from "../ui/dom.js";
import { recalcRain } from "./rain.js";

/* ---- MMY: muhtemel maksimum yağış (Hershfield) ----
   Sonuç OET (elle) alanına yazılınca QOET (muhtemel maksimum
   feyezan) mevcut hesap zinciriyle üretilir.                              */
(async function mmyBolgeYukle() {
  try {
    const r = await api("/api/mmy-bolgeler");
    const el = $("mmyBolge");
    if (el) el.innerHTML = r.bolgeler.map((b) => `<option value="${_esc(b.no)}">${_esc(b.no)}. ${_esc(b.ad)}</option>`).join("");
  } catch (e) {
    /* uç yoksa sessiz geç */
  }
})();

const _btnMmy = $("btnMmy");
if (_btnMmy) {
  _btnMmy.onclick = async () => {
    const p = ($("mmySeri").value || "")
      .split(/[\s,;]+/)
      .map((s) => parseFloat(s.replace(",", ".")))
      .filter((v) => !isNaN(v) && v > 0);
    if (p.length < 3) return setStatus("mmyStatus", "En az 3 yıllık yağış değeri girin (her satıra bir değer).", "err");
    setStatus("mmyStatus", "MMY hesaplanıyor…", "loading");
    try {
      const o = await api("/api/mmy", {
        p,
        bolge_no: +$("mmyBolge").value,
        m1_ort: +$("mmyM1o").value || 1,
        m2_ort: +$("mmyM2o").value || 1,
        m1_s: +$("mmyM1s").value || 1,
        m2_s: +$("mmyM2s").value || 1,
        gun_katsayisi: $("mmyGun").checked,
        istasyon: $("mmyIstasyon").value.trim(),
      });
      S.mmy = o;
      const sat = (ad, v, br = "") =>
        `<tr><td>${ad}</td>` +
        `<td style="text-align:right">${typeof v === "number" ? fmt(v, 4) : v}</td>` +
        `<td class="small">${br}</td></tr>`;
      const sonucEl = $("mmySonuc");
      if (sonucEl) {
        sonucEl.innerHTML =
          (o.istasyon ? `<h3 class="small">${_esc(o.istasyon)}</h3>` : "") +
          '<table class="tbl small">' +
          sat("N", o.yil_sayisi, "yıl") +
          sat("P<sub>maks</sub>", o.pmax, "mm") +
          sat("ΣP", o.toplam, "mm") +
          sat("ΣP (−P<sub>maks</sub>)", o.toplam_pmaxsiz, "mm") +
          sat("P<sub>ort</sub>", o.ortalama, "mm") +
          sat("P<sub>ort</sub> (−P<sub>maks</sub>)", o.ortalama_pmaxsiz, "mm") +
          sat(
            "oran P<sub>ort</sub>(−P<sub>maks</sub>)/P<sub>ort</sub>",
            o.ortalama_orani,
            "→ M1<sub>ort</sub> abağı bu oran ve N ile okunur",
          ) +
          sat("S", o.standart_sapma, "mm") +
          sat("S (−P<sub>maks</sub>)", o.standart_sapma_pmaxsiz, "mm") +
          sat("oran S(−P<sub>maks</sub>)/S", o.standart_sapma_orani, "→ M1<sub>s</sub> abağı bu oran ve N ile okunur") +
          sat("M1<sub>ort</sub> · M2<sub>ort</sub>", o.m1_ort * o.m2_ort, "girilen") +
          sat("M1<sub>s</sub> · M2<sub>s</sub>", o.m1_s * o.m2_s, "girilen") +
          sat("düzeltilmiş P<sub>ort</sub>", o.duzeltilmis_ortalama, "mm") +
          sat("düzeltilmiş S", o.duzeltilmis_standart_sapma, "mm") +
          sat("K<sub>m</sub>", o.km, `${_esc(o.bolge_no)}. ${_esc(o.bolge_adi)}`) +
          (o.gun_katsayisi !== 1 ? sat("gün katsayısı", o.gun_katsayisi, "sabit saat → 24 saat") : "") +
          `<tr><td><b>MMY</b></td><td style="text-align:right"><b>${fmt(o.mmy, 1)}</b></td>` +
          "<td class='small'>mm</td></tr></table>" +
          '<div class="rain-tools"><button id="btnMmyOet" class="small-btn">' +
          "↧ Bu değeri OET (elle) alanına yaz</button></div>";
        const btnOet = $("btnMmyOet");
        if (btnOet) {
          btnOet.onclick = () => {
            const hedef = document.getElementById("inpOetElle");
            if (hedef) {
              hedef.value = fmt(o.mmy, 1);
              try {
                recalcRain();
              } catch (e) {
                hedef.dispatchEvent(new Event("input", { bubbles: true }));
              }
              setStatus("mmyStatus", "OET yağışı güncellendi — OEY ELLE yazıldı.", "ok");
            } else {
              navigator.clipboard?.writeText(fmt(o.mmy, 1));
              setStatus(
                "mmyStatus",
                `MMY = ${fmt(o.mmy, 1)} mm panoya kopyalandı — ` + "OET (elle) alanına yapıştırın.",
                "ok",
              );
            }
          };
        }
      }
      setStatus("mmyStatus", `MMY = ${fmt(o.mmy, 1)} mm ` + `(N=${o.yil_sayisi}, Km=${fmt(o.km, 3)}).`, "ok");
    } catch (e) {
      setStatus("mmyStatus", "MMY hesaplanamadı: " + e.message, "err");
    }
  };
}
