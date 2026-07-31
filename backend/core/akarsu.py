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
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB_YOLU = os.path.join(ROOT, "data", "akarsu", "akarsu.sqlite")

OLCEKLER = (100, 250, 500)
VARSAYILAN_SINIR = 3000        # tek istekte döndürülecek en çok kol sayısı

# Pencere genişliğine (derece) göre otomatik ölçek. Geniş bakışta 1/100.000
# ağını göndermek anlamsız: hem okunmuyor hem de yanıt megabaytlara çıkıyor.
OTO_ESIK = ((2.0, 500), (0.5, 250))     # genişlik > eşik → o ölçek

# Ekranda bir pikselden küçük ayrıntıyı göndermenin faydası yok. Tipik harita
# genişliği ~1200 px kabul edilip tolerans pencere genişliğinden türetilir.
EKRAN_PIKSEL = 1200
ONDALIK = 5                    # ~1 m; float32 zaten bundan fazlasını taşımıyor

_yerel = threading.local()     # sqlite bağlantısı iş parçacığına özgü olmalı

# --------------------------------------------------------------- geometri kodu
# Ham float32 çiftleri 66 MB tutuyordu; dosya GitHub'ın 100 MB sınırını aşınca
# katman deploy'a hiç gidemiyordu. Kollar küçük adımlarla ilerlediği için
# ardışık noktaların FARKI küçük tam sayılar: zigzag varint + zlib bunu %36'ya
# indiriyor (düz zlib ancak %71'de kalıyordu — koordinatlar rastgeleye yakın).
# Çözünürlük 1e-5 derece (~1.1 m) ve zaten sunumda ONDALIK=5'e yuvarlanıyor,
# yani görüntüde kayıp yok.
OLCEK = 100000
BICIM = "delta1"               # meta tablosunda yoksa: eski ham float32 biçim


def _varint_yaz(v):
    z = (v << 1) ^ (v >> 31)                   # zigzag: negatifler de kısa olsun
    out = bytearray()
    while True:
        b = z & 0x7F
        z >>= 7
        if z:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def _varint_oku(veri, i, adet):
    out = []
    for _ in range(adet):
        z = k = 0
        while True:
            b = veri[i]
            i += 1
            z |= (b & 0x7F) << k
            if not b & 0x80:
                break
            k += 7
        out.append((z >> 1) ^ -(z & 1))
    return out, i


def kodla(lon, lat):
    """lon/lat listelerini delta+varint+zlib paketine çevirir."""
    xs = [int(round(v * OLCEK)) for v in lon]
    ys = [int(round(v * OLCEK)) for v in lat]
    dx = [xs[0]] + [xs[i] - xs[i - 1] for i in range(1, len(xs))]
    dy = [ys[0]] + [ys[i] - ys[i - 1] for i in range(1, len(ys))]
    gövde = b"".join(map(_varint_yaz, dx)) + b"".join(map(_varint_yaz, dy))
    return zlib.compress(struct.pack("<I", len(xs)) + gövde, 9)


def _coz_delta(paket):
    veri = zlib.decompress(paket)
    n = struct.unpack_from("<I", veri, 0)[0]
    dx, i = _varint_oku(veri, 4, n)
    dy, _ = _varint_oku(veri, i, n)
    pts, x, y = [], 0, 0
    for a, b in zip(dx, dy):
        x += a
        y += b
        pts.append((x / OLCEK, y / OLCEK))
    return pts


def var_mi():
    return os.path.exists(DB_YOLU)


def _bicim(db):
    """Veri tabanı hangi geometri biçimini tutuyor (eski dosyalar da açılsın)."""
    b = getattr(_yerel, "bicim", None)
    if b is None:
        try:
            r = db.execute("SELECT deger FROM meta WHERE anahtar='geometri'").fetchone()
            b = r[0] if r else "float32"
        except sqlite3.OperationalError:
            b = "float32"
        _yerel.bicim = b
    return b


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


def oto_olcek(genislik_derece):
    """Pencere genişliğine göre uygun ölçeği seçer."""
    for esik, olcek in OTO_ESIK:
        if genislik_derece > esik:
            return olcek
    return 100


def _sadelestir(pts, tol):
    """Douglas-Peucker — ekran ölçeğinde görünmeyen köşeleri atar.

    Yanıtın büyük kısmı koordinat metnidir; sadeleştirme olmadan orta
    yakınlıkta bir pencere megabaytlara çıkıp tarayıcıda "Failed to fetch"
    ile düşüyordu.
    """
    if len(pts) < 3 or tol <= 0:
        return pts

    def dik(p, a, b):
        ax, ay = a
        bx, by = b[0] - ax, b[1] - ay
        px, py = p[0] - ax, p[1] - ay
        if bx == 0.0 and by == 0.0:
            return (px * px + py * py) ** 0.5
        t = (px * bx + py * by) / (bx * bx + by * by)
        u = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
        dx, dy = px - u * bx, py - u * by
        return (dx * dx + dy * dy) ** 0.5

    tut = [False] * len(pts)
    tut[0] = tut[-1] = True
    yigin = [(0, len(pts) - 1)]
    while yigin:
        i, j = yigin.pop()
        en, idx = -1.0, -1
        for k in range(i + 1, j):
            d = dik(pts[k], pts[i], pts[j])
            if d > en:
                en, idx = d, k
        if en > tol and idx > 0:
            tut[idx] = True
            yigin.append((i, idx))
            yigin.append((idx, j))
    return [p for p, t in zip(pts, tut) if t]


def _cizgi(paket, tol=0.0, bicim=BICIM):
    """Geometri paketini GeoJSON koordinat listesine çevirir (iki biçim de)."""
    if bicim == BICIM:
        pts = _coz_delta(paket)
    else:                          # eski dosyalar: ham float32 çiftleri
        n = len(paket) // 8
        duz = struct.unpack(f"<{2 * n}f", paket)
        pts = [(duz[2 * i], duz[2 * i + 1]) for i in range(n)]
    if tol > 0:
        pts = _sadelestir(pts, tol)
    return [[round(x, ONDALIK), round(y, ONDALIK)] for x, y in pts]


def sorgula(bbox, olcek=100, sinir=VARSAYILAN_SINIR, sadelestir=True):
    """Verilen pencere içindeki akarsu kollarını GeoJSON olarak döndürür.

    bbox : (bati, guney, dogu, kuzey) WGS84 derece.
    olcek: 100/250/500 ya da "oto" — pencere genişliğine göre seçilir.
    """
    b, g, d, k = (float(v) for v in bbox)
    if not (-180 <= b < d <= 180 and -90 <= g < k <= 90):
        raise ValueError("Geçersiz pencere (bbox)")
    genislik = d - b
    otomatik = str(olcek).lower() in ("oto", "auto", "otomatik")
    if otomatik:
        olcek = oto_olcek(genislik)
    else:
        try:
            olcek = int(olcek)
        except (TypeError, ValueError):
            raise ValueError(f"Ölçek {OLCEKLER} içinden ya da 'oto' olmalı")
    if olcek not in OLCEKLER:
        raise ValueError(f"Ölçek {OLCEKLER} içinden olmalı (verilen: {olcek})")
    sinir = max(1, min(int(sinir), 50000))
    tol = (genislik / EKRAN_PIKSEL) if sadelestir else 0.0

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
    bicim = _bicim(db)
    ozellikler = []
    for kid, ad, tip, uzunluk, paket in sat:
        koord = _cizgi(paket, tol, bicim)
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
        "otomatik": otomatik,
        "sayi": len(ozellikler),
        "kirpildi": kirpildi,      # sınır aşıldıysa arayüz kullanıcıyı uyarır
        "sinir": sinir,
    }
