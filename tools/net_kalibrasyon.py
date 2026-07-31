# -*- coding: utf-8 -*-
"""Aylık su bütçesini doğal AGİ akımlarına oturtur.

Ham Thornthwaite-Mather bütçesi (pet_carpan=1, hizli_pay=0, 0-100 cm AWC)
22 doğal AGİ'ye karşı akışı %38 EKSİK veriyordu: desen doğru (r=0.81) ama
büyüklük yanlış (NSE=0.25). Yanlılık yağışla ilişkisiz olduğu için bunun
rastgele değil yapısal olduğu belliydi. Bu betik üç yapısal parametreyi
ölçüme oturtur:

    etkin_derinlik  AWC hangi toprak derinliğinden (0-5 … 0-100 cm)
    pet_carpan      CHELSA referans-çim PET'i gerçek örtüye ölçeklenir
    hizli_pay       doygunluk fazlası hızlı akış payı

Bunlar "uydurma katsayı" değil: hiçbiri veriden doğrudan okunamayan, her
kavramsal su bütçesinde varsayımla seçilen büyüklüklerdir. Varsayım yerine
ölçüm koyuyoruz.

DÜRÜSTLÜK KORUMASI — parametreleri aynı istasyonlara uydurup sonra o
istasyonlarla "doğruladık" demek kendi kendini kandırmaktır. Bu yüzden
skor 5 katlı çapraz doğrulamayla verilir: her kat dışarıda bırakılan
istasyonlarda ölçülür, parametre onlar görülmeden ayarlanır. Rapor hem
kalibrasyon hem çapraz doğrulama NSE'sini gösterir; aradaki fark aşırı
uydurmanın ölçüsüdür.

Kullanım:
    python tools/net_yagis_dogrulama.py      # önce ölçüt kümesi
    python tools/net_kalibrasyon.py [--uygula]
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tools"))

import su_butcesi as sb                                    # noqa: E402

OLCUT = os.path.join(ROOT, "data", "yagis", "dogrulama_havzalar.json")

DERINLIKLER = (1, 2, 3, 4, 5)                              # awc_kademe bantları
DERINLIK_AD = {1: "0-5", 2: "0-15", 3: "0-30", 4: "0-60", 5: "0-100"}
PET_ARALIK = [round(0.65 + 0.05 * i, 2) for i in range(10)]     # 0.65 … 1.10
HIZLI_ARALIK = [round(0.00 + 0.05 * i, 2) for i in range(13)]   # 0.00 … 0.60
KAT = 5


def olcut_yukle():
    if not os.path.exists(OLCUT):
        sys.exit(f"Ölçüt kümesi yok: {OLCUT}\n"
                 "  önce: python tools/net_yagis_dogrulama.py")
    with open(OLCUT, encoding="utf-8") as f:
        return json.load(f)


def piksel_kumeleri(havzalar, profil):
    """Her havzanın iklim ızgarasındaki piksel indisleri.

    Havzalar üst üste binmez ama tek düz dizide toplamak bütçeyi 2 milyon
    piksel yerine ~30 binde koşturur; kalibrasyon böylece saniyeler sürer.
    """
    import numpy as np
    from rasterio.features import geometry_mask

    bicim = (profil["height"], profil["width"])
    satir, sutun, hangi = [], [], []
    tutulan = []
    for i, h in enumerate(havzalar):
        m = ~geometry_mask([h["geojson"]], out_shape=bicim,
                           transform=profil["transform"], invert=False)
        r, c = np.nonzero(m)
        if r.size == 0:
            continue
        satir.append(r); sutun.append(c)
        hangi.append(np.full(r.size, len(tutulan), "int32"))
        tutulan.append(h)
    if not tutulan:
        sys.exit("Hiçbir havza iklim ızgarasına düşmedi")
    return (np.concatenate(satir), np.concatenate(sutun),
            np.concatenate(hangi), tutulan)


def _nse(model, gozlem):
    o = sum(gozlem) / len(gozlem)
    payda = sum((v - o) ** 2 for v in gozlem)
    return 1 - sum((a - b) ** 2 for a, b in zip(model, gozlem)) / payda


def _havza_ortalamalari(akis_ay, hangi, n):
    import numpy as np
    yil = akis_ay.sum(0)
    return np.array([yil[hangi == i].mean() for i in range(n)])


def calis(uygula):
    import numpy as np

    havzalar = olcut_yukle()
    P, PET, T, gecerli, profil = sb.aylik_yigin()
    r, c, hangi, havzalar = piksel_kumeleri(havzalar, profil)
    n = len(havzalar)
    gozlem = np.array([h["r_gozlem"] for h in havzalar])
    print(f"{n} havza, {r.size:,} iklim pikseli")

    Pk = P[:, r, c]
    PETk = PET[:, r, c]
    Tk = T[:, r, c]
    awck = {d: sb.awc_oku(profil, d)[r, c] for d in DERINLIKLER}
    print("AWC kademeleri (ölçüt havzalarında ortalama): "
          + "  ".join(f"{DERINLIK_AD[d]}cm:{awck[d].mean():.0f}" for d in DERINLIKLER))

    # --- tüm ızgarada tarama
    izgara = {}
    print(f"\ntarama: {len(DERINLIKLER)}×{len(PET_ARALIK)}×{len(HIZLI_ARALIK)} "
          f"= {len(DERINLIKLER)*len(PET_ARALIK)*len(HIZLI_ARALIK)} birleşim")
    for d in DERINLIKLER:
        for pc in PET_ARALIK:
            for hp in HIZLI_ARALIK:
                akis, _ = sb.butce(Pk, PETk, Tk, awck[d],
                                   pet_carpan=pc, hizli_pay=hp)
                izgara[(d, pc, hp)] = _havza_ortalamalari(akis, hangi, n)
        print(f"  derinlik {DERINLIK_AD[d]} cm tamam")

    def en_iyi(indis):
        g = gozlem[indis]
        return max(izgara, key=lambda k: _nse(izgara[k][indis], g))

    tum = np.arange(n)
    k_iyi = en_iyi(tum)
    kal_nse = _nse(izgara[k_iyi][tum], gozlem)

    # --- 5 katlı çapraz doğrulama (istasyonlar bölgeye göre serpiştirilmiş)
    sira = np.argsort([h["bolge"] + h["kod"] for h in havzalar])
    katlar = [sira[i::KAT] for i in range(KAT)]
    cd_model = np.zeros(n)
    for kat in katlar:
        egitim = np.setdiff1d(tum, kat)
        k = en_iyi(egitim)
        cd_model[kat] = izgara[k][kat]
    cd_nse = _nse(cd_model, gozlem)

    d, pc, hp = k_iyi
    ham = izgara[(5, 1.00, 0.00)]
    print("\n" + "=" * 74)
    print(f"HAM      derinlik 0-100 cm, pet_carpan 1.00, hizli_pay 0.00")
    print(f"         NSE={_nse(ham, gozlem):+.3f}  "
          f"yanlılık {(ham.sum()/gozlem.sum()-1)*100:+.0f}%")
    print(f"KALİBRE  derinlik {DERINLIK_AD[d]} cm, pet_carpan {pc:.2f}, "
          f"hizli_pay {hp:.2f}")
    print(f"         NSE={kal_nse:+.3f}  "
          f"yanlılık {(izgara[k_iyi].sum()/gozlem.sum()-1)*100:+.0f}%")
    print(f"ÇAPRAZ DOĞRULAMA (5 kat, parametre dışarıda bırakılanı görmedi)")
    print(f"         NSE={cd_nse:+.3f}   ← gerçek beceri budur")
    print("=" * 74)

    _bolge_dokum(havzalar, gozlem, ham, izgara[k_iyi])
    _duyarlilik(izgara, gozlem, tum, k_iyi, _nse)

    if uygula:
        _yaz_varsayilan(d, pc, hp)
    else:
        print("\n(--uygula verilmedi: tools/su_butcesi.py'deki varsayılanlar "
              "değiştirilmedi)")
    return k_iyi


def _bolge_dokum(havzalar, gozlem, ham, kal):
    print(f"\n{'bölge':<14}{'n':>3}{'gözlem':>8}{'ham':>8}{'kalibre':>9}"
          f"{'ham yanl.':>11}{'kal. yanl.':>11}")
    bolgeler = []
    for h in havzalar:
        if h["bolge"] not in bolgeler:
            bolgeler.append(h["bolge"])
    for b in bolgeler:
        i = [j for j, h in enumerate(havzalar) if h["bolge"] == b]
        g = sum(gozlem[j] for j in i) / len(i)
        a = sum(ham[j] for j in i) / len(i)
        k = sum(kal[j] for j in i) / len(i)
        print(f"{b:<14}{len(i):>3}{g:>8.0f}{a:>8.0f}{k:>9.0f}"
              f"{(a/g-1)*100:>+10.0f}%{(k/g-1)*100:>+10.0f}%")
    g = gozlem.mean()
    print(f"{'TÜMÜ':<14}{len(havzalar):>3}{g:>8.0f}{ham.mean():>8.0f}"
          f"{kal.mean():>9.0f}{(ham.mean()/g-1)*100:>+10.0f}%"
          f"{(kal.mean()/g-1)*100:>+10.0f}%")


def _duyarlilik(izgara, gozlem, tum, k_iyi, nse):
    """Her parametre tek başına ne kadar iş görüyor — hangisi gerçekten gerekli."""
    d, pc, hp = k_iyi
    print("\nparametre duyarlılığı (diğer ikisi en iyide sabit):")
    for ad, sabit, degerler in (
            ("etkin derinlik", 0, DERINLIKLER),
            ("pet_carpan", 1, PET_ARALIK),
            ("hizli_pay", 2, HIZLI_ARALIK)):
        satir = []
        for v in degerler:
            k = list(k_iyi)
            k[sabit] = v
            k = tuple(k)
            if k in izgara:
                etiket = DERINLIK_AD[v] if sabit == 0 else f"{v:.2f}"
                satir.append(f"{etiket}:{nse(izgara[k][tum], gozlem):+.2f}")
        print(f"  {ad:<15}" + "  ".join(satir))


def _yaz_varsayilan(d, pc, hp):
    yol = os.path.join(ROOT, "tools", "su_butcesi.py")
    with open(yol, encoding="utf-8") as f:
        metin = f.read()
    for anahtar, deger in (("PET_CARPAN", f"{pc:.2f}"),
                           ("HIZLI_PAY", f"{hp:.2f}"),
                           ("ETKIN_DERINLIK", str(d))):
        eski = [s for s in metin.split("\n") if s.startswith(anahtar + " =")][0]
        yeni = f"{anahtar} = {deger}" + (
            "           # awc_kademe_tr.tif bant no"
            if anahtar == "ETKIN_DERINLIK" else "")
        metin = metin.replace(eski, yeni)
    with open(yol, "w", encoding="utf-8") as f:
        f.write(metin)
    print(f"\ntools/su_butcesi.py güncellendi: PET_CARPAN={pc:.2f}, "
          f"HIZLI_PAY={hp:.2f}, ETKIN_DERINLIK={d} ({DERINLIK_AD[d]} cm)")
    print("Şimdi haritayı yeniden üretin: python tools/yagis_haritasi_indir.py")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--uygula", action="store_true",
                    help="en iyi parametreleri tools/su_butcesi.py'ye yaz")
    a = ap.parse_args()
    calis(a.uygula)
