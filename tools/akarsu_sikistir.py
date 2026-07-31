# -*- coding: utf-8 -*-
"""akarsu.sqlite geometrisini delta+varint+zlib biçimine çevirir.

Ham float32 çiftleriyle dosya 105 MB'dı; GitHub'ın 100 MB tek dosya sınırını
aştığı için katman deploy'a hiç gidemiyor, canlıda "veri yok" görünüyordu.
Kollar küçük adımlarla ilerlediğinden ardışık noktaların farkı küçük tam
sayılar: zigzag varint + zlib geometriyi ~%36'ya indiriyor.

Çözünürlük 1e-5 derece (~1.1 m). `akarsu.py` sonuçları zaten 5 haneye
yuvarlayarak sunduğu için haritada görünen geometri birebir aynı kalır.

Kaynak MDB gerekmez — mevcut veri tabanı yeniden kodlanır:
    python tools/akarsu_sikistir.py [kaynak.sqlite] [hedef.sqlite]
"""
import os
import shutil
import sqlite3
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from backend.core import akarsu  # noqa: E402

VARSAYILAN = os.path.join(ROOT, "data", "akarsu", "akarsu.sqlite")


def cevir(kaynak=VARSAYILAN, hedef=None):
    yerinde = hedef is None
    hedef = hedef or (kaynak + ".yeni")
    if os.path.exists(hedef):
        os.remove(hedef)

    src = sqlite3.connect(kaynak)
    mevcut = src.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE name='meta'").fetchone()[0]
    if mevcut and src.execute(
            "SELECT deger FROM meta WHERE anahtar='geometri'").fetchone():
        print("kaynak zaten yeni biçimde — işlem yok")
        return

    db = sqlite3.connect(hedef)
    db.executescript("""
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        CREATE TABLE kol (
            id        INTEGER PRIMARY KEY,
            olcek     INTEGER NOT NULL,
            ad        TEXT,
            tip       TEXT,
            uzunluk_m REAL,
            nokta     BLOB NOT NULL       -- delta+varint+zlib (bkz. akarsu.kodla)
        );
        CREATE INDEX kol_olcek ON kol(olcek);
        CREATE VIRTUAL TABLE kol_idx USING rtree(id, xmin, xmax, ymin, ymax);
        CREATE TABLE meta (anahtar TEXT PRIMARY KEY, deger TEXT);
    """)
    db.execute("INSERT INTO meta VALUES ('geometri', ?)", (akarsu.BICIM,))

    ham = yeni = n = 0
    toplu = []
    for kid, olcek, ad, tip, uzunluk, paket in src.execute(
            "SELECT id, olcek, ad, tip, uzunluk_m, nokta FROM kol"):
        m = len(paket) // 8
        if m < 2:
            continue
        duz = struct.unpack(f"<{2 * m}f", paket)
        lon = [duz[2 * i] for i in range(m)]
        lat = [duz[2 * i + 1] for i in range(m)]
        p = akarsu.kodla(lon, lat)
        ham += len(paket)
        yeni += len(p)
        toplu.append((kid, olcek, ad, tip, uzunluk, p))
        n += 1
        if len(toplu) >= 20000:
            db.executemany("INSERT INTO kol VALUES (?,?,?,?,?,?)", toplu)
            toplu.clear()
            print(f"  {n:,} kol…")
    if toplu:
        db.executemany("INSERT INTO kol VALUES (?,?,?,?,?,?)", toplu)

    db.executemany("INSERT INTO kol_idx VALUES (?,?,?,?,?)",
                   src.execute("SELECT id, xmin, xmax, ymin, ymax FROM kol_idx"))
    db.commit()
    db.execute("VACUUM")
    db.close()
    src.close()

    print(f"\n{n:,} kol · geometri {ham/1e6:.1f} MB -> {yeni/1e6:.1f} MB "
          f"(%{100*yeni/ham:.0f})")
    print(f"dosya {os.path.getsize(kaynak)/1e6:.1f} MB -> "
          f"{os.path.getsize(hedef)/1e6:.1f} MB")
    if yerinde:
        shutil.move(kaynak, kaynak + ".eski")
        shutil.move(hedef, kaynak)
        print(f"-> {kaynak}  (eski dosya: {os.path.basename(kaynak)}.eski)")


if __name__ == "__main__":
    cevir(*(sys.argv[1:3] or [VARSAYILAN]))
