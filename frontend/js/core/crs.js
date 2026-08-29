/**
 * @fileoverview Türkiye CRS seçenekleri.
 * @module core/crs
 * Owns: — (pure DOM helper)
 * Exports: kurCrsSecici
 * Notes: Rank 0 (core).
 */

const SECENEKLER = [
  ["EPSG:5254", "EPSG:5254 — TUREF / TM30"],
  ["EPSG:4326", "EPSG:4326 — WGS 84"],
  ["EPSG:5255", "EPSG:5255 — TUREF / TM33"],
  ["EPSG:5256", "EPSG:5256 — TUREF / TM36"],
  ["EPSG:5257", "EPSG:5257 — TUREF / TM39"],
  ["EPSG:5253", "EPSG:5253 — TUREF / TM27"],
  ["EPSG:5258", "EPSG:5258 — TUREF / TM42"],
  ["EPSG:5259", "EPSG:5259 — TUREF / TM45"],
  ["EPSG:23037", "EPSG:23037 — ED50 / UTM 37N"],
  ["EPSG:32637", "EPSG:32637 — WGS 84 / UTM 37N"],
  ["EPSG:23036", "EPSG:23036 — ED50 / UTM 36N"],
  ["EPSG:32636", "EPSG:32636 — WGS 84 / UTM 36N"],
  ["EPSG:23038", "EPSG:23038 — ED50 / UTM 38N"],
  ["EPSG:32638", "EPSG:32638 — WGS 84 / UTM 38N"],
  ["EPSG:23035", "EPSG:23035 — ED50 / UTM 35N"],
  ["EPSG:32635", "EPSG:32635 — WGS 84 / UTM 35N"],
  ["EPSG:2206", "EPSG:2206 — ED50 / 3° Gauss-Krüger 9"],
  ["EPSG:2207", "EPSG:2207 — ED50 / 3° Gauss-Krüger 10"],
  ["EPSG:2208", "EPSG:2208 — ED50 / 3° Gauss-Krüger 11"],
  ["EPSG:2209", "EPSG:2209 — ED50 / 3° Gauss-Krüger 12"],
  ["EPSG:2210", "EPSG:2210 — ED50 / 3° Gauss-Krüger 13"],
  ["EPSG:2211", "EPSG:2211 — ED50 / 3° Gauss-Krüger 14"],
  ["EPSG:2212", "EPSG:2212 — ED50 / 3° Gauss-Krüger 15"],
  ["EPSG:2319", "EPSG:2319 — ED50 / TM27"],
  ["EPSG:2320", "EPSG:2320 — ED50 / TM30"],
  ["EPSG:2321", "EPSG:2321 — ED50 / TM33"],
  ["EPSG:2322", "EPSG:2322 — ED50 / TM36"],
  ["EPSG:2323", "EPSG:2323 — ED50 / TM39"],
  ["EPSG:2324", "EPSG:2324 — ED50 / TM42"],
  ["EPSG:2325", "EPSG:2325 — ED50 / TM45"],
  ["EPSG:5269", "EPSG:5269 — TUREF / 3° Gauss-Krüger 9"],
  ["EPSG:5270", "EPSG:5270 — TUREF / 3° Gauss-Krüger 10"],
  ["EPSG:5271", "EPSG:5271 — TUREF / 3° Gauss-Krüger 11"],
  ["EPSG:5272", "EPSG:5272 — TUREF / 3° Gauss-Krüger 12"],
  ["EPSG:5273", "EPSG:5273 — TUREF / 3° Gauss-Krüger 13"],
  ["EPSG:5274", "EPSG:5274 — TUREF / 3° Gauss-Krüger 14"],
  ["EPSG:5275", "EPSG:5275 — TUREF / 3° Gauss-Krüger 15"],
  ["EPSG:3034", "EPSG:3034 — ETRS89-extended / LCC Europe"],
  ["EPSG:3035", "EPSG:3035 — ETRS89-extended / LAEA Europe"],
  ["EPSG:5636", "EPSG:5636 — TUREF / LAEA Europe"],
  ["EPSG:5637", "EPSG:5637 — TUREF / LCC Europe"],
];

export function kurCrsSecici(select, varsayilan, custom) {
  if (!select) return;
  select.replaceChildren();
  const optionOlustur = (label, value) => {
    const option = document.createElement("option");
    option.textContent = label;
    option.value = value;
    return option;
  };
  if (varsayilan === "auto") select.append(optionOlustur("Dosyadaki CRS'yi kullan", ""));
  SECENEKLER.forEach(([value, label]) => select.append(optionOlustur(label, value)));
  const customOption = optionOlustur("Özel EPSG kodu…", "custom");
  select.append(customOption);
  select.value = varsayilan === "auto" ? "" : varsayilan;
  if (custom) {
    const sync = () => {
      custom.style.display = select.value === "custom" ? "inline-block" : "none";
      if (select.value !== "custom") custom.value = "";
    };
    select.onchange = sync;
    sync();
  }
}

export function seciliCrs(select, custom) {
  if (!select || select.value === "") return "";
  return select.value === "custom" ? (custom?.value || "").trim() : select.value;
}
