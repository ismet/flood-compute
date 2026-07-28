# -*- coding: utf-8 -*-
"""Koordinatlı raster altlık sınaması (XYZ karo servisi).

Sentetik bir UTM GeoTIFF üretir, ekler, karo ister ve konumunu doğrular.
CRS'i gömülü olan ile dışarıdan verilen (kullanıcının .sdw dosyalarındaki gibi
koordinat sistemi tanımsız tarama) aynı sınırı vermelidir.

Çalıştırma:  python backend/tests/test_raster.py
"""
import io
import math
import os
import sys
import tempfile

import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import from_origin
from rasterio.warp import transform_bounds

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from backend.core import raster  # noqa: E402

# gerçek bir 1/25000 pafta .sdw dosyasındaki georeferansı taklit eder
PIKSEL, X0, Y0, W, H = 3.280461, 276313.0, 4458890.0, 400, 500
UTM = "EPSG:32637"


def _gtiff(crs):
    arr = np.zeros((3, H, W), dtype="uint8")
    arr[0, :, : W // 2] = 220          # sol yarı kırmızı
    arr[2, :, W // 2:] = 220           # sağ yarı mavi
    yol = os.path.join(tempfile.mkdtemp(), "pafta.tif")
    with rasterio.open(yol, "w", driver="GTiff", height=H, width=W, count=3,
                       dtype="uint8", crs=crs,
                       transform=from_origin(X0, Y0, PIKSEL, PIKSEL)) as d:
        d.write(arr)
    return open(yol, "rb").read()


def _karo_no(lon, lat, z):
    n = 2 ** z
    return (int((lon + 180.0) / 360.0 * n),
            int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n))


def main():
    eklenen = []
    try:
        # --- 1) CRS gömülü: sınır bağımsız hesapla doğrulanır
        ham = _gtiff(UTM)
        m1 = raster.ekle(ham, "pafta_crsli.tif")
        eklenen.append(m1["ad"])
        # GeoTIFF DÖNÜŞTÜRÜLMEMELİ: dosya olduğu gibi saklanır (harici GDAL
        # yalnız rasterio'nun açamadığı biçimler için çağrılır)
        saklanan = os.path.join(raster._dizin(), m1["dosya"])
        assert m1["dosya"].endswith(".tif"), m1["dosya"]
        assert os.path.getsize(saklanan) == len(ham), \
            f"GeoTIFF değiştirilmiş: {os.path.getsize(saklanan)} != {len(ham)}"
        print("OK  GeoTIFF dönüşümsüz    dosya birebir saklandı "
              f"({len(ham):,} bayt)")
        bek = transform_bounds(UTM, "EPSG:4326",
                               X0, Y0 - H * PIKSEL, X0 + W * PIKSEL, Y0, densify_pts=21)
        assert abs(m1["sinir"][0][0] - bek[1]) < 1e-9
        assert abs(m1["sinir"][0][1] - bek[0]) < 1e-9
        assert abs(m1["sinir"][1][0] - bek[3]) < 1e-9
        assert abs(m1["sinir"][1][1] - bek[2]) < 1e-9
        print(f"OK  gömülü CRS sınırı     {[[round(v, 5) for v in p] for p in m1['sinir']]}")

        # --- 2) CRS'siz dosya: önce hata, sonra override ile aynı sınır
        try:
            raster.ekle(_gtiff(None), "pafta_crssiz.tif")
            raise AssertionError("CRS'siz dosya hatasız eklendi!")
        except RuntimeError as e:
            assert "koordinat sistemi" in str(e).lower(), e
        m2 = raster.ekle(_gtiff(None), "pafta_crssiz.tif", crs=UTM)
        eklenen.append(m2["ad"])
        assert m2["sinir"] == m1["sinir"], (m2["sinir"], m1["sinir"])
        print("OK  CRS override          gömülü CRS ile birebir aynı sınır")

        # --- 2b) CRS girdisi toleransı: çıplak kod da kabul edilmeli
        # (rasterio'ya doğrudan "23035" verilince "The WKT could not be parsed.
        #  OGR Error code 5" diyordu — kullanıcı EPSG: önekini yazmayabilir)
        for yazim in ("23035", "EPSG:23035", "epsg:23035", " 23035 ", "EPSG 23035"):
            assert raster.crs_coz(yazim).to_string() == "EPSG:23035", yazim
        assert raster.crs_coz("") is None and raster.crs_coz(None) is None
        for bozuk in ("abc", "EPSG:99999999"):
            try:
                raster.crs_coz(bozuk)
                raise AssertionError(f"“{bozuk}” hatasız geçti")
            except RuntimeError as e:
                assert "anlaşılamadı" in str(e), e
        print("OK  CRS girdi toleransı   çıplak kod/önek/boşluk kabul, bozuk girdi anlaşılır hata")

        # --- 3) MrSID: dönüştürücü varsa çevirir, yoksa yol gösteren hata verir
        durum = raster.cevirici_durumu()
        yol, mrsid_var = durum["gdal_translate"], durum["mrsid"]
        try:
            raster.ekle(b"bozuk-sid-verisi", "h48c2_58cut.sid")
            raise AssertionError(".sid hatasız kabul edildi!")
        except RuntimeError as e:
            metin = str(e)
            if mrsid_var:
                assert "dönüşüm" in metin.lower(), metin      # gerçek dönüşüm hatası
                print(f"OK  .sid dönüştürücü      var ({yol}) — bozuk veri reddedildi")
            else:
                assert "MrSID" in metin and "gdal-mrsid" in metin, metin
                print("OK  .sid dönüştürücü yok  kurulum yolu gösteren hata veriyor")
        # ana dosya reddedilince yan dosyalar da temizlenmeli
        assert not [f for f in os.listdir(raster._dizin()) if f.startswith("h48c2")], \
            "başarısız .sid yüklemesinden artık dosya kaldı"

        # --- 3b) yan dosya (world file): georeferans .sdw/.tfw'de olabilir
        import tempfile as tf
        klasor = tf.mkdtemp()
        tif = os.path.join(klasor, "duz.tif")
        with rasterio.open(tif, "w", driver="GTiff", height=H, width=W, count=3,
                           dtype="uint8", crs=None) as d:          # georeferans YOK
            d.write(np.zeros((3, H, W), dtype="uint8") + 128)
        # World file'ın son iki değeri sol-üst pikselin MERKEZİdir (rasterio'nun
        # from_origin'i köşeyi alır) → yarım piksel kaydırarak yaz, yoksa altlık
        # yarım piksel (burada 1.64 m) kayar.
        tfw = (f"{PIKSEL}\n0.0\n0.0\n-{PIKSEL}\n"
               f"{X0 + PIKSEL / 2}\n{Y0 - PIKSEL / 2}\n")
        m3 = raster.ekle(open(tif, "rb").read(), "duz.tif", crs=UTM,
                         yardimci=[("duz.tfw", tfw.encode())])
        eklenen.append(m3["ad"])
        assert m3["sinir"] == m1["sinir"], (m3["sinir"], m1["sinir"])
        print("OK  world file (.tfw)     georeferans yan dosyadan okundu, sınır aynı")

        # --- 4) karo üretimi: zoom arttıkça kapsama artmalı
        g, b = m1["sinir"][0]
        k, d = m1["sinir"][1]
        lat, lon = (g + k) / 2, (b + d) / 2
        onceki = -1.0
        for z in (12, 14, 16):
            xt, yt = _karo_no(lon, lat, z)
            png = raster.karo(m1["ad"], z, xt, yt)
            assert png, f"z={z} karo boş"
            im = Image.open(io.BytesIO(png))
            assert im.size == (256, 256) and im.mode == "RGBA", (im.size, im.mode)
            dolu = float((np.array(im)[..., 3] > 0).mean())
            assert dolu > onceki, f"z={z} kapsama artmadı ({dolu} <= {onceki})"
            onceki = dolu
            print(f"OK  karo z={z:<2}             {len(png):5d} B, dolu oran={dolu:.2f}")

        # --- 5) kapsam dışı karo (Afrika) → None
        xt, yt = _karo_no(20.0, 0.0, 12)
        assert raster.karo(m1["ad"], 12, xt, yt) is None
        print("OK  kapsam dışı karo      None (204 dönecek)")

        # --- 6) CRS override edilen katman da gerçek karo üretiyor mu
        xt, yt = _karo_no(lon, lat, 15)
        assert raster.karo(m2["ad"], 15, xt, yt), "override katmanı boş karo verdi"
        print("OK  override katmanı      karo üretiyor")
    finally:
        for ad in eklenen:
            try:
                raster.sil(ad)
            except Exception:
                pass

    print("\nTÜM RASTER SINAMALARI GEÇTİ")


if __name__ == "__main__":
    main()
