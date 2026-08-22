# -*- coding: utf-8 -*-
"""MGM meteoroloji istasyonu veri tabanı — yağış frekans analizinin kaynağı.

`data/mgm/mgm.sqlite`, DSİ "RASAT TABLOSU" çalışma kitaplarından çıkarılmış
1290 istasyonun bütün rasat sekmelerini tutar (bkz.
tools/mgm_veritabani_olustur.py). İki ayrı iş görür:

  1. YAĞIŞ FREKANS ANALİZİ (P2…P100). `yillik_maks` tablosundaki yıllık en
     büyük günlük yağışlar, NTFA ile aynı hesaba (backend/core/tfa.py) girer:
     altı dağılım moment yöntemiyle uydurulur, Smirnov-Kolmogorov ile
     karşılaştırılır, Dmax'ı en küçük olan kabul edilir. Fark yalnız
     büyüklükte — akım yerine yağış (mm).

  2. THIESSEN İSTASYONLARIYLA EŞLEŞTİRME. Adım 3'te havzaya düşen Thiessen
     istasyonları bu veri tabanındaki istasyonlara bağlanır ve P2…P100
     doğrudan ölçümden hesaplanır.

`data/tables/mgm_plv_2020.json` ARTIK P24 KAYNAĞI DEĞİLDİR; o tablo yalnız
plüviyograf oranları (PLV) için durur. Sebep: orası 236 istasyonluk hazır bir
tekerrür tablosuydu, burada 1058 istasyonun ham ölçümü ve hesabın kendisi var
— hangi dağılımın kabul edildiği, kaç yıllık seriye dayandığı görünür.
"""
import array
import math
import os
import re
import sqlite3
import threading
import unicodedata
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB_YOLU = os.path.join(ROOT, "data", "mgm", "mgm.sqlite")

EN_AZ_YIL = 10                  # bundan kısa seride frekans analizi anlamsız
VARSAYILAN_SINIR = 3000
_yerel = threading.local()


def var_mi():
    return os.path.exists(DB_YOLU)


def _baglanti():
    db = getattr(_yerel, "db", None)
    if db is None:
        if not var_mi():
            raise RuntimeError(
                "MGM veri tabanı yok. Üretmek için:\n"
                "  python tools/mgm_veritabani_olustur.py")
        db = sqlite3.connect(DB_YOLU, check_same_thread=False)
        db.row_factory = sqlite3.Row
        _yerel.db = db
    return db


def bilgi():
    if not var_mi():
        return {"var": False}
    db = _baglanti()
    n_ist, = db.execute("SELECT COUNT(*) FROM istasyon").fetchone()
    n_mak, = db.execute("SELECT COUNT(*) FROM yillik_maks").fetchone()
    y0, y1 = db.execute("SELECT MIN(yil), MAX(yil) FROM yillik_maks").fetchone()
    n_uygun, = db.execute(
        "SELECT COUNT(*) FROM istasyon WHERE maks_yil >= ? AND lat IS NOT NULL",
        (EN_AZ_YIL,)).fetchone()
    turler = [r[0] for r in db.execute(
        "SELECT tur FROM seri GROUP BY tur ORDER BY COUNT(*) DESC")]
    return {"var": True, "istasyon": n_ist, "yillik_maks": n_mak,
            "frekansa_uygun": n_uygun, "en_az_yil": EN_AZ_YIL,
            "ilk_yil": y0, "son_yil": y1, "turler": turler,
            "boyut_mb": round(os.path.getsize(DB_YOLU) / 1e6, 1)}


def _satir(r):
    return {"kod": r["kod"], "ad": r["ad"], "il": r["il"], "kurum": r["kurum"],
            "bolge": r["bolge"], "lat": r["lat"], "lon": r["lon"],
            "kot": r["kot"], "yil_sayisi": r["maks_yil"],
            "ilk_yil": r["maks_ilk_yil"], "son_yil": r["maks_son_yil"],
            "maks_ort": r["maks_ort"], "maks_en_buyuk": r["maks_en_buyuk"]}


def pencere(bbox, en_az_yil=EN_AZ_YIL, sinir=VARSAYILAN_SINIR):
    """Verilen pencerede yıllık maksimum serisi yeterli uzunlukta istasyonlar."""
    b, g, d, k = (float(v) for v in bbox)
    if not (-180 <= b < d <= 180 and -90 <= g < k <= 90):
        raise ValueError("Geçersiz pencere (bbox)")
    db = _baglanti()
    return [_satir(r) for r in db.execute(
        "SELECT i.* FROM istasyon_idx x "
        "JOIN istasyon_no n ON n.id = x.id JOIN istasyon i ON i.kod = n.kod "
        "WHERE x.xmax >= ? AND x.xmin <= ? AND x.ymax >= ? AND x.ymin <= ? "
        "  AND i.maks_yil >= ? ORDER BY i.maks_yil DESC LIMIT ?",
        (b, d, g, k, int(en_az_yil), max(1, min(int(sinir), 10000))))]


def istasyon(kod):
    db = _baglanti()
    r = db.execute("SELECT * FROM istasyon WHERE kod = ?", (kod,)).fetchone()
    if r is None:
        raise ValueError(f"İstasyon bulunamadı: {kod}")
    return _satir(r)


def thiessen_kumesi(en_az_yil=EN_AZ_YIL):
    """Adım 3'ün varsayılan istasyon kümesi — YALNIZ ölçüm veri tabanı.

    Küme, yıllık maksimum serisi frekans analizine yetecek uzunlukta olan
    istasyonlarla sınırlıdır. Böylece her Thiessen hücresi KENDİ ÖLÇTÜĞÜ
    yağışı taşır ve Adım 4'teki P24 bağlanması arama değil kimlik eşleşmesine
    iner — koordinat ya da ad üzerinden bulanık eşleştirme kalmaz.

    Eski `data/stations/bir_cikti.kml` (2315 istasyon) ARTIK OTOMATİK
    YÜKLENMİYOR. Bir süre ikisi birleştirilmişti; birleştirmenin amacı MGM
    ağının seyrek olduğu bölgelerde Thiessen geometrisini ayakta tutmaktı, ama
    o istasyonların ölçümü olmadığı için yağışları yine kilometrelerce
    uzaktaki bir MGM istasyonundan geliyordu — hücre gerçek görünüp değeri
    ödünç alıyordu. Dosya duruyor ve arayüzden elle yüklenebilir.

    BEDELİ AÇIK OLSUN: MGM ağının seyrek olduğu yerde hücreler büyür ve havza
    ortalaması daha az noktadan hesaplanır. Karşılığında hiçbir hücre başka
    istasyonun yağışını taşımaz.
    """
    db = _baglanti()
    return [{"name": r["ad"], "lat": r["lat"], "lon": r["lon"],
             "kurum": r["kurum"] or "DMİ", "kod": r["kod"], "il": r["il"],
             "yil_sayisi": r["maks_yil"], "kot": r["kot"], "kaynak": "mgm"}
            for r in db.execute(
                "SELECT * FROM istasyon WHERE lat IS NOT NULL AND maks_yil >= ? "
                "ORDER BY ad", (int(en_az_yil),))]


def yillik_maks(kod, ilk_yil=None, son_yil=None):
    """Yıllık en büyük günlük yağış serisi (mm), yıla göre sıralı."""
    db = _baglanti()
    sql = "SELECT yil, deger FROM yillik_maks WHERE kod = ?"
    par = [kod]
    if ilk_yil:
        sql += " AND yil >= ?"
        par.append(int(ilk_yil))
    if son_yil:
        sql += " AND yil <= ?"
        par.append(int(son_yil))
    return [{"yil": r["yil"], "deger": r["deger"]}
            for r in db.execute(sql + " ORDER BY yil", par)]


def seri(kod, tur):
    """Bir rasat türünün tam aylık serisi. -> [{yil, aylar[12], yillik}]

    Eksik aylar None; `yillik` o yılın en büyüğüdür (yağış türlerinde anlamlı).
    """
    db = _baglanti()
    r = db.execute("SELECT ilk_yil, n, d FROM seri WHERE kod = ? AND tur = ?",
                   (kod, tur)).fetchone()
    if r is None:
        raise ValueError(f"Seri yok: {kod} / {tur}")
    a = array.array("f")
    a.frombytes(zlib.decompress(r["d"]))
    out = []
    for i in range(r["n"]):
        aylar = [None if math.isnan(v) else round(float(v), 3)
                 for v in a[i * 12:(i + 1) * 12]]
        dolu = [v for v in aylar if v is not None]
        out.append({"yil": r["ilk_yil"] + i, "aylar": aylar,
                    "yillik": max(dolu) if dolu else None,
                    "toplam": round(sum(dolu), 2) if len(dolu) == 12 else None})
    return out


def turler(kod):
    """İstasyonda hangi rasat türleri var. -> [{tur, ilk_yil, son_yil}]"""
    db = _baglanti()
    return [{"tur": r["tur"], "ilk_yil": r["ilk_yil"],
             "son_yil": r["ilk_yil"] + r["n"] - 1}
            for r in db.execute(
                "SELECT tur, ilk_yil, n FROM seri WHERE kod = ? ORDER BY tur",
                (kod,))]


# ------------------------------------------------------------------ frekans
def frekans(kod, ilk_yil=None, son_yil=None):
    """Yağış frekans analizi — NTFA ile aynı hesap, girdi mm cinsinden yağış.

    Akım yerine yağış konulması hesabı değiştirmez: ikisi de yıllık ekstrem
    serisidir ve DSİ aynı altı dağılımı kullanır. Aynı kodu çağırmak, iki ayrı
    uygulamanın zamanla ayrışmasını da önler.
    """
    from backend.core import tfa

    ist = istasyon(kod)
    s = yillik_maks(kod, ilk_yil, son_yil)
    if len(s) < EN_AZ_YIL:
        raise ValueError(
            f"{ist['ad']}: frekans analizi için en az {EN_AZ_YIL} yıl gerekli, "
            f"{len(s)} yıl var")
    sonuc = tfa.ozet([k["deger"] for k in s],
                     istasyon=f"{ist['kod']} {ist['ad']}".strip(),
                     yillar=[k["yil"] for k in s])
    sonuc["istasyon_bilgi"] = ist
    sonuc["birim"] = "mm"
    sonuc["buyukluk"] = "yıllık en büyük günlük yağış"
    sonuc["P24"] = p24_sozlugu(sonuc)
    return sonuc


P24_TEKERRUR = (2, 5, 10, 25, 50, 100)


def p24_sozlugu(sonuc):
    """Kabul edilen dağılımın P2…P100 değerleri. -> {"2": mm, …} ya da None."""
    q = sonuc.get("kabul_edilen_q")
    if not q:
        return None
    tek = sonuc["tekerrur"]
    return {str(t): round(q[tek.index(t)], 1) for t in P24_TEKERRUR if t in tek}


# --------------------------------------------------------------- eşleştirme
_TR_BUYUK = str.maketrans("abcçdefgğhıijklmnoöprsştuüvyzqwx",
                          "ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZQWX")


def _norm(ad):
    """Ada göre eşleştirme anahtarı — Türkçe harf katlar, noktalama atar."""
    s = str(ad or "").translate(_TR_BUYUK)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = (s.replace("Ğ", "G").replace("Ş", "S").replace("Ö", "O")
          .replace("Ü", "U").replace("Ç", "C").replace("İ", "I"))
    s = re.sub(r"\(.*?\)", " ", s)              # "EREĞLİ (KONYA)" -> "EREĞLİ"
    return re.sub(r"[^A-Z0-9]", "", s)


def _mesafe_km(lat1, lon1, lat2, lon2):
    dy = (lat2 - lat1) * 111.32
    dx = (lon2 - lon1) * 111.32 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dx, dy)


TERCIH_YIL = 25                 # bu uzunluktaki seri P100 için makul sayılır


def eslestir(istasyonlar, en_az_yil=EN_AZ_YIL, en_cok_km=25.0,
             tercih_yil=TERCIH_YIL):
    """Thiessen istasyonlarını veri tabanındaki istasyonlara bağlar.

    istasyonlar: [{ad, lat, lon}] — Thiessen KMZ'sinden gelenler.

    Önce KOORDİNAT, sonra ad denenir. Sıralama bilinçli: KMZ'deki ad serbest
    metindir ("ÇORLU DMİ", "Çorlu Meteoroloji"), koordinat ise ölçülmüş
    büyüklüktür. Ada göre eşleştirme Türkiye'de kolayca yanlış ile eşler —
    aynı adı taşıyan onlarca köy var.

    EN YAKIN İSTASYON HER ZAMAN DOĞRU SEÇİM DEĞİL. Lüleburgaz'da 5.7 km'de
    10 yıllık bir istasyon, 12 km'de 74 yıllık bir istasyon var; en yakını
    almak P100'ü 10 yıllık seriden çıkarır ve ekstrapolasyon güvenilmez olur.
    Bu yüzden yarıçap içinde `tercih_yil` uzunluğuna ulaşan istasyon varsa
    onların EN YAKINI seçilir; yoksa mutlak en yakına düşülür. Hangi kuralın
    işlediği `yontem` alanında görünür, adaylar da döndürülür ki kullanıcı
    kararı değiştirebilsin.

    -> [{ad, eslesen: {...}|None, yontem, mesafe_km, adaylar: [...]}]
    """
    db = _baglanti()
    hepsi = [_satir(r) for r in db.execute(
        "SELECT * FROM istasyon WHERE maks_yil >= ? AND lat IS NOT NULL",
        (int(en_az_yil),))]
    ada_gore = {}
    for s in hepsi:
        ada_gore.setdefault(_norm(s["ad"]), []).append(s)

    ko_gore = {s["kod"]: s for s in hepsi}
    out = []
    for g in istasyonlar:
        ad = g.get("ad") or g.get("name") or ""
        lat, lon = g.get("lat"), g.get("lon")
        kayit = {"ad": ad, "eslesen": None, "yontem": None,
                 "mesafe_km": None, "adaylar": []}

        # İstasyon zaten bu veri tabanından geldiyse (Adım 3'ün varsayılan
        # kümesi) aramaya gerek yok — kimliği belli. Arama yalnız kullanıcının
        # yüklediği KMZ ya da haritaya elle koyduğu noktalar için gerekir.
        kod = g.get("kod")
        if kod and kod in ko_gore:
            kayit["eslesen"] = ko_gore[kod]
            kayit["yontem"] = "kod"
            kayit["mesafe_km"] = 0.0
            out.append(kayit)
            continue

        if lat is not None and lon is not None:
            yakin = sorted(
                ((_mesafe_km(lat, lon, s["lat"], s["lon"]), s) for s in hepsi),
                key=lambda t: t[0])[:8]
            kayit["adaylar"] = [dict(s, mesafe_km=round(m, 2)) for m, s in yakin]
            menzil = [(m, s) for m, s in yakin if m <= en_cok_km]
            uzun = [(m, s) for m, s in menzil if s["yil_sayisi"] >= tercih_yil]
            secim = uzun[0] if uzun else (menzil[0] if menzil else None)
            if secim:
                kayit["eslesen"] = secim[1]
                kayit["yontem"] = "koordinat" if uzun else "koordinat-kısa"
                kayit["mesafe_km"] = round(secim[0], 2)

        if kayit["eslesen"] is None:
            aday = ada_gore.get(_norm(ad))
            if not aday:                        # kısmi ad içerme
                n = _norm(ad)
                aday = [s for k, v in ada_gore.items() if n and
                        (k.startswith(n) or n.startswith(k)) for s in v] or None
            if aday:
                en_uzun = max(aday, key=lambda s: s["yil_sayisi"])
                kayit["eslesen"] = en_uzun
                kayit["yontem"] = "ad"
                if lat is not None and en_uzun["lat"] is not None:
                    kayit["mesafe_km"] = round(
                        _mesafe_km(lat, lon, en_uzun["lat"], en_uzun["lon"]), 2)
                if not kayit["adaylar"]:
                    kayit["adaylar"] = aday[:5]
        out.append(kayit)
    return out
