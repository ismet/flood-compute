# -*- coding: utf-8 -*-
"""CORINE arazi örtüsünden alansal ağırlıklı CN hesabı.

Öncelik: data/corine altındaki yerel GeoTIFF (havzayı kapsıyorsa).
Yoksa EEA CLC2018 servisinden otomatik indirilir (corine_online).
"""
import os

import numpy as np

from . import corine_online, tables

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CORINE_DIR = os.path.join(ROOT, "data", "corine")

# CORINE grid_code (1..44) -> 3. seviye kod
GRID_TO_CODE = [111, 112, 121, 122, 123, 124, 131, 132, 133, 141, 142,
                211, 212, 213, 221, 222, 223, 231, 241, 242, 243, 244,
                311, 312, 313, 321, 322, 323, 324, 331, 332, 333, 334, 335,
                411, 412, 421, 422, 423, 511, 512, 521, 522, 523]


def _local_rasters():
    if not os.path.isdir(CORINE_DIR):
        return []
    return [os.path.join(CORINE_DIR, fn) for fn in sorted(os.listdir(CORINE_DIR))
            if fn.lower().endswith((".tif", ".tiff"))]


def _aggregate(vals, counts, soil_group):
    """Sınıf kodu/sayım listesinden CN dökümü üretir."""
    tab = tables.load("corine_cn")["siniflar"]
    rows, tot_w, tot_a = [], 0.0, 0
    for v, c in zip(vals, counts):
        v = int(v)
        code = v if v >= 100 else (GRID_TO_CODE[v - 1] if 1 <= v <= 44 else None)
        if code is None or str(code) not in tab:
            continue
        info = tab[str(code)]
        cn = info["cn"][soil_group]
        rows.append({"kod": code, "ad": info["ad"], "hucre": int(c), "cn": cn})
        tot_w += cn * c
        tot_a += c
    if tot_a == 0:
        raise RuntimeError("Havza içinde sınıflandırılmış CORINE hücresi yok")
    for r in rows:
        r["oran"] = round(r["hucre"] / tot_a, 4)
    rows.sort(key=lambda r: -r["hucre"])
    cn2 = tot_w / tot_a
    return {
        "CN2": round(cn2, 1),
        "CN3": round(tables.cn2_to_cn3(cn2), 1),
        "dokum": rows,
    }


def _try_local(basin_geojson, soil_group):
    import rasterio
    from rasterio.mask import mask as rio_mask
    from rasterio.warp import transform_geom
    from shapely.geometry import shape

    for path in _local_rasters():
        try:
            with rasterio.open(path) as src:
                geom = transform_geom("EPSG:4326", src.crs, basin_geojson)
                g = shape(geom)
                b = src.bounds
                if not (b.left <= g.bounds[0] and b.bottom <= g.bounds[1]
                        and b.right >= g.bounds[2] and b.top >= g.bounds[3]):
                    continue
                arr, _ = rio_mask(src, [geom], crop=True, nodata=0)
        except Exception:
            continue
        vals, counts = np.unique(arr[arr > 0], return_counts=True)
        if counts.sum() == 0:
            continue
        res = _aggregate(vals.tolist(), counts.tolist(), soil_group)
        res["kaynak"] = "yerel: " + os.path.basename(path)
        return res
    return None


def _online(basin_geojson, soil_group):
    from rasterio.features import geometry_mask
    from rasterio.warp import transform_geom
    from shapely.geometry import shape

    g = shape(basin_geojson)
    codes, transform, epsg = corine_online.fetch_classified(g.bounds)
    geom = transform_geom("EPSG:4326", f"EPSG:{epsg}", basin_geojson)
    m = geometry_mask([geom], out_shape=codes.shape, transform=transform, invert=True)
    sel = codes[m & (codes > 0)]
    if sel.size == 0:
        raise RuntimeError("Havza EEA CLC2018 görüntüsünde sınıflandırılamadı")
    vals, counts = np.unique(sel, return_counts=True)
    res = _aggregate(vals.tolist(), counts.tolist(), soil_group)
    res["kaynak"] = "online: EEA CLC2018 (100 m)"
    return res


def cn_from_basin(basin_geojson, soil_group="B"):
    """Havza poligonu (WGS84 GeoJSON) için CORINE sınıf dökümü ve ağırlıklı CN.

    Önce yerel raster denenir; kapsam yoksa EEA servisi kullanılır.
    """
    res = _try_local(basin_geojson, soil_group)
    if res is None:
        res = _online(basin_geojson, soil_group)
    res["zemin_grubu"] = soil_group
    return res
