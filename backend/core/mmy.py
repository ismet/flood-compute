# -*- coding: utf-8 -*-
"""Muhtemel Maksimum Yağış (MMY / PMP) — Hershfield yöntemi.

`Tablo 22 Binkılıç Mİ MMY Hesabı.xlsm` ve Karamandere raporunun T7.3 sayfası
ile aynı hesap. İstasyonun 1 günlük yıllık en büyük yağış serisinden:

    MMY = Port·M1ort·M2ort  +  Km · S·M1s·M2s

  Port, S : serinin ortalaması ve standart sapması
  M1      : en büyük gözlemin ortalamayı/sapmayı şişirmesini düzelten katsayı
            (Hershfield abakları; ortalama ve sapma için ayrı)
  M2      : kayıt uzunluğu düzeltmesi (yine abaktan, N'e bağlı)
  Km      : bölgesel zarf eğrisinden, DÜZELTİLMİŞ ortalamaya göre okunur

Km EĞRİLERİ: `data/tables/mmy_km.json`, kaynak Excel'in "X-KM" sayfasından
çıkarıldı — 9 bölge için sayısallaştırılmış zarflar. Okuma, Excel'in LOOKUP'ı
gibi basamak biçimindedir (x'i aşmayan son nokta); doğrusal interpolasyon
kullanılırsa Excel'le birebir tutmaz.

M1/M2 HAKKINDA: Kaynak dosyada bu katsayılar hücrede formül değil, makro/elle
yazılmış değerlerdir; abakların sayısal karşılığı dosyada yok. Bu yüzden burada
GİRDİ olarak alınırlar (varsayılan 1.0) ve hesaplanan oranlar (Port(-Pmax)/Port,
S(-Pmax)/S) ile N birlikte döndürülür — kullanıcı abaktan okuyup girer.
Uydurma bir eğri koymak, sonucu sessizce kaydırırdı.

1.13 KATSAYISI: Sabit saatte okunan günlük yağışı gerçek 24 saatlik maksimuma
çeviren katsayı. Kaynak dosyada uygulanmamış ("MMY 1,13 ile çarpılmamıştır");
burada da varsayılan kapalıdır.
"""
import math

from . import tables

GUN_24_SAAT_KATSAYISI = 1.13


def bolgeler():
    """Km zarf eğrisi tanımlı bölgeler (no, ad)."""
    return tables.load("mmy_km")["bolgeler"]


def km_oku(bolge_no, x_mm):
    """Bölgesel zarf eğrisinden Km. Excel LOOKUP'ı gibi basamak okuması."""
    t = tables.load("mmy_km")["egriler"]
    e = t.get(str(int(bolge_no)))
    if not e:
        raise ValueError(f"Km eğrisi olmayan bölge: {bolge_no}")
    xs, kms = e["x"], e["km"]
    son = kms[0]
    for a, b in zip(xs, kms):
        if a <= x_mm:
            son = b
        else:
            break
    return son


def _std(v):
    """Örnek standart sapması (n-1) — Excel STDEV."""
    n = len(v)
    m = sum(v) / n
    return math.sqrt(sum((x - m) ** 2 for x in v) / (n - 1))


def hesapla(p, bolge_no, m1_ort=1.0, m2_ort=1.0, m1_s=1.0, m2_s=1.0,
            gun_katsayisi=False, istasyon=""):
    """p: 1 günlük yıllık en büyük yağışlar (mm). -> Hershfield hesap bloğu."""
    v = [float(x) for x in p if x is not None and float(x) > 0]
    if len(v) < 3:
        raise ValueError("MMY hesabı için en az 3 yıllık veri gerekir")
    n = len(v)
    pmax = max(v)
    kalan = sorted(v)[:-1]                      # en büyük gözlem çıkarılmış seri

    port = sum(v) / n
    port_x = sum(kalan) / len(kalan)
    s = _std(v)
    s_x = _std(kalan) if len(kalan) > 2 else 0.0

    port_d = port * m1_ort * m2_ort             # düzeltilmiş ortalama
    s_d = s * m1_s * m2_s                       # düzeltilmiş standart sapma
    km = km_oku(bolge_no, port_d)               # Km, DÜZELTİLMİŞ ortalamaya göre
    mmy = port_d + km * s_d
    if gun_katsayisi:
        mmy *= GUN_24_SAAT_KATSAYISI

    ad = next((b["ad"] for b in bolgeler() if b["no"] == int(bolge_no)), "")
    return {
        "istasyon": istasyon,
        "yil_sayisi": n,
        "toplam": sum(v),
        "toplam_pmaxsiz": sum(kalan),
        "pmax": pmax,
        "ortalama": port,
        "ortalama_pmaxsiz": port_x,
        "ortalama_orani": port_x / port if port else None,
        "standart_sapma": s,
        "standart_sapma_pmaxsiz": s_x,
        "standart_sapma_orani": s_x / s if s else None,
        "m1_ort": m1_ort, "m2_ort": m2_ort, "m1_s": m1_s, "m2_s": m2_s,
        "duzeltilmis_ortalama": port_d,
        "duzeltilmis_standart_sapma": s_d,
        "bolge_no": int(bolge_no), "bolge_adi": ad,
        "km": km,
        "gun_katsayisi": GUN_24_SAAT_KATSAYISI if gun_katsayisi else 1.0,
        "mmy": mmy,
    }
