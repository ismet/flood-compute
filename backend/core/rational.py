# -*- coding: utf-8 -*-
"""Rasyonel yöntem (A ≤ ~1 km² havzalar) — Excel RASYONEL sayfası mantığı.

Q_T = YADK · C_T · I_Tc,T · A / 3.6
  C_T   = C100 · (T/100)^üs           (üs Excel'de 0.2)
  Tc    = 0.0194716·(L/√S)^0.77 dk    (Kirpich, min 5 dk; hidrografta alt sınır 0.5 sa)
  I     = P(Tc)/Tc                    (P: istasyon PLV eğrisi ile 24 sa yağıştan)

Not: Excel'de şiddet ABAK3 nomogram sayısallaştırmasından okunur; burada aynı
istasyonun PLV eğrisi kullanılır (istasyona özgü, şeffaf eşdeğer).
"""
import math

from . import tables
from .engine import MF, RETURN_PERIODS, extrapolate


def compute(inp, c100=0.2, exponent=0.2):
    A = inp["A_km2"]
    L_m = inp["L_km"] * 1000.0
    elev = inp["elevations"]
    S_lin = (elev[-1] - elev[0]) / L_m  # doğrusal eğim (C8)
    K = L_m / math.sqrt(S_lin)
    tc_min = 0.0194716203836698 * K ** 0.77
    tc_min = max(5.0, tc_min)
    tc_hr = max(0.5, tc_min / 60.0)

    yadk = 1.0 if A <= 25 else tables.yad_abak2(tc_hr, A)
    plv_tc = tables.plv_ratio(tc_hr, inp["dplv_ratios"])

    Q = {}
    for T in RETURN_PERIODS:
        c_t = c100 * (T / 100.0) ** exponent
        P_tc = inp["P24"][T] * MF * plv_tc
        intensity = P_tc / tc_hr  # mm/sa
        Q[T] = yadk * c_t * intensity * A / 3.6
    ext = extrapolate(Q[10], Q[100])
    tb_hr = 100.0 * tc_min * 60.0 / 14.0 / 3600.0  # hidrograf taban süresi (Excel B25)
    return {
        "S_dogrusal": S_lin, "Tc_dk": tc_min, "Tc_saat": tc_hr,
        "YADK": yadk, "PLV_Tc": plv_tc, "C100": c100, "us": exponent,
        "Q": Q, "Q_ext": ext, "Tb_saat": tb_hr,
    }
