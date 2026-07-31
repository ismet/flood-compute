# -*- coding: utf-8 -*-
"""CHELSA v2.1 -> data/yagis/  yıllık yağış, evapotranspirasyon ve net yağış

Üç katman, hepsi aynı kaynak/dönem/ızgara (1981-2010, 30 arc-sec ≈ 1 km):

  yagis_tr.tif  P    yıllık toplam yağış           (bio12)
  pet_tr.tif    PET  potansiyel evapotranspirasyon (pet_penman ortalaması × 12)
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
sayıp akışı eksik gösterir. Ölçüldü: yıllık Budyko 170 mm/yıl (133 km³),
aylık bütçe 186 mm/yıl (146 km³) veriyor ve akışın %87'sini kış+ilkbahara
yerleştiriyor (Nisan zirvesi = kar erimesi) — Türkiye rejimi budur.

Bütçe (Thornthwaite-Mather + derece-gün kar modeli), her ay:
    T < 0 °C ise yağış kar olarak birikir, sıcaklıkla erir (2.5 mm/°C/gün)
    giren = sıvı yağış + erime;  fark = giren − PET
    fark < 0 : toprak neminden çekilir (AET = giren + çekilen)
    fark > 0 : toprak dolar; AWC'yi aşan kısım AKIŞA geçer
Denge için 3 yıl döndürülür (başlangıç nemi sonucu etkilemesin).

AWC (kullanılabilir su tutma kapasitesi) baskın parametredir — 50 mm ile
200 mm arasında ülke akışı 180'den 98 km³'e iner. Sabit varsayılmaz:
`tools/awc_soilgrids.py` ile SoilGrids'ten piksel bazlı türetilir.

Kaynak dosyalar Cloud-Optimized GeoTIFF olduğundan yalnız Türkiye penceresi
HTTP range isteğiyle çekilir.

Kullanım:
    python tools/awc_soilgrids.py            # önce AWC (bir kez)
    python tools/yagis_haritasi_indir.py [--bbox b g d k] [--awc-sabit 100]
"""
import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIZIN = os.path.join(ROOT, "data", "yagis")

TABAN = ("https://os.zhdk.cloud.switch.ch/chelsav2/GLOBAL/climatologies/1981-2010")
URL_AY = {
    "pr": f"{TABAN}/pr/CHELSA_pr_{{m:02d}}_1981-2010_V.2.1.tif",
    "pet": f"{TABAN}/pet/CHELSA_pet_penman_{{m:02d}}_1981-2010_V.2.1.tif",
    "tas": f"{TABAN}/tas/CHELSA_tas_{{m:02d}}_1981-2010_V.2.1.tif",
}
AWC_DOSYA = "awc_tr.tif"                # tools/awc_soilgrids.py üretir

TURKIYE = (25.5, 35.5, 45.2, 42.5)     # batı, güney, doğu, kuzey
KAR_ESIK = 0.0                          # °C — altında yağış kar sayılır
DERECE_GUN = 2.5                        # mm/°C/gün — kar erime katsayısı
DENGE_TURU = 3                          # başlangıç nemi etkisi sönene kadar
AY_GUN = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


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


def _awc_oku(dizin, profil, sabit):
    """Piksel bazlı AWC; yoksa sabite düşer."""
    import numpy as np
    import rasterio

    yol = os.path.join(dizin, AWC_DOSYA)
    if sabit or not os.path.exists(yol):
        if not sabit:
            print(f"  ! {AWC_DOSYA} yok — sabit 100 mm kullanılıyor "
                  "(tools/awc_soilgrids.py ile üretin)")
        return np.full((profil["height"], profil["width"]),
                       float(sabit or 100.0), "float32"), (sabit or 100.0)
    with rasterio.open(yol) as s:
        a = s.read(1).astype("float32") * (s.scales or (1.0,))[0]
    if a.shape != (profil["height"], profil["width"]):
        raise SystemExit(f"{AWC_DOSYA} ızgarası yağış katmanıyla uyuşmuyor — "
                         "önce yağışı, sonra AWC'yi üretin")
    return np.where(a > 0, a, 100.0), None


def uret(bbox=TURKIYE, dizin=DIZIN, awc_sabit=None):
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
    import numpy as np

    os.makedirs(dizin, exist_ok=True)
    ortak = dict(kaynak_donem="1981-2010", birim="mm/yıl", lisans="CC0-1.0",
                 atif="Karger et al. 2017, Sci. Data 4:170122")

    print("aylık yağış / PET / sıcaklık okunuyor (12 ay × 3 değişken)…")
    P, PET, T, profil, gecerli = [], [], [], None, None
    for m in range(1, 13):
        a, g1, profil = _pencere_oku(URL_AY["pr"].format(m=m), bbox)
        b, g2, _ = _pencere_oku(URL_AY["pet"].format(m=m), bbox)
        t, g3, _ = _pencere_oku(URL_AY["tas"].format(m=m), bbox)
        P.append(a); PET.append(b); T.append(t)
        gecerli = (g1 & g2 & g3) if gecerli is None else (gecerli & g1 & g2 & g3)
        print(f"  ay {m:02d} tamam", end="\r")
    P, PET, T = np.stack(P), np.stack(PET), np.stack(T)
    print(" " * 30, end="\r")

    awc, sabit_deger = _awc_oku(dizin, profil, awc_sabit)
    print(f"AWC: {'sabit %.0f mm' % sabit_deger if sabit_deger else 'SoilGrids (piksel bazlı, ortalama %.0f mm)' % awc[gecerli].mean()}")

    # --- aylık su bütçesi: kar + toprak nemi, DENGE_TURU kez döndürülür
    kar = np.zeros_like(P[0])
    nem = awc * 0.5
    for tur in range(DENGE_TURU):
        akis_ay = np.zeros_like(P)
        aet_ay = np.zeros_like(P)
        for m in range(12):
            t = T[m]
            kati = np.where(t < KAR_ESIK, P[m], 0.0)
            kar += kati
            erime = np.minimum(kar, np.maximum(t - KAR_ESIK, 0)
                               * DERECE_GUN * AY_GUN[m])
            kar -= erime
            giren = (P[m] - kati) + erime
            fark = giren - PET[m]
            cekilen = np.minimum(np.where(fark < 0, -fark, 0.0), nem)
            nem -= cekilen
            aet_ay[m] = np.minimum(giren, PET[m]) + cekilen
            art = np.where(fark > 0, fark, 0.0)
            akis_ay[m] = np.maximum(nem + art - awc, 0.0)
            nem = np.minimum(nem + art, awc)

    p_mm = P.sum(0)
    pet_mm = PET.sum(0)
    aet_mm = aet_ay.sum(0)
    net_mm = akis_ay.sum(0)
    gecerli = gecerli & (p_mm > 0) & (pet_mm > 0)

    b1 = _yaz(os.path.join(dizin, "yagis_tr.tif"), p_mm, gecerli, profil,
              dict(ortak, kaynak="CHELSA v2.1 pr (1981-2010)",
                   buyukluk="yıllık toplam yağış"))
    b2 = _yaz(os.path.join(dizin, "pet_tr.tif"), pet_mm, gecerli, profil,
              dict(ortak, kaynak="CHELSA v2.1 pet_penman (1981-2010)",
                   buyukluk="potansiyel evapotranspirasyon (Penman-Monteith)"))
    b3 = _yaz(os.path.join(dizin, "net_tr.tif"), net_mm, gecerli, profil,
              dict(ortak, kaynak="CHELSA v2.1 pr/pet/tas (1981-2010) + SoilGrids AWC",
                   buyukluk="net yağış ≈ yıllık akış yüksekliği",
                   yontem="aylık su bütçesi (Thornthwaite-Mather + derece-gün kar)"))

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
                    default=list(TURKIYE))
    ap.add_argument("--awc-sabit", type=float, default=None,
                    help="SoilGrids yerine sabit AWC (mm) kullan")
    a = ap.parse_args()
    uret(tuple(a.bbox), awc_sabit=a.awc_sabit)
