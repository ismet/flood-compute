# -*- coding: utf-8 -*-
"""Ara havza hidrograf ötelemesi (routing) — tüm yöntemler.

Memba (üst) havzaların taşkın hidrografları, ara havzanın toplanma süresi (Tc)
kadar ötelenip ara havza hidrografına eklenerek en mansaptaki hidrograf bulunur:

    Q_mansap(t) = Q_ara(t) + Σ_i Q_memba_i(t − gecikme)

(Boztepe Bölüm 4.7 metodolojisi.) Her yöntem (DSİ, Snyder, Mockus, Rasyonel)
ayrı ayrı ötelenir. DSİ ve Snyder gerçek süperpozisyon hidrograflarıdır; Mockus
ve Rasyonel pik yöntemi olduğundan üçgen hidrografla (Tp/Tc–Tb) temsil edilir.
"""
from . import engine

RP_HYD = ["2", "5", "10", "25", "50", "100", "OET"]
DURS = ["2", "4", "6", "8", "12", "18", "24"]
METHOD_NAMES = {"dsi": "DSİ Sentetik", "snyder": "Snyder",
                "mockus": "Mockus", "rasyonel": "Rasyonel"}


def basin_tc(L_km, kotlar):
    """Havza toplanma süresi Tc (saat) — DSİ/Kirpich (metrik), harmonik eğimle."""
    S = engine.harmonic_slope(kotlar, L_km * 1000.0)
    return engine.TC_COEF * (L_km * 1000.0) ** 0.77 / S ** 0.385


def _gov_hydro(res, rp):
    """Bir tekerrür için hakim süredeki (en büyük pik) DSİ hidrografı (dt=0.5)."""
    best, pk = None, -1
    for d in DURS:
        v = res.get("kabulet", {}).get(d, {}).get(rp)
        if v is not None and v > pk:
            pk, best = v, d
    return res["dsi"]["hidrograflar"][best][rp] if best is not None else None


def _triangle(base, peak, tp, tb, dt):
    """(0,base)-(tp,peak)-(tb,base) üçgen hidrografını dt adımıyla örnekler."""
    n = int(round(tb / dt)) + 1
    out = []
    for i in range(n):
        t = i * dt
        if t <= tp:
            y = base + (peak - base) * (t / tp) if tp > 0 else peak
        elif t <= tb:
            y = peak - (peak - base) * ((t - tp) / (tb - tp)) if tb > tp else base
        else:
            y = base
        out.append(y)
    return out


def method_hydro(res, method, rp, dt):
    """Bir alt havza + yöntem + tekerrür için hidrograf dizisi (dt adımlı) döner."""
    qbaz = (res.get("girdi_ozeti", {}) or {}).get("Qbaz", 0) or 0
    if method == "dsi":
        return _gov_hydro(res, rp)
    if method == "snyder":
        sn = res.get("snyder")
        return sn["hidrograflar"].get(rp) if sn else None
    if method == "mockus":
        mk = res.get("mockus")
        if not mk:
            return None
        s, tp = mk["sonuclar"]["K1"], mk["Tp"]
        pk = (s["Q_OET"] if rp == "OET"
              else s["Q_ext"].get(rp) if rp in ("500", "1000", "10000") else s["Q"].get(rp))
        if pk is None:
            return None
        top = pk + qbaz if rp == "OET" else pk   # Q_OET baz akım içermez
        return _triangle(qbaz, top, tp, 2.67 * tp, dt)
    if method == "rasyonel":
        r = res.get("rasyonel")
        if not r or rp == "OET":
            return None
        pk = r["Q_ext"].get(rp) if rp in ("500", "1000", "10000") else r["Q"].get(rp)
        if pk is None:
            return None
        tc = r["Tc_saat"]
        tb = max(r["Tb_saat"], 2 * tc)
        return _triangle(qbaz, qbaz + pk, tc, tb, dt)
    return None


def _route_method(ara_res, up_results, method, lag_hours):
    dt = 1.0 if method == "snyder" else 0.5
    shift = int(round(lag_hours / dt))
    hydro, peaks, comps = {}, {}, {}
    for rp in RP_HYD:
        ara_h = method_hydro(ara_res, method, rp, dt) or []
        up_hs = [(method_hydro(ur, method, rp, dt) or []) for ur in up_results]
        if not ara_h and not any(up_hs):
            continue  # yöntemde bu tekerrür yok (ör. Rasyonel OET)
        maxlen = len(ara_h)
        for uh in up_hs:
            maxlen = max(maxlen, len(uh) + shift)
        if maxlen == 0:
            continue
        comb = [0.0] * maxlen
        for i, v in enumerate(ara_h):
            comb[i] += v
        for uh in up_hs:
            for i, v in enumerate(uh):
                comb[i + shift] += v
        hydro[rp] = comb
        peaks[rp] = max(comb) if comb else None
        comps[rp] = {"ara_pik": max(ara_h) if ara_h else None,
                     "memba_pikleri": [max(uh) if uh else None for uh in up_hs],
                     "ara_h": ara_h, "memba_hs": up_hs}  # ötelenmemiş bileşen hidrografları
    n = max((len(v) for v in hydro.values()), default=0)
    return {"dt": dt, "shift_adim": shift, "hidrograflar": hydro,
            "pikler": peaks, "bilesenler": comps,
            "t_axis": [round(i * dt, 3) for i in range(n)]}


def route(ara_res, up_results, lag_hours, methods=None):
    """Ara havza + ötelenmiş memba hidrograflarını her yönteme göre toplar.

    methods: ["dsi","snyder","mockus","rasyonel"] alt kümesi. Verilmezse
    sonuçlarda mevcut tüm yöntemler otelenir.
    """
    if methods is None:
        methods = ["dsi"]
        if ara_res.get("snyder"):
            methods.append("snyder")
        if ara_res.get("mockus"):
            methods.append("mockus")
        if ara_res.get("rasyonel"):
            methods.append("rasyonel")
    out = {"lag_saat": lag_hours, "yontemler": {}}
    for m in methods:
        out["yontemler"][m] = _route_method(ara_res, up_results, m, lag_hours)
    return out
