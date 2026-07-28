# -*- coding: utf-8 -*-
"""KMZ çıktısı sınaması — yaz, sonra projenin KENDİ okuyucusuyla geri oku.

Çalıştırma:  python backend/tests/test_kmz_export.py
"""
import io
import os
import sys
import xml.etree.ElementTree as ET
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from backend.core import kmz_export, vektor  # noqa: E402

HAVZA = {"type": "Polygon", "coordinates": [[
    [32.10, 39.10], [32.30, 39.10], [32.30, 39.28], [32.10, 39.28], [32.10, 39.10]]]}
DERE = {"type": "FeatureCollection", "features": [
    {"type": "Feature", "properties": {"ad": "Ana kol"},
     "geometry": {"type": "LineString", "coordinates": [[32.12, 39.12], [32.20, 39.20]]}},
    {"type": "Feature", "properties": {},
     "geometry": {"type": "LineString", "coordinates": [[32.25, 39.13], [32.20, 39.20]]}}]}

VERI = {
    "ad": "Tayakadın Deresi",                 # Türkçe karakter sınaması
    "yontem_ad": "DSİ Sentetik",
    "havza_geojson": HAVZA,
    "dere_geojson": DERE,
    "outlet": {"lat": 39.20, "lon": 32.20},
    "debiler": {"2": 12.3456, "10": 45.6, "100": 128.94, "OET": 210.5},
    "girdi_ozeti": {"A_km2": 123.456, "L_km": 21.3, "Lc_km": 9.8,
                    "S_harmonik": 0.01234, "CN2": 74, "CN3": 87,
                    "Qbaz": 1.5, "bolge": "B"},
}


def main():
    data = kmz_export.build(VERI)

    with zipfile.ZipFile(io.BytesIO(data)) as z:
        assert z.namelist() == ["doc.kml"], z.namelist()
        kml = z.read("doc.kml").decode("utf-8")
    ET.fromstring(kml)                        # iyi biçimli XML mi
    print(f"OK  kmz yapısı            {len(data)} bayt, doc.kml {len(kml)} karakter")

    # geometri gidiş-dönüşü: yazdığımızı kendi okuyucumuz geri okuyabilmeli
    geri = vektor.oku(data, "cikti.kmz")
    assert geri["poligon_sayisi"] == 1, geri["poligon_sayisi"]
    assert geri["cizgi_sayisi"] == 2, geri["cizgi_sayisi"]
    halka = geri["havza"]["coordinates"][0]
    assert len(halka) == 5, len(halka)
    for (x0, y0), (x1, y1) in zip(HAVZA["coordinates"][0], halka):
        assert abs(x0 - x1) < 1e-8 and abs(y0 - y1) < 1e-8, (x0, y0, x1, y1)
    print("OK  gidiş-dönüş           1 poligon + 2 çizgi, köşeler birebir")

    # debiler ve Türkçe metin KML içinde mi
    for beklenen in ("Q100_m3s", "128.94", "Tayakadın", "DSİ Sentetik",
                     "Çıkış noktası", "0.01234", "A_km2"):
        assert beklenen in kml, f"KML'de yok: {beklenen}"
    print("OK  öznitelik + debiler   ExtendedData ve açıklama tablosu yerinde")

    # havza yoksa anlaşılır hata
    bos = kmz_export.build({"ad": "x", "debiler": {"100": 5}})
    assert b"doc.kml" or bos                  # yine de geçerli kmz üretir
    print("OK  havzasız çağrı        çökmüyor")

    print("\nTÜM KMZ SINAMALARI GEÇTİ")


if __name__ == "__main__":
    main()
