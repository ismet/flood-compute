# -*- coding: utf-8 -*-
"""Ara havza hidrograf ötelemesi (routing).

Memba (üst) havzaların taşkın hidrografları, ara havzanın toplanma süresi (Tc)
kadar ötelenip ara havza hidrografına eklenerek en mansaptaki hidrograf bulunur:

    Q_mansap(t) = Q_ara(t) + Σ_i Q_memba_i(t − gecikme)

(Boztepe Bölüm 4.7 metodolojisi: "…gecikme süreleri kadar ötelenerek ara havza
taşkın hidrografına eklenmesi…")
"""
from . import engine

RP_HYD = ["2", "5", "10", "25", "50", "100", "OET"]
DURS = ["2", "4", "6", "8", "12", "18", "24"]
DT = 0.5  # DSİ hidrograf adımı (saat)


def basin_tc(L_km, kotlar):
    """Havza toplanma süresi Tc (saat) — DSİ/Kirpich (metrik), harmonik eğimle."""
    S = engine.harmonic_slope(kotlar, L_km * 1000.0)
    return engine.TC_COEF * (L_km * 1000.0) ** 0.77 / S ** 0.385


def _gov_hydro(res, rp):
    """Bir tekerrür için hakim süredeki (en büyük pik) DSİ hidrografı."""
    best, pk = None, -1
    for d in DURS:
        v = res.get("kabulet", {}).get(d, {}).get(rp)
        if v is not None and v > pk:
            pk, best = v, d
    if best is None:
        return None
    return res["dsi"]["hidrograflar"][best][rp]


def route(ara_res, up_results, lag_hours):
    """Ara havza + ötelenmiş memba hidrograflarını toplar.

    ara_res, up_results[i]: engine.compute sonuçları. lag_hours: öteleme (saat).
    Döner: {lag_saat, shift, hidrograflar{rp:[...]}, pikler{rp}, t_axis}.
    """
    shift = int(round(lag_hours / DT))
    out = {"lag_saat": lag_hours, "shift_adim": shift,
           "hidrograflar": {}, "pikler": {}, "bilesenler": {}}
    for rp in RP_HYD:
        ara_h = _gov_hydro(ara_res, rp) or []
        up_hs = [(_gov_hydro(ur, rp) or []) for ur in up_results]
        maxlen = len(ara_h)
        for uh in up_hs:
            maxlen = max(maxlen, len(uh) + shift)
        comb = [0.0] * maxlen
        for i, v in enumerate(ara_h):
            comb[i] += v
        for uh in up_hs:
            for i, v in enumerate(uh):
                comb[i + shift] += v
        out["hidrograflar"][rp] = comb
        out["pikler"][rp] = max(comb) if comb else None
        out["bilesenler"][rp] = {
            "ara_pik": max(ara_h) if ara_h else None,
            "memba_pikleri": [max(uh) if uh else None for uh in up_hs],
        }
    n = max((len(v) for v in out["hidrograflar"].values()), default=0)
    out["t_axis"] = [i * DT for i in range(n)]
    return out
