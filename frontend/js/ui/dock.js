/**
 * @fileoverview Dock minimize/maximize helper — header-only minimize for map overlays.
 * @module ui/dock
 * Owns: minimized Set (module-local, transient — not in S, not persisted to project file)
 * Exports: wireDock, isMinimized, setMinimized, clearMinimized
 * Notes:
 *  - Rank 1 (ui) — may import core/state and ui/dom, never map/wizard/modes.
 *  - Minimized = header-only 36px (CSS .dock-minimized hides body); maximized = fit-content + max-height cap + inner scroll.
 *  - Generic header handling: existing .cmp-head/.chart-head/.hesap-head reused; rainDock gets new .dock-head.
 *  - Close button stays hide (hidden); minimize toggles .dock-minimized only.
 */
import { $ } from "./dom.js";

const minimized = new Set();

export function isMinimized(id) {
  return minimized.has(id);
}

export function setMinimized(id, v) {
  const el = $(id);
  if (!el) return;
  if (v) minimized.add(id);
  else minimized.delete(id);
  el.classList.toggle("dock-minimized", v);
  const btn = el.querySelector(".dock-min-btn");
  if (btn) {
    btn.textContent = v ? "▴" : "▾";
    btn.setAttribute("aria-label", v ? "Büyüt" : "Küçült");
    btn.setAttribute("aria-expanded", String(!v));
    btn.title = v ? "Büyüt" : "Küçült";
  }
  // Chart.js canvases need resize after expand (maintainAspectRatio:false measures parent)
  if (!v) {
    try {
      // Let layout settle before Chart measures
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
      });
    } catch (e) {}
  }
}

export function clearMinimized() {
  const ids = Array.from(minimized);
  ids.forEach((id) => setMinimized(id, false));
  minimized.clear();
}

export function wireDock(id, opts = {}) {
  const el = $(id);
  if (!el) return false;
  if (el.dataset.dockWired) return true;
  // Find existing header
  let head = el.querySelector(".cmp-head, .chart-head, .hesap-head, .dock-head");
  if (!head) {
    // rainDock and any future header-less dock
    head = document.createElement("div");
    head.className = "dock-head";
    const title = opts.title || "Panel";
    // Escape title via textContent for safety
    const b = document.createElement("b");
    b.textContent = title;
    head.appendChild(b);
    el.prepend(head);
  } else {
    // Ensure existing header has dock-head behavior? Keep original class for CSS.
    // No need to add class.
  }
  // Avoid double wire
  if (head.querySelector(".dock-min-btn")) {
    el.dataset.dockWired = "1";
    return true;
  }
  const closeBtn = head.querySelector("#btnCloseCmp, #btnCloseMcmp, #btnCloseRes, #btnClosePar, #btnCloseChart");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dock-min-btn";
  btn.textContent = "▾";
  btn.setAttribute("aria-label", "Küçült");
  btn.setAttribute("aria-expanded", "true");
  btn.title = "Küçült";
  btn.addEventListener("click", () => {
    const cur = isMinimized(id);
    setMinimized(id, !cur);
  });
  if (closeBtn) {
    head.insertBefore(btn, closeBtn);
  } else {
    head.appendChild(btn);
  }
  el.dataset.dockWired = "1";
  // Respect existing minimized state (if any) — initially all maximized
  if (minimized.has(id)) setMinimized(id, true);
  return true;
}
