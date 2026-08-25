import { $ } from "../ui/dom.js";
import { api } from "../core/api.js";
import { map } from "./init.js";

/* ---------------- harita adres arama (il/ilçe/mahalle) ---------------- */
(function geocodeSearch() {
  const inp = $("geoQ"), box = $("geoResults");
  let items = [], active = -1, timer = null, seq = 0, geoMarker = null;
  const hide = () => { box.classList.add("hidden"); box.innerHTML = ""; active = -1; };
  function render() {
    if (!items.length) { box.innerHTML = `<div class="geo-empty">Sonuç yok</div>`; box.classList.remove("hidden"); return; }
    box.innerHTML = items.map((it, i) =>
      `<div class="geo-item${i === active ? " active" : ""}" data-i="${i}">
         <span class="geo-type">${it.tur || ""}</span> ${it.ad}</div>`).join("");
    box.classList.remove("hidden");
    box.querySelectorAll(".geo-item").forEach(el =>
      el.onclick = () => choose(+el.dataset.i));
  }
  function choose(i) {
    const it = items[i]; if (!it) return;
    inp.value = it.ad; hide();
    const s = it.sinir;
    if (s && s.length === 4) map.fitBounds([[+s[0], +s[2]], [+s[1], +s[3]]], { maxZoom: 15 });
    else map.setView([it.lat, it.lon], 13);
    if (geoMarker) geoMarker.remove();
    geoMarker = L.marker([it.lat, it.lon]).addTo(map)
      .bindTooltip(it.ad, { direction: "top" }).openTooltip();
  }
  async function run(q) {
    const my = ++seq;
    try {
      const r = await api("/api/geocode?q=" + encodeURIComponent(q));
      if (my !== seq) return;                 // eski istek — yoksay
      items = Array.isArray(r) ? r : []; active = -1; render();
    } catch (e) { if (my === seq) { items = []; render(); } }
  }
  inp.addEventListener("input", () => {
    const q = inp.value.trim();
    clearTimeout(timer);
    if (q.length < 2) { hide(); return; }
    timer = setTimeout(() => run(q), 350);    // debounce (Nominatim politikası)
  });
  inp.addEventListener("keydown", (e) => {
    if (box.classList.contains("hidden") || !items.length) {
      if (e.key === "Enter") { e.preventDefault(); if (inp.value.trim().length >= 2) run(inp.value.trim()); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % items.length; render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + items.length) % items.length; render(); }
    else if (e.key === "Enter") { e.preventDefault(); choose(active < 0 ? 0 : active); }
    else if (e.key === "Escape") { hide(); }
  });
  document.addEventListener("click", (e) => { if (!$("mapSearch").contains(e.target)) hide(); });
})();

