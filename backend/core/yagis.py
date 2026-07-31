# -*- coding: utf-8 -*-
"""Yıllık toplam yağış katmanı — CHELSA v2.1 bio12 (1981-2010), ~1 km piksel.

Neden CHELSA: 1005 MGM istasyonuna karşı yapılan karşılaştırmada Türkiye'de
yıllık yağışta en yüksek uyumu veren ızgara veri seti (Lin CCC 0.824; ERA5-Land
0.760, CHIRPS 0.742, WorldClim 0.712 — Keserci vd. 2026, Int. J. Climatology).
WorldClim, Akdeniz'in dağlık kesiminde yükselti-yağış ilişkisini ters çevirecek
kadar sapıyor; CHELSA orografik etkiyi hesaba katıyor.

Veri `data/yagis/yagis_tr.tif` (2.5 MB, Türkiye kırpması) —
`tools/yagis_haritasi_indir.py` ile üretilir. Değerler uint16 ve dosyada
gömülü ölçek 0.1 ile mm/yıl'a çevrilir.

Katman altlık değil TEMATİK haritadır: renk merdiveniyle çizilir, tıklanan
noktanın ve çıkarılan havzanın ortalama yağışı sorgulanabilir. Havza ortalaması
hidrolojik olarak asıl işe yarayan büyüklüktür.
"""
import io
import math
import os
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOSYA = os.path.join(ROOT, "data", "yagis", "yagis_tr.tif")

KARO = 256
ORIGIN = 20037508.342789244

# Yağış için ardışık renk merdiveni (kurak sarı → yağışlı koyu mavi).
# Sınırlar Türkiye dağılımına göre: 250 mm altı bozkır, 2000 mm üstü Doğu Karadeniz.
BASAMAK = (
    (200,  (255, 245, 200)), (300,  (254, 224, 144)), (400,  (253, 190, 110)),
    (500,  (224, 243, 248)), (650,  (171, 217, 233)), (800,  (116, 173, 209)),
    (1000, (69, 117, 180)),  (1400, (49, 84, 160)),   (2000, (36, 60, 140)),
    (3000, (25, 40, 110)),   (10000, (15, 25, 80)),
)

_yerel = threading.local()


def var_mi():
    return os.path.exists(DOSYA)


def _kaynak():
    src = getattr(_yerel, "src", None)
    if src is None:
        if not var_mi():
            raise RuntimeError(
                "Yağış haritası yok. İndirmek için:\n"
                "  python tools/yagis_haritasi_indir.py")
        import rasterio
        src = rasterio.open(DOSYA)
        _yerel.src = src
    return src


def _olcek(src):
    return (src.scales or (1.0,))[0] or 1.0


def bilgi():
    if not var_mi():
        return {"var": False}
    src = _kaynak()
    b = src.bounds
    return {
        "var": True,
        "kaynak": src.tags().get("kaynak", "CHELSA v2.1 bio12 (1981-2010)"),
        "birim": src.tags().get("birim", "mm/yıl"),
        "lisans": src.tags().get("lisans", "CC0-1.0"),
        "atif": src.tags().get("atif", ""),
        "cozunurluk_derece": round(src.res[0], 6),
        "cozunurluk_m": round(src.res[0] * 111320),
        "boyut": [src.width, src.height],
        "sinir": [[b.bottom, b.left], [b.top, b.right]],     # Leaflet [[G,B],[K,D]]
        "boyut_mb": round(os.path.getsize(DOSYA) / 1e6, 1),
        "lejant": [{"deger": d, "renk": "#%02x%02x%02x" % r} for d, r in BASAMAK],
    }


def _renk(mm):
    for sinir, renk in BASAMAK:
        if mm <= sinir:
            return renk
    return BASAMAK[-1][1]


def karo_sinirlari(z, x, y):
    n = 2 ** z
    boy = 2 * ORIGIN / n
    xmin = -ORIGIN + x * boy
    ymax = ORIGIN - y * boy
    return xmin, ymax - boy, xmin + boy, ymax


def karo(z, x, y, saydamlik=190):
    """XYZ karosu (PNG bayt) ya da kapsam dışıysa None."""
    import numpy as np
    from PIL import Image
    from rasterio.warp import reproject, Resampling
    from rasterio.transform import from_bounds as tr_from_bounds

    src = _kaynak()
    xmin, ymin, xmax, ymax = karo_sinirlari(z, x, y)
    hedef_tr = tr_from_bounds(xmin, ymin, xmax, ymax, KARO, KARO)
    ham = np.zeros((KARO, KARO), dtype="uint16")
    reproject(source=__import__("rasterio").band(src, 1), destination=ham,
              src_transform=src.transform, src_crs=src.crs,
              dst_transform=hedef_tr, dst_crs="EPSG:3857",
              resampling=Resampling.bilinear, src_nodata=0, dst_nodata=0)
    if not ham.any():
        return None

    mm = ham.astype("float32") * _olcek(src)
    rgba = np.zeros((KARO, KARO, 4), dtype="uint8")
    onceki = 0
    for sinir, renk in BASAMAK:
        maske = (mm > onceki) & (mm <= sinir)
        rgba[maske] = (*renk, saydamlik)
        onceki = sinir
    rgba[mm <= 0] = (0, 0, 0, 0)

    tampon = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(tampon, format="PNG", optimize=True)
    return tampon.getvalue()


def nokta(lat, lon):
    """Tek noktanın yıllık toplam yağışı (mm)."""
    src = _kaynak()
    b = src.bounds
    if not (b.left <= lon <= b.right and b.bottom <= lat <= b.top):
        raise ValueError("Nokta yağış haritasının kapsamı dışında")
    v = next(src.sample([(lon, lat)], 1))[0]
    return {"lat": lat, "lon": lon,
            "yagis_mm": (float(v) * _olcek(src)) if v else None}


def havza_ortalamasi(geometri):
    """Havza poligonu içindeki piksellerin ortalama yıllık yağışı.

    Alansal ortalama yağış, hidrolojik hesabın asıl girdisidir; tek noktanın
    değeri dağlık havzada yanıltıcı olur.
    """
    import numpy as np
    from rasterio.mask import mask

    src = _kaynak()
    try:
        kesit, _ = mask(src, [geometri], crop=True, filled=True, nodata=0)
    except ValueError as e:
        raise ValueError(f"Havza yağış haritasının kapsamı dışında olabilir: {e}")
    a = kesit[0].astype("float32") * _olcek(src)
    g = a[a > 0]
    if not g.size:
        raise ValueError("Havza içinde yağış pikseli bulunamadı")
    return {
        "piksel": int(g.size),
        "ortalama_mm": float(g.mean()),
        "en_az_mm": float(g.min()),
        "en_cok_mm": float(g.max()),
        "medyan_mm": float(np.median(g)),
        "std_mm": float(g.std()),
    }
