# -*- coding: utf-8 -*-
"""Noktasal Taşkın Frekans Analizi (NTFA) — DSİ ekstrem dağılım hesabı.

`ornek.xlsm` (DSİ frekans analizi şablonu) birebir karşılığı. Altı dağılım
(Normal, Log-Normal 2P/3P, Pearson Tip-3, Log-Pearson Tip-3, Gumbel) moment
yöntemiyle uydurulur, Simirnov-Kolmogorov testiyle karşılaştırılır ve Dmax'ı
en küçük olan dağılım "kabul edilen" sayılır.

Excel'deki sayfa karşılıkları:
  DATAGİR   -> siralama + ampirik olasılık (m/(N+1))
  LN2       -> momentler M1/M2/M3, Cv, Sn-1
  ND / LN2 / LN3 / P3 TABLO / LP3 / GUMBEL1  -> dağılım kuantilleri
  SONUÇLAR  -> ozet() çıktısı
"""
import math

from . import tables

# Excel'de sabit yazılı standart normal değişkenler (ND!B2:B9 + LN2!K17:K18).
# T = 2 ... 10 000 için z_T; Normal dağılım yalnız ilk sekizini kullanıyor.
TEKERRUR = (2, 5, 10, 25, 50, 100, 200, 500, 1000, 10000)
Z_T = (0.0, 0.8416, 1.2816, 1.7511, 2.0538, 2.3264, 2.575, 2.875,
       3.090522225780171, 3.7191242961969238)
NORMAL_TEKERRUR = 8                      # ND sayfası 500 yılda bitiyor

# Simirnov-Kolmogorov kritik katsayıları (ND!DU3:DU7)
KS_ANLAMLILIK = (0.80, 0.85, 0.90, 0.95, 0.99)
KS_CALFA = (1.075, 1.138, 1.224, 1.358, 1.628)

# SONUÇLAR!AD27 = ND!T3 + 0.01 — Normal dağılımın Dmax'ına şablonda sabit bir
# ceza ekleniyor. Kabul edilen dağılım seçimi buna bağlı olduğu için korunuyor.
NORMAL_DMAX_DUZELTME = 0.01


def _mean(v):
    return sum(v) / len(v)


def istatistikler(x):
    """Excel LN2/P3FORMÜL/LP3 sayfalarındaki moment hesapları.

    Dikkat: M2 önce yansız olmayan biçimde hesaplanıp C1 = N/(N-1) ile
    düzeltiliyor (LN2!F6 * H5). Doğrudan örnek varyansı almak binlerce
    satırda 1e-12 seviyesinde fark üretiyor, Excel sırası korunuyor.
    """
    n = len(x)
    if n < 3:
        raise ValueError("Frekans analizi için en az 3 yıllık veri gerekir.")
    s1 = sum(x)
    s2 = sum(v * v for v in x)
    s3 = sum(v ** 3 for v in x)
    m1 = s1 / n
    m2 = (s2 / n) - (s1 / n) ** 2
    m2c = m2 * (n / (n - 1))                       # LN2!F10
    sn1 = math.sqrt(m2c)                           # lineer standart sapma
    m3 = (s3 / n) + 2 * m1 ** 3 - 3 * m1 * (s2 / n)
    cv = sn1 / m1 if m1 else float("nan")          # LN2!F9
    # lineer çarpıklık (P3FORMÜL!D6)
    t3 = sum((v - m1) ** 3 for v in x)
    cs = (n * t3) / ((n - 1) * (n - 2) * sn1 ** 3) if sn1 else 0.0

    y = [math.log10(v) for v in x]                 # LP3 sayfası: 10 tabanlı log
    ylog = _mean(y)
    sy = math.sqrt(sum((v - ylog) ** 2 for v in y) / (n - 1))
    t3y = sum((v - ylog) ** 3 for v in y)
    csy = (n * t3y) / ((n - 1) * (n - 2) * sy ** 3) if sy else 0.0

    return {"n": n, "m1": m1, "m2": m2, "m2c": m2c, "sn1": sn1, "m3": m3,
            "cv": cv, "cs": cs, "log_ort": ylog, "log_sn1": sy, "log_cs": csy}


def _pearson_k(cs, sutun):
    """P3 TABLO VLOOKUP + doğrusal interpolasyon karşılığı.

    Excel: K = K1 - ((Cs1 - Cs) * ΔK) / ΔCs   (Cs1 = Cs'yi aşmayan tablo satırı)
    """
    t = tables.load("pearson3_k")
    css, ks = t["cs"], t["k"]
    if cs <= css[0]:
        return ks[0][sutun]
    if cs >= css[-1]:
        return ks[-1][sutun]
    i = 0
    while i + 1 < len(css) and css[i + 1] <= cs:
        i += 1
    cs1, cs2 = css[i], css[i + 1]
    k1, k2 = ks[i][sutun], ks[i + 1][sutun]
    d_cs = cs1 - cs2                      # Excel'deki "Cs fark" (negatif)
    d_k = k1 - k2
    return k1 - ((cs1 - cs) * d_k) / d_cs


# P3 tablosundaki 14 sütunun hangisi hangi tekerrür — TEKERRUR ile eşleme
_P3_SUTUN = {2: 4, 5: 5, 10: 6, 25: 7, 50: 8, 100: 9,
             200: 10, 500: 11, 1000: 12, 10000: 13}


def kuantiller(x, ist=None):
    """Altı dağılım için Q_T (m³/s). -> {dağılım: [T sırasına göre değerler]}"""
    ist = ist or istatistikler(x)
    m1, sn1, cv, cs = ist["m1"], ist["sn1"], ist["cv"], ist["cs"]

    # --- Normal (ND!E3:E10)
    normal = [m1 + Z_T[i] * sn1 for i in range(NORMAL_TEKERRUR)]
    normal += [None] * (len(TEKERRUR) - NORMAL_TEKERRUR)

    # --- Log-Normal 2 parametreli (LN2!G18:H27)
    ak = math.log(1 + cv * cv)
    ln2 = [m1 + ((math.exp(math.sqrt(ak) * z - ak / 2) - 1) / cv) * sn1 for z in Z_T]

    # --- Log-Normal 3 parametreli (LN3!B1:F18)
    #     çarpıklıktan Cv3 türetiliyor; işaret lineer çarpıklığa göre
    g = ist["m3"] / (ist["m2"] ** 1.5) if ist["m2"] > 0 else 0.0     # LN3!B1
    b2 = (-g + math.sqrt(g * g + 4)) / 2                             # LN3!B2
    cv3 = (1 - b2 ** (2 / 3)) / (b2 ** (1 / 3))                      # LN3!B3
    s5 = math.log(cv3 * cv3 + 1)                                     # LN3!B5
    isaret = -1 if cs < 0 else 1
    ln3 = []
    for z in Z_T:
        b = math.exp(math.sqrt(s5) * z - s5 / 2)
        ln3.append(m1 + isaret * ((b - 1) / cv3) * sn1)

    # --- Pearson Tip-3 (P3 TABLO!AO9:AO18) ve Log-Pearson Tip-3 (AO31:AO40)
    if -3 <= cs <= 3:
        p3 = [m1 + _pearson_k(cs, _P3_SUTUN[t]) * sn1 for t in TEKERRUR]
    else:
        p3 = [None] * len(TEKERRUR)
    csy, ylog, sy = ist["log_cs"], ist["log_ort"], ist["log_sn1"]
    if -3 <= csy <= 3:
        lp3 = [10 ** (ylog + _pearson_k(csy, _P3_SUTUN[t]) * sy) for t in TEKERRUR]
    else:
        lp3 = [None] * len(TEKERRUR)

    # --- Gumbel (GUMBEL1!O14:P23) — indirgenmiş değişkenin örnek Yn/Sn'i
    yn, sn = _gumbel_yn_sn(len(x))
    gumbel = []
    for t in TEKERRUR:
        yt = -math.log(-math.log(1 - 1.0 / t))
        gumbel.append(m1 + ((yt - yn) / sn) * sn1)

    return {"normal": normal, "ln2": ln2, "ln3": ln3,
            "p3": p3, "lp3": lp3, "gumbel": gumbel}


def _gumbel_yn_sn(n):
    """GUMBEL1!K14/L14: ampirik olasılıklardan indirgenmiş değişkenin ort/std'si.

    y_i = -ln(-ln(m/(N+1))), Yn = Σy/N, Sn = sqrt(Σy²/N - Yn²)  (yansız değil).
    """
    ys = [-math.log(-math.log(m / (n + 1.0))) for m in range(1, n + 1)]
    yn = sum(ys) / n
    sn = math.sqrt(sum(v * v for v in ys) / n - yn * yn)
    return yn, sn


# --------------------------------------------------- Simirnov-Kolmogorov testi
# Şablonun normal dağılım kuyruk yaklaşımı (ND!B12:B16, C2). İki bilinçli
# sapması aynen korunuyor, çünkü Dmax sıralaması -> kabul edilen dağılım:
#   * 2*pi yerine 44/7 (= 6.2857, gerçeği 6.2832)
#   * 3. katsayı 1.78147937 (literatürde 1.781477937 — şablonda bir hane eksik)
_CDF_P = 0.2316419
_CDF_B = (0.31938153, -0.356563782, 1.78147937, -1.821255978, 1.330274429)


def _normal_kuyruk(z):
    """-> (Q, F): Q tek taraflı kuyruk (şablonun 'Teorik Pi'si), F birikimli."""
    i = abs(z)
    j = (1 / math.sqrt(44 / 7)) * math.exp(-(i * i) / 2)
    k = 1 / (1 + _CDF_P * i)
    q = 1 - j * sum(b * k ** (m + 1) for m, b in enumerate(_CDF_B))
    return q, (1 - q if z < 0 else q)


def _p3_ters(k_gozlem, cs):
    """P3/LP3: gözlenen K'dan aşılmama olasılığı (%) — P3 TABLO AX:BE zinciri.

    K tablosunun bu Cs için interpole edilmiş 12 (K, P%) çifti üzerinde
    doğrusal ters interpolasyon. Excel VLOOKUP yaklaşık eşleme kullanıyor.
    """
    sutunlar = (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)
    yuzde = (1, 5, 10, 20, 50, 80, 90, 96, 98, 99, 99.5, 99.8)
    ks = [_pearson_k(cs, s) for s in sutunlar]
    k = ks[0] if (k_gozlem < ks[0] and k_gozlem < 0) else k_gozlem
    i = 0
    while i + 1 < len(ks) and ks[i + 1] <= k:
        i += 1
    if i >= len(ks) - 1:
        return yuzde[-1]
    d_k = ks[i] - ks[i + 1]
    d_p = yuzde[i] - yuzde[i + 1]
    return yuzde[i] - ((ks[i] - k) * d_p / d_k)


def ks_testi(x, ist=None):
    """Her dağılım için Dmax ve anlamlılık düzeylerinde kabul/red.

    -> {dağılım: {dmax, teorik_pi, amprik_pi, gozlem, kabul: {düzey: bool}}}
    """
    ist = ist or istatistikler(x)
    n, m1, sn1, cv, cs = ist["n"], ist["m1"], ist["sn1"], ist["cv"], ist["cs"]
    xs = sorted(x)
    amprik = [(m + 1) / (n + 1.0) for m in range(n)]

    ak = math.log(1 + cv * cv)
    g = ist["m3"] / (ist["m2"] ** 1.5) if ist["m2"] > 0 else 0.0
    b2 = (-g + math.sqrt(g * g + 4)) / 2
    cv3 = (1 - b2 ** (2 / 3)) / (b2 ** (1 / 3))
    s5 = math.log(cv3 * cv3 + 1)
    isaret = -1 if cs < 0 else 1
    yn, sn = _gumbel_yn_sn(n)
    ylog, sy, csy = ist["log_ort"], ist["log_sn1"], ist["log_cs"]

    def teorik(ad, xi):
        k = (xi - m1) / sn1
        if ad == "normal":
            return _normal_kuyruk(k)
        if ad == "ln2":
            z = (math.log(k * cv + 1) + ak / 2) / math.sqrt(ak)
            return _normal_kuyruk(z)
        if ad == "ln3":
            z = (math.log(1 + isaret * k * cv3) + s5 / 2) / math.sqrt(s5)
            return _normal_kuyruk(z)
        if ad == "gumbel":
            u = k * sn + yn
            f = math.exp(-math.exp(-u))
            return f, f
        if ad == "p3":
            f = _p3_ters(k, cs) / 100.0
            return f, f
        f = _p3_ters((math.log10(xi) - ylog) / sy, csy) / 100.0
        return f, f

    sonuc = {}
    for ad in ("normal", "ln2", "ln3", "p3", "lp3", "gumbel"):
        if ad == "p3" and not (-3 <= cs <= 3):
            sonuc[ad] = None
            continue
        if ad == "lp3" and not (-3 <= csy <= 3):
            sonuc[ad] = None
            continue
        en_iyi = None
        for xi, pe in zip(xs, amprik):
            try:
                q, f = teorik(ad, xi)
            except (ValueError, ZeroDivisionError):
                continue
            d = abs(f - pe)
            if en_iyi is None or d > en_iyi[0]:
                en_iyi = (d, q, pe, xi)
        if en_iyi is None:
            sonuc[ad] = None
            continue
        d, q, pe, xi = en_iyi
        if ad == "normal":
            d += NORMAL_DMAX_DUZELTME          # SONUÇLAR!AD27 = ND!T3 + 0.01
        kok = math.sqrt(n)
        bolen = kok if n > 50 else (kok + 0.12 + 0.11 / kok)
        sonuc[ad] = {"dmax": d, "teorik_pi": q, "amprik_pi": pe, "gozlem": xi,
                     "kabul": {a: d <= c / bolen
                               for a, c in zip(KS_ANLAMLILIK, KS_CALFA)}}
    return sonuc


DAGILIM_ADI = {
    "normal": "Normal Dağılım",
    "ln2": "Log-Normal (2 Parametreli)",
    "ln3": "Log-Normal (3 Parametreli)",
    "p3": "Pearson Tip-3 (Gama Tip-3)",
    "lp3": "Log-Pearson Tip-3",
    "gumbel": "Gumbel",
}


def ozet(x, istasyon="", yillar=None):
    """SONUÇLAR sayfasının karşılığı: tam NTFA çıktısı.

    x       : yıllık maksimum akımlar (m³/s), sıra önemsiz
    yillar  : x ile aynı uzunlukta yıl listesi (opsiyonel, veri tablosu için)
    """
    ist = istatistikler(x)
    q = kuantiller(x, ist)
    ks = ks_testi(x, ist)

    gecerli = {a: v for a, v in ks.items() if v}
    kabul = min(gecerli, key=lambda a: gecerli[a]["dmax"]) if gecerli else None

    n = ist["n"]
    xs = sorted(x)
    veri = [{"sira": i + 1,
             "yil": (sorted(yillar)[i] if yillar and len(yillar) == n else None),
             "x": xv, "sirali": xs[i], "amprik_yuzde": (i + 1) / (n + 1) * 100}
            for i, xv in enumerate(x)]

    return {
        "istasyon": istasyon,
        "veri": veri,
        "parametreler": {
            "yil_sayisi": n,
            "lineer_carpiklik": ist["cs"],
            "logaritmik_carpiklik": ist["log_cs"],
            "lineer_ortalama": ist["m1"],
            "lineer_standart_sapma": ist["sn1"],
            "logaritmik_ortalama": ist["log_ort"],
            "logaritmik_standart_sapma": ist["log_sn1"],
        },
        "tekerrur": list(TEKERRUR),
        "debiler": [{"dagilim": DAGILIM_ADI[a], "anahtar": a, "q": q[a],
                     "kabul_edilen": a == kabul} for a in DAGILIM_ADI],
        "ks_testi": [{"dagilim": DAGILIM_ADI[a], "anahtar": a, **(ks[a] or {})}
                     for a in DAGILIM_ADI],
        "ks_anlamlilik": list(KS_ANLAMLILIK),
        "kabul_edilen": kabul,
        "kabul_edilen_adi": DAGILIM_ADI.get(kabul, ""),
        "kabul_edilen_q": q.get(kabul) if kabul else None,
    }
