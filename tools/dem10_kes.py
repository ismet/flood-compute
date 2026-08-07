# -*- coding: utf-8 -*-
"""Ulusal 10 m DEM'den bölge kesiti -> data/dem10/*.tif (depoyla taşınır)

Kaynak (`tr10clip.img`, 23.5 GB, 11.8 milyar hücre, ED50 Lambert) depoya
konamaz: GitHub'ın dosya başına 100 MB sınırının 236 katı, Git LFS'in 2 GB
sınırının 12 katı. Ama çalışılan bölgenin kesiti ucuz — ölçüldü:

    bir havza + 500 m tampon      363 bin hücre     0.1 MB
    ~25×25 km                     6.3 M hücre       2.3 MB
    ~55×55 km                    30.4 M hücre      11.1 MB

Bu araç kesiti WGS84'e döndürüp sıkıştırılmış GeoTIFF olarak yazar. Kesit
depoda olduğunda 10 m seçeneği, kaynağın bulunmadığı makinelerde de (deploy
dahil) çalışır — `gis._kesit_bul` önce kesitlere bakar.

KESİTLER data/dem/ İÇİNE KONMAZ. Orası 30 m havuzu ve `get_dem_mosaic` oradaki
dosyaları merge ediyor; merge karışık çözünürlükte ilk dosyanınkini dayattığı
için 10 m kesit ya 30 m'ye düşürülür ya da bütün pencereyi 10 m'ye çıkarıp
belleği patlatır. Ayrı klasör bu ikilemi kaldırır.

Kullanım:
    python tools/dem10_kes.py --havza kk_havza.kmz [--tampon 500]
    python tools/dem10_kes.py --bbox 28.60 37.00 29.22 37.50 --ad beyagac
"""
import argparse
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from backend.core import gis  # noqa: E402

HEDEF_DIZIN = os.path.join(ROOT, "data", "dem10")
UYARI_MB = 50.0          # bunun üstü depoya konmadan önce düşünülmeli

# İstenen kutuya eklenen emniyet payı. Kesit, uygulamanın SONRADAN isteyeceği
# pencereyi tümüyle kapsamak zorunda (`gis._kesit_bul` içerme arar); uygulama
# o pencereyi kendi çıkardığı havzadan tam duyarlıkla hesaplar ve elle verilen
# yuvarlak bir kutudan birkaç metre taşabilir. İlk denemede kesit tam bu yüzden
# eşleşmedi. Pay ucuz: 300 m, 0.1 MB'lık bir kesitte birkaç on kilobayt.
EK_PAY_M = 300.0


def _havza_bbox(yol, tampon_m):
    from backend.core import vektor
    with open(yol, "rb") as f:
        d = vektor.oku(f.read(), os.path.basename(yol))
    hz = d["havza"] if isinstance(d, dict) and "havza" in d else d
    koord = hz.get("coordinates") or []
    halkalar = koord if hz.get("type") == "Polygon" else [h for p in koord for h in p]
    xs = [p[0] for h in halkalar for p in h]
    ys = [p[1] for h in halkalar for p in h]
    if not xs:
        sys.exit(f"{yol}: poligon bulunamadı")
    orta = math.radians((min(ys) + max(ys)) / 2.0)
    dlat = tampon_m / 110540.0
    dlon = tampon_m / (111320.0 * max(math.cos(orta), 1e-6))
    return (min(xs) - dlon, min(ys) - dlat, max(xs) + dlon, max(ys) + dlat)


def kes(bbox, ad, max_cells=None):
    import rasterio

    if not (gis.DEM_10M and os.path.exists(gis.DEM_10M)):
        sys.exit(f"10 m kaynağı yok: {gis.DEM_10M}\n"
                 "Bu aracı kaynağın bulunduğu makinede çalıştırın "
                 "(yol: DEM_10M ortam değişkeni).")
    w, s, e, n = bbox
    orta = math.radians((s + n) / 2.0)
    dlat = EK_PAY_M / 110540.0
    dlon = EK_PAY_M / (111320.0 * max(math.cos(orta), 1e-6))
    w, s, e, n = w - dlon, s - dlat, e + dlon, n + dlat
    bbox = (w, s, e, n)
    print(f"kesit (+{EK_PAY_M:.0f} m emniyet payı): "
          f"{w:.4f}..{e:.4f} D, {s:.4f}..{n:.4f} K")
    gecici = gis._10m_pencere(bbox, max_cells=max_cells)
    try:
        with rasterio.open(gecici) as src:
            arr = src.read(1)
            profil = src.profile.copy()
        os.makedirs(HEDEF_DIZIN, exist_ok=True)
        hedef = os.path.join(HEDEF_DIZIN, f"dem10_{ad}.tif")
        profil.update(compress="deflate", predictor=2, tiled=True,
                      blockxsize=256, blockysize=256)
        with rasterio.open(hedef, "w", **profil) as dst:
            dst.write(arr, 1)
    finally:
        os.unlink(gecici)

    # 10 m'nin işe yaradığı ölçek: havza çıkarımı MAX_CELLS ile sınırlı, 10 m'de
    # hücre sayısı onu aşınca DEM kabalaştırılır ve fiilen 30 m'ye döner.
    alan_km2 = ((e - w) * 111320 * math.cos(math.radians((s + n) / 2))
                * (n - s) * 110540) / 1e6
    sinir = gis.MAX_CELLS * 100.0 / 1e6
    if alan_km2 > 8 * sinir:
        etkin = 10 * (alan_km2 * 1e4 / gis.MAX_CELLS) ** 0.5
        print(f"\n⚠ Kesit ~{alan_km2:,.0f} km². Bu ölçekte 10 m, hücre sınırı "
              f"yüzünden ~{etkin:.0f} m'ye kabalaştırılır — 30 m ile aynı "
              "sonucu verir. 10 m'nin kazancı kabaca "
              f"{8*sinir:,.0f} km²'nin altındaki havzalarda görülür.")

    mb = os.path.getsize(hedef) / 1e6
    gecerli = arr[arr != profil.get("nodata")]
    print(f"{arr.shape[1]}×{arr.shape[0]} = {arr.size:,} hücre, "
          f"çözünürlük {abs(profil['transform'].e)*110540:.1f} m")
    if gecerli.size:
        print(f"kot {gecerli.min()}–{gecerli.max()} m, veri %{100*gecerli.size/arr.size:.0f}")
    print(f"-> {hedef}  ({mb:.1f} MB)")
    if mb > UYARI_MB:
        print(f"\n⚠ {mb:.0f} MB — GitHub dosya sınırı 100 MB. Depoya eklemeden "
              "önce alanı daraltmayı düşünün; kesitin amacı bir projenin "
              "çalışma bölgesini taşımak, il haritası göndermek değil.")
    return hedef


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--havza", help="KMZ/KML/GeoJSON havza dosyası")
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("B", "G", "D", "K"))
    ap.add_argument("--tampon", type=float, default=500.0,
                    help="havza sınırına eklenecek pay (m)")
    ap.add_argument("--ad", help="çıktı adı (verilmezse dosyadan/bbox'tan türetilir)")
    ap.add_argument("--max-hucre", type=int, default=80_000_000)
    a = ap.parse_args()

    if a.havza:
        bbox = _havza_bbox(a.havza, a.tampon)
        ad = a.ad or os.path.splitext(os.path.basename(a.havza))[0]
    elif a.bbox:
        bbox = tuple(a.bbox)
        ad = a.ad or f"{bbox[0]:.2f}_{bbox[1]:.2f}"
    else:
        ap.error("--havza ya da --bbox verin")
    kes(bbox, "".join(c if c.isalnum() or c in "_-." else "_" for c in ad),
        max_cells=a.max_hucre)
