/**
 * @fileoverview Biçimlendirme ve kaçış yardımcıları.
 * @module core/format
 * Owns: — (pure)
 * Exports: fmt(x,d), _esc(s), mgmNorm(s)
 * Notes:
 *  - _esc() — stage11'de TÜM innerHTML / bindTooltip interpolasyonlarında zorunlu.
 *  - Rank 0 (core).
 */

export const fmt = (x, d = 2) => (x === null || x === undefined || isNaN(x) ? "—" : (+x).toFixed(d));
export const _esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
export const mgmNorm = (s) => (s || "").toLocaleUpperCase("tr").replace(/[^A-ZÇĞİÖŞÜ0-9]/g, "");
