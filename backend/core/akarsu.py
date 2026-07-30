# -*- coding: utf-8 -*-
"""DSİ kaynak akarsu ağı — haritada gösterilen seçilebilir bağlam katmanı.

Veri `data/akarsu/akarsu.sqlite` içinde durur ve `tools/mdb_akarsu_cikar.py`
ile Kaynak_Akarsu.mdb'den bir kez üretilir (bkz. o dosyanın başlığı: MDB
okumak ODBC/Access gerektirir, bu da Windows'a özgüdür — çalışma anında
yalnızca stdlib sqlite3 kullanılır).

Türkiye'nin tamamı üç ölçekte ~405.000 çizgi tuttuğu için tamamı asla
gönderilmez: R*Tree indeksiyle yalnız istenen pencere (bbox) döndürülür.
Bu katman HESABA GİRMEZ; havza/dere çıkarımı yine DEM'den yapılır.
"""
import os
import sqlite3
import struct
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB_YOLU = os.path.join(ROOT, "data", "akarsu", "akarsu.sqlite")

OLCEKLER = (100, 250, 500)
VARSAYILAN_SINIR = 8000        # tek istekte döndürülecek en çok kol sayısı

_yerel = threading.local()     # sqlite bağlantısı iş parçacığına özgü olmalı


def var_mi():
    return os.path.exists(DB_YOLU)


def _baglanti():
    db = getattr(_yerel, "db", None)
    if db is None:
        if not var_mi():
            raise RuntimeError(
                "Akarsu katmanı verisi yok. Kaynak_Akarsu.mdb'den üretmek için:\n"
                "  pip install pyodbc\n"
                '  python tools/mdb_akarsu_cikar.py "…\\Havzalar\\Kaynak_Akarsu.mdb"')
        db = sqlite3.connect(DB_YOLU, check_same_thread=False)
        _yerel.db = db
    return db


def bilgi():
    """Katman var mı, hangi ölçekte kaç kol var (arayüzde göstermek için)."""
    if not var_mi():
        return {"var": False, "olcekler": []}
    db = _baglanti()
    sat = db.execute("SELECT olcek, COUNT(*) FROM kol GROUP BY olcek "
                     "ORDER BY olcek").fetchall()
    return {
        "var": True,
        "boyut_mb": round(os.path.getsize(DB_YOLU) / 1e6, 1),
        "olcekler": [{"olcek": o, "kol": n} for o, n in sat],
    }


def _cizgi(paket):
    """Paketli float32 lon/lat çiftlerini GeoJSON koordinat listesine çevirir."""
    n = len(paket) // 8            # her nokta 2 × float32 = 8 bayt
    duz = struct.unpack(f"<{2 * n}f", paket)
    return [[duz[2 * i], duz[2 * i + 1]] for i in range(n)]


def sorgula(bbox, olcek=100, sinir=VARSAYILAN_SINIR):
    """Verilen pencere içindeki akarsu kollarını GeoJSON olarak döndürür.

    bbox: (bati, guney, dogu, kuzey) WGS84 derece.
    """
    if olcek not in OLCEKLER:
        raise ValueError(f"Ölçek {OLCEKLER} içinden olmalı (verilen: {olcek})")
    b, g, d, k = (float(v) for v in bbox)
    if not (-180 <= b < d <= 180 and -90 <= g < k <= 90):
        raise ValueError("Geçersiz pencere (bbox)")
    sinir = max(1, min(int(sinir), 50000))

    db = _baglanti()
    # R*Tree ile kesişen kolları bul, sonra geometriyi çek
    sat = db.execute(
        "SELECT k.id, k.ad, k.tip, k.uzunluk_m, k.nokta "
        "FROM kol_idx i JOIN kol k ON k.id = i.id "
        "WHERE i.xmax >= ? AND i.xmin <= ? AND i.ymax >= ? AND i.ymin <= ? "
        "  AND k.olcek = ? LIMIT ?",
        (b, d, g, k, olcek, sinir + 1)).fetchall()

    kirpildi = len(sat) > sinir
    sat = sat[:sinir]
    ozellikler = []
    for kid, ad, tip, uzunluk, paket in sat:
        koord = _cizgi(paket)
        if len(koord) < 2:
            continue
        ozellikler.append({
            "type": "Feature",
            "properties": {"id": kid, "ad": ad or "", "tip": tip or "",
                           "uzunluk_m": round(uzunluk, 1) if uzunluk else None},
            "geometry": {"type": "LineString", "coordinates": koord},
        })
    return {
        "geojson": {"type": "FeatureCollection", "features": ozellikler},
        "olcek": olcek,
        "sayi": len(ozellikler),
        "kirpildi": kirpildi,      # sınır aşıldıysa arayüz kullanıcıyı uyarır
        "sinir": sinir,
    }
