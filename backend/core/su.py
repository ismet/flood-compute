# -*- coding: utf-8 -*-
"""Su potansiyeli / su temini — AGİ günlük akım serilerinden.

Veri `data/su/su.sqlite` içinde durur ve `tools/su_veritabani_olustur.py` ile
`Data.db`'den bir kez üretilir (2909 istasyon, 1934-2015, 8,9 milyon günlük
kayıt). Seri istasyon başına tek sıkıştırılmış float32 dizisi olarak saklanır;
eksik günler NaN'dır.

Taşkın tarafından farklı olarak burada pik değil HACİM önemlidir: ortalama
akım, aylık dağılım, yıllık hacim, süreklilik (debi süreklilik) eğrisi ve
verilen bir talebin ne kadar süre karşılandığı.

Su yılı 1 Ekim - 30 Eylül alınır (uygulamanın geri kalanıyla tutarlı).
"""
import array
import datetime
import math
import os
import sqlite3
import threading
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB_YOLU = os.path.join(ROOT, "data", "su", "su.sqlite")

SANIYE_GUN = 86400.0
AY_ADI = ("Ekim", "Kasım", "Aralık", "Ocak", "Şubat", "Mart",
          "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül")
SU_YILI_AYLARI = (10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9)
GUVENILIRLIK = (50, 75, 90, 95)

_yerel = threading.local()


def var_mi():
    return os.path.exists(DB_YOLU)


def _baglanti():
    db = getattr(_yerel, "db", None)
    if db is None:
        if not var_mi():
            raise RuntimeError(
                "Su potansiyeli veri tabanı yok. Üretmek için:\n"
                "  python tools/su_veritabani_olustur.py <Data.db>")
        db = sqlite3.connect(DB_YOLU, check_same_thread=False)
        db.row_factory = sqlite3.Row
        _yerel.db = db
    return db


def bilgi():
    if not var_mi():
        return {"var": False}
    db = _baglanti()
    n = db.execute("SELECT COUNT(*) FROM istasyon").fetchone()[0]
    y0, y1 = db.execute("SELECT MIN(ilk_tarih), MAX(son_tarih) FROM istasyon").fetchone()
    gun = db.execute("SELECT SUM(veri_gun) FROM istasyon").fetchone()[0]
    return {"var": True, "istasyon": n, "ilk_tarih": y0, "son_tarih": y1,
            "gun": gun, "boyut_mb": round(os.path.getsize(DB_YOLU) / 1e6, 1)}


def _satir(r):
    return {"kod": r["kod"], "ad": r["ad"], "lon": r["lon"], "lat": r["lat"],
            "alan_km2": r["alan_km2"], "kot": r["kot"],
            "ilk_tarih": r["ilk_tarih"], "son_tarih": r["son_tarih"],
            "gun": r["gun"], "veri_gun": r["veri_gun"], "q_ort": r["q_ort"],
            "q_min": r["q_min"], "q_maks": r["q_maks"]}


def pencere(bbox, en_az_yil=5, sinir=3000):
    """Haritada görünen pencere içindeki istasyonlar."""
    b, g, d, k = (float(v) for v in bbox)
    if not (-180 <= b < d <= 180 and -90 <= g < k <= 90):
        raise ValueError("Geçersiz pencere (bbox)")
    db = _baglanti()
    return [_satir(r) for r in db.execute(
        "SELECT i.* FROM istasyon_idx x JOIN istasyon_no n ON n.id = x.id "
        "JOIN istasyon i ON i.kod = n.kod "
        "WHERE x.xmax >= ? AND x.xmin <= ? AND x.ymax >= ? AND x.ymin <= ? "
        "  AND i.veri_gun >= ? ORDER BY i.veri_gun DESC LIMIT ?",
        (b, d, g, k, int(en_az_yil) * 365, max(1, min(int(sinir), 10000))))]


def istasyon(kod):
    db = _baglanti()
    r = db.execute("SELECT * FROM istasyon WHERE kod = ?", (kod,)).fetchone()
    if r is None:
        raise ValueError(f"İstasyon bulunamadı: {kod}")
    return _satir(r)


def seri(kod):
    """-> (ilk_tarih, [q...])  eksik günler NaN."""
    db = _baglanti()
    r = db.execute("SELECT ilk_tarih, n, q FROM seri WHERE kod = ?", (kod,)).fetchone()
    if r is None:
        raise ValueError(f"Seri bulunamadı: {kod}")
    d = array.array("f")
    d.frombytes(zlib.decompress(r["q"]))
    return datetime.date.fromisoformat(r["ilk_tarih"]), list(d[:r["n"]])


def _su_yili(t):
    return t.year + 1 if t.month >= 10 else t.year


def potansiyel(kod, ilk_yil=None, son_yil=None, talep_ls=None):
    """Bir istasyonun su potansiyeli özeti.

    talep_ls: sürekli su talebi (L/s). Verilirse karşılanma güvenilirliği ve
    açık hacmi de hesaplanır — "su temini" sorusunun doğrudan karşılığı.
    """
    ist = istasyon(kod)
    ilk, q = seri(kod)
    alan = ist.get("alan_km2") or 0

    gecerli, aylik, yillik = [], {m: [] for m in SU_YILI_AYLARI}, {}
    for i, v in enumerate(q):
        if v is None or math.isnan(v):
            continue
        t = ilk + datetime.timedelta(days=i)
        sy = _su_yili(t)
        if ilk_yil and sy < ilk_yil:
            continue
        if son_yil and sy > son_yil:
            continue
        gecerli.append(v)
        aylik[t.month].append(v)
        yillik.setdefault(sy, []).append(v)
    if not gecerli:
        raise ValueError("Seçilen dönemde geçerli günlük akım yok")

    n = len(gecerli)
    q_ort = sum(gecerli) / n
    hacim_yil = q_ort * 365.25 * SANIYE_GUN / 1e6        # hm³/yıl

    sirali = sorted(gecerli, reverse=True)               # süreklilik: büyükten küçüğe

    def asilma(p):
        """Zamanın %p'sinde aşılan debi (debi süreklilik eğrisi)."""
        i = min(len(sirali) - 1, max(0, int(round(p / 100.0 * (len(sirali) - 1)))))
        return sirali[i]

    egri = [{"yuzde": p, "q": asilma(p)} for p in
            (1, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99)]
    guvenilir = {str(p): asilma(p) for p in GUVENILIRLIK}

    aylik_ozet = []
    for m in SU_YILI_AYLARI:
        v = aylik[m]
        qa = (sum(v) / len(v)) if v else None
        gun = 30.4375
        aylik_ozet.append({
            "ay": m, "ad": AY_ADI[SU_YILI_AYLARI.index(m)], "gun": len(v),
            "q_ort": qa,
            "hacim_hm3": (qa * gun * SANIYE_GUN / 1e6) if qa is not None else None,
            "oran": (qa / q_ort) if (qa is not None and q_ort) else None,
        })

    yillik_ozet = []
    for sy in sorted(yillik):
        v = yillik[sy]
        qy = sum(v) / len(v)
        yillik_ozet.append({
            "su_yili": sy, "gun": len(v), "q_ort": qy,
            "hacim_hm3": qy * len(v) * SANIYE_GUN / 1e6,
            "tam": len(v) >= 355,          # eksik yıllar ortalamayı bozmasın diye işaretli
        })
    tam = [y for y in yillik_ozet if y["tam"]]

    sonuc = {
        "istasyon": ist,
        "donem": {"ilk_su_yili": yillik_ozet[0]["su_yili"],
                  "son_su_yili": yillik_ozet[-1]["su_yili"],
                  "yil_sayisi": len(yillik_ozet), "tam_yil": len(tam),
                  "gun": n},
        "q_ort": q_ort, "q_min": min(gecerli), "q_maks": max(gecerli),
        "yillik_hacim_hm3": hacim_yil,
        "ozgul_verim_ls_km2": (q_ort * 1000 / alan) if alan else None,
        "yillik_verim_mm": (hacim_yil * 1e6 / (alan * 1e6) * 1000) if alan else None,
        "aylik": aylik_ozet,
        "yillik": yillik_ozet,
        "sureklilik": egri,
        "guvenilir_debi": guvenilir,
    }

    if talep_ls:
        t = float(talep_ls) / 1000.0                     # L/s -> m³/s
        karsilanan = sum(1 for v in gecerli if v >= t)
        acik = sum((t - v) for v in gecerli if v < t)     # m³/s·gün
        sonuc["temin"] = {
            "talep_ls": float(talep_ls), "talep_m3s": t,
            "guvenilirlik_yuzde": karsilanan / n * 100.0,
            "karsilanan_gun": karsilanan, "toplam_gun": n,
            "yillik_acik_hm3": acik * SANIYE_GUN / 1e6 / max(len(yillik_ozet), 1),
            "yillik_talep_hm3": t * 365.25 * SANIYE_GUN / 1e6,
        }
    return sonuc
