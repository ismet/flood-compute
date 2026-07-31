# -*- coding: utf-8 -*-
"""pik_veritabani.csv -> data/agi/agi.sqlite  (bir kereye mahsus üretim aracı)

Kaynak CSV, DSİ ve EİE Akım Gözlem Yıllıklarından çıkarılmış yıllık maksimum
akım veri tabanıdır (1935-2020, ~37.000 istasyon-yıl). Çalışma anında yalnız
stdlib sqlite3 kullanılır; bu araç kurulumda bir kez koşar.

Kullanım:
    python tools/agi_veritabani_olustur.py <pik_veritabani.csv>

Haritada pencere sorgusu R*Tree ile yapıldığı için istasyonlar ayrıca
`istasyon_idx` sanal tablosuna yazılır.
"""
import csv
import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HEDEF = os.path.join(ROOT, "data", "agi", "agi.sqlite")

# CSV başlıkları -> alan. Kaynak dosya utf-8-sig (Excel uyumu için BOM'lu).
S_YIL, S_KURUM, S_KOD, S_AD = "Yıl", "Kurum", "İstasyon Kodu (DSİ)", "İstasyon Adı"
S_HAVZA, S_ENLEM, S_BOYLAM = "Havza", "Enlem (K)", "Boylam (D)"
S_KOT, S_ALAN, S_Q = "Yaklaşık Kot (m)", "Yağış Alanı (km²)", "Maks. Akım (m³/s)"
S_TARIH, S_GUVEN, S_KAYNAK = "Oluşum Tarihi", "Güven", "Kaynak Dosya"


def _sayi(s):
    try:
        return float(str(s).replace(",", "."))
    except (TypeError, ValueError):
        return None


def olustur(csv_yolu, hedef=HEDEF):
    os.makedirs(os.path.dirname(hedef), exist_ok=True)
    if os.path.exists(hedef):
        os.remove(hedef)
    db = sqlite3.connect(hedef)
    db.executescript("""
        CREATE TABLE istasyon (
            kod TEXT PRIMARY KEY, ad TEXT, kurum TEXT, havza TEXT,
            enlem REAL, boylam REAL, yagis_alani REAL, kot REAL,
            yil_sayisi INTEGER, ilk_yil INTEGER, son_yil INTEGER);
        CREATE TABLE pik (
            kod TEXT, yil INTEGER, q REAL, tarih TEXT, guven TEXT, kaynak TEXT,
            PRIMARY KEY (kod, yil));
        CREATE VIRTUAL TABLE istasyon_idx USING rtree(id, xmin, xmax, ymin, ymax);
        CREATE TABLE istasyon_no (kod TEXT PRIMARY KEY, id INTEGER);
    """)

    ist, pikler = {}, []
    with open(csv_yolu, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            kod = (r.get(S_KOD) or "").strip()
            q, yil = _sayi(r.get(S_Q)), _sayi(r.get(S_YIL))
            if not kod or q is None or yil is None:
                continue                      # kodsuz satır haritaya konamaz
            yil = int(yil)
            pikler.append((kod, yil, q, (r.get(S_TARIH) or "").strip(),
                           (r.get(S_GUVEN) or "").strip(), (r.get(S_KAYNAK) or "").strip()))
            k = ist.setdefault(kod, {"ad": "", "kurum": "", "havza": "", "enlem": None,
                                     "boylam": None, "alan": None, "kot": None,
                                     "yillar": set()})
            k["yillar"].add(yil)
            for alan, sut in (("ad", S_AD), ("kurum", S_KURUM), ("havza", S_HAVZA)):
                if not k[alan] and (r.get(sut) or "").strip():
                    k[alan] = r[sut].strip()
            for alan, sut in (("enlem", S_ENLEM), ("boylam", S_BOYLAM),
                              ("alan", S_ALAN), ("kot", S_KOT)):
                if k[alan] is None:
                    k[alan] = _sayi(r.get(sut))

    sirali = sorted(ist)
    db.executemany(
        "INSERT INTO istasyon VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [(kod, v["ad"], v["kurum"], v["havza"], v["enlem"], v["boylam"],
          v["alan"], v["kot"], len(v["yillar"]), min(v["yillar"]), max(v["yillar"]))
         for kod, v in ((k, ist[k]) for k in sirali)])
    db.executemany("INSERT OR REPLACE INTO pik VALUES (?,?,?,?,?,?)", pikler)
    db.executemany("INSERT INTO istasyon_no VALUES (?,?)",
                   [(kod, i + 1) for i, kod in enumerate(sirali)])
    db.executemany(
        "INSERT INTO istasyon_idx VALUES (?,?,?,?,?)",
        [(i + 1, ist[kod]["boylam"], ist[kod]["boylam"], ist[kod]["enlem"], ist[kod]["enlem"])
         for i, kod in enumerate(sirali)
         if ist[kod]["enlem"] is not None and ist[kod]["boylam"] is not None])
    db.execute("CREATE INDEX pik_kod ON pik(kod)")
    db.commit()

    n_koord = db.execute("SELECT COUNT(*) FROM istasyon_idx").fetchone()[0]
    print(f"{len(sirali)} istasyon ({n_koord} koordinatlı) · {len(pikler)} pik kaydı")
    print(f"-> {hedef}  ({os.path.getsize(hedef) / 1e6:.1f} MB)")
    db.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    olustur(sys.argv[1])
