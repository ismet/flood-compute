# -*- coding: utf-8 -*-
"""İklim katmanları — CHELSA v2.1 (1981-2010), ~1 km piksel.

Üç katman: yağış (P), potansiyel evapotranspirasyon (PET) ve net yağış
(P − AET ≈ yıllık akış yüksekliği).

Neden CHELSA: 1005 MGM istasyonuna karşı yapılan karşılaştırmada Türkiye'de
yıllık yağışta en yüksek uyumu veren ızgara veri seti (Lin CCC 0.824; ERA5-Land
0.760, CHIRPS 0.742, WorldClim 0.712 — Keserci vd. 2026, Int. J. Climatology).
WorldClim, Akdeniz'in dağlık kesiminde yükselti-yağış ilişkisini ters çevirecek
kadar sapıyor; CHELSA orografik etkiyi hesaba katıyor.

Veri `data/yagis/{yagis,pet,net}_tr.tif` (toplam ~6 MB, Türkiye kırpması) —
`tools/yagis_haritasi_indir.py` ile üretilir. Değerler uint16 ve dosyada
gömülü ölçek 0.1 ile mm/yıl'a çevrilir.

NODATA 65535'TİR, 0 DEĞİL. Net yağışta sıfır akış meşru bir değerdir (kapalı
havzada düşen suyun tamamı buharlaşır: Konya P=389, AET=389, net=0); "veri yok"
ile karıştırılamaz. Buradaki her maske `src.nodata` ile karşılaştırılmalıdır.

Katman altlık değil TEMATİK haritadır: renk merdiveniyle çizilir, tıklanan
noktanın ve çıkarılan havzanın ortalaması sorgulanabilir. Havza ortalaması
hidrolojik olarak asıl işe yarayan büyüklüktür.
"""
import io
import math
import os
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIZIN = os.path.join(ROOT, "data", "yagis")

KARO = 256
ORIGIN = 20037508.342789244

# Yağış: kurak sarı → yağışlı koyu mavi. Sınırlar Türkiye dağılımına göre
# (250 mm altı bozkır, 2000 mm üstü Doğu Karadeniz).
BASAMAK_YAGIS = (
    (200,  (255, 245, 200)), (300,  (254, 224, 144)), (400,  (253, 190, 110)),
    (500,  (224, 243, 248)), (650,  (171, 217, 233)), (800,  (116, 173, 209)),
    (1000, (69, 117, 180)),  (1400, (49, 84, 160)),   (2000, (36, 60, 140)),
    (3000, (25, 40, 110)),   (10000, (15, 25, 80)),
)
# PET: buharlaşma isteği — düşükten yükseğe yeşil → kırmızı
BASAMAK_PET = (
    (700,  (229, 245, 224)), (850,  (199, 233, 192)), (950,  (161, 217, 155)),
    (1050, (254, 237, 160)), (1150, (254, 217, 118)), (1250, (253, 174, 97)),
    (1400, (244, 109, 67)),  (1600, (215, 48, 39)),   (10000, (165, 15, 21)),
)
# Net yağış (akışa geçen): kuru kahve → bol su koyu mavi
BASAMAK_NET = (
    (25,   (245, 235, 220)), (50,   (233, 215, 190)), (100,  (214, 230, 235)),
    (150,  (180, 215, 230)), (250,  (140, 195, 222)), (400,  (95, 165, 210)),
    (600,  (55, 130, 190)),  (900,  (30, 95, 165)),   (1500, (20, 65, 135)),
    (10000, (12, 40, 100)),
)

KATMANLAR = {
    "yagis": {"dosya": "yagis_tr.tif", "ad": "Yıllık toplam yağış",
              "kisa": "P", "basamak": BASAMAK_YAGIS},
    "pet":   {"dosya": "pet_tr.tif", "ad": "Potansiyel evapotranspirasyon",
              "kisa": "PET", "basamak": BASAMAK_PET},
    "net":   {"dosya": "net_tr.tif", "ad": "Net yağış (P − AET)",
              "kisa": "net", "basamak": BASAMAK_NET},
}
VARSAYILAN = "yagis"

_yerel = threading.local()


def _yol(katman):
    if katman not in KATMANLAR:
        raise ValueError(f"Bilinmeyen katman: {katman} "
                         f"(seçenekler: {', '.join(KATMANLAR)})")
    return os.path.join(DIZIN, KATMANLAR[katman]["dosya"])


def var_mi(katman=VARSAYILAN):
    return os.path.exists(_yol(katman))


def _kaynak(katman=VARSAYILAN):
    onbellek = getattr(_yerel, "src", None)
    if onbellek is None:
        onbellek = {}
        _yerel.src = onbellek
    src = onbellek.get(katman)
    if src is None:
        if not var_mi(katman):
            raise RuntimeError(
                f"'{katman}' katmanı yok. Üretmek için:\n"
                "  python tools/yagis_haritasi_indir.py")
        import rasterio
        src = rasterio.open(_yol(katman))
        onbellek[katman] = src
    return src


def _olcek(src):
    return (src.scales or (1.0,))[0] or 1.0


def _katman_bilgi(katman):
    src = _kaynak(katman)
    b = src.bounds
    k = KATMANLAR[katman]
    return {
        "anahtar": katman, "ad": k["ad"], "kisa": k["kisa"],
        "kaynak": src.tags().get("kaynak", ""),
        "buyukluk": src.tags().get("buyukluk", ""),
        "yontem": src.tags().get("yontem", ""),
        "birim": src.tags().get("birim", "mm/yıl"),
        "donem": src.tags().get("kaynak_donem", "1981-2010"),
        "lisans": src.tags().get("lisans", "CC0-1.0"),
        "atif": src.tags().get("atif", ""),
        "cozunurluk_derece": round(src.res[0], 6),
        "cozunurluk_m": round(src.res[0] * 111320),
        "boyut": [src.width, src.height],
        "sinir": [[b.bottom, b.left], [b.top, b.right]],     # Leaflet [[G,B],[K,D]]
        "boyut_mb": round(os.path.getsize(_yol(katman)) / 1e6, 1),
        "lejant": [{"deger": d, "renk": "#%02x%02x%02x" % r}
                   for d, r in k["basamak"]],
    }


def bilgi():
    """Kurulu katmanların tamamı (arayüz listeyi buradan kurar)."""
    kurulu = [k for k in KATMANLAR if var_mi(k)]
    if not kurulu:
        return {"var": False, "katmanlar": []}
    return {"var": True, "varsayilan": VARSAYILAN if VARSAYILAN in kurulu else kurulu[0],
            "katmanlar": [_katman_bilgi(k) for k in kurulu]}


def karo_sinirlari(z, x, y):
    n = 2 ** z
    boy = 2 * ORIGIN / n
    xmin = -ORIGIN + x * boy
    ymax = ORIGIN - y * boy
    return xmin, ymax - boy, xmin + boy, ymax


def karo(z, x, y, katman=VARSAYILAN, saydamlik=190):
    """XYZ karosu (PNG bayt) ya da kapsam dışıysa None."""
    import numpy as np
    from PIL import Image
    from rasterio.warp import reproject, Resampling
    from rasterio.transform import from_bounds as tr_from_bounds

    src = _kaynak(katman)
    basamak = KATMANLAR[katman]["basamak"]
    bos = src.nodata if src.nodata is not None else 0
    xmin, ymin, xmax, ymax = karo_sinirlari(z, x, y)
    hedef_tr = tr_from_bounds(xmin, ymin, xmax, ymax, KARO, KARO)
    ham = np.full((KARO, KARO), bos, dtype="uint16")
    reproject(source=__import__("rasterio").band(src, 1), destination=ham,
              src_transform=src.transform, src_crs=src.crs,
              dst_transform=hedef_tr, dst_crs="EPSG:3857",
              resampling=Resampling.bilinear, src_nodata=bos, dst_nodata=bos)
    gecerli = ham != bos
    if not gecerli.any():
        return None

    # Sıfır akış meşru bir değerdir (kurak havza), boşlukla karıştırılmaz —
    # renk basamağı ilk sınıftan başlar, saydamlık yalnız nodata'ya uygulanır.
    mm = ham.astype("float32") * _olcek(src)
    rgba = np.zeros((KARO, KARO, 4), dtype="uint8")
    onceki = -1e-6
    for sinir, renk in basamak:
        maske = gecerli & (mm > onceki) & (mm <= sinir)
        rgba[maske] = (*renk, saydamlik)
        onceki = sinir
    rgba[~gecerli] = (0, 0, 0, 0)

    tampon = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(tampon, format="PNG", optimize=True)
    return tampon.getvalue()


def nokta(lat, lon):
    """Tek noktada kurulu tüm katmanların değeri (mm/yıl)."""
    out = {"lat": lat, "lon": lon}
    for k in KATMANLAR:
        if not var_mi(k):
            continue
        src = _kaynak(k)
        b = src.bounds
        if not (b.left <= lon <= b.right and b.bottom <= lat <= b.top):
            raise ValueError("Nokta haritanın kapsamı dışında")
        v = next(src.sample([(lon, lat)], 1))[0]
        bos = src.nodata if src.nodata is not None else 0
        out[k] = None if v == bos else float(v) * _olcek(src)
    if out.get("yagis") is not None and out.get("net") is not None:
        out["aet"] = out["yagis"] - out["net"]
    return out


def _ozet(src, geometri):
    import numpy as np
    from rasterio.mask import mask

    bos = src.nodata if src.nodata is not None else 0
    kesit, _ = mask(src, [geometri], crop=True, filled=True, nodata=bos)
    ham = kesit[0]
    g = ham[ham != bos].astype("float32") * _olcek(src)   # 0 geçerli değerdir
    if not g.size:
        return None
    return {"piksel": int(g.size), "ortalama_mm": float(g.mean()),
            "en_az_mm": float(g.min()), "en_cok_mm": float(g.max()),
            "medyan_mm": float(np.median(g)), "std_mm": float(g.std())}


def havza_ortalamasi(geometri):
    """Havza üzerindeki alansal ortalamalar — kurulu tüm katmanlar için.

    Alansal ortalama, hidrolojik hesabın asıl girdisidir; tek noktanın değeri
    dağlık havzada yanıltıcı olur. Yağış ve net yağış birlikte verildiğinde
    AET ile akış katsayısı da türetilir.
    """
    out = {}
    for k in KATMANLAR:
        if not var_mi(k):
            continue
        try:
            o = _ozet(_kaynak(k), geometri)
        except ValueError as e:
            raise ValueError(f"Havza haritanın kapsamı dışında olabilir: {e}")
        if o:
            out[k] = o
    if not out:
        raise ValueError("Havza içinde piksel bulunamadı")
    p = out.get("yagis", {}).get("ortalama_mm")
    n = out.get("net", {}).get("ortalama_mm")
    if p and n is not None:
        out["turetilmis"] = {"aet_mm": p - n, "akis_katsayisi": n / p}
    return out
