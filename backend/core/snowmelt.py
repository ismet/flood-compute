# -*- coding: utf-8 -*-
"""Kar erimesi (KAR1 sayfası) — derece-gün yöntemi.

Girdi: referans DMİ istasyonunun günlük en büyük sıcaklıkları (kümülatif değil,
günlük değerler), kar alanı, kotlar, erime oranı, erime periyodu (5/10/15 gün).
Sıcaklıklar kar alanı ortalama kotuna 0.5°C/100 m ile taşınır; en büyük değerler
ortaya, sonrakiler iki yana dağıtılır; Qkar = T·Akar·oran·10³/86400.
"""


def _dagit(values, n):
    """En büyüğü ortaya, 2.'yi üstüne, 3.'yü altına... dağıtan patern (KAR1 E kolonu)."""
    srt = sorted(values, reverse=True)[:n]
    out = [None] * n
    mid = n // 2
    order = [mid]
    up, down = mid - 1, mid + 1
    for i in range(1, n):
        if i % 2 == 1 and up >= 0:
            order.append(up); up -= 1
        elif down < n:
            order.append(down); down += 1
        else:
            order.append(up); up -= 1
    for rank, pos in enumerate(order):
        out[pos] = srt[rank]
    return out


def compute(daily_tmax, a_kar_km2, h_kar_m, h_ist_m, melt_rate=1.08, period=15):
    """Qkar hidrografı (günlük seri) ve pik değeri döner."""
    dT = round((h_kar_m - h_ist_m) * 0.5 / 100.0, 1)
    proj = [t - dT for t in daily_tmax if t is not None]
    proj = [t for t in proj if t > 0]
    if not proj:
        return {"dT": dT, "Qkar_gunluk": [], "Qkar_pik": 0.0}
    n = min(period, len(proj))
    pattern = _dagit(proj, n)
    q = [round(t * a_kar_km2 * melt_rate * 1e3 / 86400.0, 1) for t in pattern]
    return {"dT": dT, "sicaklik_paterni": pattern, "Qkar_gunluk": q, "Qkar_pik": max(q)}
