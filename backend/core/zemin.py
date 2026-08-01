# -*- coding: utf-8 -*-
"""Hidrolojik zemin grubunu (A/B/C/D) havzanın toprağından belirler.

NEDEN VAR: zemin grubu taşkın hesabının sonucunu en çok değiştiren girdidir —
Karakurt havzasında B ile C arasında Q100 296'dan 771 m³/s'ye çıkıyor, A ile D
arasında on kat oynuyor. Buna rağmen uygulamada gerekçesiz bir varsayılan
olarak duruyordu: açılır listede ikinci maddeye `selected` konmuştu. Kullanıcı
dokunmazsa program sessizce B'yi kullanıyor ve neden B olduğunu kimse
sormuyordu. Oysa üretilen ülke haritasına göre B, Türkiye'nin %1.6'sına uyuyor.

Katman `data/zemin/hsg_tr.tif` (~1 km, 80 kB) — bkz. tools/zemin_grubu_uret.py.
Grup, SoilGrids dokusundan Saxton & Rawls (2006) Ksat'ı hesaplanıp NRCS
NEH-630 Tablo 7-1 sınırlarına vurularak, profildeki EN GEÇİRİMSİZ katmana göre
verilir.

YZD bölgesiyle aynı kalıp: havza çıkarılınca otomatik belirlenir, GEREKÇESİ
döndürülür (piksel yüzdeleri, hangi ölçüt) ve kullanıcı değiştirebilir.
Otomatik seçim, kararı gizlemek için değil görünür kılmak için var.
"""
import os
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
KATMAN = os.path.join(ROOT, "data", "zemin", "hsg_tr.tif")

GRUP_AD = {1: "A", 2: "B", 3: "C", 4: "D"}
# NRCS NEH-630 Tablo 7-1 — grubun dayandığı Ksat aralığı (mm/sa), açıklama için
KSAT_ARALIK = {"A": "> 145", "B": "14.5 – 145", "C": "1.45 – 14.5", "D": "< 1.45"}

_yerel = threading.local()


def var_mi():
    return os.path.exists(KATMAN)


def _kaynak():
    src = getattr(_yerel, "src", None)
    if src is None:
        if not var_mi():
            raise RuntimeError(
                "Zemin grubu katmanı yok. Üretmek için:\n"
                "  python tools/zemin_grubu_uret.py")
        import rasterio
        src = rasterio.open(KATMAN)
        _yerel.src = src
    return src


def bilgi():
    if not var_mi():
        return {"var": False}
    src = _kaynak()
    t = src.tags()
    return {"var": True, "kaynak": t.get("kaynak", ""), "yontem": t.get("yontem", ""),
            "uyari": t.get("uyari", ""), "lisans": t.get("lisans", ""),
            "boyut_kb": round(os.path.getsize(KATMAN) / 1e3)}


def havza(geometri):
    """Havzanın zemin grubu + gerekçesi.

    Grup, alanca en çok payı olan sınıftır. Baskınlık zayıfsa (en çok pay
    %60'ın altında) `kararsiz` işaretlenir — böyle bir havzada tek bir gruba
    indirgemek zorlamadır ve kullanıcı bunu bilmelidir.
    """
    import numpy as np
    from rasterio.mask import mask

    src = _kaynak()
    try:
        kesit, _ = mask(src, [geometri], crop=True, filled=True, nodata=0)
    except ValueError as e:
        raise ValueError(f"Havza katmanın kapsamı dışında olabilir: {e}")
    ham = kesit[0]
    g = ham[ham > 0]
    if not g.size:
        raise ValueError("Havza içinde zemin verisi bulunamadı")

    say = {GRUP_AD[k]: int((g == k).sum()) for k in (1, 2, 3, 4)}
    n = int(g.size)
    dagilim = {k: round(100.0 * v / n, 1) for k, v in say.items()}
    grup = max(say, key=lambda k: say[k])
    pay = dagilim[grup]
    return {
        "grup": grup,
        "pay_yuzde": pay,
        "kararsiz": pay < 60.0,
        "dagilim": dagilim,
        "piksel": n,
        "ksat_araligi_mm_sa": KSAT_ARALIK[grup],
        "yontem": "SoilGrids 0-100 cm → Saxton & Rawls Ksat → NRCS NEH-630",
        "uyari": ("Ana kayaya derinlik hesaba katılmadı; dağlık havzada gerçek "
                  "grup bir kademe daha geçirimsiz olabilir. Arazi etüdü ya da "
                  "onaylı raporun grubu bağlayıcıdır."),
    }
