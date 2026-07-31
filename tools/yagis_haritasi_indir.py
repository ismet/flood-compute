# -*- coding: utf-8 -*-
"""CHELSA v2.1 yıllık toplam yağış (bio12) -> data/yagis/yagis_tr.tif

CHELSA, 1005 MGM istasyonuna karşı yapılan karşılaştırmada Türkiye'de yıllık
yağışta en yüksek uyumu veren ızgara veri setidir (Lin CCC 0.824; ERA5-Land
0.760, CHIRPS 0.742, WorldClim 0.712 — Keserci vd. 2026, Int. J. Climatology).
WorldClim özellikle Akdeniz'in dağlık kesiminde yükselti-yağış ilişkisini ters
çevirecek kadar sapıyor; CHELSA orografik etkiyi hesaba kattığı için tercih
edildi.

Kaynak dosya Cloud-Optimized GeoTIFF olduğundan 625 GB'lık küresel katmanın
tamamı indirilmez: yalnız Türkiye penceresi HTTP range isteğiyle çekilir.

Kullanım:
    python tools/yagis_haritasi_indir.py [--bbox b g d k]
"""
import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HEDEF = os.path.join(ROOT, "data", "yagis", "yagis_tr.tif")

URL = ("https://os.zhdk.cloud.switch.ch/chelsav2/GLOBAL/climatologies/"
       "1981-2010/bio/CHELSA_bio12_1981-2010_V.2.1.tif")
TURKIYE = (25.5, 35.5, 45.2, 42.5)     # batı, güney, doğu, kuzey


def indir(bbox=TURKIYE, hedef=HEDEF, url=URL):
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
    import rasterio
    from rasterio.windows import from_bounds

    os.makedirs(os.path.dirname(hedef), exist_ok=True)
    print(f"kaynak: {url}")
    with rasterio.open("/vsicurl/" + url) as s:
        print(f"  küresel {s.width}×{s.height}, {s.res[0]:.6f}° (~1 km), {s.dtypes[0]}")
        pencere = from_bounds(*bbox, s.transform)
        veri = s.read(1, window=pencere)
        profil = s.profile.copy()
        profil.update(height=veri.shape[0], width=veri.shape[1],
                      transform=s.window_transform(pencere),
                      compress="deflate", predictor=2, tiled=True,
                      blockxsize=256, blockysize=256)
        olcek = (s.scales or (1.0,))[0]

    with rasterio.open(hedef, "w", **profil) as h:
        h.write(veri, 1)
        h.scales = (olcek,)
        h.update_tags(kaynak="CHELSA v2.1 bio12 (1981-2010)", birim="mm/yıl",
                      olcek=str(olcek), lisans="CC0-1.0",
                      atif="Karger et al. 2017, Sci. Data 4:170122")

    mm = veri * olcek
    print(f"\n{veri.shape[1]}×{veri.shape[0]} piksel · {mm.min():.0f}–{mm.max():.0f} mm/yıl "
          f"(ortalama {mm.mean():.0f})")
    print(f"-> {hedef}  ({os.path.getsize(hedef)/1e6:.1f} MB)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("B", "G", "D", "K"),
                    default=list(TURKIYE))
    a = ap.parse_args()
    indir(tuple(a.bbox))
