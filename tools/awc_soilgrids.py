# -*- coding: utf-8 -*-
"""SoilGrids -> data/yagis/awc_tr.tif  (kullanılabilir su tutma kapasitesi, mm)

Aylık su bütçesindeki AWC'yi tek bir sabit (ör. 100 mm) yerine topraktan
türetir. AWC baskın parametredir: 50 mm ile 200 mm arasında Türkiye akışı
180'den 98 km³'e iniyor, yani sabit seçmek sonucu belirliyor.

Kaynak: ISRIC SoilGrids v2.0, 1 km toplulaştırılmış ürün (CC-BY 4.0).
Özellikler: kum, kil, organik karbon, iri taneli malzeme oranı — 0-5, 5-15,
15-30, 30-60, 60-100 cm derinlikleri (1 m kök bölgesi).

Yöntem: Saxton & Rawls (2006) pedotransfer fonksiyonlarıyla her derinlik için
tarla kapasitesi (θ33) ve solma noktası (θ1500) hesaplanır; ikisinin farkı
katman kalınlığıyla ve (1 − iri malzeme) ile çarpılıp toplanır.

    AWC = Σ (θ33 − θ1500) × kalınlık × (1 − cfvo)

Kullanım:
    python tools/awc_soilgrids.py [--bbox b g d k]
"""
import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HEDEF = os.path.join(ROOT, "data", "yagis", "awc_tr.tif")
ORNEK = os.path.join(ROOT, "data", "yagis", "yagis_tr.tif")   # ızgara buna uydurulur

TABAN = "https://files.isric.org/soilgrids/latest/data_aggregated/1000m"
DERINLIK = (("0-5", 50), ("5-15", 100), ("15-30", 150),
            ("30-60", 300), ("60-100", 400))                   # (etiket, mm kalınlık)
OZELLIK = ("sand", "clay", "soc", "cfvo")
TURKIYE = (25.5, 35.5, 45.2, 42.5)


def _oku(ozellik, derinlik, hedef_profil):
    """SoilGrids katmanını hedef ızgaraya yeniden projeksiyonlayarak okur."""
    import numpy as np
    import rasterio
    from rasterio.warp import reproject, Resampling

    url = (f"/vsicurl/{TABAN}/{ozellik}/"
           f"{ozellik}_{derinlik}cm_mean_1000.tif")
    cikti = np.zeros((hedef_profil["height"], hedef_profil["width"]), "float32")
    with rasterio.open(url) as s:
        reproject(source=rasterio.band(s, 1), destination=cikti,
                  src_transform=s.transform, src_crs=s.crs,
                  src_nodata=s.nodata,
                  dst_transform=hedef_profil["transform"],
                  dst_crs=hedef_profil["crs"], dst_nodata=np.nan,
                  resampling=Resampling.average)
    return cikti


def _saxton_rawls(kum, kil, om):
    """Saxton & Rawls (2006) — hacimsel tarla kapasitesi ve solma noktası.

    kum, kil: hacim değil AĞIRLIK oranı (0-1); om: organik madde yüzdesi.
    """
    import numpy as np

    s, c = kum, kil
    t1500 = (-0.024 * s + 0.487 * c + 0.006 * om + 0.005 * (s * om)
             - 0.013 * (c * om) + 0.068 * (s * c) + 0.031)
    teta1500 = t1500 + (0.14 * t1500 - 0.02)

    t33 = (-0.251 * s + 0.195 * c + 0.011 * om + 0.006 * (s * om)
           - 0.027 * (c * om) + 0.452 * (s * c) + 0.299)
    teta33 = t33 + (1.283 * t33 ** 2 - 0.374 * t33 - 0.015)
    return np.clip(teta33, 0, 0.6), np.clip(teta1500, 0, 0.5)


def uret(bbox=TURKIYE, hedef=HEDEF, ornek=ORNEK):
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
    import numpy as np
    import rasterio

    if not os.path.exists(ornek):
        sys.exit(f"Önce yağış katmanı üretilmeli (ızgara ondan alınıyor): {ornek}")
    with rasterio.open(ornek) as s:
        profil = s.profile.copy()
    print(f"hedef ızgara: {profil['width']}×{profil['height']} (yağış katmanıyla aynı)")

    awc = None
    for etiket, kalinlik in DERINLIK:
        print(f"  {etiket} cm okunuyor…")
        d = {o: _oku(o, etiket, profil) for o in OZELLIK}
        # SoilGrids birimleri: kum/kil g/kg, soc dg/kg, cfvo cm³/dm³
        kum = d["sand"] / 1000.0
        kil = d["clay"] / 1000.0
        om = (d["soc"] / 100.0) * 1.724            # SOC% -> organik madde %
        iri = np.clip(d["cfvo"] / 1000.0, 0, 0.9)  # hacimsel iri malzeme

        t33, t1500 = _saxton_rawls(kum, kil, om)
        katman = np.maximum(t33 - t1500, 0) * kalinlik * (1 - iri)
        awc = katman if awc is None else awc + katman
        with np.errstate(invalid="ignore"):
            print(f"     katman AWC ortalama {np.nanmean(katman):.1f} mm")

    gecerli = np.isfinite(awc) & (awc > 0)
    awc = np.where(gecerli, np.clip(awc, 5, 500), 0)

    p = dict(profil)
    p.update(dtype="uint16", nodata=0, compress="deflate", predictor=2,
             tiled=True, blockxsize=256, blockysize=256, count=1)
    with rasterio.open(hedef, "w", **p) as h:
        h.write((awc * 10).astype("uint16"), 1)     # ölçek 0.1
        h.scales = (0.1,)
        h.update_tags(kaynak="ISRIC SoilGrids v2.0 (1 km)", birim="mm",
                      buyukluk="kullanılabilir su tutma kapasitesi (0-100 cm)",
                      yontem="Saxton & Rawls (2006) pedotransfer",
                      lisans="CC-BY 4.0")

    g = awc[gecerli]
    print(f"\nAWC {g.min():.0f} – {g.max():.0f} mm, ortalama {g.mean():.0f} mm "
          f"({int(gecerli.sum()):,} piksel)")
    print(f"-> {hedef}  ({os.path.getsize(hedef)/1e6:.1f} MB)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("B", "G", "D", "K"),
                    default=list(TURKIYE))
    a = ap.parse_args()
    uret(tuple(a.bbox))
