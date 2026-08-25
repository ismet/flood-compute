import { S } from "../core/state.js";
import { $ } from "../ui/dom.js";

export const STEP_KEYS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
export const markDone = (n) => document.querySelector(`.step[data-step="${n}"]`)?.classList.add("done");
export function updateComputeReady() {
  const ready = $("inpA").value && $("inpL").value && S.P24w != null;
  $("btnCompute").disabled = !ready;
}
