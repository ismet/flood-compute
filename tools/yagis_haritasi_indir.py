# -*- coding: utf-8 -*-
"""CHELSA v2.1 -> data/yagis/  yıllık yağış, evapotranspirasyon ve net yağış

Üç katman, hepsi aynı kaynak/dönem/ızgara (1981-2010, 30 arc-sec ≈ 1 km):

  yagis_tr.tif  P    yıllık toplam yağış           (bio12)
  pet_tr.tif    PET  potansiyel evapotranspirasyon (pet_penman ortalaması × 12)
  net_tr.tif    P−AET net yağış ≈ yıllık akış yüksekliği

CHELSA, 1005 MGM istasyonuna karşı yapılan karşılaştırmada Türkiye'de yıllık
yağışta en yüksek uyumu veren ızgara veri setidir (Lin CCC 0.824; ERA5-Land
0.760, CHIRPS 0.742, WorldClim 0.712 — Keserci vd. 2026, Int. J. Climatology).

NET YAĞIŞ NEDEN P−PET DEĞİL: Türkiye ortalaması P≈726, PET≈1186 mm; P−PET
neredeyse her yerde negatif çıkar ve bu *iklimsel su açığıdır*, akış değildir.
Buharlaşabilecek su, düşen sudan çok olamaz. Gerçek buharlaşma (AET) Budyko
çerçevesinde Fu (1981) bağıntısıyla kestirilir:

    AET/P = 1 + PET/P − [1 + (PET/P)^ω]^(1/ω),    ω = 2.6

ω = 2.6 küresel kalibrasyondur (Zhang vd. 2004). Böylece AET hem P'yi hem
PET'i aşamaz; net = P − AET uzun dönem ortalama akış yüksekliğine karşılık
gelir ve DSİ'nin bildirdiği ülke su potansiyeliyle karşılaştırılabilir.

Kaynak dosyalar Cloud-Optimized GeoTIFF olduğundan yalnız Türkiye penceresi
HTTP range isteğiyle çekilir.

Kullanım:
    python tools/yagis_haritasi_indir.py [--bbox b g d k]
"""
import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIZIN = os.path.join(ROOT, "data", "yagis")

TABAN = ("https://os.zhdk.cloud.switch.ch/chelsav2/GLOBAL/climatologies/1981-2010")
URL_P = f"{TABAN}/bio/CHELSA_bio12_1981-2010_V.2.1.tif"
URL_PET = f"{TABAN}/bio/CHELSA_pet_penman_mean_1981-2010_V.2.1.tif"

TURKIYE = (25.5, 35.5, 45.2, 42.5)     # batı, güney, doğu, kuzey
FU_OMEGA = 2.6                          # Budyko-Fu parametresi (Zhang vd. 2004)


def _pencere_oku(url, bbox):
    """COG'dan yalnız pencereyi oku -> (ölçekli float dizi, maske, profil)."""
    import numpy as np
    import rasterio
    from rasterio.windows import from_bounds

    with rasterio.open("/vsicurl/" + url) as s:
        p = from_bounds(*bbox, s.transform)
        ham = s.read(1, window=p)
        nodata = s.nodata
        sc = (s.scales or (1.0,))[0] or 1.0
        off = (s.offsets or (0.0,))[0]
        profil = s.profile.copy()
        profil.update(height=ham.shape[0], width=ham.shape[1],
                      transform=s.window_transform(p))
        gecerli = np.ones(ham.shape, bool) if nodata is None else (ham != nodata)
        return ham.astype("float32") * sc + off, gecerli, profil


def _yaz(yol, veri, gecerli, profil, tags):
    """mm cinsinden diziyi uint16 (ölçek 0.1) GeoTIFF olarak yazar."""
    import numpy as np
    import rasterio

    p = dict(profil)
    p.update(dtype="uint16", nodata=0, compress="deflate", predictor=2,
             tiled=True, blockxsize=256, blockysize=256, count=1)
    ham = np.where(gecerli, np.clip(veri, 0, 6553) * 10.0, 0).astype("uint16")
    with rasterio.open(yol, "w", **p) as h:
        h.write(ham, 1)
        h.scales = (0.1,)
        h.update_tags(**tags)
    return os.path.getsize(yol) / 1e6


def uret(bbox=TURKIYE, dizin=DIZIN):
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
    import numpy as np

    os.makedirs(dizin, exist_ok=True)
    ortak = dict(kaynak_donem="1981-2010", birim="mm/yıl", lisans="CC0-1.0",
                 atif="Karger et al. 2017, Sci. Data 4:170122")

    print("yağış (bio12) okunuyor…")
    p_mm, g1, profil = _pencere_oku(URL_P, bbox)
    print("PET (pet_penman) okunuyor…")
    pet_ay, g2, _ = _pencere_oku(URL_PET, bbox)
    pet_mm = pet_ay * 12.0                       # aylık ortalama -> yıllık toplam
    gecerli = g1 & g2 & (p_mm > 0) & (pet_mm > 0)

    # Budyko-Fu: AET hem yağışı hem PET'i aşamaz
    with np.errstate(divide="ignore", invalid="ignore"):
        phi = np.where(gecerli, pet_mm / np.maximum(p_mm, 1e-6), 0.0)
        oran = 1 + phi - np.power(1 + np.power(phi, FU_OMEGA), 1.0 / FU_OMEGA)
    aet_mm = np.clip(oran, 0, 1) * p_mm
    net_mm = np.maximum(p_mm - aet_mm, 0.0)

    b1 = _yaz(os.path.join(dizin, "yagis_tr.tif"), p_mm, gecerli, profil,
              dict(ortak, kaynak="CHELSA v2.1 bio12 (1981-2010)",
                   buyukluk="yıllık toplam yağış"))
    b2 = _yaz(os.path.join(dizin, "pet_tr.tif"), pet_mm, gecerli, profil,
              dict(ortak, kaynak="CHELSA v2.1 pet_penman (1981-2010)",
                   buyukluk="potansiyel evapotranspirasyon (Penman-Monteith)"))
    b3 = _yaz(os.path.join(dizin, "net_tr.tif"), net_mm, gecerli, profil,
              dict(ortak, kaynak="CHELSA v2.1 bio12 & pet_penman (1981-2010)",
                   buyukluk="net yağış = P − AET (Budyko-Fu, ω=%.1f)" % FU_OMEGA,
                   yontem="Fu (1981) / Zhang vd. (2004)"))

    k = gecerli
    print(f"\n{p_mm.shape[1]}×{p_mm.shape[0]} piksel, {int(k.sum()):,} kara pikseli")
    for ad, a, boy in (("yağış P    ", p_mm, b1), ("PET        ", pet_mm, b2),
                       ("AET        ", aet_mm, None), ("net P−AET  ", net_mm, b3)):
        print(f"  {ad} {a[k].min():6.0f} – {a[k].max():6.0f} mm, "
              f"ortalama {a[k].mean():5.0f} mm"
              + (f"   ({boy:.1f} MB)" if boy else ""))
    print(f"\nakış katsayısı (net/P) ortalama: {net_mm[k].sum() / p_mm[k].sum():.3f}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("B", "G", "D", "K"),
                    default=list(TURKIYE))
    a = ap.parse_args()
    uret(tuple(a.bbox))
