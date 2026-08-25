export const fmt = (x, d = 2) => (x === null || x === undefined || isNaN(x) ? "—" : (+x).toFixed(d));
export const _esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
export const mgmNorm = (s) => (s || "").toLocaleUpperCase("tr").replace(/[^A-ZÇĞİÖŞÜ0-9]/g, "");
