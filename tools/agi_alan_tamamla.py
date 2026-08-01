# -*- coding: utf-8 -*-
"""DSİ akım gözlem ağı KMZ'sinden agi.sqlite'ın EKSİK yağış alanlarını doldurur.

`agi.sqlite` istasyonları Akım Gözlem Yıllıklarının PDF'lerinden çıkarıldı;
241 istasyonun yağış alanı okunamadı. Yağış alanı BTFA'nın (bölgesel taşkın
frekans analizi) doğrudan girdisidir — alan–Q2 güç yasası ondan kurulur — bu
yüzden alansız istasyon analize hiç giremiyor.

DSİ'nin gözlem ağı KMZ'si aynı istasyonları `IST_NO`/`ISTKOD` (D02A001 biçimi)
ile ve `YAGISALAN` alanıyla taşıyor. Aynı büyüklük ve aynı birim olduğu
doğrulandı: iki kaynakta da alanı bulunan 2330 istasyonda oranın medyanı
1.0000 ve %90'ı %2 içinde.

YALNIZ BOŞ OLANLAR DOLDURULUR, mevcut değerin üstüne yazılmaz. Sebep şu:
kalan %10'luk sapmanın büyük kısmında hatalı olan taraf agi.sqlite'tır —
istasyon adı da bozuk çıkmış OCR kayıtlarıdır ("KULLANILABİLİR RASAT S",
"SEIEİH N. - DEHİB IÖ1B"). Ama bu, KMZ'nin her çelişkide haklı olduğu
anlamına gelmez; toptan üzerine yazmak, doğrulanmamış bir kaynağı
doğrulanmış verinin önüne geçirmek olurdu. Çelişkiler `--celiskiler` ile
listelenir, kararı insan verir.

Kullanım:
    python tools/agi_alan_tamamla.py [--kmz DOSYA] [--yaz] [--celiskiler]
"""
import argparse
import os
import re
import sqlite3
import statistics
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AGI_DB = os.path.join(ROOT, "data", "agi", "agi.sqlite")
VARSAYILAN_KMZ = os.path.join(ROOT, "RASATLAR GÖZLEMAĞI (2).kmz")

# KMZ'nin iki nokta katmanı var, alan adları farklı ama içerik aynı biçimde.
KOD_ALANI = ("IST_NO", "ISTKOD")
ALAN_ALANI = "YAGISALAN"
SAPMA_ESIK = 0.02               # bu oranın üstü "çelişki" sayılır


def kmz_oku(yol):
    """-> {istasyon_kodu: yağış_alanı_km2}"""
    with zipfile.ZipFile(yol) as z:
        ad = next(n for n in z.namelist() if n.lower().endswith(".kml"))
        kml = z.read(ad).decode("utf-8", "replace")
    out, celisen = {}, 0
    for p in re.findall(r"<Placemark.*?</Placemark>", kml, re.S):
        d = dict(re.findall(
            r"<td>([A-ZĞÜŞİÖÇ_0-9a-z]+)</td>\s*<td>(.*?)</td>", p, re.S))
        kod = next((d[k] for k in KOD_ALANI if d.get(k)), None)
        if not kod:
            continue
        try:
            alan = float((d.get(ALAN_ALANI) or "").replace(",", "."))
        except ValueError:
            alan = None
        if alan is not None and alan <= 0:
            alan = None
        if kod in out:
            # aynı istasyon iki katmanda: değerler çelişirse ikisini de atma,
            # ilkini koru ve say — sessiz seçim yapmaktansa görünür olsun
            if alan and out[kod] and abs(alan - out[kod]) > 0.01 * max(alan, out[kod]):
                celisen += 1
            elif out[kod] is None:
                out[kod] = alan
        else:
            out[kod] = alan
    return {k: v for k, v in out.items() if v}, celisen


def dogrula(db, kmz):
    """İki kaynakta da alanı olan istasyonlarla birim/anlam uyumunu sınar."""
    ikisi = [(k, a, kmz[k]) for k, a in db.execute(
        "SELECT kod, yagis_alani FROM istasyon WHERE yagis_alani > 0")
        if k in kmz]
    if not ikisi:
        sys.exit("Ortak istasyon yok — KMZ agi.sqlite ile eşleşmiyor")
    oran = [b / a for _, a, b in ikisi]
    medyan = statistics.median(oran)
    yakin = sum(1 for o in oran if abs(o - 1) <= SAPMA_ESIK)
    print(f"birim/anlam sınaması: {len(ikisi)} ortak istasyon, "
          f"oran medyanı {medyan:.4f}, %{SAPMA_ESIK*100:.0f} içinde "
          f"{yakin} (%{100*yakin/len(ikisi):.0f})")
    if not (0.98 <= medyan <= 1.02):
        sys.exit(f"DURDURULDU: oran medyanı {medyan:.3f} — KMZ'deki alan "
                 "agi.sqlite ile aynı büyüklük/birim değil, doldurma yapılmaz")
    return ikisi


def calis(kmz_yol, yaz, celiskiler):
    if not os.path.exists(kmz_yol):
        sys.exit(f"KMZ yok: {kmz_yol}")
    kmz, katman_celisen = kmz_oku(kmz_yol)
    print(f"KMZ: {len(kmz)} istasyonda yağış alanı"
          + (f" ({katman_celisen} tanesi iki katmanda çelişik)" if katman_celisen else ""))

    db = sqlite3.connect(AGI_DB)
    ikisi = dogrula(db, kmz)

    eksik = [k for k, in db.execute(
        "SELECT kod FROM istasyon WHERE yagis_alani IS NULL OR yagis_alani <= 0")]
    dolacak = [(k, kmz[k]) for k in eksik if k in kmz]
    print(f"\nagi.sqlite: {len(eksik)} istasyonda alan yok, "
          f"{len(dolacak)} tanesi KMZ'de var")
    if dolacak:
        a = [v for _, v in dolacak]
        print(f"  dolacak alanlar: {min(a):.1f} – {max(a):.1f} km², "
              f"medyan {statistics.median(a):.1f}")
        for k, v in dolacak[:5]:
            ad = db.execute("SELECT ad FROM istasyon WHERE kod=?", (k,)).fetchone()[0]
            print(f"    {k}  {ad[:34]:<34} {v:9.2f} km²")
        if len(dolacak) > 5:
            print(f"    … ve {len(dolacak)-5} tane daha")

    if celiskiler:
        sapan = sorted(((abs(b / a - 1), k, a, b) for k, a, b in ikisi
                        if abs(b / a - 1) > SAPMA_ESIK), reverse=True)
        print(f"\nÇELİŞKİLER ({len(sapan)} istasyon, yazılmıyor):")
        for _, k, a, b in sapan[:25]:
            ad = db.execute("SELECT ad FROM istasyon WHERE kod=?", (k,)).fetchone()[0]
            print(f"  {k}  {ad[:30]:<30} agi={a:10.2f}  kmz={b:10.2f}  "
                  f"oran {b/a:7.2f}")
        if len(sapan) > 25:
            print(f"  … ve {len(sapan)-25} tane daha")

    if not yaz:
        print("\n(--yaz verilmedi: veri tabanı değiştirilmedi)")
        return
    db.executemany("UPDATE istasyon SET yagis_alani = ? WHERE kod = ?",
                   ((v, k) for k, v in dolacak))
    db.commit()
    kalan, = db.execute("SELECT COUNT(*) FROM istasyon "
                        "WHERE yagis_alani IS NULL OR yagis_alani <= 0").fetchone()
    print(f"\n{len(dolacak)} istasyonun yağış alanı yazıldı; "
          f"alansız kalan: {kalan}")
    db.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--kmz", default=VARSAYILAN_KMZ)
    ap.add_argument("--yaz", action="store_true", help="veri tabanına yaz")
    ap.add_argument("--celiskiler", action="store_true",
                    help="iki kaynağın uyuşmadığı istasyonları listele")
    a = ap.parse_args()
    calis(a.kmz, a.yaz, a.celiskiler)
