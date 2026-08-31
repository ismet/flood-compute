/**
 * @fileoverview Biçimlendirme ve kaçış yardımcıları.
 * @module core/format
 * Owns: — (pure)
 * Exports: fmt(x,d), _esc(s), mgmNorm(s), stKey(s), istasyonYagisAnahtari(s), mgmIstasyonGorunumu(s)
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
export const stKey = (s) => `${s.name}|${(+s.lat).toFixed(5)}|${(+s.lon).toFixed(5)}`;
export function istasyonYagisAnahtari(s) {
  const kod = String(s.kod ?? "").trim();
  return kod ? `kod:${kod}` : `istasyon:${stKey(s)}`;
}
export function mgmIstasyonGorunumu(s) {
  const metadata = s.metadata && typeof s.metadata === "object" ? s.metadata : {};
  const sensor = s.sensor && typeof s.sensor === "object" ? s.sensor : {};
  const yagisSensoru =
    typeof s.sensor === "string"
      ? s.sensor
      : sensor.YagisSensor || s.YagisSensor || s.yagis_sensor
        ? "yağış sensörü"
        : "";
  const detay = [
    typeof s.metadata === "string" ? s.metadata : metadata.il || s.il,
    metadata.ilce || s.ilce,
    metadata.gozlem_turu || metadata.veri_sinifi,
    yagisSensoru,
  ].filter(Boolean);
  return {
    kod: String(s.kod || s.no || metadata.kod || "").trim(),
    ad: s.ad || s.name || s.istasyon || metadata.ad || "",
    kurum: s.kurum || metadata.kurum || "MGM",
    detay: [...new Set(detay)].join(" · "),
  };
}
