# -*- coding: utf-8 -*-
"""İçe aktarılan havza sınırından parametre üretimi — alt süreç sürümü.

stdin'den JSON okur: {"havza": <geojson poligon>, "river_km2":.., "dem_source":..}
stdout'a params_from_basin_polygon sonucunu JSON yazar.
"""
import json
import sys


def main():
    for akis in (sys.stdout, sys.stdin):
        try:
            akis.reconfigure(encoding="utf-8")
        except Exception:
            pass
    req = json.loads(sys.stdin.read())
    from backend.core.gis import params_from_basin_polygon
    res = params_from_basin_polygon(
        req["havza"], river_km2=req.get("river_km2", 1.0),
        dem_source=req.get("dem_source", "auto"),
        dere_gj=req.get("dere"))
    print(json.dumps(res, ensure_ascii=False))


if __name__ == "__main__":
    main()
