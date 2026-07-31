# -*- coding: utf-8 -*-
"""CHELSA v2.1 -> data/yagis/  yıllık yağış, evapotranspirasyon ve net yağış

Üç katman, hepsi aynı kaynak/dönem/ızgara (1981-2010, 30 arc-sec ≈ 1 km):

  yagis_tr.tif  P    yıllık toplam yağış
  pet_tr.tif    PET  potansiyel evapotranspirasyon (Penman-Monteith)
  net_tr.tif    P−AET net yağış ≈ yıllık akış yüksekliği

CHELSA, 1005 MGM istasyonuna karşı yapılan karşılaştırmada Türkiye'de yıllık
yağışta en yüksek uyumu veren ızgara veri setidir (Lin CCC 0.824; ERA5-Land
0.760, CHIRPS 0.742, WorldClim 0.712 — Keserci vd. 2026, Int. J. Climatology).

NET YAĞIŞ NEDEN P−PET DEĞİL: Türkiye ortalaması P≈720, PET≈1186 mm; P−PET
neredeyse her yerde negatif çıkar ve bu *iklimsel su açığıdır*, akış değildir.
Buharlaşabilecek su, düşen sudan çok olamaz.

NEDEN AYLIK: Net yağış AYLIK su bütçesiyle hesaplanır, yıllık toplamlarla
değil. Türkiye'de yağış kışa yığılır, buharlaşma isteği ise yaza; yıllık
toplamlar bu karşıtlığı yutar ve kışın doğrudan akışa geçen suyu "su kısıtlı"
sayıp akışı eksik gösterir. Ölçüldü: yıllık Budyko 170 mm/yıl, aylık bütçe
186 mm/yıl veriyor ve akışın %87'sini kış+ilkbahara yerleştiriyor (Nisan
zirvesi = kar erimesi) — Türkiye rejimi budur.

Bütçenin kendisi `tools/su_butcesi.py`'dedir; kalibrasyon da aynı kodu
çağırır, böylece kalibre edilen şey ile üretilen şey ayrışamaz. Bütçenin üç
yapısal parametresi (etkin toprak derinliği, PET çarpanı, hızlı akış payı)
doğal AGİ akımlarına oturtulmuştur — bkz. tools/net_kalibrasyon.py.

Kaynak dosyalar Cloud-Optimized GeoTIFF olduğundan yalnız Türkiye penceresi
HTTP range isteğiyle çekilir; ilk çekimden sonra yerel önbellekten okunur.

Kullanım:
    python tools/awc_soilgrids.py            # önce AWC (bir kez)
    python tools/yagis_haritasi_indir.py [--bbox b g d k] [--awc-sabit 100]
"""
import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

import su_butcesi as sb                                    # noqa: E402

DIZIN = os.path.join(ROOT, "data", "yagis")

BOS = 65535        # nodata. 0 KULLANILAMAZ: net yağışta sıfır akış meşru bir
                   # değerdir (kurak havzalar), "veri yok" ile karıştırılamaz.


def _yaz(yol, veri, gecerli, profil, tags):
    """mm cinsinden diziyi uint16 (ölçek 0.1) GeoTIFF olarak yazar."""
    import numpy as np
    import rasterio

    p = dict(profil)
    p.update(dtype="uint16", nodata=BOS, compress="deflate", predictor=2,
             tiled=True, blockxsize=256, blockysize=256, count=1)
    ham = np.where(gecerli, np.clip(veri, 0, 6553) * 10.0, BOS).astype("uint16")
    with rasterio.open(yol, "w", **p) as h:
        h.write(ham, 1)
        h.scales = (0.1,)
        h.update_tags(**tags)
    return os.path.getsize(yol) / 1e6


def uret(bbox=sb.TURKIYE, dizin=DIZIN, awc_sabit=None):
    import numpy as np

    os.makedirs(dizin, exist_ok=True)
    ortak = dict(kaynak_donem="1981-2010", birim="mm/yıl", lisans="CC0-1.0",
                 atif="Karger et al. 2017, Sci. Data 4:170122")

    P, PET, T, gecerli, profil = sb.aylik_yigin(bbox)
    awc = sb.awc_oku(profil, sb.ETKIN_DERINLIK, awc_sabit)
    if awc_sabit:
        print(f"AWC: sabit {awc_sabit:.0f} mm")
    else:
        print(f"AWC: SoilGrids, etkin derinlik bandı {sb.ETKIN_DERINLIK} "
              f"(ortalama {awc[gecerli].mean():.0f} mm)")
    print(f"bütçe: pet_carpan {sb.PET_CARPAN:.2f}, hizli_pay {sb.HIZLI_PAY:.2f}")

    akis_ay, aet_ay = sb.butce(P, PET, T, awc)

    p_mm = P.sum(0)
    pet_mm = PET.sum(0)
    aet_mm = aet_ay.sum(0)
    net_mm = akis_ay.sum(0)
    gecerli = gecerli & (p_mm > 0) & (pet_mm > 0)

    yontem = (f"aylık su bütçesi (Thornthwaite-Mather + derece-gün kar + "
              f"doygunluk fazlası); AGİ'ye kalibre: derinlik bant "
              f"{sb.ETKIN_DERINLIK}, pet×{sb.PET_CARPAN:.2f}, "
              f"hızlı pay {sb.HIZLI_PAY:.2f}")
    b1 = _yaz(os.path.join(dizin, "yagis_tr.tif"), p_mm, gecerli, profil,
              dict(ortak, kaynak="CHELSA v2.1 pr (1981-2010)",
                   buyukluk="yıllık toplam yağış"))
    b2 = _yaz(os.path.join(dizin, "pet_tr.tif"), pet_mm, gecerli, profil,
              dict(ortak, kaynak="CHELSA v2.1 pet_penman (1981-2010)",
                   buyukluk="potansiyel evapotranspirasyon (Penman-Monteith)"))
    b3 = _yaz(os.path.join(dizin, "net_tr.tif"), net_mm, gecerli, profil,
              dict(ortak, kaynak="CHELSA v2.1 pr/pet/tas (1981-2010) + SoilGrids AWC",
                   buyukluk="net yağış ≈ yıllık akış yüksekliği",
                   yontem=yontem))

    k = gecerli
    print(f"\n{p_mm.shape[1]}×{p_mm.shape[0]} piksel, {int(k.sum()):,} kara pikseli")
    for ad, a, boy in (("yağış P    ", p_mm, b1), ("PET        ", pet_mm, b2),
                       ("AET        ", aet_mm, None), ("net (akış)  ", net_mm, b3)):
        print(f"  {ad} {a[k].min():6.0f} – {a[k].max():6.0f} mm, "
              f"ortalama {a[k].mean():5.0f} mm"
              + (f"   ({boy:.1f} MB)" if boy else ""))
    print(f"\nakış katsayısı (net/P): {net_mm[k].sum() / p_mm[k].sum():.3f}")
    adlar = "Oca Şub Mar Nis May Haz Tem Ağu Eyl Eki Kas Ara".split()
    print("aylık akış (ortalama, mm): "
          + "  ".join(f"{n}:{akis_ay[i][k].mean():.1f}" for i, n in enumerate(adlar)))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("B", "G", "D", "K"),
                    default=list(sb.TURKIYE))
    ap.add_argument("--awc-sabit", type=float, default=None,
                    help="SoilGrids yerine sabit AWC (mm) kullan")
    a = ap.parse_args()
    uret(tuple(a.bbox), awc_sabit=a.awc_sabit)
