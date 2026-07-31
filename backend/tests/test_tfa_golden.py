# -*- coding: utf-8 -*-
"""NTFA golden testi — ornek.xlsm (D24A016, 1969-1995, N=25) ile karşılaştırma.

Excel'in SONUÇLAR sayfasındaki üç blok da doğrulanıyor: istatistik parametreler,
altı dağılımın Q2..Q10000 değerleri ve Simirnov-Kolmogorov testi sonuçları.
Beklenen değerler ornek.xlsm'den okunmuş sabitlerdir (dosya gerekmez).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from backend.core import tfa  # noqa: E402

# DATAGİR!D9:D34 — 27 yıllık pencerede 2 noksan yıl, N = 25
X = [30, 14, 10.5, 11.5, 15.5, 8.8, 4.1, 18.5, 11.5, 10.5, 10, 12, 5, 10, 3.7,
     9, 15, 8.6, 16, 12, 6.4, 8.64, 8.92, 3.68, 8.92]

PAR_GOLD = {
    "yil_sayisi": 25,
    "lineer_carpiklik": 1.690806387307071,
    "logaritmik_carpiklik": -0.2852621753109116,
    "lineer_ortalama": 10.9104,
    "lineer_standart_sapma": 5.525562173510797,
    "logaritmik_ortalama": 0.9882220476587805,
    "logaritmik_standart_sapma": 0.21584132769747205,
}

# SONUÇLAR!AB7:AK12 — T = 2, 5, 10, 25, 50, 100, 200, 500, 1000, 10000
Q_GOLD = {
    "normal": [10.9104, 15.560713125226686, 17.991960481571436, 20.586211922034757,
               22.258799591956475, 23.765067840455515, 25.138722596790302,
               26.79639124884354, None, None],
    "ln2": [9.73332078503883, 14.551555215271375, 17.956346300843286, 22.472343125117913,
            25.96955434564652, 29.582461011422357, 33.313758854884, 38.448506505971785,
            42.61912507994065, 57.550843066916315],
    "ln3": [9.760085224400195, 14.596263224241907, 17.984271454862228, 22.449525026287024,
            25.889107635687836, 29.42828232300212, 33.070193008994565, 38.06271425875916,
            42.103352616746704, 56.48204693174982],
    "p3": [9.436661320493858, 14.564891016297217, 18.22878431165499, 22.94247199551459,
           26.44707756094601, 29.91198819359217, 33.35378057997361, 36.79557296635505,
           40.23736535273649, 48.759898880919096],
    "lp3": [9.964909, 14.86754, 18.08664, 22.08138, 24.99837, 27.84236, 30.64447,
            33.72859, 37.12310, 47.07257],
    "gumbel": [10.078355209225268, 15.816453027537886, 19.615573071626564,
               24.415771318604605, 27.976832593155113, 31.511599550237136,
               35.03346873645275, 39.67990637835358, 43.191573854419175,
               54.85094058488795],
}

# SONUÇLAR!AB27:AE32 — teorik Pi, ampirik Pi, Dmax, Pi'deki gözlem
KS_GOLD = {
    "normal": (0.578245950799109, 0.7307692307692306, 0.16252327997012161, 12),
    "ln2": (0.6022898628464224, 0.23076923076923075, 0.16694090638434686, 8.6),
    "ln3": (0.6035287509165699, 0.23076923076923075, 0.16570201831419937, 8.6),
    "p3": (0.4162078318424156, 0.23076923076923075, 0.18543860107318483, 8.6),
    "lp3": (0.3980725736264064, 0.23076923076923075, 0.16730334285717563, 8.6),
    "gumbel": (0.3952610102290081, 0.23076923076923075, 0.16449177945977736, 8.6),
}

fails = []


def check(name, got, want, tol=1e-6):
    err = abs(got - want) / max(abs(want), 1e-12)
    st = "OK " if err <= tol else "FAIL"
    if err > tol:
        fails.append(name)
    print(f"{st} {name:34s} hesap={got:16.8f} excel={want:16.8f} hata={err:.2e}")


o = tfa.ozet(X, istasyon="D24A016")

print("--- istatistik parametreler ---")
for k, v in PAR_GOLD.items():
    check("par." + k, float(o["parametreler"][k]), float(v))

print("\n--- tekerrür debileri (m3/s) ---")
for d in o["debiler"]:
    for i, t in enumerate(o["tekerrur"]):
        want = Q_GOLD[d["anahtar"]][i]
        got = d["q"][i]
        if want is None:
            assert got is None, f"{d['anahtar']} T={t} beklenen boş"
            continue
        # LP3 altınları Excel'de 6 haneye yuvarlı gösteriliyor
        check(f"{d['anahtar']}.Q{t}", float(got), float(want),
              1e-6 if d["anahtar"] != "lp3" else 1e-5)

print("\n--- Simirnov-Kolmogorov ---")
for s in o["ks_testi"]:
    tp, ap, dm, gz = KS_GOLD[s["anahtar"]]
    check(f"{s['anahtar']}.teorik_pi", s["teorik_pi"], tp)
    check(f"{s['anahtar']}.amprik_pi", s["amprik_pi"], ap)
    check(f"{s['anahtar']}.dmax", s["dmax"], dm)
    check(f"{s['anahtar']}.gozlem", s["gozlem"], gz)

print("\n--- kabul edilen dağılım ---")
if o["kabul_edilen"] != "normal":
    fails.append("kabul_edilen")
print(f"{'OK ' if o['kabul_edilen'] == 'normal' else 'FAIL'} kabul_edilen = "
      f"{o['kabul_edilen']} (excel: normal)")

print()
if fails:
    print(f"BAŞARISIZ ({len(fails)}): {', '.join(fails)}")
    sys.exit(1)
print("TÜM TESTLER GEÇTİ")
