# -*- coding: utf-8 -*-
"""Kenetleme atlama uyarısı — DEM gerektirmeyen kural sınaması.

Gerçek olay (Beyağaç/Denizli, 28.88968E 37.24602N): tıklanan noktanın 58 m
yanında 24.5 km²'lik kol var, 2 km ötede ise bambaşka bir akarsu. Kenetleme
kuralı "yarıçap içindeki en yüksek birikim" olduğu için yarıçap büyüdükçe
sonuç yakınsamıyor:

    250 m -> 24.5 km²      2000 m -> 215.2 km²   (komşu akarsuya atladı)
    500 m -> 24.6          4000 m -> 311.5
   1000 m -> 25.4

Uyarı yalnız ATLAMA durumunda çıkmalı. Aynı kol üzerinde mansaba kaymak
alanı değiştirmez ve uyarı vermemelidir — 500 m yarıçapta kenetleme 477 m
gidiyor ama sonuç doğru; sırf mesafeye bakan bir kural burada yanlış alarm
verirdi.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from backend.core import gis  # noqa: E402

hatalar = []


def kontrol(ad, out, uyari_bekleniyor):
    r = gis._kenetleme_uyar(dict(out))
    var = bool(r.get("uyarilar"))
    ok = var == uyari_bekleniyor
    print(f"{'OK  ' if ok else 'FAIL'} {ad:<46} uyarı={'var' if var else 'yok':<3} "
          f"(beklenen {'var' if uyari_bekleniyor else 'yok'})")
    if not ok:
        hatalar.append(ad)


# --- Beyağaç: dipteki kol 24.5 km², seçilen alan yarıçapa göre değişiyor
for yaricap, alan, bekle in ((250, 24.530, False), (500, 24.579, False),
                             (1000, 25.416, False), (2000, 215.227, True),
                             (4000, 311.456, True)):
    kontrol(f"Beyağaç yarıçap {yaricap} m -> {alan:.1f} km²",
            {"alan_km2": alan, "snap_mesafe_m": 0.95 * yaricap,
             "kenetleme_yaricapi_m": yaricap, "kenetleme_doymus": True,
             "yakin_en_buyuk_km2": 24.5}, bekle)

# --- doymamış kenetleme: yakında yatağa oturmuş, alan ne olursa olsun uyarı yok
kontrol("kenetleme doymamış (yatağın üstüne tıklanmış)",
        {"alan_km2": 900.0, "snap_mesafe_m": 30.0, "kenetleme_yaricapi_m": 500,
         "kenetleme_doymus": False, "yakin_en_buyuk_km2": 24.5}, False)

# --- dipte hiç kol yok: referans yoksa uyarma (yanlış alarm üretmemek için)
kontrol("dipte kol yok — referans yok",
        {"alan_km2": 215.0, "snap_mesafe_m": 1900.0, "kenetleme_yaricapi_m": 2000,
         "kenetleme_doymus": True, "yakin_en_buyuk_km2": None}, False)

# --- sınırda: tam 1.5 kat uyarı vermemeli, biraz üstü vermeli
kontrol("seçilen = 1.5 × dipteki (sınır, uyarı yok)",
        {"alan_km2": 30.0, "snap_mesafe_m": 1900.0, "kenetleme_yaricapi_m": 2000,
         "kenetleme_doymus": True, "yakin_en_buyuk_km2": 20.0}, False)
kontrol("seçilen = 1.6 × dipteki (uyarı var)",
        {"alan_km2": 32.0, "snap_mesafe_m": 1900.0, "kenetleme_yaricapi_m": 2000,
         "kenetleme_doymus": True, "yakin_en_buyuk_km2": 20.0}, True)

# --- uyarı metni kullanıcıya iki sayıyı da vermeli
r = gis._kenetleme_uyar({"alan_km2": 215.227, "snap_mesafe_m": 1988.0,
                         "kenetleme_yaricapi_m": 2000, "kenetleme_doymus": True,
                         "yakin_en_buyuk_km2": 24.58})
metin = (r.get("uyarilar") or [""])[0]
for parca in ("215.2", "24.6", "1988", "2000"):
    if parca not in metin:
        hatalar.append(f"uyarı metninde {parca} yok")
print(f"{'OK  ' if not hatalar else 'FAIL'} uyarı metni seçilen/dipteki/mesafe/yarıçapı içeriyor")

if hatalar:
    print("\nBAŞARISIZ:", ", ".join(hatalar))
    sys.exit(1)
print("\nTÜM KENETLEME SINAMALARI GEÇTİ")
