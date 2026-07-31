# -*- coding: utf-8 -*-
"""BTFA golden testi — "Karamandere NTFA-BTFA.xlsx" (T7.2BTFA) ile karşılaştırma.

İstasyon başına Q2…Q100 değerleri Excel'den sabit olarak verilir; böylece
BÖLGESEL adımlar (boyutsuz büyüme eğrisi, indeks debi, ekstrapolasyon ve tek
istasyondan alan oranıyla aktarım) NTFA motorundan bağımsız sınanır.

NOT: Excel'in alan-debi üssü (0.8968) o dosyadaki verinin en küçük kareler
uyumundan çıkmıyor — elle girilmiş. Bu yüzden test, üs elle verildiğinde
Excel'in havza satırını birebir ürettiğimizi doğrular; regresyonun kendisi
ayrıca kendi içinde tutarlılık için sınanır.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from backend.core import btfa  # noqa: E402

# T7.2BTFA A5:L22 — (kod, ad, alan, Q2, Q5, Q10, Q25, Q50, Q100), büyüme
# eğrisine katılmayanlar (D02A095/096/097) listede yok.
ISTASYON = [
    ("D02A015", "Karasu-İnceğiz", 174.9, [65.08744702199924, 139.70635260905988,
     198.9840493413857, 280.55130288409237, 344.26975950221214, 409.259099837953]),
    ("D02A021", "Sarısu-Bahşayış", 143.0, [75.57038760174346, 86.41922540024943,
     89.95301416658276, 92.46963162468148, 93.54211704645294, 94.23144240630835]),
    ("D02A022", "Sazlı D.-Bosna", 84.0, [25.627247346035475, 50.83480968597983,
     76.72813044399815, 124.20520133288764, 173.59478688813238, 238.47632481896025]),
    ("D02A023", "Nakkaş D.-Halkalı", 43.75, [8.18972081210039, 15.74142835120749,
     22.15162610056263, 31.894371622681437, 40.34409720101275, 49.853617719067906]),
    ("D02A024", "Çakıl D.-Tepecik", 95.75, [18.940268672135286, 31.942338929687516,
     40.55084078765024, 51.42770570588214, 59.49678545133163, 67.50628437855099]),
    ("D02A028", "Istranca D.-Karamandere", 287.1, [142.39667775875682, 237.2645022648147,
     303.05179933940394, 387.2432797859897, 449.8290044250488, 511.5354443626853]),
    ("D02A046", "Kova D.-B.Kılıçlı", 54.2, [19.73896273407741, 41.04827831876743,
     55.44604589616862, 73.41460498813781, 86.51569077697258, 99.3188014278224]),
    ("D02A047", "Mağlova D.-Pirinçköy", 111.8, [55.46247907299181, 90.43758318487914,
     112.29113780473259, 138.4473723144666, 156.96370456940767, 174.70602376133039]),
    ("D02A057", "Pabuç D.-Kızılağaç", 83.5, [37.02725922644321, 68.19946706446368,
     93.85604157712936, 131.95973479958448, 164.3795670580907, 200.3397705528132]),
    ("D02A107", "Kılıncı D.-Kemerburgaz", 55.0, [8.257284939782473, 11.959931159036229,
     13.77536491064751, 15.4816962151854, 16.42176818766407, 17.151362528315214]),
    ("D02A116", "Sarısu-İzzettin", 83.9, [51.602474450812984, 82.2049738717583,
     104.42970942971276, 134.4215385647119, 157.94936874151338, 182.32249465866818]),
    ("D02A117", "Çakıldere-Ahmediye", 65.8, [16.818050947917065, 32.948561403876326,
     44.408148971466524, 58.828085721632284, 69.20033998140282, 79.0872844318746]),
    ("D02A136", "Kağıthane D.-Kağıthane", 182.8, [62.99, 99.55, 123.75, 154.33,
     177.01, 199.53]),
    ("D01A052", "K.Yoncalı-Manika D.", 118.3, [48.31918047411335, 113.26542256438555,
     170.65658767354327, 257.6129392776747, 331.6085241287631, 412.0185762390306]),
    ("D01A063", "Ayvacık D.-Ayvacık", 25.8, [8.556266717176301, 14.294834157005116,
     18.69440200138523, 24.8918402540231, 29.938224321882256, 35.352749155268256]),
]

# T7.2BTFA N23:S23 — ortalama boyutsuz taşkın yinelenme değerleri
BUYUME_GOLD = [1.0, 1.7797487840999249, 2.373183095131933,
               3.2105101722770093, 3.90108210543613, 4.6543798746667475]
# T7.2BTFA N24:T24 — Karamandere Barajı (A = 115 km²), üs 0.8968
BTFA_GOLD = [70.47479532088136, 125.42743128202967, 167.2495928883987,
             226.26004726682976, 274.9279629105642, 328.0164690127684]
Q500_GOLD = 439.26714729083227
# T7.2BTFA N25:T25 — D02A028'den (A=287.1) alan oranıyla, üs 2/3
TRANSFER_GOLD = [77.37659637975814, 128.92660078833748, 164.67460567704492,
                 210.42321655521658, 244.43152651547726, 277.96204402639347]
TRANSFER_Q500_GOLD = 356.3569513641427

fails = []


def check(name, got, want, tol=1e-9):
    err = abs(got - want) / max(abs(want), 1e-12)
    st = "OK " if err <= tol else "FAIL"
    if err > tol:
        fails.append(name)
    print(f"{st} {name:26s} hesap={got:16.8f} excel={want:16.8f} hata={err:.2e}")


# --- büyüme eğrisi: istasyonların QT/Q2 ortalaması
kullanilan = [{"kod": k, "ad": a, "alan": al, "q": q, "oranlar": [v / q[0] for v in q],
               "kullanildi": True} for k, a, al, q in ISTASYON]
print(f"--- bölgesel büyüme eğrisi ({len(kullanilan)} istasyon) ---")
for i, t in enumerate(btfa.TEKERRUR):
    got = sum(k["oranlar"][i] for k in kullanilan) / len(kullanilan)
    check(f"Q{t}/Q2", got, BUYUME_GOLD[i])

# --- indeks debi + havza debileri (Excel'in elle girdiği üs ile)
US, ALAN = 0.8968, 115.0
q2 = 1.0 * ALAN ** US
print("\n--- indeks debi ve BTFA debileri (A = 115 km², Q2 = A^0.8968) ---")
check("Q2 indeks", q2, BTFA_GOLD[0])
for i, t in enumerate(btfa.TEKERRUR):
    check(f"BTFA Q{t}", q2 * BUYUME_GOLD[i], BTFA_GOLD[i])
q = [q2 * g for g in BUYUME_GOLD]
check("BTFA Q500", btfa._ekstrapole(q)[0], Q500_GOLD)

# --- tek istasyondan alan oranıyla aktarım
print("\n--- NTFA aktarımı (D02A028, A=287.1 → 115 km², üs 2/3) ---")
kaynak = next(k for k in ISTASYON if k[0] == "D02A028")
oran = (ALAN / kaynak[2]) ** (2 / 3)
qt = [v * oran for v in kaynak[3]]
for i, t in enumerate(btfa.TEKERRUR):
    check(f"aktarım Q{t}", qt[i], TRANSFER_GOLD[i])
check("aktarım Q500", btfa._ekstrapole(qt)[0], TRANSFER_Q500_GOLD)

# --- uçtan uca: bolgesel() aynı sayıları üretiyor mu (üs elle verilince)
print("\n--- bolgesel() uçtan uca ---")
seriler = [{"kod": k, "ad": a, "alan": al, "x": [1.0]} for k, a, al, q in ISTASYON]
o = btfa.bolgesel.__wrapped__ if hasattr(btfa.bolgesel, "__wrapped__") else None
# NTFA'yı atlayıp doğrudan bölgesel adımları sınamak için istasyon kayıtlarını
# hazır veriyoruz (istasyon_analizi'nin çıktısıyla aynı biçim).
import types  # noqa: E402
gercek = btfa.istasyon_analizi
btfa.istasyon_analizi = lambda s: [dict(k) for k in kullanilan]
try:
    r = btfa.bolgesel(seriler, ALAN, us=US, transfer_kod="D02A028")
finally:
    btfa.istasyon_analizi = gercek
for i, t in enumerate(btfa.TEKERRUR):
    check(f"uçtan uca Q{t}", r["btfa"]["q"][i], BTFA_GOLD[i])
check("uçtan uca Q500", r["btfa"]["q"][len(btfa.TEKERRUR)], Q500_GOLD)
for i, t in enumerate(btfa.TEKERRUR):
    check(f"uçtan uca aktarım Q{t}", r["ntfa_transfer"]["q"][i], TRANSFER_GOLD[i])

print()
if fails:
    print(f"BAŞARISIZ ({len(fails)}): {', '.join(fails)}")
    sys.exit(1)
print("TÜM TESTLER GEÇTİ")
