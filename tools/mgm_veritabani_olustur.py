#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Kanonik MGM istasyon JSON dosyasını değiştirmeden doğrula ve raporla."""
import argparse
import hashlib
import json
import math
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VARSAYILAN_YOL = ROOT / "data" / "mgm" / "mgm-istasyonlari.json"
BEKLENEN_ISTASYON = 1913

ILLER = (
    "Adana", "Adıyaman", "Afyonkarahisar", "Ağrı", "Amasya", "Ankara", "Antalya", "Artvin",
    "Aydın", "Balıkesir", "Bilecik", "Bingöl", "Bitlis", "Bolu", "Burdur", "Bursa",
    "Çanakkale", "Çankırı", "Çorum", "Denizli", "Diyarbakır", "Edirne", "Elazığ", "Erzincan",
    "Erzurum", "Eskişehir", "Gaziantep", "Giresun", "Gümüşhane", "Hakkari", "Hatay", "Isparta",
    "Mersin", "İstanbul", "İzmir", "Kars", "Kastamonu", "Kayseri", "Kırklareli", "Kırşehir",
    "Kocaeli", "Konya", "Kütahya", "Malatya", "Manisa", "Kahramanmaraş", "Mardin", "Muğla",
    "Muş", "Nevşehir", "Niğde", "Ordu", "Rize", "Sakarya", "Samsun", "Siirt", "Sinop",
    "Sivas", "Tekirdağ", "Tokat", "Trabzon", "Tunceli", "Şanlıurfa", "Uşak", "Van", "Yozgat",
    "Zonguldak", "Aksaray", "Bayburt", "Karaman", "Kırıkkale", "Batman", "Şırnak", "Bartın",
    "Ardahan", "Iğdır", "Yalova", "Karabük", "Kilis", "Osmaniye", "Düzce",
)
IL_PLAKALARI = {ad: plaka for plaka, ad in enumerate(ILLER, 1)}
ALANLAR = {
    "istNo", "istAd", "enlem", "boylam", "yukseklik", "ilPlaka", "il", "ilce", "BirimId",
    "Indikator", "BasincSensor", "NemSensor", "RuzgarSensor", "SicaklikSensor", "ToprakSicSensor",
    "HaliHazirHavaSensor", "OmgiGrupAdi", "YagisSensor", "KarSensor",
}
SENSORLER = (
    "BasincSensor", "NemSensor", "RuzgarSensor", "SicaklikSensor", "ToprakSicSensor",
    "HaliHazirHavaSensor", "YagisSensor", "KarSensor",
)
TAMSAYILAR = {"istNo", "ilPlaka", "BirimId", *SENSORLER}
METINLER = {"istAd", "il", "OmgiGrupAdi"}
NULL_OLABILIR = {"ilce", "Indikator"}
EKSIK_OLABILIR = {"YagisSensor", "KarSensor"}
BEKLENEN_EKSIK_SENSORLER = {
    (18286, "YagisSensor"), (18286, "KarSensor"),
    (18654, "YagisSensor"), (18654, "KarSensor"),
    (18982, "YagisSensor"), (18982, "KarSensor"),
    (18981, "YagisSensor"), (18981, "KarSensor"),
}


def _norm(ad):
    metin = unicodedata.normalize("NFKD", str(ad or "").upper())
    return re.sub(r"[^A-Z0-9]", "", "".join(c for c in metin if not unicodedata.combining(c)))


def _tekrar_sayisi(degerler):
    return sum(adet > 1 for adet in Counter(degerler).values())


def _alan_istatistikleri(kayitlar):
    sonuc = {}
    for alan in sorted(ALANLAR):
        degerler = [k.get(alan) for k in kayitlar]
        dolu = [v for v in degerler if v is not None]
        siralanabilir = dolu and (all(type(v) in (int, float) for v in dolu)
                                  or all(isinstance(v, str) for v in dolu))
        sonuc[alan] = {
            "turler": sorted({type(v).__name__ for v in degerler}),
            "farkli": len(set(dolu)),
            "min": min(dolu) if siralanabilir else None,
            "max": max(dolu) if siralanabilir else None,
        }
    return sonuc


def dosya_oku(yol):
    ham = Path(yol).read_bytes()
    return json.loads(ham), hashlib.sha256(ham).hexdigest()


def dogrula(veri, beklenen_istasyon=BEKLENEN_ISTASYON):
    """Doğrulama raporu ve hata listesini döndür."""
    hatalar = []
    if not isinstance(veri, dict):
        return {}, ["Kök değer 81 il kovası içeren bir nesne olmalı"]
    eksik = set(ILLER) - set(veri)
    fazla = set(veri) - set(ILLER)
    if eksik or fazla:
        hatalar.append(f"İl kovaları uyuşmuyor; eksik={sorted(eksik)}, fazla={sorted(fazla)}")

    kayitlar = []
    eksik_sensorler = set()
    for il, satirlar in veri.items():
        if not isinstance(satirlar, list):
            hatalar.append(f"{il}: il kovası dizi değil")
            continue
        plaka = IL_PLAKALARI.get(il)
        for sira, kayit in enumerate(satirlar, 1):
            yer = f"{il}[{sira}]"
            if not isinstance(kayit, dict):
                hatalar.append(f"{yer}: kayıt nesne değil")
                continue
            kayitlar.append(kayit)
            eksik_alan = ALANLAR - set(kayit)
            fazla_alan = set(kayit) - ALANLAR
            eksik_sensorler.update((kayit.get("istNo"), alan)
                                   for alan in eksik_alan & EKSIK_OLABILIR)
            if fazla_alan or eksik_alan - EKSIK_OLABILIR:
                hatalar.append(
                    f"{yer}: alanlar uyuşmuyor; eksik={sorted(eksik_alan)}, "
                    f"fazla={sorted(fazla_alan)}")
                continue
            for alan in TAMSAYILAR - EKSIK_OLABILIR:
                if type(kayit.get(alan)) is not int:
                    hatalar.append(f"{yer}.{alan}: tamsayı olmalı")
            if type(kayit.get("istNo")) is int and kayit["istNo"] <= 0:
                hatalar.append(f"{yer}.istNo: pozitif olmalı")
            for alan in METINLER:
                if not isinstance(kayit[alan], str) or not kayit[alan].strip():
                    hatalar.append(f"{yer}.{alan}: boş olmayan metin olmalı")
            for alan in NULL_OLABILIR:
                if kayit[alan] is not None and not isinstance(kayit[alan], str):
                    hatalar.append(f"{yer}.{alan}: metin veya null olmalı")
            for alan in ("enlem", "boylam", "yukseklik"):
                if (isinstance(kayit[alan], bool)
                        or not isinstance(kayit[alan], (int, float))
                        or not math.isfinite(kayit[alan])):
                    hatalar.append(f"{yer}.{alan}: sayı olmalı")
            if kayit["il"] != il or kayit["ilPlaka"] != plaka:
                hatalar.append(f"{yer}: il/plaka kova ile uyuşmuyor")
            if isinstance(kayit["enlem"], (int, float)) and not 35 <= kayit["enlem"] <= 43:
                hatalar.append(f"{yer}.enlem: Türkiye sınırı dışında")
            if isinstance(kayit["boylam"], (int, float)) and not 25 <= kayit["boylam"] <= 46:
                hatalar.append(f"{yer}.boylam: Türkiye sınırı dışında")
            for alan in SENSORLER:
                deger = kayit.get(alan)
                if alan in EKSIK_OLABILIR and deger is None:
                    continue
                if deger not in (0, 1) or type(deger) is not int:
                    hatalar.append(f"{yer}.{alan}: 0, 1 veya izin verilen null olmalı")

    kimlikler = [k.get("istNo") for k in kayitlar if type(k.get("istNo")) is int]
    tekrarlar = sorted(k for k, adet in Counter(kimlikler).items() if adet > 1)
    if tekrarlar:
        hatalar.append(f"Tekrarlanan istNo değerleri: {tekrarlar}")
    if len(kayitlar) != beklenen_istasyon:
        hatalar.append(f"İstasyon sayısı {len(kayitlar)}, beklenen {beklenen_istasyon}")
    if eksik_sensorler != BEKLENEN_EKSIK_SENSORLER:
        hatalar.append("Eksik YagisSensor/KarSensor alanları beklenen dört kayıtla uyuşmuyor")

    yagisli = [k for k in kayitlar if k.get("YagisSensor") == 1]

    rapor = {
        "il": len(veri),
        "istasyon": len(kayitlar),
        "null": {a: sum(k.get(a) is None for k in kayitlar) for a in sorted(ALANLAR)},
        "sensor": {a: sum(k.get(a) == 1 for k in kayitlar) for a in SENSORLER},
        "tekrar": tekrarlar,
        "tekrar_gruplari": {
            "ad": _tekrar_sayisi(k.get("istAd") for k in kayitlar),
            "normalize_ad": _tekrar_sayisi(_norm(k.get("istAd")) for k in kayitlar),
            "koordinat": _tekrar_sayisi((k.get("enlem"), k.get("boylam")) for k in kayitlar),
        },
        "yagisli_tekrar_gruplari": {
            "ad": _tekrar_sayisi(k.get("istAd") for k in yagisli),
            "normalize_ad": _tekrar_sayisi(_norm(k.get("istAd")) for k in yagisli),
            "koordinat": _tekrar_sayisi((k.get("enlem"), k.get("boylam")) for k in yagisli),
        },
        "alan": _alan_istatistikleri(kayitlar),
    }
    return rapor, hatalar


def rapor_yaz(yol, sha256, rapor, hatalar):
    print(f"dosya: {yol}")
    print(f"bayt: {Path(yol).stat().st_size}")
    print(f"sha256: {sha256}")
    print(f"il: {rapor.get('il', 0)}")
    print(f"istasyon: {rapor.get('istasyon', 0)}")
    print("null: " + ", ".join(f"{k}={v}" for k, v in rapor.get("null", {}).items()))
    print("sensor: " + ", ".join(f"{k}={v}" for k, v in rapor.get("sensor", {}).items()))
    print(f"tekrar: {len(rapor.get('tekrar', []))}")
    print("tekrar_gruplari: " + ", ".join(
        f"{k}={v}" for k, v in rapor.get("tekrar_gruplari", {}).items()))
    print("yagisli_tekrar_gruplari: " + ", ".join(
        f"{k}={v}" for k, v in rapor.get("yagisli_tekrar_gruplari", {}).items()))
    for alan, istatistik in rapor.get("alan", {}).items():
        print(f"alan.{alan}: tur={','.join(istatistik['turler'])}, "
              f"farkli={istatistik['farkli']}, min={istatistik['min']}, max={istatistik['max']}")
    if hatalar:
        print(f"HATA: {len(hatalar)} doğrulama hatası", file=sys.stderr)
        for hata in hatalar[:20]:
            print(f"  - {hata}", file=sys.stderr)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("yol", nargs="?", type=Path, default=VARSAYILAN_YOL)
    args = ap.parse_args(argv)
    try:
        veri, sha256 = dosya_oku(args.yol)
        rapor, hatalar = dogrula(veri)
    except (OSError, UnicodeError, json.JSONDecodeError) as hata:
        print(f"HATA: {hata}", file=sys.stderr)
        return 1
    rapor_yaz(args.yol, sha256, rapor, hatalar)
    return bool(hatalar)


if __name__ == "__main__":
    raise SystemExit(main())