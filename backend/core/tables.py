# -*- coding: utf-8 -*-
"""Sabit veri tabloları (Excel'den çıkarılmış JSON'lar) ve interpolasyon yardımcıları."""
import json
import os
from functools import lru_cache

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TABLES = os.path.join(ROOT, "data", "tables")


@lru_cache(maxsize=None)
def load(name):
    with open(os.path.join(TABLES, name + ".json"), encoding="utf-8") as f:
        return json.load(f)


def interp1(x, xs, ys):
    """Doğrusal interpolasyon; sınırlar dışında uç değer."""
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    for i in range(1, len(xs)):
        if x <= xs[i]:
            x0, x1 = xs[i - 1], xs[i]
            y0, y1 = ys[i - 1], ys[i]
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return ys[-1]


def yad_abak2(duration_hr, area_km2):
    """ABAK2 alansal azaltma abakı: (süre, alan) -> oran (0-1).

    Excel InterpolateXY karşılığı: önce alan satırında süre yönünde,
    sonra alan yönünde çift doğrusal interpolasyon.
    """
    t = load("abak2_yad")
    durs, areas, vals = t["durations_hr"], t["areas_km2"], t["percent"]
    row_vals = [interp1(duration_hr, durs, row) for row in vals]
    return interp1(area_km2, areas, row_vals) / 100.0


def yad_at_datagir_durations(area_km2):
    """DATAGİR X5:AD5 mantığı: 2,4,6,8,12,18,24 saat için YAD.

    Excel ABAK2'den 0.5/1/3/6/24 saatte okur, aradakileri kendi doğrusal
    kurallarıyla türetir (Y1/Z1/AA1 artımları). Aynısı uygulanır.
    """
    v = {d: yad_abak2(d, area_km2) for d in (0.5, 1, 3, 6, 24)}
    y2 = (v[3] - v[1]) / 2.0     # Y2 = (C10-B10)/2
    z2 = (v[6] - v[3]) / 3.0     # Z2 (kullanılmıyor ama Excel'de var)
    aa2 = (v[24] - v[6]) / 18.0  # AA2
    return {
        2: v[1] + y2,                      # X5
        4: round(v[3] + z2, 3),            # Y5 = C10 + Z2
        6: v[6],                           # Z5
        8: round(v[6] + 2 * aa2, 3),       # AA5
        12: round(v[6] + 6 * aa2, 3),      # AB5
        18: round(v[6] + 12 * aa2, 3),     # AC5
        24: v[24],                         # AD5
    }


def plv_ratio(duration_hr, dplv_ratios):
    """DPLV istasyon eğrisinden süreye karşılık yağış oranı (24 sa = 1)."""
    t = load("dplv_stations")
    xs = [m / 60.0 for m in t["durations_min"]]
    return interp1(duration_hr, xs, dplv_ratios)


def yzd(ratio, region):
    """24 saatten kısa sağanaklarda blok oranı (t/D) -> yağış yüzde dağılımı."""
    t = load("yzd_curves")
    return interp1(ratio, t["ratios"], t[region])


def cn2_to_cn3(cn2):
    """CN Şart II -> Şart III (Excel CNIII sayfası, doğrusal interpolasyon)."""
    t = load("cn2_to_cn3")
    return interp1(cn2, t["cn2"], t["cn3"])
