# -*- coding: utf-8 -*-
"""Net yağış katmanını uzun dönem AGİ akımlarıyla doğrular.

Katman (`data/yagis/net_tr.tif`) bir MODELDİR: CHELSA yağış/PET/sıcaklık +
SoilGrids AWC üzerinde aylık Thornthwaite-Mather bütçesi. Ölçüm değildir.
Bu betik onu, aynı dönemde (1981-2010 su yılları) ölçülmüş akımlara karşı
tutar ve bölge bölge nerede tuttuğunu, nerede kaçtığını gösterir.

Karşılaştırılan büyüklük AKIŞ YÜKSEKLİĞİdir (mm/yıl); ikisi de aynı birime
indirgenir:
    gözlem  R = Q_ort [m³/s] × 31 556 952 s / (A [km²] × 10⁶ m²) × 1000
    model   net katmanının havza poligonu üzerindeki alansal ortalaması

DOĞALLIK — asıl zorluk bu. Baraj, sulama alımı ve havza dışına aktarma
gözlenen akışı modelin bilmediği biçimde değiştirir; böyle bir istasyonla
katmanı yargılamak katmana haksızlık olur. Rezervuar envanterine sahip
olmadığım için doğallığı SERİNİN KENDİSİNDEN eliyorum:

  1. Mann-Kendall  — yıllık ortalama akımda anlamlı gidiş (|Z| ≥ 1.96)
     varsa dışlanır: artan alım ya da dolan rezervuar böyle görünür.
  2. Pettitt       — anlamlı sıçrama (p < 0.05) varsa dışlanır: bir barajın
     işletmeye girişi seride basamak bırakır.
  3. Alan          — DEM'den çıkarılan havza alanı DSİ'nin bildirdiğinden
     %20'den çok saparsa dışlanır. Bu, koordinat/kenetleme hatasını yakalar;
     yanlış poligonun alansal ortalaması karşılaştırmayı sessizce bozar.
  4. Ölçek         — 50–5000 km². Küçüğü DEM'de çözülemez, büyüğü Türkiye'de
     neredeyse kaçınılmaz olarak regüle edilmiştir.

Bu testlerin yakalayamadığı bir durum var ve saklamıyorum: KAYITTAN ÖNCE
kurulmuş bir regülasyon seride ne gidiş ne sıçrama bırakır. Buradaki
"doğal" nitelemesi bu yüzden "kayıt boyunca rejimi değişmemiş" demektir,
"hiç dokunulmamış" değil.

BULGU (2026-07-31, 49 havza × ~29 su yılı):

Ham Thornthwaite-Mather bütçesi akışı %35 EKSİK veriyordu — deseni doğru
(r=0.81) ama büyüklüğü yanlış (NSE=0.42). Tek bir çarpanla (1.51) NSE
0.62'ye çıkıyordu, AMA ÇARPAN YAMAMAK YANLIŞ OLURDU: örneklem büyütülünce
en ıslak Karadeniz havzalarında modelin ZATEN FAZLA verdiği görüldü —
2218 İyidere gözlem 1046'ya karşı model 1207. Çarpan uygulansa 1560'a
çıkıp doğru olan havzalar bozulacaktı.

Yerine üç yapısal parametre kalibre edildi (tools/net_kalibrasyon.py):
etkin derinlik 0-100 cm, pet_carpan 0.80, hizli_pay 0.70. Sonuç, sulama
havzaları dışlanmış 41 havzada:

    küme                          n      r      NSE   yanlılık
    ham katman                   41      -    +0.42      -35%
    kalibre katman               41   0.86    +0.72       +1%
    çapraz doğrulama (5 kat)     41      -    +0.58
    kalibre, sulama dahil        49   0.76    +0.50      +14%

    bölge (kalibre, temiz)        n      r      NSE   yanlılık
    Akdeniz                       6   0.97    +0.82      +12%
    İç Anadolu                    8   0.89    +0.74      -10%
    Karadeniz                    15   0.84    +0.59       -6%
    Ege/Marmara                   9   0.43    +0.01      +18%
    Doğu (Aras)                   3   0.98        -      +44%

KALAN ZAYIFLIKLAR — kapatılmadılar, biliniyorlar:
  - Ege/Marmara, sulama havzaları çıkarıldıktan SONRA da tutmuyor; Susurluk
    ve Meriç-Ergene'de sistematik +70% fazla. Sonuç güzelleşene kadar
    istasyon atmak kalibrasyonu anlamsızlaştıracağı için dokunulmadı.
  - Doğu'da n=3 ve üç gözlem birbirine çok yakın; NSE'nin paydası neredeyse
    sıfır olduğu için o sayı yorumlanamaz, gerçek bilgi %44 yanlılıktır.
    Kar egemen havzalar — derece-gün katsayısı (2.5 mm/°C/gün) kalibre
    EDİLMEDİ, sabit duruyor.
  - Türkiye sınırında akış katsayısı 0.379 (DSİ su bütçesinde 186/501 =
    0.371). Hacim yine de 219 km³ çıkıyor, DSİ'nin 186'sına karşı; fark
    tümüyle YAĞIŞTAN geliyor (CHELSA 740 mm, MGM/DSİ 574 mm), akış
    üretiminden değil.

Kullanım:
    python tools/net_yagis_dogrulama.py [--en-az-yil 20] [--sinir 40]
"""
import argparse
import math
import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

ILK_YIL, SON_YIL = 1981, 2010          # CHELSA 1981-2010 ile aynı pencere
EN_AZ_ALAN, EN_COK_ALAN = 50.0, 5000.0
ALAN_TOLERANS = 0.20                    # DEM ↔ DSİ alan uyuşmazlığı sınırı
SANIYE_YIL = 31_556_952.0

# DSİ havza numarası = istasyon kodu // 100
HAVZA_AD = {
    1: "Meriç-Ergene", 2: "Marmara", 3: "Susurluk", 4: "Kuzey Ege", 5: "Gediz",
    6: "Küçük Menderes", 7: "Büyük Menderes", 8: "Batı Akdeniz", 9: "Antalya",
    10: "Burdur Göller", 11: "Akarçay", 12: "Sakarya", 13: "Batı Karadeniz",
    14: "Yeşilırmak", 15: "Kızılırmak", 16: "Konya Kapalı", 17: "Doğu Akdeniz",
    18: "Seyhan", 19: "Asi", 20: "Ceyhan", 21: "Fırat-Dicle",
    22: "Doğu Karadeniz", 23: "Çoruh", 24: "Aras", 25: "Van Gölü",
}
BOLGE = {
    13: "Karadeniz", 14: "Karadeniz", 22: "Karadeniz", 23: "Karadeniz",
    8: "Akdeniz", 9: "Akdeniz", 17: "Akdeniz", 18: "Akdeniz", 19: "Akdeniz",
    20: "Akdeniz",
    4: "Ege/Marmara", 5: "Ege/Marmara", 6: "Ege/Marmara", 7: "Ege/Marmara",
    1: "Ege/Marmara", 2: "Ege/Marmara", 3: "Ege/Marmara",
    10: "İç Anadolu", 11: "İç Anadolu", 12: "İç Anadolu", 15: "İç Anadolu",
    16: "İç Anadolu",
    21: "Doğu/G.Doğu", 24: "Doğu/G.Doğu", 25: "Doğu/G.Doğu",
}


# ---------------------------------------------------------------- istatistik
def mann_kendall(x):
    """Gidiş testi. -> Z (|Z| ≥ 1.96 %5 düzeyinde anlamlı)."""
    n = len(x)
    if n < 10:
        return 0.0
    s = sum(_isaret(x[j] - x[i]) for i in range(n - 1) for j in range(i + 1, n))
    # bağlı gözlem düzeltmeli varyans
    sayim = {}
    for v in x:
        sayim[v] = sayim.get(v, 0) + 1
    duzelt = sum(t * (t - 1) * (2 * t + 5) for t in sayim.values() if t > 1)
    var = (n * (n - 1) * (2 * n + 5) - duzelt) / 18.0
    if var <= 0:
        return 0.0
    return (s - _isaret(s)) / math.sqrt(var)


def _isaret(v):
    return (v > 0) - (v < 0)


def pettitt(x):
    """Sıçrama testi. -> (kırılma indisi, yaklaşık p)."""
    n = len(x)
    if n < 10:
        return None, 1.0
    en_iyi, k_en = 0, 0
    u = 0
    for t in range(n - 1):
        u += sum(_isaret(x[t] - x[j]) for j in range(n))
        if abs(u) > abs(en_iyi):
            en_iyi, k_en = u, t
    k = abs(en_iyi)
    p = 2.0 * math.exp(-6.0 * k * k / (n ** 3 + n ** 2))
    return k_en, min(1.0, p)


# ------------------------------------------------------------------- gözlem
def yillik_akim(su, kod):
    """1981-2010 penceresindeki TAM su yılları -> {yıl: Q_ort m³/s}."""
    y = su.yillik(kod, ILK_YIL, SON_YIL)
    return {sy: d["q"] for sy, d in y.items() if d["tam"]}


def adaylar(db, en_az_yil):
    sor = """SELECT kod, ad, lat, lon, alan_km2, ilk_tarih, son_tarih
             FROM istasyon
             WHERE alan_km2 BETWEEN ? AND ?
               AND ilk_tarih <= '1985-10-01' AND son_tarih >= '2005-09-30'
             ORDER BY kod"""
    return db.execute(sor, (EN_AZ_ALAN, EN_COK_ALAN)).fetchall()


SNAP_MERDIVEN = (500.0, 1000.0, 2000.0, 3500.0)


def _havza_bul(gis, lat, lon, hedef_alan):
    """DSİ'nin bildirdiği alanı HEDEF alarak doğru kola kenetlenir.

    Varsayılan 500 m'lik kenetleme, AGİ koordinatı ana yataktan bir kilometre
    kayan büyük havzalarda küçük bir yan kola oturuyor ve havzayı 1642 km²
    yerine 5 km² veriyordu — ilk koşuda 36 istasyonun 14'ü böyle düştü.
    Yarıçap kademeli büyütülür, DSİ alanına en yakın sonuç seçilir.

    Bu bir "sonucu istediğim yere çekme" değil: kalibre edilen büyüklük akış
    değil, ÖLÇÜM NOKTASININ YERİdir; alan bağımsız olarak DSİ'den bilinir.
    Yine de %20 toleransı geçen bir eşleşme yoksa istasyon dışlanır — büyük
    yarıçap komşu nehre atlayabilir ve bunun sessizce kabulü karşılaştırmayı
    bozardı.
    """
    en_iyi, en_iyi_sapma, en_iyi_snap = None, 9.9, None
    for snap in SNAP_MERDIVEN:
        try:
            h = gis.delineate(lat, lon, river_km2=1.0, snap_m=snap)
        except Exception:
            continue
        sapma = abs(h["alan_km2"] - hedef_alan) / hedef_alan
        if sapma < en_iyi_sapma:
            en_iyi, en_iyi_sapma, en_iyi_snap = h, sapma, snap
        if sapma <= ALAN_TOLERANS:
            break
    if en_iyi_sapma > ALAN_TOLERANS:
        return None, en_iyi_sapma, en_iyi_snap
    return en_iyi, en_iyi_sapma, en_iyi_snap


# -------------------------------------------------------------------- akış
def calis(en_az_yil, sinir, bolge_basi):
    from backend.core import su, yagis, gis

    if not yagis.var_mi("net"):
        raise SystemExit("net katmanı yok — önce tools/yagis_haritasi_indir.py")

    db = sqlite3.connect(os.path.join(ROOT, "data", "su", "su.sqlite"))
    ham = adaylar(db, en_az_yil)
    print(f"{len(ham)} istasyon {EN_AZ_ALAN:.0f}-{EN_COK_ALAN:.0f} km² "
          f"ve kayıt penceresi ölçütünü karşılıyor")

    # 1-2. seri elemesi (ucuz) — DEM'e ancak bunu geçenler gider
    gecen, elenen = [], {"kısa": 0, "gidiş": 0, "sıçrama": 0}
    for kod, ad, lat, lon, alan, t1, t2 in ham:
        yil = yillik_akim(su, kod)
        if len(yil) < en_az_yil:
            elenen["kısa"] += 1
            continue
        seri = [yil[y] for y in sorted(yil)]
        z = mann_kendall(seri)
        if abs(z) >= 1.96:
            elenen["gidiş"] += 1
            continue
        _, p = pettitt(seri)
        if p < 0.05:
            elenen["sıçrama"] += 1
            continue
        havza_no = int(kod) // 100
        gecen.append(dict(kod=kod, ad=ad, lat=lat, lon=lon, alan=alan,
                          yil=len(yil), q=sum(seri) / len(seri), z=z, p=p,
                          havza=havza_no, bolge=BOLGE.get(havza_no, "?")))
    print(f"  eleme: {elenen['kısa']} kısa kayıt, {elenen['gidiş']} anlamlı gidiş, "
          f"{elenen['sıçrama']} sıçrama  →  {len(gecen)} doğal aday")

    # bölge başına en uzun kayıtlılar — DEM çıkarımı pahalı
    secili = []
    for b in ("Karadeniz", "Akdeniz", "Ege/Marmara", "İç Anadolu", "Doğu/G.Doğu"):
        g = sorted((s for s in gecen if s["bolge"] == b),
                   key=lambda s: -s["yil"])[:bolge_basi]
        secili += g
        print(f"    {b:<12} {len(g)} istasyon")
    secili = secili[:sinir]

    print(f"\n{len(secili)} istasyon için havza çıkarılıyor (DEM)…")
    sonuc = []
    for i, s in enumerate(secili, 1):
        etiket = f"[{i}/{len(secili)}] {s['kod']} {s['ad'][:34]}"
        h, sapma, snap = _havza_bul(gis, s["lat"], s["lon"], s["alan"])
        if h is None:
            print(f"  {etiket}: alan tutturulamadı "
                  f"(en iyi %{sapma*100:.0f}, DSİ {s['alan']:.0f} km²)")
            continue
        alan_dem = h["alan_km2"]
        try:
            o = yagis.havza_ortalamasi(h["havza_geojson"])
        except Exception as e:
            print(f"  {etiket}: katman okunamadı ({str(e)[:40]})")
            continue
        r_gozlem = s["q"] * SANIYE_YIL / (s["alan"] * 1e6) * 1000.0
        s.update(alan_dem=alan_dem,
                 r_gozlem=r_gozlem,
                 p_model=o["yagis"]["ortalama_mm"],
                 net_model=o["net"]["ortalama_mm"],
                 pet_model=o["pet"]["ortalama_mm"])
        s["c_gozlem"] = r_gozlem / s["p_model"]
        s["c_model"] = s["net_model"] / s["p_model"]
        s["geojson"] = h["havza_geojson"]
        sonuc.append(s)
        print(f"  {etiket}: gözlem {r_gozlem:6.0f} — model {s['net_model']:6.0f} mm"
              f"   (alan %{sapma*100:.0f}, kenetleme {snap:.0f} m)")
    return sonuc


# ------------------------------------------------------------------- rapor
def rapor(sonuc):
    if not sonuc:
        print("\nKarşılaştırılabilir istasyon kalmadı.")
        return
    print("\n" + "=" * 108)
    print("AKIŞ YÜKSEKLİĞİ — GÖZLEM (AGİ, 1981-2010 su yılları) ↔ MODEL (net yağış katmanı)")
    print("=" * 108)
    bas = (f"{'AGİ':<6}{'ad':<26}{'havza':<15}{'yıl':>4}{'alan':>7}"
           f"{'P':>6}{'gözlem':>8}{'model':>7}{'fark':>7}{'C_göz':>7}{'C_mod':>7}")
    for bolge in ("Karadeniz", "Akdeniz", "Ege/Marmara", "İç Anadolu", "Doğu/G.Doğu"):
        g = [s for s in sonuc if s["bolge"] == bolge]
        if not g:
            continue
        print(f"\n— {bolge} —")
        print(bas)
        for s in sorted(g, key=lambda s: -s["r_gozlem"]):
            f = (s["net_model"] - s["r_gozlem"]) / s["r_gozlem"] * 100
            print(f"{s['kod']:<6}{s['ad'][:25]:<26}{HAVZA_AD.get(s['havza'],'?'):<15}"
                  f"{s['yil']:>4}{s['alan']:>7.0f}{s['p_model']:>6.0f}"
                  f"{s['r_gozlem']:>8.0f}{s['net_model']:>7.0f}{f:>+6.0f}%"
                  f"{s['c_gozlem']:>7.2f}{s['c_model']:>7.2f}")
        _ozet(g, "  bölge")
    print("\n" + "=" * 108)
    _ozet(sonuc, "TÜMÜ")
    _skor(sonuc)


def _ozet(g, etiket):
    og = sum(s["r_gozlem"] for s in g) / len(g)
    om = sum(s["net_model"] for s in g) / len(g)
    print(f"{etiket}: n={len(g)}  gözlem {og:.0f} mm  model {om:.0f} mm  "
          f"yanlılık {(om-og)/og*100:+.0f}%  "
          f"C gözlem {sum(s['c_gozlem'] for s in g)/len(g):.2f} / "
          f"model {sum(s['c_model'] for s in g)/len(g):.2f}")


def _skor(sonuc):
    n = len(sonuc)
    g = [s["r_gozlem"] for s in sonuc]
    m = [s["net_model"] for s in sonuc]
    og, om = sum(g) / n, sum(m) / n
    rmse = math.sqrt(sum((a - b) ** 2 for a, b in zip(m, g)) / n)
    mutlak = sum(abs(a - b) / b for a, b in zip(m, g)) / n * 100
    sg = math.sqrt(sum((v - og) ** 2 for v in g) / n)
    sm = math.sqrt(sum((v - om) ** 2 for v in m) / n)
    kov = sum((a - og) * (b - om) for a, b in zip(g, m)) / n
    r = kov / (sg * sm) if sg and sm else 0.0
    nse = 1 - sum((a - b) ** 2 for a, b in zip(m, g)) / sum((v - og) ** 2 for v in g)
    print(f"       r={r:.3f}  NSE={nse:.3f}  RMSE={rmse:.0f} mm  "
          f"ortalama mutlak sapma %{mutlak:.0f}")


OLCUT_DOSYA = os.path.join(ROOT, "data", "yagis", "dogrulama_havzalar.json")


def yeniden_oku():
    """Kayıtlı havzaları KATMANIN ŞU ANKİ HALİNE karşı yeniden ölçer.

    Havza çıkarımı istasyon başına dakikalar sürüyor; katman her yeniden
    üretildiğinde bunu tekrarlamanın anlamı yok — poligonlar ve gözlenen
    akışlar değişmiyor, yalnız model değeri değişiyor.

    Bu, kalibrasyonun bellekteki bütçesini değil YAZILMIŞ RASTERİ okur:
    ölçek, nodata ve yazma adımı da böylece sınanmış olur.
    """
    import json
    from backend.core import yagis

    with open(OLCUT_DOSYA, encoding="utf-8") as f:
        havzalar = json.load(f)
    out = []
    for s in havzalar:
        o = yagis.havza_ortalamasi(s["geojson"])
        s["p_model"] = o["yagis"]["ortalama_mm"]
        s["net_model"] = o["net"]["ortalama_mm"]
        s["pet_model"] = o["pet"]["ortalama_mm"]
        s["c_gozlem"] = s["r_gozlem"] / s["p_model"]
        s["c_model"] = s["net_model"] / s["p_model"]
        out.append(s)
    print(f"{len(out)} havza kayıtlı poligonlardan yeniden ölçüldü "
          f"(katman: data/yagis/net_tr.tif)")
    return out


def kaydet(sonuc):
    """Havza poligonu + gözlenen akış — kalibrasyon bunu yeniden çıkarmasın.

    DEM çıkarımı istasyon başına 5-60 saniye sürüyor; kalibrasyon yüzlerce
    parametre denemesi yapacak ve her denemede aynı poligonları isteyecek.
    """
    import json
    with open(OLCUT_DOSYA, "w", encoding="utf-8") as f:
        json.dump([{k: v for k, v in s.items() if k != "geojson"}
                   | {"geojson": s["geojson"]} for s in sonuc],
                  f, ensure_ascii=False)
    print(f"\nölçüt kümesi yazıldı: {OLCUT_DOSYA} "
          f"({os.path.getsize(OLCUT_DOSYA)/1e3:.0f} kB, {len(sonuc)} havza)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--en-az-yil", type=int, default=20,
                    help="1981-2010 içinde gerekli TAM su yılı sayısı")
    ap.add_argument("--bolge-basi", type=int, default=8)
    ap.add_argument("--sinir", type=int, default=40)
    ap.add_argument("--yeniden-oku", action="store_true",
                    help="havzaları yeniden çıkarma; kayıtlı poligonları "
                         "katmanın şu anki haline karşı ölç")
    a = ap.parse_args()
    if a.yeniden_oku:
        rapor(yeniden_oku())
    else:
        s = calis(a.en_az_yil, a.sinir, a.bolge_basi)
        rapor(s)
        if s:
            kaydet(s)
