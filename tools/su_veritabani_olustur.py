# -*- coding: utf-8 -*-
"""Data.db (günlük akım) -> data/su/su.sqlite  (bir kereye mahsus üretim aracı)

Kaynak `Data.db`, 2909 AGİ'nin 1934-2015 arası günlük akımlarını tek düz
tabloda tutar: 8,88 milyon satır, 1,68 GB. İstasyon adı/koordinat/alan her
satırda tekrar ettiği ve indeks bulunmadığı için tek istasyonu okumak bile
tam tarama gerektiriyor (dakikalar).

Burada seri, istasyon başına TEK satırda saklanır: ilk tarihten itibaren
kesintisiz günlük float32 dizisi, eksik günler NaN. Böylece hem dosya ~40 MB'a
iner hem de "bir istasyonun tüm serisi" tek satır okumasıyla gelir — su
potansiyeli hesabının erişim deseni tam olarak budur.

Kullanım:
    python tools/su_veritabani_olustur.py <Data.db>
"""
import array
import datetime
import math
import os
import sqlite3
import sys
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HEDEF = os.path.join(ROOT, "data", "su", "su.sqlite")

EKSIK = ("---", "", "-", "--")


def _tarih(s):
    return datetime.date.fromisoformat(s[:10])


def _sayi(s):
    if s is None:
        return math.nan
    t = str(s).strip()
    if t in EKSIK:
        return math.nan
    try:
        return float(t.replace(",", "."))
    except ValueError:
        return math.nan


def olustur(kaynak, hedef=HEDEF):
    os.makedirs(os.path.dirname(hedef), exist_ok=True)
    if os.path.exists(hedef):
        os.remove(hedef)
    src = sqlite3.connect(kaynak)
    db = sqlite3.connect(hedef)
    db.executescript("""
        CREATE TABLE istasyon (
            kod TEXT PRIMARY KEY, ad TEXT, lon REAL, lat REAL,
            alan_km2 REAL, kot REAL,
            ilk_tarih TEXT, son_tarih TEXT, gun INTEGER, veri_gun INTEGER,
            q_ort REAL, q_min REAL, q_maks REAL);
        CREATE TABLE seri (kod TEXT PRIMARY KEY, ilk_tarih TEXT, n INTEGER, q BLOB);
        CREATE VIRTUAL TABLE istasyon_idx USING rtree(id, xmin, xmax, ymin, ymax);
        CREATE TABLE istasyon_no (kod TEXT PRIMARY KEY, id INTEGER);
    """)

    print("kaynak taranıyor (istasyon sırasına göre)…")
    cur = src.execute(
        "SELECT Station, Name, lon, lat, Basin_Area, Elevation, Date, Discharge "
        "FROM Discharge ORDER BY Station, Date")

    def yaz(kod, meta, gunler):
        """gunler: {date: q}  -> kesintisiz float32 dizisi + istasyon satırı"""
        if not gunler:
            return 0
        ilk, son = min(gunler), max(gunler)
        n = (son - ilk).days + 1
        dizi = array.array("f", [math.nan]) * n
        for d, q in gunler.items():
            dizi[(d - ilk).days] = q
        gecerli = [q for q in gunler.values() if not math.isnan(q)]
        db.execute("INSERT INTO seri VALUES (?,?,?,?)",
                   (kod, ilk.isoformat(), n, zlib.compress(dizi.tobytes(), 6)))
        db.execute("INSERT INTO istasyon VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (kod, meta[0], meta[1], meta[2], meta[3], meta[4],
                    ilk.isoformat(), son.isoformat(), n, len(gecerli),
                    (sum(gecerli) / len(gecerli)) if gecerli else None,
                    min(gecerli) if gecerli else None,
                    max(gecerli) if gecerli else None))
        return 1

    kod_o, meta_o, gunler = None, None, {}
    n_ist = n_sat = 0
    for kod, ad, lon, lat, alan, kot, tarih, q in cur:
        n_sat += 1
        if kod != kod_o:
            n_ist += yaz(kod_o, meta_o, gunler)
            kod_o, gunler = kod, {}
            meta_o = (ad, lon, lat, alan, kot)
            if n_ist % 250 == 0 and n_ist:
                print(f"  {n_ist} istasyon, {n_sat:,} satır")
        try:
            gunler[_tarih(tarih)] = _sayi(q)
        except (ValueError, TypeError):
            continue
    n_ist += yaz(kod_o, meta_o, gunler)

    sirali = [r[0] for r in db.execute("SELECT kod FROM istasyon ORDER BY kod")]
    db.executemany("INSERT INTO istasyon_no VALUES (?,?)",
                   [(k, i + 1) for i, k in enumerate(sirali)])
    db.executemany(
        "INSERT INTO istasyon_idx SELECT n.id, i.lon, i.lon, i.lat, i.lat "
        "FROM istasyon i JOIN istasyon_no n ON n.kod = i.kod WHERE i.kod = ?",
        [(k,) for k in sirali])
    db.commit()
    db.execute("VACUUM")
    print(f"\n{n_ist} istasyon · {n_sat:,} günlük kayıt")
    print(f"-> {hedef}  ({os.path.getsize(hedef) / 1e6:.1f} MB)")
    db.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    olustur(sys.argv[1])
