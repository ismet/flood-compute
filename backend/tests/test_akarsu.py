# -*- coding: utf-8 -*-
"""DSİ akarsu ağı katmanı sınaması.

Veri (data/akarsu/akarsu.sqlite) depoda tutulmaz — Kaynak_Akarsu.mdb'den
tools/mdb_akarsu_cikar.py ile üretilir. Veri yoksa sınama ATLANIR (hata değil),
böylece temiz bir klonda test paketi kırılmaz.

Çalıştırma:  python backend/tests/test_akarsu.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from backend.core import akarsu  # noqa: E402

# Ayvalık çevresi — 1/25000 j17a3 paftasının kapsadığı alan
PENCERE = (26.62, 39.24, 26.75, 39.38)


def main():
    if not akarsu.var_mi():
        print("ATLANDI  data/akarsu/akarsu.sqlite yok.")
        print("         Üretmek için: pip install pyodbc && "
              'python tools/mdb_akarsu_cikar.py "…\\Kaynak_Akarsu.mdb"')
        return

    b = akarsu.bilgi()
    assert b["var"] and b["olcekler"], b
    olcekler = {o["olcek"]: o["kol"] for o in b["olcekler"]}
    print(f"OK  katman bilgisi       {b['boyut_mb']} MB, "
          + " · ".join(f"1/{o}.000={n}" for o, n in sorted(olcekler.items())))

    # --- 1) pencere sorgusu: ölçek büyüdükçe kol sayısı azalmalı
    onceki = None
    for olcek in sorted(akarsu.OLCEKLER):
        r = akarsu.sorgula(PENCERE, olcek=olcek)
        assert r["olcek"] == olcek
        assert r["sayi"] == len(r["geojson"]["features"])
        if onceki is not None:
            assert r["sayi"] <= onceki, \
                f"1/{olcek}.000 ({r['sayi']}) daha ayrıntılı ölçekten fazla ({onceki})"
        onceki = r["sayi"]
        print(f"OK  1/{olcek}.000 sorgusu   {r['sayi']} kol")

    # --- 2) geometri geçerli ve pencereyle kesişiyor
    r = akarsu.sorgula(PENCERE, olcek=100)
    assert r["sayi"] > 0, "Ayvalık penceresinde hiç akarsu yok — veri bozuk olabilir"
    bati, guney, dogu, kuzey = PENCERE
    for f in r["geojson"]["features"]:
        koord = f["geometry"]["coordinates"]
        assert f["geometry"]["type"] == "LineString" and len(koord) >= 2
        # en az bir nokta makul yakınlıkta olmalı (kol pencereden taşabilir)
        assert any(bati - 1 <= x <= dogu + 1 and guney - 1 <= y <= kuzey + 1
                   for x, y in koord), f["properties"]
        for x, y in koord:
            assert 25 <= x <= 46 and 35 <= y <= 43, ("Türkiye dışı koordinat", x, y)
    print(f"OK  geometri             {r['sayi']} kolun tamamı LineString, "
          "koordinatlar Türkiye sınırları içinde")

    # --- 3) adlar okunabiliyor (P_NAME alanı)
    adlar = sorted({f["properties"]["ad"] for f in r["geojson"]["features"]
                    if f["properties"]["ad"]})
    assert adlar, "hiçbir kolda ad yok — öznitelik eşlemesi bozulmuş olabilir"
    print(f"OK  dere adları          {len(adlar)} adlı kol, ör. {adlar[:3]}")

    # --- 4) sınır (limit) uygulanıyor ve bildiriliyor
    kucuk = akarsu.sorgula(PENCERE, olcek=100, sinir=5)
    assert kucuk["sayi"] <= 5 and kucuk["kirpildi"] is True, kucuk
    print(f"OK  sınır/kırpma         sinir=5 → {kucuk['sayi']} kol, kirpildi=True")

    # --- 5) hatalı girdi anlaşılır biçimde reddediliyor
    for hatali, aciklama in (((26.7, 39.3, 26.6, 39.4), "batı > doğu"),
                             ((26.6, 39.4, 26.7, 39.3), "güney > kuzey"),
                             ((-200, 0, 200, 10), "boylam aralık dışı")):
        try:
            akarsu.sorgula(hatali, olcek=100)
            raise AssertionError(f"{aciklama} kabul edildi: {hatali}")
        except ValueError:
            pass
    try:
        akarsu.sorgula(PENCERE, olcek=999)
        raise AssertionError("geçersiz ölçek kabul edildi")
    except ValueError:
        pass
    print("OK  girdi doğrulama      ters/aşırı pencere ve geçersiz ölçek reddediliyor")

    # --- 6) boş bölge (Akdeniz açıkları) çökmeden 0 kol dönmeli
    bos = akarsu.sorgula((30.0, 33.0, 30.2, 33.2), olcek=100)
    assert bos["sayi"] == 0 and not bos["kirpildi"], bos
    print("OK  boş bölge            0 kol, çökmüyor")

    # --- 7) otomatik ölçek: geniş bakışta kaba ağ seçilmeli
    assert akarsu.oto_olcek(3.0) == 500 and akarsu.oto_olcek(1.0) == 250
    assert akarsu.oto_olcek(0.1) == 100
    genis = akarsu.sorgula((25.5, 38.5, 28.5, 40.5), olcek="oto")
    dar = akarsu.sorgula(PENCERE, olcek="oto")
    assert genis["otomatik"] and genis["olcek"] == 500, genis["olcek"]
    assert dar["otomatik"] and dar["olcek"] == 100, dar["olcek"]
    print(f"OK  otomatik ölçek       geniş→1/{genis['olcek']}.000, dar→1/{dar['olcek']}.000")

    # --- 8) yanıt boyutu sınırlı kalmalı (tarayıcı "Failed to fetch" vermesin)
    # Sadeleştirme olmadan geniş pencere 7 MB'a çıkıyor ve saniyelerce sürüyordu.
    import json
    for ad, pencere in (("geniş", (25.5, 38.5, 28.5, 40.5)),
                        ("çok geniş", (24.0, 36.0, 32.0, 42.0))):
        r = akarsu.sorgula(pencere, olcek="oto")
        mb = len(json.dumps(r["geojson"])) / 1e6
        assert mb < 2.0, f"{ad} pencere yanıtı {mb:.2f} MB — fazla büyük"
        print(f"OK  yanıt boyutu         {ad}: {r['sayi']} kol, {mb:.2f} MB")

    # sadeleştirme gerçekten nokta azaltıyor mu
    ham = akarsu.sorgula(PENCERE, olcek=100, sadelestir=False)
    sade = akarsu.sorgula(PENCERE, olcek=100, sadelestir=True)
    n_ham = sum(len(f["geometry"]["coordinates"]) for f in ham["geojson"]["features"])
    n_sade = sum(len(f["geometry"]["coordinates"]) for f in sade["geojson"]["features"])
    assert n_sade <= n_ham, (n_ham, n_sade)
    print(f"OK  sadeleştirme         {n_ham} → {n_sade} nokta")

    print("\nTÜM AKARSU SINAMALARI GEÇTİ")


if __name__ == "__main__":
    main()
