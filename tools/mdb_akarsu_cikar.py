# -*- coding: utf-8 -*-
"""Kaynak_Akarsu.mdb (ESRI Personal Geodatabase) → data/akarsu/akarsu.sqlite

DSİ akarsu ağını üç ölçekte (1/100.000, 1/250.000, 1/500.000) uygulamanın
kullanabileceği, alansal indeksli bir SQLite dosyasına çıkarır.

NEDEN TEK SEFERLİK ARAÇ:
  - MDB okumak ODBC + Microsoft Access sürücüsü gerektirir; bu Windows'a özgü
    ve projenin Linux Dockerfile'ında bulunmaz.
  - OSGeo4W GDAL'ının PGeo/ODBC sürücüsü bu makinede bağlanamıyor
    ("Unable to initialize ODBC connection to DSN"), fiona'nın GDAL'ında ise
    PGeo hiç yok. Bu yüzden geometri doğrudan okunup ESRI shape ikilisinden
    elle ayrıştırılıyor (blob sıkıştırılmamış: int32 tip + 4×double bbox +
    numParts + numPoints + parts[] + XY çiftleri).
  - Çıktı yalnızca stdlib sqlite3 ile okunur (R*Tree indeksi dahil), yani
    uygulamanın çalışma anında yeni bağımlılığı olmaz.

KULLANIM (yalnız geliştirme, pyodbc gerekir):
    pip install pyodbc
    python tools/mdb_akarsu_cikar.py "…\\Havzalar\\Kaynak_Akarsu.mdb"

TÜRKÇE YOL UYARISI: Access ODBC sürücüsü Türkçe karakterli yollarda
bağlanamıyor. Yol ASCII değilse dosya otomatik olarak geçici ASCII bir yola
kopyalanır.
"""
import os
import shutil
import sqlite3
import struct
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CIKTI = os.path.join(ROOT, "data", "akarsu", "akarsu.sqlite")

# tablo -> ölçek (bin) eşlemesi
TABLOLAR = {"akarsu100": 100, "akarsu250": 250, "akarsu500": 500}

# Öznitelik adayları: ilk bulunan kullanılır (tablolar arasında ad değişebilir)
AD_ALANLARI = ("P_NAME", "DSINAME", "F_NAME")
TIP_ALANLARI = ("DSINAME", "F_CODE")
UZUNLUK_ALANLARI = ("Shape_Length_meter",)


def _ascii_yol(yol):
    """Access ODBC Türkçe yolda bağlanamıyor → gerekirse ASCII'ye kopyala."""
    if yol.isascii():
        return yol, None
    gecici = os.path.join(tempfile.mkdtemp(prefix="mdb_"), "veri.mdb")
    print(f"  yol ASCII değil, kopyalanıyor → {gecici}")
    shutil.copy2(yol, gecici)
    return gecici, os.path.dirname(gecici)


def _polyline_parcalari(blob):
    """ESRI shape blob → [[(x, y), ...], ...] parça listesi.

    PolyLine(3) / PolyLineZ(13) / PolyLineM(23) aynı XY yerleşimine sahiptir;
    Z/M dizileri XY'den SONRA geldiği için yok sayılabilir.
    """
    if not blob or len(blob) < 44:
        return []
    tip = struct.unpack_from("<i", blob, 0)[0]
    if tip not in (3, 13, 23):
        return []
    n_parca, n_nokta = struct.unpack_from("<ii", blob, 36)
    if n_parca <= 0 or n_nokta <= 0:
        return []
    p0 = 44
    parca_bas = struct.unpack_from(f"<{n_parca}i", blob, p0)
    p1 = p0 + 4 * n_parca
    gerekli = p1 + 16 * n_nokta
    if len(blob) < gerekli:
        return []
    xy = struct.unpack_from(f"<{2 * n_nokta}d", blob, p1)
    sinirlar = list(parca_bas) + [n_nokta]
    out = []
    for i in range(n_parca):
        a, b = sinirlar[i], sinirlar[i + 1]
        if b - a >= 2:
            out.append([(xy[2 * k], xy[2 * k + 1]) for k in range(a, b)])
    return out


def _alan_sec(kolonlar, adaylar):
    for a in adaylar:
        if a in kolonlar:
            return a
    return None


def _tablo_srid(cur, tablo):
    """GDB_GeomColumns'taki indeks orijinine göre tablonun SRID'sini bulur."""
    cur.execute("SELECT TableName, IdxOriginX, IdxOriginY FROM GDB_GeomColumns")
    orijin = {t.lower(): (ox, oy) for t, ox, oy in cur.fetchall()}
    ox, oy = orijin.get(tablo.lower(), (None, None))
    if ox is None:
        return None
    cur.execute("SELECT SRID, SRTEXT, FalseX, FalseY FROM GDB_SpatialRefs")
    en_iyi, en_fark = None, None
    for srid, wkt, fx, fy in cur.fetchall():
        if fx is None or fy is None:
            continue
        fark = abs(fx - ox) + abs(fy - oy)
        if en_fark is None or fark < en_fark:
            en_iyi, en_fark = (srid, wkt), fark
    return en_iyi


def _semayi_kur(db):
    db.executescript("""
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        DROP TABLE IF EXISTS kol;
        DROP TABLE IF EXISTS kol_idx;
        CREATE TABLE kol (
            id        INTEGER PRIMARY KEY,
            olcek     INTEGER NOT NULL,   -- 100 / 250 / 500 (bin)
            ad        TEXT,               -- dere adı (P_NAME)
            tip       TEXT,               -- DSİ sınıfı (DERE, ÇAY…)
            uzunluk_m REAL,
            nokta     BLOB NOT NULL       -- paketli float32 lon,lat çiftleri
        );
        CREATE INDEX kol_olcek ON kol(olcek);
        CREATE VIRTUAL TABLE kol_idx USING rtree(id, xmin, xmax, ymin, ymax);
    """)


def cikar(mdb_yolu, cikti=CIKTI):
    import pyodbc
    from pyproj import CRS, Transformer

    mdb, temizlenecek = _ascii_yol(os.path.abspath(mdb_yolu))
    os.makedirs(os.path.dirname(cikti), exist_ok=True)
    if os.path.exists(cikti):
        os.unlink(cikti)

    baglanti = pyodbc.connect(
        r"Driver={Microsoft Access Driver (*.mdb, *.accdb)};DBQ=" + mdb + ";",
        readonly=True)
    cur = baglanti.cursor()
    db = sqlite3.connect(cikti)
    _semayi_kur(db)

    sonraki_id = 1
    ozet = []
    try:
        for tablo, olcek in TABLOLAR.items():
            t0 = time.time()
            srid_bilgi = _tablo_srid(cur, tablo)
            if srid_bilgi is None:
                print(f"  {tablo}: GDB_GeomColumns'ta yok, atlanıyor")
                continue
            srid, wkt = srid_bilgi
            kaynak = CRS.from_user_input(wkt)
            donustur = None
            if not kaynak.equals(CRS.from_epsg(4326)):
                donustur = Transformer.from_crs(kaynak, "EPSG:4326", always_xy=True)
            print(f"  {tablo} (1/{olcek}.000)  SRID={srid}  {kaynak.name}"
                  f"{'  → WGS84 dönüşümü' if donustur else '  (zaten WGS84)'}")

            kolonlar = [r.column_name for r in cur.columns(table=tablo)]
            ad_alan = _alan_sec(kolonlar, AD_ALANLARI)
            tip_alan = _alan_sec(kolonlar, TIP_ALANLARI)
            uz_alan = _alan_sec(kolonlar, UZUNLUK_ALANLARI)
            secilen = ["Shape"] + [a for a in (ad_alan, tip_alan, uz_alan) if a]
            cur.execute(f"SELECT {', '.join(secilen)} FROM {tablo}")

            satirlar, indeks = [], []
            okunan = yazilan = bos = 0
            while True:
                yigin = cur.fetchmany(2000)
                if not yigin:
                    break
                for satir in yigin:
                    okunan += 1
                    blob = satir[0]
                    i = 1
                    ad = (satir[i].strip() if ad_alan and satir[i] else None) if ad_alan else None
                    if ad_alan:
                        i += 1
                    tip = (satir[i].strip() if tip_alan and satir[i] else None) if tip_alan else None
                    if tip_alan:
                        i += 1
                    uzunluk = satir[i] if uz_alan else None
                    parcalar = _polyline_parcalari(blob)
                    if not parcalar:
                        bos += 1
                        continue
                    for pts in parcalar:
                        if donustur is not None:
                            xs, ys = zip(*pts)
                            lon, lat = donustur.transform(xs, ys)
                        else:
                            lon = [p[0] for p in pts]
                            lat = [p[1] for p in pts]
                        paket = struct.pack(f"<{2 * len(lon)}f",
                                            *[v for pair in zip(lon, lat) for v in pair])
                        satirlar.append((sonraki_id, olcek, ad or None, tip or None,
                                         uzunluk, paket))
                        indeks.append((sonraki_id, min(lon), max(lon), min(lat), max(lat)))
                        sonraki_id += 1
                        yazilan += 1
                if len(satirlar) >= 20000:
                    db.executemany("INSERT INTO kol VALUES (?,?,?,?,?,?)", satirlar)
                    db.executemany("INSERT INTO kol_idx VALUES (?,?,?,?,?)", indeks)
                    satirlar, indeks = [], []
                    print(f"    {okunan:>7} kayıt okundu, {yazilan:>7} kol yazıldı…")
            if satirlar:
                db.executemany("INSERT INTO kol VALUES (?,?,?,?,?,?)", satirlar)
                db.executemany("INSERT INTO kol_idx VALUES (?,?,?,?,?)", indeks)
            db.commit()
            ozet.append((tablo, olcek, okunan, yazilan, bos, time.time() - t0))
            print(f"    bitti: {okunan} kayıt → {yazilan} kol"
                  f"{f', {bos} geometrisiz' if bos else ''}"
                  f"  ({time.time() - t0:.1f} sn)")
    finally:
        baglanti.close()

    db.execute("ANALYZE")
    db.commit()
    db.close()
    if temizlenecek:
        shutil.rmtree(temizlenecek, ignore_errors=True)

    print("\nözet:")
    for tablo, olcek, okunan, yazilan, bos, sure in ozet:
        print(f"  1/{olcek}.000  {okunan:>7} kayıt → {yazilan:>7} kol  ({sure:.1f} sn)")
    print(f"\nçıktı: {cikti}  ({os.path.getsize(cikti) / 1e6:.1f} MB)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cikar(sys.argv[1])
