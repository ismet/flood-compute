# -*- coding: utf-8 -*-
"""MMY golden testi — Hershfield hesabı, iki bağımsız kaynakla.

  1) "Tablo 22 Binkılıç Mİ MMY Hesabı.xlsm" / SONUÇLAR   (N = 51)
  2) "Karamandere NTFA-BTFA.xlsx" / T7.3 MMY             (N = 42, aynı istasyon)

İkisi de Binkılıç MGİ'nin 1 günlük yıllık en büyük yağışları; ikincisi serinin
kısa hâli, dolayısıyla M2 katsayıları 1'den farklı çıkıyor. M1/M2 kaynak
dosyalarda abaktan okunup elle girildiği için burada da girdi olarak verilir
(bkz. backend/core/mmy.py başlığı); test edilen zincir bunların dışındaki
her adımdır — özellikle Km'nin bölgesel zarftan okunması.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from backend.core import mmy  # noqa: E402

P51 = [69.1, 93.1, 96.7, 92.8, 62.5, 98.6, 92.3, 120.1, 75.1, 40.2, 150.0, 105.7,
       52.9, 90.1, 62.6, 49.0, 98.7, 46.5, 65.4, 68.6, 72.4, 54.5, 77.4, 69.1,
       57.0, 75.0, 79.2, 75.8, 134.3, 183.8, 211.7, 77.8, 58.9, 162.0, 78.5, 70.0,
       96.5, 127.6, 142.2, 77.0, 111.2, 273.4, 64.0, 140.3, 75.4, 77.8, 43.0,
       55.0, 99.2, 76.0, 108.2]
P42 = P51[:42]

BOLGE = 5          # MARMARA, EGE, DOĞU KARADENİZ, AKDENİZ YAKINI DAĞ

# (seri, M1ort, M2ort, M1s, M2s, beklenenler)
DURUM = [
    ("Binkılıç SONUÇLAR (N=51)", P51, 0.9816748997651582, 1, 0.8889256606314562, 1, {
        "yil_sayisi": 51, "pmax": 273.4, "toplam": 4734.199999999998,
        "toplam_pmaxsiz": 4460.799999999998, "ortalama": 92.82745098039211,
        "ortalama_pmaxsiz": 89.21599999999997,
        "ortalama_orani": 0.9610950107726755, "standart_sapma": 44.15235476588486,
        "standart_sapma_pmaxsiz": 36.20039102280647,
        "standart_sapma_orani": 0.819897176826849,
        "duzeltilmis_ortalama": 91.12637863663157,
        "duzeltilmis_standart_sapma": 39.24816112869862,
        "km": 5.919, "mmy": 323.43624435739866}),
    ("Karamandere T7.3 (N=42)", P42, 0.9807194881862875, 1.0015, 0.8908521641969612,
     1.0113999999999999, {
        "yil_sayisi": 42, "pmax": 273.4, "toplam": 3995.299999999999,
        "toplam_pmaxsiz": 3721.8999999999987, "ortalama": 95.12619047619044,
        "ortalama_pmaxsiz": 90.77804878048778,
        "ortalama_orani": 0.9542908038896923, "standart_sapma": 46.63339146757093,
        "standart_sapma_pmaxsiz": 37.618110745989995,
        "standart_sapma_orani": 0.8066775664847322,
        "duzeltilmis_ortalama": 93.43204700017617,
        "duzeltilmis_standart_sapma": 42.01705313065478,
        "km": 5.734, "mmy": 334.3578296513507}),
]

fails = []


def check(name, got, want, tol=1e-9):
    err = abs(got - want) / max(abs(want), 1e-12)
    st = "OK " if err <= tol else "FAIL"
    if err > tol:
        fails.append(name)
    print(f"{st} {name:44s} hesap={got:16.8f} excel={want:16.8f} hata={err:.2e}")


for ad, p, m1o, m2o, m1s, m2s, gold in DURUM:
    print(f"--- {ad} ---")
    o = mmy.hesapla(p, BOLGE, m1_ort=m1o, m2_ort=m2o, m1_s=m1s, m2_s=m2s)
    for k, want in gold.items():
        check(f"{ad.split()[0]}.{k}", float(o[k]), float(want))
    print()

# 1.13 katsayısı yalnız istenirse uygulanır (kaynak dosyalarda kapalı)
o = mmy.hesapla(P51, BOLGE, m1_ort=0.9816748997651582, m1_s=0.8889256606314562,
                gun_katsayisi=True)
check("1.13 katsayılı MMY", o["mmy"], 323.43624435739866 * 1.13)

# bölge adı Km tablosundan geliyor mu
if "MARMARA" not in o["bolge_adi"]:
    fails.append("bolge_adi")
print(f"{'OK ' if 'MARMARA' in o['bolge_adi'] else 'FAIL'} bölge adı = {o['bolge_adi'][:45]}")

print()
if fails:
    print(f"BAŞARISIZ ({len(fails)}): {', '.join(fails)}")
    sys.exit(1)
print("TÜM TESTLER GEÇTİ")
