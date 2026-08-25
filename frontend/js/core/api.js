/**
 * @fileoverview Fetch sarmalayıcısı — tüm API çağrıları tek noktadan.
 * @module core/api
 * Owns: — (pure, S/layers yazmaz)
 * Exports: api(url, body?, isForm?) => Promise<json>
 * Notes:
 *  - Rank 0 (core) — ui/map/wizard/modes'ten serbestçe import edilir.
 *  - Hata uzlaşımı: {hata} alanı varsa throw; HTTP !ok da throw.
 *  - JSON gövde otomatik stringify; isForm ise ham FormData.
 */

export const api = async (url, body, isForm) => {
  const opt =
    body === undefined
      ? {}
      : isForm
        ? { method: "POST", body }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const r = await fetch(url, opt);
  const j = await r.json();
  if (!r.ok || j.hata) throw new Error(j.hata || r.statusText);
  return j;
};
