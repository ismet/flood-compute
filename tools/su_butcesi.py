# -*- coding: utf-8 -*-
"""Aylık su bütçesi — harita üretimi ve kalibrasyon bunu ORTAK kullanır.

Ayrı bir modülde olmasının sebebi teknik değil, yöntemsel: kalibrasyon
bir bütçeyi ayarlayıp harita başka bir bütçeyi koşarsa kalibre edilen şey
üretilen şey olmaz. Tek uygulama var, ikisi de bunu çağırır.

Bütçe (Thornthwaite-Mather + derece-gün kar + doygunluk fazlası hızlı akış),
her ay:
    kar        : T < KAR_ESIK ise yağış katı olarak birikir, T ile erir
    giren      : sıvı yağış + erime
    hızlı akış : doygun alan payı kadarı toprağa uğramadan akar
    kalan      : PET'i aşarsa toprak dolar, AWC taşarsa akar;
                 açık kalırsa toprak neminden çekilir (AET = giren + çekilen)
Başlangıç neminin etkisi sönsün diye 12 ay DENGE_TURU kez döndürülür.

AYARLANABİLİR ÜÇ PARAMETRE — hepsi ölçüme karşı kalibre edilir, çünkü
hiçbiri veriden doğrudan okunamaz:

  pet_carpan   CHELSA pet_penman REFERANS BİTKİ (çim) PET'idir. Ormanlık,
               kayalık ya da seyrek bitkili havzada atmosferin gerçekte
               çekebileceği suyu olduğundan büyük gösterir.
  hizli_pay    Thornthwaite-Mather tüm girdiyi önce toprak deposundan
               geçirir; gerçek havzada şiddetli yağışın bir kısmı toprak
               kuruyken bile doğrudan akar. Doygun alan payıyla ölçekleriz
               (nem/AWC) — değişken kaynak alanı fikri.
  etkin_derinlik  AWC'nin hangi toprak derinliğinden hesaplanacağı. 1 m kök
               bölgesi tarım toprağı için doğrudur; dik ve kayalık dağ
               havzasında hidrolojik olarak etkin derinlik bundan sığdır.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIZIN = os.path.join(ROOT, "data", "yagis")
ONBELLEK = os.path.join(DIZIN, "_onbellek_aylik.npz")

TABAN = "https://os.zhdk.cloud.switch.ch/chelsav2/GLOBAL/climatologies/1981-2010"
URL_AY = {
    "pr": f"{TABAN}/pr/CHELSA_pr_{{m:02d}}_1981-2010_V.2.1.tif",
    "pet": f"{TABAN}/pet/CHELSA_pet_penman_{{m:02d}}_1981-2010_V.2.1.tif",
    "tas": f"{TABAN}/tas/CHELSA_tas_{{m:02d}}_1981-2010_V.2.1.tif",
}
TURKIYE = (25.5, 35.5, 45.2, 42.5)
KAR_ESIK = 0.0
DERECE_GUN = 2.5
DENGE_TURU = 3
AY_GUN = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)

# Kalibrasyon sonucu (bkz. tools/net_kalibrasyon.py). Varsayılanlar ham
# Thornthwaite-Mather değil, ÖLÇÜME OTURTULMUŞ değerlerdir.
PET_CARPAN = 1.0
HIZLI_PAY = 0.0
ETKIN_DERINLIK = 5           # awc_kademe_tr.tif bant no (5 = 0-100 cm)


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


def aylik_yigin(bbox=TURKIYE, onbellek=ONBELLEK, yeniden=False):
    """12 aylık P / PET / T yığını. İlk çağrıda indirir, sonra diskten okur.

    Kalibrasyon yüzlerce parametre denemesi yapıyor; 36 COG penceresini her
    denemede yeniden indirmek saatler alırdı.

    -> (P, PET, T, gecerli, profil)   hepsi (12, H, W) float32
    """
    import numpy as np
    import rasterio
    from rasterio.transform import Affine

    if onbellek and os.path.exists(onbellek) and not yeniden:
        z = np.load(onbellek, allow_pickle=False)
        profil = dict(height=int(z["h"]), width=int(z["w"]),
                      transform=Affine(*z["tr"]),
                      crs=rasterio.crs.CRS.from_string(str(z["crs"])),
                      count=1, dtype="float32", driver="GTiff")
        return z["P"], z["PET"], z["T"], z["gecerli"], profil

    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
    print("aylık yağış / PET / sıcaklık okunuyor (12 ay × 3 değişken)…")
    P, PET, T, profil, gecerli = [], [], [], None, None
    for m in range(1, 13):
        a, g1, profil = _pencere_oku(URL_AY["pr"].format(m=m), bbox)
        b, g2, _ = _pencere_oku(URL_AY["pet"].format(m=m), bbox)
        t, g3, _ = _pencere_oku(URL_AY["tas"].format(m=m), bbox)
        P.append(a); PET.append(b); T.append(t)
        gecerli = (g1 & g2 & g3) if gecerli is None else (gecerli & g1 & g2 & g3)
        print(f"  ay {m:02d} tamam", end="\r")
    print(" " * 30, end="\r")
    P, PET, T = np.stack(P), np.stack(PET), np.stack(T)
    if onbellek:
        np.savez(onbellek, P=P, PET=PET, T=T, gecerli=gecerli,
                 h=profil["height"], w=profil["width"],
                 tr=np.array(profil["transform"].to_gdal()),
                 crs=str(profil["crs"]))
        print(f"önbellek: {onbellek} ({os.path.getsize(onbellek)/1e6:.0f} MB)")
    return P, PET, T, gecerli, profil


def awc_oku(profil, derinlik=ETKIN_DERINLIK, sabit=None):
    """Kademeli AWC dosyasından seçilen etkin derinliği okur."""
    import numpy as np
    import rasterio

    bicim = (profil["height"], profil["width"])
    if sabit:
        return np.full(bicim, float(sabit), "float32")
    yol = os.path.join(DIZIN, "awc_kademe_tr.tif")
    if not os.path.exists(yol):
        yol = os.path.join(DIZIN, "awc_tr.tif")
        derinlik = 1
    if not os.path.exists(yol):
        print("  ! AWC dosyası yok — sabit 100 mm (tools/awc_soilgrids.py)")
        return np.full(bicim, 100.0, "float32")
    with rasterio.open(yol) as s:
        a = s.read(derinlik).astype("float32") * (s.scales or (1.0,) * s.count)[derinlik - 1]
    if a.shape != bicim:
        raise SystemExit("AWC ızgarası iklim ızgarasıyla uyuşmuyor")
    return np.where(a > 0, a, 100.0).astype("float32")


def butce(P, PET, T, awc, pet_carpan=PET_CARPAN, hizli_pay=HIZLI_PAY,
          kar_esik=KAR_ESIK, derece_gun=DERECE_GUN, tur=DENGE_TURU):
    """-> (akis_ay, aet_ay)  ikisi de (12, ...) — girdiyle aynı biçimde."""
    import numpy as np

    pet = PET * pet_carpan
    kar = np.zeros_like(P[0])
    nem = awc * 0.5
    akis_ay = np.zeros_like(P)
    aet_ay = np.zeros_like(P)
    for _ in range(tur):
        akis_ay = np.zeros_like(P)
        aet_ay = np.zeros_like(P)
        for m in range(12):
            t = T[m]
            kati = np.where(t < kar_esik, P[m], 0.0)
            kar = kar + kati
            erime = np.minimum(kar, np.maximum(t - kar_esik, 0)
                               * derece_gun * AY_GUN[m])
            kar = kar - erime
            giren = (P[m] - kati) + erime

            # doygunluk fazlası: doygun alan payı kadarı toprağa uğramadan akar
            hizli = (hizli_pay * giren * np.clip(nem / awc, 0, 1)
                     if hizli_pay else 0.0)
            kalan = giren - hizli

            fark = kalan - pet[m]
            cekilen = np.minimum(np.where(fark < 0, -fark, 0.0), nem)
            nem = nem - cekilen
            aet_ay[m] = np.minimum(kalan, pet[m]) + cekilen
            art = np.where(fark > 0, fark, 0.0)
            akis_ay[m] = np.maximum(nem + art - awc, 0.0) + hizli
            nem = np.minimum(nem + art, awc)
    return akis_ay, aet_ay
