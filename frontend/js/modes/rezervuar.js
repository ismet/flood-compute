import { S } from "../core/state.js";
import { $ } from "../ui/dom.js";
// Stage 4 placeholder — full implementation in Stage 5
export async function openReservoir() {
  // Placeholder: delegate to legacy if still present (stage 4 fallback)
  try {
    const legacy = await import("../legacy.js");
    if (legacy.openReservoir) return legacy.openReservoir();
  } catch (e) {}
  alert("Rezervuar modu Stage 5'te taşınacak — şu anda legacy katmanda.");
}
