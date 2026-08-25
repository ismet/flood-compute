/**
 * @fileoverview Dilekçe — MGM veri talebi Word/PDF üretimi.
 * @module modes/dilekce
 * Owns: — (form state module-local; S yazmaz)
 * Exports: initDilekce
 * Notes:
 *  - Shadowing trap: handler içindeki local `const fmt` gölgeler — yeniden adlandırma.
 *  - Rank 2 (modes).
 */

import { S } from "../core/state.js";
import { api } from "../core/api.js";
import { fmt, _esc } from "../core/format.js"; // eslint-disable-line no-unused-vars -- local shadow in dilekçe handler intentionally per MIGRATION §3.1 trap, keep import for format.js cohesion
import { $, setStatus } from "../ui/dom.js";
import { makePasteGrid } from "../ui/paste-grid.js";

/* ---------------- DİLEKÇE (MGM veri talebi) ---------------- */
let dilStGrid = null,
  dilInited = false;
let dilImzaB64 = ""; // kullanıcı görsel yüklerse; boşsa backend varsayılanı kullanır
async function initDilekce() {
  if (!dilStGrid) {
    dilStGrid = makePasteGrid(
      "dilStGrid",
      "btnDilStAdd",
      "btnDilStClear",
      ["İst. No", "İstasyon Adı", "Ölçüm aralığı (yıl)"],
      [],
      3,
    );
  }
  if (dilInited) return;
  dilInited = true;
  try {
    const d = await api("/api/dilekce-defaults");
    if (!$("dilEposta").value) $("dilEposta").value = d.eposta || "";
    if (!$("dilGsm").value) $("dilGsm").value = d.gsm || "";
    if (!$("dilAdres").value.trim()) $("dilAdres").value = d.adres || "";
    if (!$("dilVeri").value.trim()) $("dilVeri").value = (d.veri_turleri || []).join("\n");
    if (d.imza_var) $("dilImzaPrev").src = "/api/dilekce-imza?" + Date.now();
  } catch (e) {
    setStatus("dilStatus", "Varsayılanlar yüklenemedi: " + e.message, "err");
  }
}
$("dilImzaFile").onchange = () => {
  const f = $("dilImzaFile").files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    dilImzaB64 = rd.result;
    $("dilImzaPrev").src = rd.result;
  };
  rd.readAsDataURL(f);
};
$("btnDilImzaReset").onclick = () => {
  dilImzaB64 = "";
  $("dilImzaFile").value = "";
  $("dilImzaPrev").src = "/api/dilekce-imza?" + Date.now();
};
$("btnDilFromTh").onclick = () => {
  const act = (S.thiessen || []).filter((t) => t.agirlik > 0);
  if (!act.length) return alert("Önce Yağış adımında Thiessen hesaplayın (Tek Havza → Adım 3)");
  if (!dilStGrid) initDilekce();
  dilStGrid.render(act.map((t) => ["", t.name, ""]));
};
$("btnDilekce").onclick = async () => {
  try {
    const rows = dilStGrid ? dilStGrid.read() : [];
    const istasyonlar = rows
      .filter((r) => (r[1] || "").trim() || (r[0] || "").trim())
      .map((r) => ({ no: (r[0] || "").trim(), ad: (r[1] || "").trim(), aralik: (r[2] || "").trim() }));
    if (!istasyonlar.length) throw new Error("En az bir istasyon girin (Ad)");
    const veri = $("dilVeri")
      .value.split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
    const fmt = $("dilFormat").value === "pdf" ? "pdf" : "docx";
    const body = {
      il: $("dilIl").value.trim(),
      istasyonlar,
      veri_turleri: veri.length ? veri : null,
      eposta: $("dilEposta").value.trim(),
      gsm: $("dilGsm").value.trim(),
      adres: $("dilAdres").value.trim(),
      imza: $("dilImza").value.trim(),
      kase: $("dilKase").value.trim(),
      format: fmt,
      imza_b64: dilImzaB64 || "",
      use_default_imza: true,
    };
    setStatus("dilStatus", "Dilekçe oluşturuluyor…", "loading");
    const resp = await fetch("/api/dilekce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      throw new Error(j.hata || j.detail || resp.statusText);
    }
    const blob = await resp.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (istasyonlar[0].ad || body.il || "MGM").replace(/[^\wçğıöşüÇĞİÖŞÜ]+/g, "_") + "_MGM_Dilekce." + fmt;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("dilStatus", "Dilekçe indirildi.", "ok");
  } catch (e) {
    setStatus("dilStatus", "Hata: " + e.message, "err");
  }
};

export { dilStGrid, dilImzaB64, initDilekce };
