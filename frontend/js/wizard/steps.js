/**
 * @fileoverview Adım navigasyon yardımcıları.
 * @module wizard/steps
 * Owns: STEP_KEYS, adım done işaretleme
 * Exports: STEP_KEYS, markDone, updateComputeReady
 * Notes: activateStep KÖK'te (app.js), burada değil — §3.1.
 *  Rank 2 (wizard).
 */

import { S } from "../core/state.js";
import { $ } from "../ui/dom.js";

export const N_STEPS = 6;
export const STEP_KEYS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
export const markDone = (n) => document.querySelector(`.step[data-step="${n}"]`)?.classList.add("done");
export function updateComputeReady() {
  const ready = $("inpA").value && $("inpL").value && S.P24w != null;
  $("btnCompute").disabled = !ready;
}
