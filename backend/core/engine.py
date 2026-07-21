# -*- coding: utf-8 -*-
"""Taşkın hesap motoru — Excel (SENTETİK YÖNTEMLER TABLOLU) mantığının birebir kopyası.

Yöntemler:
  * DSİ Sentetik (BH2 birim hidrograf + 2..24 saat süperpozisyonlu taşkın hidrografları)
  * Mockus (süperpozesiz, K1/K2/K3 pik debiler)
Ekstrapolasyon: Q500/Q1000/Q10000 ve debi->tekerrür yılı ters çözümü.
"""
import math

from . import tables

RETURN_PERIODS = [2, 5, 10, 25, 50, 100]  # + OET (olası en yüksek / muhtemel maksimum)
DURATIONS = [2, 4, 6, 8, 12, 18, 24]      # sağanak süreleri (saat)
DT = 0.5                                   # hidrograf zaman adımı (saat)
MF = 1.13                                  # maksimizasyon faktörü

# Mockus Tc katsayısı: 0.0078*(1/0.3048009)^0.77/60  (Kirpich, metrik)
TC_COEF = 0.0078 * (1.0 / 0.3048009) ** 0.77 / 60.0


# ----------------------------------------------------------------- yardımcılar
def harmonic_slope(elevations, L_m):
    """10 parçalı harmonik eğim: S = (10 / Σ 1/sqrt(Δh/l))², l = L/10."""
    if len(elevations) != 11:
        raise ValueError("11 kot değeri gerekli (0..10)")
    seg = L_m / 10.0
    tot = 0.0
    for i in range(1, 11):
        dh = abs(elevations[i] - elevations[i - 1])
        if dh <= 0:
            raise ValueError("Kot profili artan olmalı (Δh > 0)")
        tot += math.sqrt(seg / dh)
    return (10.0 / tot) ** 2


def scs_S(cn):
    """SCS potansiyel tutma S (mm)."""
    return (1000.0 / cn - 10.0) * 25.4


def scs_runoff(P, cn):
    """SCS akış (mm); P<=0.2S ise 0."""
    S = scs_S(cn)
    if P <= 0.2 * S:
        return 0.0
    return (P - 0.2 * S) ** 2 / (P + 0.8 * S)


def extrapolate(q10, q100):
    return {
        500: q10 + 1.692 * (q100 - q10),
        1000: q10 + 1.99 * (q100 - q10),
        10000: q10 + 2.98 * (q100 - q10),
    }


def find_return_period(q, q10, q100):
    """Yıl_Ara makrosunun analitik çözümü: Q = Q10 + (0.99·log10(T) − 0.98)·(Q100−Q10)."""
    if q100 == q10:
        return None
    x = (q - q10) / (q100 - q10)
    return 10 ** ((x + 0.98) / 0.99)


def mockus_D_round(d):
    """Excel D yuvarlama kuralı (0.5'e)."""
    frac = d - int(d)
    if 0 <= frac <= 0.1:
        return float(int(d))
    if 0.1 < frac <= 0.6:
        return int(d) + 0.5
    return float(int(d) + 1)


# ------------------------------------------------------------------- Mockus
def mockus(inp, S_harm):
    A, L_m = inp["A_km2"], inp["L_km"] * 1000.0
    cn2, cn3 = inp["CN2"], inp["CN3"]
    elev = inp["elevations"]
    tc = TC_COEF * (L_m ** 0.77) / (S_harm ** 0.385)
    D = mockus_D_round(2.0 * math.sqrt(tc))
    tp = 0.5 * D + 0.6 * tc
    k3 = round(0.201 + 0.01183 * (L_m / 1000.0) / math.sqrt(A)
               - 0.2646 * (elev[-1] - elev[0]) / 1000.0 / math.sqrt(A), 3)
    ks = {"K1": 0.208, "K2": 0.163, "K3": k3}
    qps = {k: v * A / tp for k, v in ks.items()}

    plv_D = tables.plv_ratio(D, inp["dplv_ratios"])
    yadk = 1.0 if A <= 25 else tables.yad_abak2(D, A)
    mult = MF * yadk * plv_D  # B29

    p24 = inp["P24"]           # {2:..,5:..,...,100:..}
    p24_oet = inp["P24_OET"]
    out = {}
    for kname, qp in qps.items():
        q = {}
        for T in RETURN_PERIODS:
            ha = scs_runoff(p24[T] * mult, cn2)
            q[T] = ha * qp + inp["Qbaz"]
        ext = extrapolate(q[10], q[100])
        ha_oet = scs_runoff(p24_oet * mult, cn3)
        q_oet = ha_oet * qp  # Excel: QKAT'a baz akım eklenmiyor
        out[kname] = {"K": ks[kname], "qp": qp, "Q": q, "Q_ext": ext, "Q_OET": q_oet}
    return {
        "Tc": tc, "D": D, "Tp": tp, "PLV_D": plv_D, "YADK": yadk,
        "carpan": mult, "sonuclar": out,
        "rasyonel_uyari": A <= 1.0,
    }


# --------------------------------------------------------------- DSİ Sentetik
def dsi_onhesap(inp, S_harm):
    A, L, Lc = inp["A_km2"], inp["L_km"], inp["Lc_km"]
    qp = 414.0 * A ** -0.225 * (L * Lc / math.sqrt(S_harm)) ** -0.16  # l/s/km²/mm
    Qp = A * qp * 1e-3   # m³/s/mm
    Vb = A * 1e3         # m³ (1 mm akış hacmi ×10³)
    T_s = 3.65 * Vb / Qp
    T_hr = round(T_s / 3600.0)
    tp = T_hr / 5.0
    return {"qp": qp, "Qp": Qp, "Vb": Vb, "T_saat": T_hr, "Tp": tp}


def dsi_unit_hydrograph(Qp, Tp, T_hr):
    """BH2: boyutsuz eğri ölçekle, 0.5 saat adımına yeniden örnekle, piki Qp'ye düzelt."""
    dless = tables.load("bh2_dimensionless")
    ts = [t * Tp for t in dless["t_tp"]]
    qs = [q * Qp for q in dless["q_qp"]]
    n = int(round(T_hr / DT)) + 1
    grid_t, grid_q = [], []
    for i in range(n):
        t = i * DT
        if t > ts[-1]:
            q = 0.0
        else:
            q = tables.interp1(t, ts, qs)
        grid_t.append(t)
        grid_q.append(q)
    if grid_q:
        mx = max(grid_q)
        if mx > 0:
            grid_q = [Qp if abs(q - mx) < 1e-12 else q for q in grid_q]
    return grid_t, grid_q


def incremental_runoff(inp, duration, cn, p24_value):
    """Bir sağanak süresi için 2'şer saatlik artım akışları (mm)."""
    A = inp["A_km2"]
    region = inp["region"]
    plv_D = tables.plv_ratio(duration, inp["dplv_ratios"])
    if A <= 25:
        yad = 1.0
    else:
        yad = tables.yad_at_datagir_durations(A)[duration]
    base = p24_value * MF * plv_D * yad
    incs, prev = [], 0.0
    for k in range(2, duration + 1, 2):
        r = k / duration
        y = 1.0 if k == duration else tables.yzd(round(r, 6), region)
        cum = scs_runoff(base * y, cn)
        incs.append(cum - prev)
        prev = cum
    return incs


def superpose(uh_q, incs, qbaz):
    """h bloklarını (2'şer saat kaydırarak) birim hidrografla süperpoze eder."""
    lag_steps = int(round(2.0 / DT))
    n = len(uh_q) + lag_steps * (len(incs) - 1)
    out = [0.0] * n
    for i, h in enumerate(incs):
        off = i * lag_steps
        for j, q in enumerate(uh_q):
            out[off + j] += q * h
    return [v + qbaz for v in out]


def dsi_flood_hydrographs(inp, on, kar_add=0.0):
    """Tüm süre × tekerrür kombinasyonları için taşkın hidrografları ve pikler."""
    uh_t, uh_q = dsi_unit_hydrograph(on["Qp"], on["Tp"], on["T_saat"])
    cn2, cn3 = inp["CN2"], inp["CN3"]
    hydro, peaks = {}, {}
    for D in DURATIONS:
        hd, pk = {}, {}
        for T in RETURN_PERIODS:
            incs = incremental_runoff(inp, D, cn2, inp["P24"][T])
            q = superpose(uh_q, incs, inp["Qbaz"])
            hd[str(T)] = q
            pk[str(T)] = max(q)
        incs = incremental_runoff(inp, D, cn3, inp["P24_OET"])
        q = superpose(uh_q, incs, inp["Qbaz"])
        if kar_add:
            q = [v + kar_add for v in q]
        hd["OET"] = q
        pk["OET"] = max(q)
        hydro[str(D)] = hd
        peaks[str(D)] = pk
    t_axis = [i * DT for i in range(max(len(h["2"]) for h in hydro.values()))]
    return {"uh_t": uh_t, "uh_q": uh_q, "hidrograflar": hydro,
            "pikler": peaks, "t_axis": t_axis}


# ------------------------------------------------------------------ ana akış
def compute(inp):
    """Tam hesap. inp:
    {ad, A_km2, L_km, Lc_km, CN2, CN3?, region(A/B/C), elevations[11],
     Qbaz, P24{2,5,10,25,50,100}, P24_OET, dplv_ratios[14], kar_qmax?}
    """
    inp = dict(inp)
    inp.setdefault("Qbaz", 0.0)
    if not inp.get("CN3"):
        inp["CN3"] = tables.cn2_to_cn3(inp["CN2"])
    S_harm = harmonic_slope(inp["elevations"], inp["L_km"] * 1000.0)

    mck = mockus(inp, S_harm)
    on = dsi_onhesap(inp, S_harm)
    dsi = dsi_flood_hydrographs(inp, on, kar_add=inp.get("kar_qmax") or 0.0)

    # KABULET pik matrisi + ekstrapolasyonlar
    kabulet = {}
    for D in DURATIONS:
        pk = dsi["pikler"][str(D)]
        ext = extrapolate(pk["10"], pk["100"])
        kabulet[str(D)] = {**pk, "500": ext[500], "1000": ext[1000], "10000": ext[10000]}

    return {
        "girdi_ozeti": {
            "ad": inp.get("ad", ""),
            "A_km2": inp["A_km2"], "L_km": inp["L_km"], "Lc_km": inp["Lc_km"],
            "CN2": inp["CN2"], "CN3": inp["CN3"], "S_harmonik": S_harm,
            "Qbaz": inp["Qbaz"], "bolge": inp["region"],
        },
        "mockus": mck,
        "dsi_onhesap": on,
        "dsi": dsi,
        "kabulet": kabulet,
    }
