# -*- coding: utf-8 -*-
"""AGİ (Akım Gözlem İstasyonu) yıllık maksimum akım veri tabanı.

`data/agi/agi.sqlite`, DSİ ve EİE Akım Gözlem Yıllıklarından çıkarılmış
1935-2020 yıllık pik akım kayıtlarını tutar (bkz. tools/agi_veritabani_olustur.py).
Frekans analizinin (NTFA) girdisi buradan gelir; haritada istasyon seçmek için
R*Tree ile pencere sorgusu yapılır.
"""
import os
import sqlite3
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB_YOLU = os.path.join(ROOT, "data", "agi", "agi.sqlite")

VARSAYILAN_SINIR = 2000
_yerel = threading.local()


def var_mi():
    return os.path.exists(DB_YOLU)


def _baglanti():
    db = getattr(_yerel, "db", None)
    if db is None:
        if not var_mi():
            raise RuntimeError(
                "AGİ veri tabanı yok. Üretmek için:\n"
                "  python tools/agi_veritabani_olustur.py <pik_veritabani.csv>")
        db = sqlite3.connect(DB_YOLU, check_same_thread=False)
        db.row_factory = sqlite3.Row
        _yerel.db = db
    return db


def bilgi():
    if not var_mi():
        return {"var": False}
    db = _baglanti()
    n_ist = db.execute("SELECT COUNT(*) FROM istasyon").fetchone()[0]
    n_pik = db.execute("SELECT COUNT(*) FROM pik").fetchone()[0]
    y0, y1 = db.execute("SELECT MIN(yil), MAX(yil) FROM pik").fetchone()
    kurumlar = [r[0] for r in db.execute(
        "SELECT DISTINCT kurum FROM istasyon WHERE kurum <> '' ORDER BY kurum")]
    return {"var": True, "istasyon": n_ist, "pik": n_pik,
            "ilk_yil": y0, "son_yil": y1, "kurumlar": kurumlar,
            "boyut_mb": round(os.path.getsize(DB_YOLU) / 1e6, 1)}


def _satir(r):
    return {"kod": r["kod"], "ad": r["ad"], "kurum": r["kurum"], "havza": r["havza"],
            "enlem": r["enlem"], "boylam": r["boylam"],
            "yagis_alani": r["yagis_alani"], "kot": r["kot"],
            "yil_sayisi": r["yil_sayisi"], "ilk_yil": r["ilk_yil"], "son_yil": r["son_yil"]}


def pencere(bbox, en_az_yil=10, kurum=None, sinir=VARSAYILAN_SINIR):
    """Verilen pencerede yeterli veri uzunluğuna sahip istasyonlar.

    en_az_yil: frekans analizi için anlamlı en kısa seri (varsayılan 10).
    """
    b, g, d, k = (float(v) for v in bbox)
    if not (-180 <= b < d <= 180 and -90 <= g < k <= 90):
        raise ValueError("Geçersiz pencere (bbox)")
    db = _baglanti()
    sql = ("SELECT i.* FROM istasyon_idx x "
           "JOIN istasyon_no n ON n.id = x.id JOIN istasyon i ON i.kod = n.kod "
           "WHERE x.xmax >= ? AND x.xmin <= ? AND x.ymax >= ? AND x.ymin <= ? "
           "  AND i.yil_sayisi >= ?")
    par = [b, d, g, k, int(en_az_yil)]
    if kurum:
        sql += " AND i.kurum = ?"
        par.append(kurum)
    sql += " ORDER BY i.yil_sayisi DESC LIMIT ?"
    par.append(max(1, min(int(sinir), 10000)))
    return [_satir(r) for r in db.execute(sql, par)]


def _nokta_icinde(x, y, halkalar):
    """Ray casting — havza poligonu (dış halka + varsa delikler)."""
    icinde = False
    for halka in halkalar:
        for i in range(len(halka) - 1):
            x1, y1 = halka[i][0], halka[i][1]
            x2, y2 = halka[i + 1][0], halka[i + 1][1]
            if (y1 > y) != (y2 > y):
                kesim = (x2 - x1) * (y - y1) / (y2 - y1) + x1
                if x < kesim:
                    icinde = not icinde
    return icinde


def _halkalar(geometri):
    tip = geometri.get("type")
    koord = geometri.get("coordinates") or []
    if tip == "Polygon":
        return [koord]
    if tip == "MultiPolygon":
        return list(koord)
    raise ValueError("Havza geometrisi Polygon ya da MultiPolygon olmalı")


def poligon(geometri, tampon_derece=0.0, en_az_yil=10, kurum=None):
    """Havza poligonu içindeki (ve istenirse çevresindeki) istasyonlar.

    tampon_derece: havza dışında da istasyon göstermek için pencereyi büyütür;
    poligon içinde kalanlar `icinde=True` ile işaretlenir. Bölgesel analizde
    komşu havzaların istasyonları da gerektiği için tampon ayrı tutuluyor.
    """
    poligonlar = _halkalar(geometri)
    xs = [p[0] for pol in poligonlar for h in pol for p in h]
    ys = [p[1] for pol in poligonlar for h in pol for p in h]
    if not xs:
        raise ValueError("Havza geometrisi boş")
    t = max(0.0, float(tampon_derece))
    bbox = (min(xs) - t, min(ys) - t, max(xs) + t, max(ys) + t)
    ist = pencere(bbox, en_az_yil=en_az_yil, kurum=kurum)
    for s in ist:
        s["icinde"] = any(_nokta_icinde(s["boylam"], s["enlem"], pol) for pol in poligonlar)
    return ist


def seri(kod, ilk_yil=None, son_yil=None, dusuk_guveni_at=False):
    """Bir istasyonun yıllık maksimum akım serisi (yıla göre sıralı)."""
    db = _baglanti()
    sql = "SELECT yil, q, tarih, guven, kaynak FROM pik WHERE kod = ?"
    par = [kod]
    if ilk_yil:
        sql += " AND yil >= ?"
        par.append(int(ilk_yil))
    if son_yil:
        sql += " AND yil <= ?"
        par.append(int(son_yil))
    if dusuk_guveni_at:
        sql += " AND guven NOT LIKE 'düşük%'"
    sql += " ORDER BY yil"
    return [{"yil": r["yil"], "q": r["q"], "tarih": r["tarih"],
             "guven": r["guven"], "kaynak": r["kaynak"]}
            for r in db.execute(sql, par)]


def istasyon(kod):
    db = _baglanti()
    r = db.execute("SELECT * FROM istasyon WHERE kod = ?", (kod,)).fetchone()
    if r is None:
        raise ValueError(f"İstasyon bulunamadı: {kod}")
    return _satir(r)
