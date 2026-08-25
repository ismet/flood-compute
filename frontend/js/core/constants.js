/**
 * @fileoverview Paylaşımlı sabitler — yalnızca ≥2 özellik tüketicisi olanlar.
 * @module core/constants
 * Owns: — (salt okunur sabitler, S yazmaz)
 * Exports: DURS, RPS, M_LABEL, CMP_LABELS, CMP_RPS
 * Notes:
 *  - §3.1 constants admission: ≥2 feature consumer yoksa sabit modül-lokal kalır
 *    (MRP, SNY_RPS, CMP_COLORS, RES_RP, DPLV_*, INFO_RENK, RAIN_* vb. lokal).
 *  - Rank 0 (core).
 */

export const DURS = [2, 4, 6, 8, 12, 18, 24];
export const RPS = ["2", "5", "10", "25", "50", "100", "OET"];
export const M_LABEL = { dsi: "DSİ Sentetik", snyder: "Snyder", mockus: "Mockus", rasyonel: "Rasyonel" };
export const CMP_LABELS = { dsi: "DSİ Sentetik", mockus: "Mockus", rasyonel: "Rasyonel", snyder: "Snyder" };
export const CMP_RPS = ["2", "5", "10", "25", "50", "100", "500", "1000", "10000", "OET"];
