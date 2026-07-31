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


TAM_YIL_GUN = 355          # bu günden az veri olan su yılı "eksik" sayılır


def _nokta_icinde(x, y, halkalar):
    icinde = False
    for halka in halkalar:
        for i in range(len(halka) - 1):
            x1, y1 = halka[i][0], halka[i][1]
            x2, y2 = halka[i + 1][0], halka[i + 1][1]
            if (y1 > y) != (y2 > y):
                if x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                    icinde = not icinde
    return icinde


def havza(geometri, tampon_derece=0.35, en_az_yil=10):
    """Havza poligonunun içindeki ve çevresindeki günlük akım istasyonları.

    Havzanın kendi içinde AGİ olmayabilir; su potansiyeli o zaman komşu
    istasyonlardan taşınır, bu yüzden tampon varsayılan olarak geniştir.
    """
    tip = geometri.get("type")
    koord = geometri.get("coordinates") or []
    poligonlar = [koord] if tip == "Polygon" else list(koord) if tip == "MultiPolygon" \
        else None
    if poligonlar is None:
        raise ValueError("Havza geometrisi Polygon ya da MultiPolygon olmalı")
    xs = [p[0] for pol in poligonlar for h in pol for p in h]
    ys = [p[1] for pol in poligonlar for h in pol for p in h]
    if not xs:
        raise ValueError("Havza geometrisi boş")
    t = max(0.0, float(tampon_derece))
    ist = pencere((min(xs) - t, min(ys) - t, max(xs) + t, max(ys) + t),
                  en_az_yil=en_az_yil)
    for s in ist:
        s["icinde"] = any(_nokta_icinde(s["lon"], s["lat"], pol) for pol in poligonlar)
    return ist


def yillik(kod, ilk_yil=None, son_yil=None):
    """Su yılı bazında ortalama akım. -> {su_yili: {q, gun, tam}}"""
    ilk, q = seri(kod)
    toplam = {}
    for i, v in enumerate(q):
        if v is None or math.isnan(v):
            continue
        sy = _su_yili(ilk + datetime.timedelta(days=i))
        if (ilk_yil and sy < ilk_yil) or (son_yil and sy > son_yil):
            continue
        t = toplam.setdefault(sy, [0.0, 0])
        t[0] += v
        t[1] += 1
    return {sy: {"q": s / n, "gun": n, "tam": n >= TAM_YIL_GUN}
            for sy, (s, n) in toplam.items()}


def periyot_tablosu(kodlar, ilk_yil=None, son_yil=None):
    """İstasyon × su yılı ölçüm durumu — eksik yıllar tek bakışta görünsün.

    durum: 'tam' | 'eksik' (kısmi gözlem) | 'yok'
    """
    seriler = {k: yillik(k, ilk_yil, son_yil) for k in kodlar}
    yillar = sorted({y for s in seriler.values() for y in s})
    if ilk_yil and son_yil:
        yillar = list(range(int(ilk_yil), int(son_yil) + 1))
    satirlar = []
    for k in kodlar:
        s = seriler[k]
        hucre = []
        for y in yillar:
            d = s.get(y)
            hucre.append({"yil": y, "durum": "yok" if not d else ("tam" if d["tam"] else "eksik"),
                          "q": d["q"] if d else None, "gun": d["gun"] if d else 0})
        tam = sum(1 for h in hucre if h["durum"] == "tam")
        satirlar.append({"kod": k, "ad": istasyon(k)["ad"],
                         "alan_km2": istasyon(k)["alan_km2"],
                         "yillar": hucre, "tam_yil": tam,
                         "eksik_yil": len(yillar) - tam})
    return {"yillar": yillar, "istasyonlar": satirlar}


def _regresyon(x, y):
    """OLS y = a + b·x. -> (a, b, r, n)"""
    n = len(x)
    if n < 3:
        return None
    mx, my = sum(x) / n, sum(y) / n
    sxx = sum((v - mx) ** 2 for v in x)
    syy = sum((v - my) ** 2 for v in y)
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
    if sxx <= 0 or syy <= 0:
        return None
    b = sxy / sxx
    return (my - b * mx, b, sxy / math.sqrt(sxx * syy), n)


def korelasyon(kodlar, ilk_yil=None, son_yil=None):
    """İstasyon çiftleri arasında yıllık ortalama akım regresyonu.

    Eksik yılları hangi istasyondan tamamlayacağımıza bu karar verir: ortak
    yılları en iyi açıklayan (|r| en yüksek) istasyon verici olur.
    """
    seriler = {k: yillik(k, ilk_yil, son_yil) for k in kodlar}
    ciftler = []
    for i, a in enumerate(kodlar):
        for b in kodlar[i + 1:]:
            ortak = [y for y in seriler[a] if y in seriler[b]
                     and seriler[a][y]["tam"] and seriler[b][y]["tam"]]
            r = _regresyon([seriler[a][y]["q"] for y in ortak],
                           [seriler[b][y]["q"] for y in ortak]) if len(ortak) >= 3 else None
            ciftler.append({"a": a, "b": b, "ortak_yil": len(ortak),
                            "r": r[2] if r else None,
                            "r2": (r[2] ** 2) if r else None,
                            "egim": r[1] if r else None,
                            "kesim": r[0] if r else None})
    return ciftler


def tamamla(hedef, vericiler, ilk_yil, son_yil, en_az_r2=0.5):
    """Hedef istasyonun eksik su yıllarını regresyonla tamamlar.

    Her eksik yıl için, o yılda verisi olan ve hedefle en yüksek r²'ye sahip
    verici seçilir; hedef = kesim + eğim·verici ile üretilir. r² eşiğin
    altındaki ilişkiler kullanılmaz — kaydın kaynağı `kaynak` alanında durur.
    """
    hs = yillik(hedef, ilk_yil, son_yil)
    vs = {k: yillik(k, ilk_yil, son_yil) for k in vericiler if k != hedef}

    iliski = {}
    for k, s in vs.items():
        ortak = [y for y in hs if y in s and hs[y]["tam"] and s[y]["tam"]]
        if len(ortak) < 3:
            continue
        r = _regresyon([s[y]["q"] for y in ortak], [hs[y]["q"] for y in ortak])
        if r and r[2] ** 2 >= en_az_r2:
            iliski[k] = {"kesim": r[0], "egim": r[1], "r": r[2], "r2": r[2] ** 2,
                         "ortak_yil": len(ortak)}

    sira = sorted(iliski, key=lambda k: -iliski[k]["r2"])
    yillar = list(range(int(ilk_yil), int(son_yil) + 1))
    seri_out, dolduruldu = [], 0
    for y in yillar:
        d = hs.get(y)
        if d and d["tam"]:
            seri_out.append({"yil": y, "q": d["q"], "kaynak": "gözlem", "gun": d["gun"]})
            continue
        yazildi = False
        for k in sira:
            v = vs[k].get(y)
            if v and v["tam"]:
                il = iliski[k]
                q = il["kesim"] + il["egim"] * v["q"]
                seri_out.append({"yil": y, "q": max(q, 0.0), "kaynak": k,
                                 "r2": il["r2"], "gun": d["gun"] if d else 0})
                dolduruldu += 1
                yazildi = True
                break
        if not yazildi:
            seri_out.append({"yil": y, "q": None, "kaynak": None,
                             "gun": d["gun"] if d else 0})
    return {"hedef": hedef, "iliskiler": iliski, "sira": sira,
            "seri": seri_out, "dolduruldu": dolduruldu,
            "gozlem": sum(1 for s in seri_out if s["kaynak"] == "gözlem"),
            "bos": sum(1 for s in seri_out if s["q"] is None)}


def outlet(hedef_seri, kaynak_alan, havza_alani, us=1.0):
    """Temsil istasyonunun serisini havza çıkışına taşır (alan oranıyla).

    Su potansiyelinde hacim alanla neredeyse doğrusal gittiği için üs
    varsayılan 1.0'dır (taşkın pikinde 2/3 kullanılır — farklı büyüklükler).
    """
    if not kaynak_alan or not havza_alani:
        raise ValueError("Alan oranı için hem AGİ hem havza yağış alanı gerekir")
    oran = (float(havza_alani) / float(kaynak_alan)) ** float(us)
    seri_out = [{**s, "q": (s["q"] * oran if s["q"] is not None else None)}
                for s in hedef_seri]
    q = [s["q"] for s in seri_out if s["q"] is not None]
    q_ort = sum(q) / len(q) if q else None
    return {
        "oran": oran, "us": float(us),
        "kaynak_alan_km2": float(kaynak_alan), "havza_alani_km2": float(havza_alani),
        "seri": seri_out, "yil_sayisi": len(q),
        "q_ort": q_ort,
        "yillik_hacim_hm3": (q_ort * 365.25 * SANIYE_GUN / 1e6) if q_ort else None,
        "ozgul_verim_ls_km2": (q_ort * 1000 / float(havza_alani)) if q_ort else None,
        "yillik_verim_mm": ((q_ort * 365.25 * SANIYE_GUN) / (float(havza_alani) * 1e6) * 1000)
                           if q_ort else None,
    }


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
