# -*- coding: utf-8 -*-
"""Havza çıkarımı — alt süreç (subprocess) sürümü.

Bu modül, delineate() fonksiyonunu ayrı bir Python sürecinde çalıştırır;
süreç çıkışında tüm bellek işletim sistemine iade edilir.
"""
import json
import sys


def main():
    # Windows'ta stdout varsayılan cp1252 açılır; Türkçe karakterli çıktı
    # UnicodeEncodeError verir (bkz. çok parçalı havza uyarı metinleri).
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    lat = float(sys.argv[1])
    lon = float(sys.argv[2])
    river_km2 = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
    buffer_deg = float(sys.argv[4]) if len(sys.argv) > 4 else 0.08
    snap_m = float(sys.argv[5]) if len(sys.argv) > 5 else 500.0
    dem_source = sys.argv[6] if len(sys.argv) > 6 else "auto"

    from backend.core.gis import delineate
    result = delineate(lat, lon, buffer_deg=buffer_deg, river_km2=river_km2,
                       snap_m=snap_m, dem_source=dem_source)
    # JSON seri hale getirilebilir formata çevir (GeoJSON __geo_interface__ zaten dict)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
