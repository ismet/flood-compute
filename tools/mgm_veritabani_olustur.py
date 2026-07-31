# -*- coding: utf-8 -*-
"""DMI-tümü/*.xls -> data/mgm/mgm.sqlite  (meteoroloji istasyon veritabanı)

1290 DSİ "RASAT TABLOSU" çalışma kitabı. Her kitap bir istasyon, her sekme bir
rasat türü (aylık toplam yağış, günlük en çok yağış, sıcaklık, buharlaşma,
rüzgâr, kar…). Düzen kitaplar arasında tutarlı:

    satır 0-2  kurum başlığı
    satır 3    İSTASYON İSMİ | ad        … İŞLT. İDARE | kurum | RAKIM | kot
    satır 4    İSTASYON NO   | no        … BÖLGE       | bölge
    satır 5    İL VE İLÇESİ  | il/ilçe   … ENLM-BYLAM  | "36° 59' - 35° 21'"
    satır 6    RASAT TÜRÜ    | tür
    satır 7    YIL | OCAK … ARLK | YILLIK
    satır 8+   veri

ÜÇ TABLO:
  istasyon     kod, ad, il, koordinat, kot + R*Tree (harita sorgusu için)
  olcum        bütün sekmeler uzun biçimde (kod, tür, yıl, ay, değer)
  yillik_maks  "GÜNLÜK EN ÇOK YAĞIŞ" sekmesinden yıllık en büyük — noktasal
               frekans analizinin (P2…P100) girdisi

DİKKAT EDİLEN ÜÇ TUZAK:

1. YILLIK SÜTUNU SIFIR OLABİLİR AMA VERİ OLMAYABİLİR. Kayıt bittikten sonraki
   yıllar için satır açık bırakılmış, aylar boş ve YILLIK 0.0 yazılmıştır
   (ADANA 2006-2007 böyle). Bunu 0 mm yağış saymak frekans analizini bozar:
   yıllık maksimum, ayların HEPSİ boşsa yok sayılır, YILLIK sütununa
   güvenilmez — aylardan yeniden hesaplanır.

2. SEKME ADLARI AYNI ŞEYİ ONLARCA BİÇİMDE YAZIYOR: "GÜNLÜK EN ÇOK YAĞIŞ",
   "GUNLUK EN COK YAGIŞ", "AYLIK TOPLAM YAGIS"… Türkçe harfler kimi dosyada
   ASCII'ye düşürülmüş. Ad normalize edilip (harf katlama + noktalama atma)
   eşanlamlı tablosundan kanonik türe çevrilir.

3. EKSİK DEĞER İŞARETİ İKİ TANE: '-' ve '.'. İkisi de boş demek, sıfır değil.

Kullanım:
    python tools/mgm_veritabani_olustur.py [--kaynak DIZIN] [--is 8]
"""
import argparse
import os
import re
import sqlite3
import sys
import unicodedata
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KAYNAK = os.path.join(ROOT, "DMI-tümü", "DMI-tümü")
HEDEF = os.path.join(ROOT, "data", "mgm", "mgm.sqlite")

BOS = {"", "-", ".", "..", "---", "*"}
BASLIK_SATIR = 7                 # 'YIL' satırı; veri bir alt satırdan başlar

# Normalize edilmiş sekme adı -> kanonik tür. Anahtarlar _anahtar() çıktısıdır.
TURLER = {
    "AYLIKTOPLAMYAGIS": "aylik_toplam_yagis",
    "GUNLUKENCOKYAGIS": "gunluk_en_cok_yagis",
    "AYLIKMAXYAGIS": "gunluk_en_cok_yagis",
    "ORTALAMASICAKLIK": "ortalama_sicaklik",
    "ORTSICAKLIK": "ortalama_sicaklik",
    "MINSICAKLIK": "min_sicaklik",
    "ORTMINSICAKLIK": "ort_min_sicaklik",
    "ORTDUSUKSICAKLIK": "ort_min_sicaklik",
    "MAKSICAKLIK": "mak_sicaklik",
    "MAXSICAKLIK": "mak_sicaklik",
    "ORTMAXSICAKLIK": "ort_mak_sicaklik",
    "ORTYUKSEKSICAKLIK": "ort_mak_sicaklik",
    "GUNLUKMAXSICAKLIKFARKI": "gunluk_sicaklik_farki",
    "AYLIKTOPBUHARLASMA": "buharlasma",
    "ORTNISPINEM": "nispi_nem",
    "ORTRUZGARHIZI": "ruzgar_hizi",
    "ENKUVVETLIRUZGARVEYONU": "en_kuvvetli_ruzgar",
    "ENKUVVETLIRUZGARVEYONU1": "en_kuvvetli_ruzgar",
    "MAXRUZGARVEYONU": "en_kuvvetli_ruzgar",
    "MAXRUZGARVEYONUBOFOR": "en_kuvvetli_ruzgar",
    "ORTGUNESLENME": "gunesleme",
    "GUNESLENMEMUDDETI": "gunesleme",
    "AYLIKKARKALINLIGI": "kar_kalinligi",
    "MAXKARORTUSU": "mak_kar_ortusu",
    "MAKKARORTUSU": "mak_kar_ortusu",
    "KARLAORTULUGUNLER": "karla_ortulu_gunler",
    "KARYAGISLIGUNLER": "kar_yagisli_gunler",
    "YAGISLIGUNLERSAYISI": "yagisli_gunler",
    "ACIKGUNLERSAYISI": "acik_gunler",
    "DONLUGUNLERSAYISI": "donlu_gunler",
    "DONLUGUNLER": "donlu_gunler",
    "KUVVETLIRUZGARLIGUNLER": "kuvvetli_ruzgarli_gunler",
}
YAGIS_TURU = "gunluk_en_cok_yagis"
SON_YIL = 2026                   # bundan sonrası kaynak dosyanın hatasıdır

# Eşanlamlı listesinde olmayan sekmeler ATILMAZ, adından tür üretilir. 79 çeşit
# eşlenmemiş ad vardı ("DOLULU GÜNLER SAYISI", "ORT.BULUTLULUK"…); elle harita
# yazmak yerine otomatik ad, veriyi kaybetmeden içeri alır. Otomatik ad yalnız
# normalize adı BİREBİR aynı olanları birleştirir, yani "MAX.RÜZGAR (msec)" ile
# "MAX.RÜZGAR (bofor)" ayrı kalır — farklı birimleri sessizce karıştırmaz.
_TR = str.maketrans("ÇĞİÖŞÜçğıöşü", "CGIOSUcgiosu")


def _slug(ad):
    s = unicodedata.normalize("NFKD", str(ad or "").translate(_TR))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_").lower()
    return s or "bilinmeyen"


def _anahtar(s):
    """Sekme adını harf katlayıp noktalamayı atarak eşleştirilebilir hale getirir."""
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = (s.upper().replace("İ", "I").replace("I", "I").replace("Ğ", "G")
         .replace("Ş", "S").replace("Ö", "O").replace("Ü", "U").replace("Ç", "C"))
    return re.sub(r"[^A-Z0-9]", "", s)


def _sayi(v):
    """Hücreden float; eksik işaretleri ('-', '.') None döner."""
    if isinstance(v, (int, float)):
        return float(v)
    t = str(v or "").strip().replace(",", ".")
    if t in BOS:
        return None
    try:
        return float(t)
    except ValueError:
        return None


_DMS = re.compile(r"(\d+)\s*°\s*(\d+)?\s*'?\s*(\d+)?")


def _koordinat(metin):
    """\"36° 59' - 35° 21'\" -> (36.983, 35.350); okunamazsa (None, None)."""
    parcalar = str(metin or "").split("-")
    if len(parcalar) < 2:
        return None, None
    out = []
    for p in parcalar[:2]:
        m = _DMS.search(p)
        if not m:
            return None, None
        d = float(m.group(1))
        d += float(m.group(2) or 0) / 60.0 + float(m.group(3) or 0) / 3600.0
        out.append(d)
    lat, lon = out
    # Türkiye penceresi dışındaki değer ayrıştırma hatasıdır, uydurma veri
    # üretmektense boş bırakılır.
    if not (35.0 <= lat <= 42.5 and 25.0 <= lon <= 45.5):
        return None, None
    return round(lat, 5), round(lon, 5)


def _metin(v):
    t = str(v or "").strip()
    return t if t and t not in BOS else ""


def _kitap_oku(yol):
    """Bir .xls -> (istasyon sözlüğü, [(tür, yıl, ay, değer)…]) ya da None."""
    import xlrd

    try:
        kitap = xlrd.open_workbook(yol, on_demand=True)
    except Exception as e:
        return None, f"açılamadı: {e}"

    ilk = kitap.sheet_by_index(0)
    no = _sayi(ilk.cell_value(4, 3))
    ad = _metin(ilk.cell_value(3, 3))
    lat, lon = _koordinat(ilk.cell_value(5, 11) if ilk.ncols > 11 else "")
    ist = {
        "kod": str(int(no)) if no else None,
        "ad": ad or os.path.splitext(os.path.basename(yol))[0],
        "il": _metin(ilk.cell_value(5, 3)),
        "kurum": _metin(ilk.cell_value(3, 11)) if ilk.ncols > 11 else "",
        "bolge": _metin(ilk.cell_value(4, 11)) if ilk.ncols > 11 else "",
        "kot": _sayi(ilk.cell_value(3, 13)) if ilk.ncols > 13 else None,
        "lat": lat, "lon": lon,
        "dosya": os.path.basename(yol),
    }

    olcumler, otomatik, atilan = [], set(), 0
    for sekme_ad in kitap.sheet_names():
        anahtar = _anahtar(sekme_ad)
        tur = TURLER.get(anahtar)
        if tur is None:
            tur = _slug(sekme_ad)
            otomatik.add(sekme_ad.strip())
        s = kitap.sheet_by_name(sekme_ad)
        if s.nrows <= BASLIK_SATIR:
            continue
        onceki = None
        for r in range(BASLIK_SATIR + 1, s.nrows):
            yil = _sayi(s.cell_value(r, 0))
            if yil is None or not (1900 <= yil <= SON_YIL):
                continue
            satir = tuple((ay, _sayi(s.cell_value(r, ay)))
                          for ay in range(1, min(13, s.ncols)))
            dolu = tuple(x for x in satir if x[1] is not None)
            # Excel'de yıl hücresi aşağı sürüklendiğinde veri satırı olduğu
            # gibi tekrarlanıyor (EREĞLİ 2024-2027 birebir aynı). Ardışık iki
            # yılda 12 aylık değerin tıpatıp aynı olması gözlemde imkânsızdır;
            # tekrar atılır, yoksa frekans serisine sahte yıl girer.
            if onceki and len(dolu) >= 3 and dolu == onceki[1] and int(yil) == onceki[0] + 1:
                atilan += 1
                onceki = (int(yil), dolu)
                continue
            onceki = (int(yil), dolu)
            for ay, d in dolu:
                olcumler.append((tur, int(yil), ay, d))
        kitap.unload_sheet(sekme_ad)
    ist["otomatik_sekme"] = otomatik
    ist["atilan_tekrar"] = atilan
    return (ist, olcumler), None


def _yillik_maksimumlar(olcumler):
    """Günlük en çok yağış sekmesinden yıllık maksimum.

    YILLIK sütunu OKUNMAZ. Kayıt bittikten sonraki yıllarda aylar boş
    bırakılıp YILLIK'a 0.0 yazılmış oluyor; o sıfırı gerçek bir gözlem
    saymak frekans analizinde en küçük değeri sabitleyip bütün dağılımı
    aşağı çeker. Ayların hepsi boşsa yıl yoktur.
    """
    yillik = {}
    for tur, yil, ay, d in olcumler:
        if tur != YAGIS_TURU or not (1 <= ay <= 12):
            continue
        if d > yillik.get(yil, -1.0):
            yillik[yil] = d
    return {y: v for y, v in yillik.items() if v > 0}


SEMA = """
CREATE TABLE istasyon (
    kod TEXT PRIMARY KEY, ad TEXT, il TEXT, kurum TEXT, bolge TEXT,
    lat REAL, lon REAL, kot REAL, dosya TEXT,
    maks_yil INTEGER, maks_ilk_yil INTEGER, maks_son_yil INTEGER,
    maks_ort REAL, maks_en_buyuk REAL);
CREATE TABLE seri (
    kod TEXT, tur TEXT, ilk_yil INTEGER, n INTEGER, d BLOB,
    PRIMARY KEY (kod, tur)) WITHOUT ROWID;
CREATE TABLE yillik_maks (
    kod TEXT, yil INTEGER, deger REAL, PRIMARY KEY (kod, yil)) WITHOUT ROWID;
CREATE VIRTUAL TABLE istasyon_idx USING rtree(id, xmin, xmax, ymin, ymax);
CREATE TABLE istasyon_no (kod TEXT PRIMARY KEY, id INTEGER);
CREATE INDEX seri_tur ON seri(tur);
"""


def _seri_paketle(olcumler):
    """(tür, yıl, ay, değer) listesini tür başına sıkıştırılmış diziye çevirir.

    Satır başına bir kayıt tutmak 2.4 milyon ölçüm için 191 MB veritabanı
    üretiyordu — GitHub'ın 100 MB dosya sınırının üstü. Tür başına
    n×12 float32 (eksik = NaN) + zlib, agi.sqlite ve su.sqlite'ta zaten
    kullanılan biçim; aynı veriyi onda birinden az yerde tutar.

    -> {tür: (ilk_yil, n, blob)}
    """
    import array
    import math
    import zlib

    grup = {}
    for tur, yil, ay, d in olcumler:
        grup.setdefault(tur, {}).setdefault(yil, {})[ay] = d
    out = {}
    for tur, yillar in grup.items():
        ilk, son = min(yillar), max(yillar)
        n = son - ilk + 1
        dizi = array.array("f", [math.nan]) * (n * 12)
        for yil, aylar in yillar.items():
            taban = (yil - ilk) * 12
            for ay, d in aylar.items():
                dizi[taban + ay - 1] = d
        out[tur] = (ilk, n, zlib.compress(dizi.tobytes(), 9))
    return out


def uret(kaynak=KAYNAK, hedef=HEDEF, is_sayisi=8):
    import glob

    dosyalar = sorted(glob.glob(os.path.join(kaynak, "*.xls")))
    if not dosyalar:
        sys.exit(f"Kaynakta .xls yok: {kaynak}")
    print(f"{len(dosyalar)} çalışma kitabı okunuyor…")

    sonuc, hatalar = [], []
    with ThreadPoolExecutor(max_workers=is_sayisi) as havuz:
        for i, (veri, hata) in enumerate(havuz.map(_kitap_oku, dosyalar), 1):
            if hata:
                hatalar.append((dosyalar[i - 1], hata))
            else:
                sonuc.append(veri)
            if i % 100 == 0:
                print(f"  {i}/{len(dosyalar)}", end="\r")
    print(" " * 30, end="\r")

    os.makedirs(os.path.dirname(hedef), exist_ok=True)
    if os.path.exists(hedef):
        os.remove(hedef)
    db = sqlite3.connect(hedef)
    db.executescript(SEMA)

    kullanilan, cakisma, koordsuz, bilinmeyen = set(), 0, 0, {}
    tekrar_toplam = 0
    sonraki_id = 1
    for ist, olcumler in sonuc:
        kod = ist["kod"] or "X" + _anahtar(ist["ad"])[:12]
        if kod in kullanilan:                       # aynı no iki dosyada
            cakisma += 1
            kod = f"{kod}_{cakisma}"
        kullanilan.add(kod)
        tekrar_toplam += ist["atilan_tekrar"]
        for s in ist["otomatik_sekme"]:
            bilinmeyen[s] = bilinmeyen.get(s, 0) + 1

        maks = _yillik_maksimumlar(olcumler)
        yillar = sorted(maks)
        if ist["lat"] is None:
            koordsuz += 1

        db.execute(
            "INSERT INTO istasyon VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (kod, ist["ad"], ist["il"], ist["kurum"], ist["bolge"],
             ist["lat"], ist["lon"], ist["kot"], ist["dosya"],
             len(yillar), yillar[0] if yillar else None,
             yillar[-1] if yillar else None,
             round(sum(maks.values()) / len(maks), 2) if maks else None,
             max(maks.values()) if maks else None))
        db.executemany(
            "INSERT INTO seri VALUES (?,?,?,?,?)",
            ((kod, t, ilk, n, b) for t, (ilk, n, b) in _seri_paketle(olcumler).items()))
        db.executemany("INSERT INTO yillik_maks VALUES (?,?,?)",
                       ((kod, y, maks[y]) for y in yillar))
        if ist["lat"] is not None:
            db.execute("INSERT INTO istasyon_idx VALUES (?,?,?,?,?)",
                       (sonraki_id, ist["lon"], ist["lon"], ist["lat"], ist["lat"]))
            db.execute("INSERT INTO istasyon_no VALUES (?,?)", (kod, sonraki_id))
            sonraki_id += 1
    db.commit()
    db.execute("VACUUM")

    _rapor(db, hedef, hatalar, cakisma, koordsuz, bilinmeyen, tekrar_toplam)
    db.close()


def _rapor(db, hedef, hatalar, cakisma, koordsuz, bilinmeyen, tekrar):
    n_ist, = db.execute("SELECT COUNT(*) FROM istasyon").fetchone()
    n_ser, = db.execute("SELECT COUNT(*) FROM seri").fetchone()
    n_mak, = db.execute("SELECT COUNT(*) FROM yillik_maks").fetchone()
    print(f"\n{n_ist} istasyon · {n_ser:,} seri · {n_mak:,} yıllık maksimum")
    if hatalar:
        print(f"  {len(hatalar)} dosya okunamadı")
        for f, h in hatalar[:5]:
            print(f"    {os.path.basename(f)}: {h}")
    if cakisma:
        print(f"  {cakisma} istasyon numarası birden çok dosyada (sonek eklendi)")
    if koordsuz:
        print(f"  {koordsuz} istasyonun koordinatı yok — haritada görünmez")
    if tekrar:
        print(f"  {tekrar} satır sürükleme tekrarı olarak atıldı")
    if bilinmeyen:
        print(f"  {len(bilinmeyen)} sekme adı eşanlamlı listesinde yoktu, "
              f"adından türetildi:")
        for s, n in sorted(bilinmeyen.items(), key=lambda x: -x[1])[:8]:
            print(f"    {n:4d}× {s!r}")

    print("\n  tür bazında seri:")
    for t, n, y1, y2 in db.execute(
            "SELECT tur, COUNT(*), MIN(ilk_yil), MAX(ilk_yil + n - 1) FROM seri "
            "GROUP BY tur ORDER BY COUNT(*) DESC LIMIT 24"):
        print(f"    {t:<28} {n:>5} istasyon  {y1}-{y2}")

    print("\n  frekans analizine uygunluk (yıllık maksimum serisi):")
    for esik in (10, 15, 20, 25, 30):
        n, = db.execute("SELECT COUNT(*) FROM istasyon WHERE maks_yil >= ? "
                        "AND lat IS NOT NULL", (esik,)).fetchone()
        print(f"    ≥{esik:2d} yıl ve koordinatlı: {n}")
    print(f"\n-> {hedef}  ({os.path.getsize(hedef)/1e6:.1f} MB)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--kaynak", default=KAYNAK)
    ap.add_argument("--hedef", default=HEDEF)
    ap.add_argument("--is", dest="is_sayisi", type=int, default=8)
    a = ap.parse_args()
    uret(a.kaynak, a.hedef, a.is_sayisi)
