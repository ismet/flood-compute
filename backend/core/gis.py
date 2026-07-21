# -*- coding: utf-8 -*-
"""Havza çıkarımı: DEM temini (yerel klasör + Copernicus GLO-30 online),
pysheds ile akış yönü/birikim, havza sınırı, dere ağı, L, Lc ve harmonik kot profili.
"""
import math
import os

import numpy as np

# pysheds, NumPy 2'de kaldırılan takma adları kullanıyor
if not hasattr(np, "in1d"):
    np.in1d = np.isin
if not hasattr(np, "float_"):
    np.float_ = np.float64

# Ağır kütüphaneler (pysheds→scikit-image→numba→llvmlite, rasterio, shapely)
# fonksiyon içinden yüklenir — 512 MB planında bellek tasarrufu için.
# import requests
# from pyproj import Geod
# from pysheds.grid import Grid
# from rasterio import features as rfeatures
# from shapely.geometry import LineString, Point, shape
# from shapely.ops import unary_union

# GEOD = Geod(ellps="WGS84")
_GEOD = None
def _geod():
    global _GEOD
    if _GEOD is None:
        from pyproj import Geod
        _GEOD = Geod(ellps="WGS84")
    return _GEOD
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEM_DIR = os.path.join(ROOT, "data", "dem")
CACHE_DIR = os.path.join(DEM_DIR, "cache")
COP30_URL = ("https://copernicus-dem-30m.s3.amazonaws.com/"
             "Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM/"
             "Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM.tif")

# D8 yön kodlaması (pysheds varsayılanı) -> (dsatır, dsütun)
D8 = {64: (-1, 0), 128: (-1, 1), 1: (0, 1), 2: (1, 1),
      4: (1, 0), 8: (1, -1), 16: (0, -1), 32: (-1, -1)}


# ------------------------------------------------------------------ DEM temini
def _local_dems():
    import rasterio
    out = []
    if not os.path.isdir(DEM_DIR):
        return out
    for fn in os.listdir(DEM_DIR):
        if fn.lower().endswith((".tif", ".tiff")):
            p = os.path.join(DEM_DIR, fn)
            try:
                with rasterio.open(p) as src:
                    if src.crs and src.crs.to_epsg() == 4326:
                        out.append((p, src.bounds))
            except Exception:
                pass
    return out


def _download_cop30(lat_i, lon_i):
    import requests
    os.makedirs(CACHE_DIR, exist_ok=True)
    ns = "N" if lat_i >= 0 else "S"
    ew = "E" if lon_i >= 0 else "W"
    url = COP30_URL.format(ns=ns, lat=abs(lat_i), ew=ew, lon=abs(lon_i))
    dest = os.path.join(CACHE_DIR, os.path.basename(url))
    if os.path.exists(dest):
        return dest
    r = requests.get(url, timeout=300)
    if r.status_code != 200:
        raise RuntimeError(f"DEM karosu indirilemedi ({r.status_code}): {url}")
    with open(dest, "wb") as f:
        f.write(r.content)
    return dest


def get_dem_mosaic(bbox):
    """bbox (w,s,e,n) kapsayan DEM mozaiğini geçici GeoTIFF olarak döner.

    Önce data/dem altındaki yerel dosyalara bakar; kapsam eksikse
    Copernicus GLO-30 karolarını indirir (data/dem/cache).
    """
    import rasterio
    from rasterio.merge import merge
    from shapely.geometry import shape, box as sbox
    from shapely.ops import unary_union

    w, s, e, n = bbox
    srcs = []
    for p, b in _local_dems():
        if not (b.right < w or b.left > e or b.top < s or b.bottom > n):
            srcs.append(p)
    covered = False
    if srcs:
        u = unary_union([shape({
            "type": "Polygon",
            "coordinates": [[(b.left, b.bottom), (b.right, b.bottom),
                             (b.right, b.top), (b.left, b.top), (b.left, b.bottom)]]})
            for p, b in _local_dems() if p in srcs])
        covered = u.contains(sbox(w, s, e, n))
    if not covered:
        for lat_i in range(math.floor(s), math.floor(n) + 1):
            for lon_i in range(math.floor(w), math.floor(e) + 1):
                try:
                    srcs.append(_download_cop30(lat_i, lon_i))
                except RuntimeError:
                    if not srcs:
                        raise
    if not srcs:
        raise RuntimeError("Bölgeyi kapsayan DEM bulunamadı (yerel yok, indirme başarısız)")
    dss = [rasterio.open(p) for p in srcs]
    arr, transform = merge(dss, bounds=(w, s, e, n))
    meta = dss[0].meta.copy()
    for d in dss:
        d.close()
    meta.update(height=arr.shape[1], width=arr.shape[2], transform=transform,
                driver="GTiff", count=1)
    tmp = os.path.join(CACHE_DIR if os.path.isdir(CACHE_DIR) else DEM_DIR, "_mosaic.tif")
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    with rasterio.open(tmp, "w", **meta) as dst:
        dst.write(arr[0], 1)
    return tmp


# ------------------------------------------------------------- havza çıkarımı
def _path_downstream(fdir, r, c, grid_shape, stop=None):
    """(r,c) hücresinden D8 boyunca mansaba hücre listesi; stop hücresinde durur."""
    path = [(r, c)]
    seen = {(r, c)}
    while (r, c) != stop:
        d = int(fdir[r, c])
        if d not in D8:
            break
        dr, dc = D8[d]
        r, c = r + dr, c + dc
        if not (0 <= r < grid_shape[0] and 0 <= c < grid_shape[1]) or (r, c) in seen:
            break
        path.append((r, c))
        seen.add((r, c))
    return path


def _seg_len_m(lon1, lat1, lon2, lat2):
    _, _, d = _geod().inv(lon1, lat1, lon2, lat2)
    return d


def delineate(lat, lon, buffer_deg=0.08, river_km2=1.0, max_tries=3):
    """Outlet (lat, lon) için havza çıkarımı. GeoJSON + fiziksel parametreler döner."""
    # Bellek kontrolü (Render free planında 512 MB — pysheds ~400 MB gerektirir)
    try:
        import resource
        mem_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0
        if mem_mb > 350:
            import gc
            gc.collect()
            mem_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0
            if mem_mb > 450:
                raise RuntimeError(
                    f"Yetersiz bellek ({mem_mb:.0f} MB kullanımda, pysheds ~400 MB daha gerektirir). "
                    "Render Starter planına (2 GB RAM) yükseltin veya yerel DEM kullanın.")
    except RuntimeError:
        raise
    except Exception:
        pass
    out = None
    for attempt in range(max_tries):
        buf = buffer_deg * (2 ** attempt)
        bbox = (lon - buf, lat - buf, lon + buf, lat + buf)
        res = _delineate_once(lat, lon, bbox, river_km2)
        if res is None:
            continue
        touches, out = res
        if not touches:
            return out
    if out is None:
        raise RuntimeError("Havza çıkarılamadı: tıklanan nokta bir akış yoluna oturmuyor olabilir")
    return out  # en geniş pencere sonucu (kenara değiyorsa uyarıyla)


def _delineate_once(lat, lon, bbox, river_km2):
    import gc
    from pysheds.grid import Grid
    from rasterio import features as rfeatures
    from shapely.geometry import LineString, shape
    from shapely.ops import unary_union

    dem_path = get_dem_mosaic(bbox)
    grid = Grid.from_raster(dem_path)
    dem = grid.read_raster(dem_path)
    pit_filled = grid.fill_pits(dem)
    del dem
    gc.collect()
    flooded = grid.fill_depressions(pit_filled)
    del pit_filled
    gc.collect()
    inflated = grid.resolve_flats(flooded)
    del flooded
    gc.collect()
    fdir = grid.flowdir(inflated)
    del inflated
    gc.collect()
    acc = grid.accumulation(fdir)
    gc.collect()

    # hücre alanı (yaklaşık, merkez enlemde)
    dx = abs(grid.affine.a) * 111320.0 * math.cos(math.radians(lat))
    dy = abs(grid.affine.e) * 110540.0
    cell_km2 = dx * dy / 1e6

    # outlet'i yüksek birikime kenetle (~500 m)
    snap_cells = max(3, int(500.0 / dx))
    col, row = ~grid.affine * (lon, lat)
    col, row = int(col), int(row)
    r0, r1 = max(0, row - snap_cells), min(grid.shape[0], row + snap_cells + 1)
    c0, c1 = max(0, col - snap_cells), min(grid.shape[1], col + snap_cells + 1)
    win = np.asarray(acc)[r0:r1, c0:c1]
    rr, cc = np.unravel_index(np.argmax(win), win.shape)
    row, col = r0 + rr, c0 + cc
    x_snap, y_snap = grid.affine * (col + 0.5, row + 0.5)

    catch = grid.catchment(x=x_snap, y=y_snap, fdir=fdir, xytype="coordinate")
    catch_arr = np.asarray(catch).astype(bool)
    del catch
    n_cells = int(catch_arr.sum())
    if n_cells < 4:
        return None
    area_km2 = n_cells * cell_km2

    # havza kenar penceresine değiyor mu?
    touches = (catch_arr[0, :].any() or catch_arr[-1, :].any()
               or catch_arr[:, 0].any() or catch_arr[:, -1].any())

    # havza poligonu
    shapes = list(rfeatures.shapes(catch_arr.astype(np.uint8),
                                   mask=catch_arr, transform=grid.affine))
    poly = unary_union([shape(g) for g, v in shapes]).simplify(abs(grid.affine.a) / 2)
    del shapes
    gc.collect()
    if poly.geom_type == "MultiPolygon":
        poly = max(poly.geoms, key=lambda p: p.area)

    fdir_arr = np.asarray(fdir)
    acc_arr = np.asarray(acc)
    del fdir, acc
    gc.collect()

    # ---- en uzun akış yolu: havza içi her uç hücreden değil, akış mesafesiyle
    dist = grid.distance_to_outlet(x=x_snap, y=y_snap, fdir=fdir, xytype="coordinate")
    dist_arr = np.asarray(dist)
    del dist
    gc.collect()
    dist_arr = np.where(catch_arr & np.isfinite(dist_arr), dist_arr, -1)
    head = np.unravel_index(np.argmax(dist_arr), dist_arr.shape)
    path = _path_downstream(fdir_arr, head[0], head[1], grid.shape, stop=(row, col))
    path_ll = [tuple(grid.affine * (c + 0.5, r + 0.5)) for r, c in path]
    del dist_arr
    gc.collect()

    # metrik uzunluk (kümülatif)
    cum = [0.0]
    for i in range(1, len(path_ll)):
        cum.append(cum[-1] + _seg_len_m(*path_ll[i - 1], *path_ll[i]))
    L_m = cum[-1]

    # ---- Lc: ana kanal üzerinde ağırlık merkezine en yakın noktaya kadar mesafe
    cen = poly.centroid
    dmin, imin = 1e30, 0
    for i, (px, py) in enumerate(path_ll):
        d = (px - cen.x) ** 2 + (py - cen.y) ** 2
        if d < dmin:
            dmin, imin = d, i
    Lc_m = L_m - cum[imin]  # outlet'ten itibaren

    # ---- harmonik profil: yol boyunca 11 eşit aralıklı kot
    dem_arr = np.asarray(grid.read_raster(dem_path))  # yeniden oku (inflated silindi)
    prof = []
    for k in range(11):
        target = L_m * k / 10.0  # H0=outlet (mesafe 0), H10=memba (mesafe L)
        j = min(range(len(cum)), key=lambda i: abs((L_m - cum[i]) - target))
        r, c = path[j]
        prof.append(float(dem_arr[r, c]))
    del dem_arr
    gc.collect()
    # artan olmaya zorla (Excel gereksinimi)
    for i in range(1, 11):
        if prof[i] <= prof[i - 1]:
            prof[i] = prof[i - 1] + 0.1

    # ---- dere ağı
    thr = max(30, int(river_km2 / cell_km2))
    riv_mask = (acc_arr >= thr) & catch_arr
    lines = []
    for r, c in zip(*np.nonzero(riv_mask)):
        d = int(fdir_arr[r, c])
        if d in D8:
            dr, dc = D8[d]
            r2, c2 = r + dr, c + dc
            if 0 <= r2 < grid.shape[0] and 0 <= c2 < grid.shape[1] and riv_mask[r2, c2]:
                p1 = grid.affine * (c + 0.5, r + 0.5)
                p2 = grid.affine * (c2 + 0.5, r2 + 0.5)
                lines.append(LineString([p1, p2]))
    rivers = unary_union(lines) if lines else None
    del riv_mask, fdir_arr, acc_arr, catch_arr
    gc.collect()

    out = {
        "outlet": {"lat": lat, "lon": lon, "snap_lat": y_snap, "snap_lon": x_snap},
        "alan_km2": round(area_km2, 3),
        "L_km": round(L_m / 1000.0, 3),
        "Lc_km": round(Lc_m / 1000.0, 3),
        "kotlar": [round(p, 1) for p in prof],
        "havza_geojson": poly.__geo_interface__,
        "dere_geojson": rivers.__geo_interface__ if rivers else None,
        "ana_kanal_geojson": LineString(path_ll).__geo_interface__,
        "kenar_uyarisi": bool(touches),
    }
    return touches, out
