# -*- coding: utf-8 -*-
"""Snyder sentetik birim hidrograf yöntemi — SNYDER V7.xlsm mantığı.

Parametreler (BAŞLANGIÇ sayfası):
  tp   = Ct·(L·Lc)^0.30              havza gecikmesi (saat)
  tr   = round(tp/5.5)              standart yağış (blok) süresi (saat)
  qp   = 2760·Cp/tp                 birim pik (L/s/km²/cm)
  Qp   = A·qp·10⁻³/10               pik debi (m³/s/mm)
  Tp   = round(tr/2 + tp)           pike varış (saat)
  Tb   = round((3 + 3·tp/24)·24)    taban süresi (saat)

Birim hidrograf: W50/W75 genişlik noktalarıyla kurulan, hacmi 1 mm'ye
(V = A·10³ m³) dengelenmiş Snyder UH. Taşkın hidrografı: 24 saatlik tasarım
sağanağı tr saatlik n=24/tr bloğa bölünür (YZD dağılımı + alansal azaltma +
1.13 maksimizasyon + SCS akış), her blok UH ile çarpılıp tr saat kaydırılarak
süperpoze edilir; taban akım eklenir. (Excel makro CommandButton1/10 karşılığı.)
"""
import math

from . import tables
from .engine import RETURN_PERIODS, extrapolate, scs_runoff

MF = 1.13  # maksimizasyon faktörü (Excel: 1.13)


# ----------------------------------------------------------- Snyder parametreleri
def parameters(A_km2, L_km, Lc_km, Ct, Cp):
    tp = Ct * (L_km * Lc_km) ** 0.30
    tr = round(tp / 5.5)
    qp = 2760.0 * Cp / tp                 # L/s/km²/cm
    Qp = A_km2 * qp * 1e-3 / 10.0         # m³/s/mm
    Tp = round(tr / 2.0 + tp)
    Tb = round((3.0 + 3.0 * tp / 24.0) * 24.0)
    return {"tp": tp, "tr": int(tr), "qp": qp, "Qp": Qp, "Tp": int(Tp), "Tb": int(Tb)}


# ------------------------------------------------------------- birim hidrograf
def unit_hydrograph(A_km2, par, W50, W75):
    """Saatlik Snyder UH (m³/s/mm), hacmi 1 mm'ye dengelenmiş.

    Yükselen/pik/inen kol W50-W75 genişlik noktalarıyla; kuyruk, toplam hacim
    tam 1 mm olacak şekilde üstel azalışla kapatılır (Excel'deki elle ayarın
    otomatik karşılığı). Pik = Qp, pike varış = Tp korunur.
    """
    Qp, Tp, Tb = par["Qp"], par["Tp"], par["Tb"]
    # kontrol noktaları (Snyder: genişliğin 1/3'ü pikten önce, 2/3'ü sonra)
    pts = [
        (0.0, 0.0),
        (Tp - W50 / 3.0, 0.5 * Qp),
        (Tp - W75 / 3.0, 0.75 * Qp),
        (float(Tp), Qp),
        (Tp + W75 * 2.0 / 3.0, 0.75 * Qp),
        (Tp + W50 * 2.0 / 3.0, 0.5 * Qp),
    ]
    t_last, y_last = pts[-1]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]

    # sabit bölüm (0..t_last) saatlik örnekleme
    n_fixed = int(math.floor(t_last))
    q = [tables.interp1(float(i), xs, ys) for i in range(0, n_fixed + 1)]

    target = A_km2 / 3.6  # Σ Q_i (saatlik) = 1 mm hacim
    s_fixed = sum(q)
    tail_t = list(range(n_fixed + 1, Tb + 1))
    s_needed = target - s_fixed

    if tail_t and s_needed > 0:
        # üstel kuyruk: y = y_last·exp(-λ·(t - t_last)); Σ = s_needed olacak λ
        def tail_sum(lam):
            return sum(y_last * math.exp(-lam * (t - t_last)) for t in tail_t)

        lo, hi = 1e-6, 5.0
        if tail_sum(hi) > s_needed:      # çok fazla hacim → daha dik iner
            hi = 50.0
        for _ in range(80):
            mid = (lo + hi) / 2.0
            if tail_sum(mid) > s_needed:
                lo = mid
            else:
                hi = mid
        lam = (lo + hi) / 2.0
        q += [y_last * math.exp(-lam * (t - t_last)) for t in tail_t]
    else:
        # hacim zaten dolu/aşkın: kuyruğu doğrusal sıfıra indir
        q += [max(0.0, y_last * (1 - (t - t_last) / max(1.0, Tb - t_last))) for t in tail_t]

    volume_mm = sum(q) * 3.6 / A_km2  # kontrol (≈1)
    return q, volume_mm


# -------------------------------------------------------- artım akış blokları
def incremental_blocks(P, cn, region, tr, yald):
    """24 saatlik sağanağın tr saatlik bloklarında artım akışlar (mm).

    Excel AKIŞ sayfası: D_k = P·1.13·YZD_k·YALD, F_k = SCS(D_k, CN),
    G_k = F_k − F_{k−1}. n = round(24/tr) blok.
    """
    n = int(round(24.0 / tr))
    incs, prev = [], 0.0
    for k in range(1, n + 1):
        ratio = min(1.0, k * tr / 24.0)
        yzd = 1.0 if ratio >= 1.0 else tables.yzdo(round(ratio, 6), region)
        D = P * MF * yzd * yald
        F = scs_runoff(D, cn)
        incs.append(F - prev)
        prev = F
    return incs


def superpose(uh, incs, tr, qbaz):
    """Blokları tr saat kaydırarak UH ile süperpoze eder, taban akım ekler."""
    N = len(uh) - 1
    M = N + tr * len(incs)
    out = [0.0] * (M + 1)
    for i in range(M + 1):
        s = 0.0
        for k, h in enumerate(incs):
            idx = i - k * tr
            if 0 <= idx <= N:
                s += uh[idx] * h
        out[i] = s + qbaz
    return out


# ------------------------------------------------------------------ ana akış
def compute(inp):
    """Snyder yöntemi tam hesap.

    inp: {A_km2, L_km, Lc_km, Ct, Cp, W50, W75, region, CN2, CN3,
          Qbaz, P24{2..100}, P24_OET, YALD?}
    """
    A, L, Lc = inp["A_km2"], inp["L_km"], inp["Lc_km"]
    par = parameters(A, L, Lc, inp["Ct"], inp["Cp"])
    tr = par["tr"]
    if tr < 1:
        tr = 1
        par["tr"] = 1
    yald = inp.get("YALD")
    if yald is None:
        yald = tables.yad_abak2(24.0, A) if A > 25 else 1.0
    W50 = inp.get("W50") or par["Tp"] * 1.45
    W75 = inp.get("W75") or W50 * 0.586
    qbaz = inp.get("Qbaz", 0.0) or 0.0

    uh, vol = unit_hydrograph(A, par, W50, W75)

    cn2, cn3 = inp["CN2"], inp.get("CN3")
    if not cn3:
        cn3 = tables.cn2_to_cn3(cn2)

    hydro, peaks = {}, {}
    for T in RETURN_PERIODS:
        incs = incremental_blocks(inp["P24"][T], cn2, inp["region"], tr, yald)
        q = superpose(uh, incs, tr, qbaz)
        hydro[str(T)] = q
        peaks[str(T)] = max(q)
    # OET: CIII
    incs = incremental_blocks(inp["P24_OET"], cn3, inp["region"], tr, yald)
    q = superpose(uh, incs, tr, qbaz)
    hydro["OET"] = q
    peaks["OET"] = max(q)

    ext = extrapolate(peaks["10"], peaks["100"])
    t_axis = [float(i) for i in range(max(len(h) for h in hydro.values()))]

    return {
        "parametreler": {**par, "W50": W50, "W75": W75, "YALD": yald,
                         "hacim_mm": vol, "CN2": cn2, "CN3": cn3, "Qbaz": qbaz},
        "birim_hidrograf": uh,
        "hidrograflar": hydro,
        "pikler": {**peaks, "500": ext[500], "1000": ext[1000], "10000": ext[10000]},
        "t_axis": t_axis,
    }
