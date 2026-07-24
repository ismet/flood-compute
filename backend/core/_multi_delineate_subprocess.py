# -*- coding: utf-8 -*-
"""Çok parçalı havza (ara havza) çıkarımı — alt süreç sürümü.

stdin'den JSON okur: {"mansap":{lat,lon}, "membalar":[{lat,lon}], "river_km2":..}
stdout'a multi_delineate sonucunu + ara/memba Tc değerlerini JSON yazar.
"""
import json
import sys


def main():
    req = json.loads(sys.stdin.read())
    from backend.core.gis import multi_delineate
    from backend.core.routing import basin_tc
    res = multi_delineate(req["mansap"], req["membalar"],
                          river_km2=req.get("river_km2", 1.0))
    try:
        res["ara"]["Tc_saat"] = round(basin_tc(res["ara"]["L_km"], res["ara"]["kotlar"]), 3)
    except Exception:
        res["ara"]["Tc_saat"] = None
    for mb in res["membalar"]:
        try:
            mb["Tc_saat"] = round(basin_tc(mb["L_km"], mb["kotlar"]), 3)
        except Exception:
            mb["Tc_saat"] = None
    print(json.dumps(res, ensure_ascii=False))


if __name__ == "__main__":
    main()
