# -*- coding: utf-8 -*-
"""SoilGrids -> data/zemin/hsg_tr.tif  (hidrolojik zemin grubu A/B/C/D)

Zemin grubu, taşkın hesabında sonucu en çok değiştiren girdidir: aynı havzada
A ile D arasında Q100 on kata kadar oynayabiliyor. Buna rağmen uygulamada
gerekçesiz bir varsayılan (B) olarak duruyordu — açılır listedeki ikinci
maddeye `selected` konmuştu, o kadar. Bu katman o varsayılanın yerine geçer:
grup artık havzanın toprağından belirlenir ve gerekçesi gösterilir.

YÖNTEM — NRCS NEH-630 Bölüm 7 (2009 revizyonu):
grup, profildeki EN GEÇİRİMSİZ katmanın doygun hidrolik iletkenliğine (Ksat)
göre verilir; su en dar boğazdan geçebildiği kadar geçer.

    Ksat > 145 mm/sa    -> A        1.45 - 14.5  -> C
    14.5 - 145          -> B        Ksat < 1.45  -> D

Ksat, Saxton & Rawls (2006) pedotransfer fonksiyonlarıyla kum/kil/organik
maddeden hesaplanır. Kaynak ISRIC SoilGrids v2.0 (1 km, CC-BY), 0-5 … 60-100 cm.

BU KATMANIN GÖREMEDİĞİ ŞEY: NRCS grubu ana kayaya ve taban suyuna derinliği de
hesaba katar. Kaya üstünde sığ toprak varsa gerçek grup buradakinden DAHA
GEÇİRİMSİZDİR. SoilGrids bu derinliği vermediği için katman ALT SINIR verir;
dağlık havzada bir grup yukarısı (C yerine D) makul bir emniyet tarafıdır.
Katman bir arazi etüdünün yerine geçmez; DSİ pratiğinde grup ulusal Toprak-Su
haritasından okunur ve onaylı rapor varsa o bağlayıcıdır.

Kullanım:
    python tools/zemin_grubu_uret.py [--bbox b g d k]
"""
import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HEDEF = os.path.join(ROOT, "data", "zemin", "hsg_tr.tif")
ORNEK = os.path.join(ROOT, "data", "yagis", "yagis_tr.tif")   # ızgara buna uyar

TABAN = "https://files.isric.org/soilgrids/latest/data_aggregated/1000m"
DERINLIK = ("0-5", "5-15", "15-30", "30-60", "60-100")
TURKIYE = (25.5, 35.5, 45.2, 42.5)

# NRCS NEH-630 Tablo 7-1 — Ksat (mm/sa) sınırları. Sıra önemli: ilk tutan alınır.
KSAT_SINIR = ((145.0, 1), (14.5, 2), (1.45, 3))     # 1=A 2=B 3=C, kalanı 4=D
GRUP_AD = {1: "A", 2: "B", 3: "C", 4: "D"}


def _oku(ozellik, derinlik, profil):
    import numpy as np
    import rasterio
    from rasterio.warp import reproject, Resampling

    url = f"/vsicurl/{TABAN}/{ozellik}/{ozellik}_{derinlik}cm_mean_1000.tif"
    out = np.full((profil["height"], profil["width"]), np.nan, "float32")
    with rasterio.open(url) as s:
        reproject(source=rasterio.band(s, 1), destination=out,
                  src_transform=s.transform, src_crs=s.crs, src_nodata=s.nodata,
                  dst_transform=profil["transform"], dst_crs=profil["crs"],
                  dst_nodata=np.nan, resampling=Resampling.average)
    return out


def saxton_rawls_ksat(kum, kil, om):
    """Saxton & Rawls (2006) -> doygun hidrolik iletkenlik (mm/sa).

    kum, kil: ağırlık oranı (0-1);  om: organik madde yüzdesi.
    """
    import numpy as np

    s, c = kum, kil
    t1500 = (-0.024 * s + 0.487 * c + 0.006 * om + 0.005 * (s * om)
             - 0.013 * (c * om) + 0.068 * (s * c) + 0.031)
    th1500 = np.clip(t1500 + (0.14 * t1500 - 0.02), 1e-4, 0.5)

    t33 = (-0.251 * s + 0.195 * c + 0.011 * om + 0.006 * (s * om)
           - 0.027 * (c * om) + 0.452 * (s * c) + 0.299)
    th33 = np.clip(t33 + (1.283 * t33 ** 2 - 0.374 * t33 - 0.015), 1e-3, 0.6)

    ts33 = (0.278 * s + 0.034 * c + 0.022 * om - 0.018 * (s * om)
            - 0.027 * (c * om) - 0.584 * (s * c) + 0.078)
    ths33 = ts33 + 0.636 * ts33 - 0.107
    ths = th33 + ths33 - 0.097 * s + 0.043            # doygunluk nem içeriği

    with np.errstate(divide="ignore", invalid="ignore"):
        B = (np.log(1500.0) - np.log(33.0)) / (np.log(th33) - np.log(th1500))
        lam = 1.0 / B
        ks = 1930.0 * np.power(np.clip(ths - th33, 1e-6, None), 3.0 - lam)
    return ks


def uret(bbox=TURKIYE, hedef=HEDEF, ornek=ORNEK):
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
    import numpy as np
    import rasterio

    if not os.path.exists(ornek):
        sys.exit(f"Önce yağış katmanı üretilmeli (ızgara ondan alınıyor): {ornek}")
    with rasterio.open(ornek) as s:
        profil = s.profile.copy()
    print(f"hedef ızgara: {profil['width']}×{profil['height']}")

    ks_min = None
    for d in DERINLIK:
        kum = _oku("sand", d, profil) / 1000.0
        kil = _oku("clay", d, profil) / 1000.0
        om = (_oku("soc", d, profil) / 100.0) * 1.724
        ks = saxton_rawls_ksat(kum, kil, om)
        # profildeki EN GEÇİRİMSİZ katman belirleyicidir
        ks_min = ks if ks_min is None else np.fmin(ks_min, ks)
        with np.errstate(invalid="ignore"):
            print(f"  {d:>7} cm  Ksat medyan {np.nanmedian(ks):7.1f} mm/sa")

    gecerli = np.isfinite(ks_min)
    grup = np.full(ks_min.shape, 4, dtype="uint8")     # varsayılan D
    for sinir, kod in KSAT_SINIR:
        grup = np.where(gecerli & (ks_min > sinir) & (grup == 4), kod, grup)
    grup = np.where(gecerli, grup, 0).astype("uint8")   # 0 = veri yok

    os.makedirs(os.path.dirname(hedef), exist_ok=True)
    p = dict(profil)
    p.update(dtype="uint8", nodata=0, count=1, compress="deflate", predictor=2,
             tiled=True, blockxsize=256, blockysize=256)
    with rasterio.open(hedef, "w", **p) as h:
        h.write(grup, 1)
        h.update_tags(
            kaynak="ISRIC SoilGrids v2.0 (1 km), 0-100 cm",
            buyukluk="hidrolojik zemin grubu (1=A 2=B 3=C 4=D)",
            yontem="Saxton & Rawls (2006) Ksat -> NRCS NEH-630 Tablo 7-1; "
                   "profildeki en geçirimsiz katman",
            uyari="Ana kayaya derinlik hesaba katılmadı; gerçek grup daha "
                  "geçirimsiz olabilir (bu katman alt sınırdır)",
            lisans="CC-BY 4.0")

    n = int(gecerli.sum())
    print(f"\n{n:,} geçerli piksel, Ksat medyanı "
          f"{np.nanmedian(ks_min[gecerli]):.1f} mm/sa")
    for kod in (1, 2, 3, 4):
        k = int((grup == kod).sum())
        print(f"  grup {GRUP_AD[kod]}: %{100*k/n:5.1f}  ({k:,} piksel)")
    print(f"-> {hedef}  ({os.path.getsize(hedef)/1e6:.2f} MB)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("B", "G", "D", "K"),
                    default=list(TURKIYE))
    a = ap.parse_args()
    uret(tuple(a.bbox))
