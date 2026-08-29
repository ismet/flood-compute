/**
 * @fileoverview Mukayese ve Rapor — step 6 view.
 * @module wizard/comparison
 * Owns: #comparisonResults / #comparisonStatus DOM (Adım 6), S.rapFilter (persisted)
 * Exports: renderMukayese
 * Notes:
 *  - Allowed pulls (§3.1): comparison→hesap (syncRepSecili/downloadReport/exportCSV), comparison→ui/dom, →core/*
 *    comparison→modes/rezervuar dynamic (dialog).
 *  - Rank 2 (wizard). Static import from hesap keeps single-owner for report meta.
 *  - Grafik overlay backend (openCompare) stays in wizard/grafik.js; this view only renders the 7 controls.
 *  - Hesap (4) keeps Yıl_Ara; this keeps the 7: Rapora dahil + Seçilen yontem + Bolum no + Word + Rezervuar + CSV + JSON.
 *  - EN filename per D-02; Turkish only in UI labels/comments.
 */
import { S } from "../core/state.js";
import { $, setStatus } from "../ui/dom.js";
import { _esc } from "../core/format.js";
import { CMP_LABELS } from "../core/constants.js";
import { syncRepSecili, downloadReport, exportCSV } from "./hesap.js";
import { download } from "../ui/dom.js";

export function renderMukayese() {
  const el = $("comparisonResults");
  const st = $("comparisonStatus");
  if (!el) return;
  const r = S.sonuc;
  if (!r) {
    el.innerHTML = `<div class="hint">Mukayese ve rapor için önce <b>Adım 4 → HESAPLA</b>. Hesap tamamlanınca bu sekmede yöntemleri karşılaştırabilir ve raporu indirebilirsiniz.</div>`;
    if (st) setStatus("comparisonStatus", "", "");
    return;
  }
  if (!(S.rapFilter instanceof Set)) S.rapFilter = new Set(S.rapFilter || []);
  const avail = ["dsi", "mockus", "rasyonel", "snyder"].filter(
    (k) => k === "dsi" || k === "mockus" || (k === "rasyonel" && r.rasyonel) || (k === "snyder" && r.snyder),
  );
  // ensure rapFilter only contains still-available methods; stale entries ignored
  const filteredAvail = avail.filter((m) => !S.rapFilter.has(m));
  // repSecili must have at least filteredAvail; if empty due to user unchecking all, show all checked again
  const effectiveAvail = filteredAvail.length ? filteredAvail : avail;
  // we rebuild checkbox state from rapFilter: unchecked = in Set
  let h = "";
  h += `<div class="export-row" style="align-items:center;flex-wrap:wrap">`;
  h += `<span class="small">Rapora dahil yöntemler:</span>`;
  h += avail
    .map(
      (m) =>
        `<label style="flex-direction:row;align-items:center;gap:3px"><input type="checkbox" class="repMethod" data-m="${m}" ${S.rapFilter.has(m) ? "" : "checked"}>${_esc(CMP_LABELS[m])}</label>`,
    )
    .join("");
  h += `</div>`;
  h += `<div class="export-row" style="align-items:center;flex-wrap:wrap">`;
  h += `<label style="flex-direction:row;align-items:center;gap:4px">Seçilen (kabul edilen) yöntem <select id="repSecili">${effectiveAvail.map((m) => `<option value="${m}">${_esc(CMP_LABELS[m])}</option>`).join("")}</select></label>`;
  h += `<label style="flex-direction:row;align-items:center;gap:4px">Bölüm no <input id="repBolum" value="${_esc($("repBolum")?.value || "4.7.3")}" style="width:64px"></label>`;
  h += `</div>`;
  // preserve Bolum no value if already typed: read before overwriting, handled above via _esc($("repBolum")?.value)
  h += `<div class="export-row" style="align-items:center"><button id="btnReport" class="primary">📄 Word Raporu (Bölüm) indir</button><span id="repStatus" class="small"></span></div>`;
  h += `<div class="export-row"><button id="btnReservoir" class="primary">🏞 Rezervuar Ötelemesi</button><button id="btnCSV">⬇ CSV</button><button id="btnJSON">⬇ JSON</button></div>`;
  // small helper: if hesapDock shows a fallback repBolum, keep it linked
  // capture previous repBolum before DOM replacement for persistence
  const prevBolum = $("repBolum") ? $("repBolum").value : null;
  el.innerHTML = h;
  // restore bolum if we overwrote: the new input already has prev value via construction, but if construction missed (initial), set it
  if (prevBolum && $("repBolum") && $("repBolum").value !== prevBolum) $("repBolum").value = prevBolum;
  // also sync fields from project restore: proje.js may have set repBolum before renderMukayese called; ensure it wins
  // (handled by construction above reading existing value)
  // wire: checkbox -> S.rapFilter -> syncRepSecili (rebuild dropdown)
  el.querySelectorAll(".repMethod").forEach((cb) => {
    cb.onchange = () => {
      if (!(S.rapFilter instanceof Set)) S.rapFilter = new Set(S.rapFilter || []);
      if (cb.checked) S.rapFilter.delete(cb.dataset.m);
      else S.rapFilter.add(cb.dataset.m);
      syncRepSecili();
      // after sync, if effectiveAvail became empty (all unchecked), re-render to avoid empty select
      const remaining = avail.filter((m) => !S.rapFilter.has(m));
      if (!remaining.length) {
        // keep at least one for usability: don't allow empty — revert last uncheck
        S.rapFilter.delete(cb.dataset.m);
        cb.checked = true;
        syncRepSecili();
      }
    };
  });
  // also ensure initial syncRepSecili runs to set dropdown to first available if mismatch
  try {
    syncRepSecili();
  } catch (e) {}
  // wire buttons: report / reservoir / CSV / JSON (single-owner in hesap.js)
  const btnReport = $("btnReport");
  if (btnReport) btnReport.onclick = downloadReport;
  const btnRes = $("btnReservoir");
  if (btnRes)
    btnRes.onclick = async () => {
      const m = await import("../modes/rezervuar.js");
      m.openReservoir();
    };
  const btnCsv = $("btnCSV");
  if (btnCsv) btnCsv.onclick = exportCSV;
  const btnJson = $("btnJSON");
  if (btnJson) btnJson.onclick = () => download("taskin_sonuc.json", JSON.stringify(S.sonuc, null, 1));
  if (st) setStatus("comparisonStatus", "", "");
}
