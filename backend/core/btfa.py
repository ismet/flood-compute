# -*- coding: utf-8 -*-
"""Bölgesel Taşkın Frekans Analizi (BTFA) — indeks-debi (index flood) yöntemi.

`Karamandere NTFA-BTFA.xlsx` (T7.2BTFA sayfası) yöntemi:

  1. Bölgedeki her AGİ için noktasal analiz (NTFA) yapılır, kabul edilen
     dağılımın Q2…Q100 değerleri alınır.
  2. Her istasyon kendi Q2'sine bölünerek boyutsuz büyüme eğrisi çıkarılır
     (QT/Q2), istasyonlar arasında ortalanır → bölgesel büyüme eğrisi.
  3. Proje havzasının indeks debisi Q2, alan-debi bağıntısından bulunur:
     Q2 = a · A^b  (Excel'de a = 1 alınıp yalnız üs yazılıyor).
  4. Q_T = Q2 · (QT/Q2)_ortalama.
  5. Q500/1000/10000, uygulamanın genelindeki gibi Q10-Q100'den ekstrapole
     edilir — Excel'deki `(Q100-Q10)*1.692+Q10` ile aynı.

ÜS HAKKINDA UYARI: Örnek dosyada yazan üsler (Q2 için 0.8968, Q100 için 1.259)
o dosyadaki 15 istasyonun en küçük kareler uyumundan ÇIKMIYOR (serbest uyum
0.0827·A^1.3146 veriyor). Elle girilmiş olmalılar. Bu yüzden burada regresyon
veriden hesaplanır ve raporlanır, ama `us`/`katsayi` verilerek elle geçilebilir
— rapordaki sayıyı birebir tutturmak gerektiğinde kullanılır.

Tek istasyondan alan oranıyla aktarım (Excel r25) ayrıca sunulur:
     Q_T,havza = Q_T,AGİ · (A_havza / A_AGİ)^n     (n varsayılan 2/3)
"""
import math

from . import tfa

# Büyüme eğrisi bu tekerrürler üzerinden kurulur (Excel T7.2BTFA N4:S4).
# 20-30 yıllık serilerden 500+ yıl doğrudan okunmaz; onlar ekstrapole edilir.
TEKERRUR = (2, 5, 10, 25, 50, 100)

# Q10 ve Q100'den uzun tekerrürlere geçiş katsayıları (uygulama geneliyle aynı).
EKSTRAPOLASYON = ((500, 1.692), (1000, 1.99), (10000, 2.98))

VARSAYILAN_TRANSFER_USSU = 2.0 / 3.0


def _kuvvet_uyumu(alanlar, debiler, katsayi_serbest=True):
    """log-log en küçük kareler: Q = a·A^b  →  (a, b, R²).

    Excel'in "kuvvet" trend çizgisiyle aynı hesap. katsayi_serbest=False ise
    a = 1 alınıp yalnız üs aranır (Excel'de bağıntı böyle yazılmış).
    """
    ok = [(a, q) for a, q in zip(alanlar, debiler)
          if a and q and a > 0 and q > 0]
    if len(ok) < 2:
        raise ValueError("Alan-debi bağıntısı için en az 2 istasyon gerekir")
    lx = [math.log(a) for a, _ in ok]
    ly = [math.log(q) for _, q in ok]
    n = len(lx)
    if katsayi_serbest:
        mx, my = sum(lx) / n, sum(ly) / n
        sxx = sum((x - mx) ** 2 for x in lx)
        b = sum((x - mx) * (y - my) for x, y in zip(lx, ly)) / sxx
        a = math.exp(my - b * mx)
    else:
        b = sum(x * y for x, y in zip(lx, ly)) / sum(x * x for x in lx)
        a = 1.0
    tahmin = [math.log(a) + b * x for x in lx]
    my = sum(ly) / n
    sst = sum((y - my) ** 2 for y in ly)
    sse = sum((y - t) ** 2 for y, t in zip(ly, tahmin))
    r2 = 1 - sse / sst if sst > 0 else 1.0
    return a, b, r2, n


def _ekstrapole(q):
    """Q10 ve Q100'den Q500/1000/10000. q: TEKERRUR sırasına göre liste."""
    q10, q100 = q[TEKERRUR.index(10)], q[TEKERRUR.index(100)]
    return [q10 + k * (q100 - q10) for _, k in EKSTRAPOLASYON]


def istasyon_analizi(seriler):
    """Her istasyon için NTFA çalıştırıp Q2…Q100 ve QT/Q2 oranlarını çıkarır.

    seriler: [{kod, ad, alan, x: [yıllık pikler]}]
    Kabul edilen dağılımda ilgili tekerrür hesaplanamıyorsa (Normal 500'de
    biter, P3/LP3 |Cs|>3'te boş döner) istasyon büyüme eğrisine katılmaz.
    """
    cikti = []
    for s in seriler:
        try:
            o = tfa.ozet(s["x"], istasyon=s.get("kod", ""))
        except ValueError as e:
            cikti.append({**s, "hata": str(e), "kullanildi": False})
            continue
        q_hepsi = o["kabul_edilen_q"]
        idx = [tfa.TEKERRUR.index(t) for t in TEKERRUR]
        q = [q_hepsi[i] for i in idx]
        kayit = {
            "kod": s.get("kod", ""), "ad": s.get("ad", ""), "alan": s.get("alan"),
            "yil_sayisi": o["parametreler"]["yil_sayisi"],
            "dagilim": o["kabul_edilen"], "dagilim_adi": o["kabul_edilen_adi"],
            "q": q, "gozlem_maks": max(s["x"]),
        }
        if any(v is None for v in q) or not q[0]:
            kayit.update(oranlar=None, kullanildi=False,
                         hata="kabul edilen dağılım bu tekerrürlerde tanımsız")
        else:
            kayit.update(oranlar=[v / q[0] for v in q], kullanildi=True)
        cikti.append(kayit)
    return cikti


def bolgesel(seriler, alan_km2, us=None, katsayi=None, katsayi_serbest=False,
             disla=(), transfer_kod=None, transfer_ussu=VARSAYILAN_TRANSFER_USSU):
    """BTFA — bölgesel büyüme eğrisi + indeks debi ile havza taşkın debileri.

    alan_km2 : proje havzasının yağış alanı
    us       : alan-debi üssü b; None ise veriden hesaplanır
    katsayi  : bağıntı katsayısı a; None ise (us verildiyse) 1 alınır
    disla    : büyüme eğrisine katılmayacak istasyon kodları
    """
    if not alan_km2 or alan_km2 <= 0:
        raise ValueError("Havza alanı (km²) gerekli")
    ist = istasyon_analizi(seriler)
    for k in ist:
        if k["kod"] in set(disla):
            k["kullanildi"] = False
            k["hata"] = k.get("hata") or "kullanıcı dışladı"

    kullanilan = [k for k in ist if k.get("kullanildi")]
    if len(kullanilan) < 2:
        raise ValueError("Bölgesel analiz için en az 2 uygun istasyon gerekir "
                         f"(uygun bulunan: {len(kullanilan)})")

    # bölgesel büyüme eğrisi — istasyonlar arası ortalama QT/Q2
    buyume = [sum(k["oranlar"][i] for k in kullanilan) / len(kullanilan)
              for i in range(len(TEKERRUR))]

    # indeks debi bağıntısı: Q2 = a·A^b
    a_hes, b_hes, r2, n_reg = _kuvvet_uyumu(
        [k["alan"] for k in kullanilan], [k["q"][0] for k in kullanilan],
        katsayi_serbest=True)
    a1_hes, b1_hes, r2_1, _ = _kuvvet_uyumu(
        [k["alan"] for k in kullanilan], [k["q"][0] for k in kullanilan],
        katsayi_serbest=False)
    if us is not None:
        b = float(us)
        a = 1.0 if katsayi is None else float(katsayi)
        kaynak = "elle"
    elif katsayi_serbest:
        a, b, kaynak = a_hes, b_hes, "regresyon (a serbest)"
    else:
        a, b, kaynak = a1_hes, b1_hes, "regresyon (a=1)"

    q2 = a * (alan_km2 ** b)
    q = [q2 * g for g in buyume]
    uzun = _ekstrapole(q)

    sonuc = {
        "alan_km2": alan_km2,
        "tekerrur": list(TEKERRUR),
        "istasyonlar": ist,
        "kullanilan_sayisi": len(kullanilan),
        "buyume_egrisi": buyume,
        "bagintis": {
            "katsayi": a, "us": b, "kaynak": kaynak,
            "regresyon_serbest": {"katsayi": a_hes, "us": b_hes, "r2": r2, "n": n_reg},
            "regresyon_a1": {"katsayi": 1.0, "us": b1_hes, "r2": r2_1, "n": n_reg},
        },
        "q2_indeks": q2,
        "btfa": {"tekerrur": list(TEKERRUR) + [t for t, _ in EKSTRAPOLASYON],
                 "q": q + uzun,
                 "ekstrapole_baslangic": len(TEKERRUR)},
    }

    # tek istasyondan alan oranıyla aktarım (Excel r25) — karşılaştırma satırı
    if transfer_kod:
        kaynak_ist = next((k for k in ist if k["kod"] == transfer_kod), None)
        if kaynak_ist and kaynak_ist.get("alan") and kaynak_ist["q"][0]:
            oran = (alan_km2 / kaynak_ist["alan"]) ** float(transfer_ussu)
            qt = [(v * oran if v is not None else None) for v in kaynak_ist["q"]]
            sonuc["ntfa_transfer"] = {
                "kod": transfer_kod, "ad": kaynak_ist["ad"],
                "kaynak_alan": kaynak_ist["alan"], "us": float(transfer_ussu),
                "oran": oran,
                "tekerrur": list(TEKERRUR) + [t for t, _ in EKSTRAPOLASYON],
                "q": qt + _ekstrapole(qt),
            }
    return sonuc
