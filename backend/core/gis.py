# -*- coding: utf-8 -*-
"""Havza çıkarımı: DEM temini (yerel klasör + Copernicus GLO-30 online),
pyflwdir ile akış yönü/birikim/pit doldurma, havza sınırı, dere ağı,
L, Lc ve harmonik kot profili.
"""
import math
import os

import numpy as np

# Ağır kütüphaneler (pyflwdir→numba, rasterio, shapely) fonksiyon içinden
# yüklenir — bellek tasarrufu için.
# from pyproj import Geod
# from rasterio import features as rfeatures
# from shapely.geometry import LineString, shape
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

# D8 yön kodlaması (pyflwdir/D8 standart) -> (dsatır, dsütun)
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


def get_dem_mosaic(bbox, target_resolution_deg=0.001):
    """bbox (w,s,e,n) kapsayan DEM mozaiğini geçici GeoTIFF olarak döner.

    Önce data/dem altındaki yerel dosyalara bakar; kapsam eksikse
    Copernicus GLO-30 karolarını indirir (data/dem/cache).

    target_resolution_deg: hedef piksel boyutu (derece). Varsayılan 0.001° ≈ 110 m
    (Copernicus GLO-30 orijinali ~0.00027° ≈ 30 m). 3x alt-örnekleme = 9x daha az
    bellek — pyflwdir+numba ile birlikte sığması için gerekli.
    """
    import rasterio
    from rasterio.merge import merge
    from rasterio.transform import Affine
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
    try:
        arr, transform = merge(dss, bounds=(w, s, e, n))
    finally:
        for d in dss:
            d.close()

    # Alt-örnekleme (downsample): hedef çözünürlüğe nearest-neighbor ile
    src_h, src_w = arr.shape[1], arr.shape[2]
    src_res = abs(transform.a)
    if src_res < target_resolution_deg:
        step = max(1, int(round(target_resolution_deg / src_res)))
        arr = arr[:, ::step, ::step]
        transform = Affine(
            transform.a * step, transform.b, transform.c,
            transform.d, transform.e * step, transform.f)

    meta = {
        "height": arr.shape[1], "width": arr.shape[2], "transform": transform,
        "driver": "GTiff", "count": 1, "dtype": "float32", "crs": "EPSG:4326",
        "nodata": None,
    }
    import tempfile
    os.makedirs(CACHE_DIR, exist_ok=True)
    tmp = tempfile.NamedTemporaryFile(suffix='.tif', delete=False, dir=CACHE_DIR)
    tmp.close()
    try:
        with rasterio.open(tmp.name, "w", **meta) as dst:
            dst.write(arr[0].astype("float32"), 1)
    except Exception:
        os.unlink(tmp.name)
        raise
    del arr
    return tmp.name


# ------------------------------------------------------------- havza çıkarımı


def _seg_len_m(lon1, lat1, lon2, lat2):
    _, _, d = _geod().inv(lon1, lat1, lon2, lat2)
    return d


def delineate(lat, lon, buffer_deg=0.08, river_km2=1.0, max_tries=3):
    """Outlet (lat, lon) için havza çıkarımı. GeoJSON + fiziksel parametreler döner."""
    # Bellek kontrolü
    try:
        import resource
        mem_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0
        if mem_mb > 350:
            import gc
            gc.collect()
            mem_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0
            if mem_mb > 450:
                raise RuntimeError(
                    f"Yetersiz bellek ({mem_mb:.0f} MB kullanımda). "
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
    import pyflwdir
    from rasterio import features as rfeatures
    from shapely.geometry import LineString, shape
    from shapely.ops import unary_union

    dem_path = get_dem_mosaic(bbox)

    # DEM'i oku + pit doldur + akış yönü (pyflwdir tek çağrıda)
    import rasterio
    try:
        with rasterio.open(dem_path) as src:
            dem_arr = src.read(1)
            transform = src.transform
    finally:
        os.unlink(dem_path)  # clean up tempfile
    dem_arr = dem_arr.astype(np.float64)
    dem_arr[dem_arr <= -1e6] = np.nan

    # Pit doldurulmuş DEM + D8 akış yönü (tek geçişte)
    dem_raw = dem_arr  # raw elevations (harmonik profil için sakla)
    filled_dem, d8 = pyflwdir.fill_depressions(np.copy(dem_arr), nodata=np.nan)
    flw = pyflwdir.from_array(d8, ftype='d8', transform=transform, latlon=True)
    del d8
    gc.collect()

    acc = flw.upstream_area('cell')

    # hücre alanı (yaklaşık, merkez enlemde)
    dx = abs(transform.a) * 111320.0 * math.cos(math.radians(lat))
    dy = abs(transform.e) * 110540.0
    cell_km2 = dx * dy / 1e6

    # outlet'i yüksek birikime kenetle (~500 m)
    snap_cells = max(3, int(500.0 / dx))
    col, row = int((lon - transform.c) / transform.a), int((lat - transform.f) / transform.e)
    h, w = flw.shape
    r0, r1 = max(0, row - snap_cells), min(h, row + snap_cells + 1)
    c0, c1 = max(0, col - snap_cells), min(w, col + snap_cells + 1)
    win = np.array(acc[r0:r1, c0:c1])
    rr, cc = np.unravel_index(np.argmax(win), win.shape)
    row, col = r0 + rr, c0 + cc
    idx_out = row * w + col
    x_snap, y_snap = transform * (col + 0.5, row + 0.5)

    # havza maskesi
    flw.add_pits(xy=([x_snap], [y_snap]))
    basin_ids = flw.basins(xy=([x_snap], [y_snap]))
    outlet_id = basin_ids[row, col]
    if outlet_id == 0:
        return None
    catch_arr = np.asarray(basin_ids == outlet_id, dtype=bool)
    n_cells = int(catch_arr.sum())
    if n_cells < 4:
        return None
    area_km2 = n_cells * cell_km2

    # havza kenar penceresine değiyor mu?
    touches = (catch_arr[0, :].any() or catch_arr[-1, :].any()
               or catch_arr[:, 0].any() or catch_arr[:, -1].any())

    # havza poligonu
    shapes = list(rfeatures.shapes(catch_arr.astype(np.uint8),
                                   mask=catch_arr, transform=transform))
    poly = unary_union([shape(g) for g, v in shapes]).simplify(abs(transform.a) / 2)
    del shapes
    gc.collect()
    if poly.geom_type == "MultiPolygon":
        poly = max(poly.geoms, key=lambda p: p.area)

    fdir_arr = flw.to_array('d8')
    acc_arr = np.asarray(acc)
    del acc
    gc.collect()

    # ---- en uzun akış yolu: akış mesafesi havza içinde max olan hücreden
    dist_arr = flw.stream_distance(unit='m')
    dist_arr = np.where(catch_arr & np.isfinite(dist_arr), dist_arr, -1)
    head_idx = int(np.argmax(dist_arr))

    path_idxs, _ = flw.path(idxs=np.array([head_idx]))
    path_idxs = np.asarray(path_idxs[0])

    # outlet'e kadar olan kısmı al
    outlet_found = None
    for i in range(len(path_idxs)):
        if path_idxs[i] == idx_out:
            outlet_found = i
            break
    if outlet_found is None:
        outlet_found = len(path_idxs) - 1
    path_idxs = path_idxs[:outlet_found + 1]
    path = [(int(x) // w, int(x) % w) for x in path_idxs]

    xs, ys = flw.xy(path_idxs)
    path_ll = [(float(xs[i]), float(ys[i])) for i in range(len(xs))]
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
    Lc_m = L_m - cum[imin]

    # ---- harmonik profil: yol boyunca 11 eşit aralıklı kot (ham DEM'den)
    prof = []
    for k in range(11):
        target = L_m * k / 10.0
        j = min(range(len(cum)), key=lambda i: abs((L_m - cum[i]) - target))
        r, c = path[j]
        prof.append(float(dem_raw[r, c]))
    del dem_raw, filled_dem
    gc.collect()
    for i in range(1, 11):
        if prof[i] <= prof[i - 1]:
            prof[i] = prof[i - 1] + 0.1

    # ---- dere ağı
    thr = max(30, int(river_km2 / cell_km2))
    riv_mask = (acc_arr >= thr) & catch_arr
    lines = []
    for ri, ci in zip(*np.nonzero(riv_mask)):
        d = int(fdir_arr[ri, ci])
        if d in D8:
            dr, dc = D8[d]
            r2, c2 = ri + dr, ci + dc
            if 0 <= r2 < h and 0 <= c2 < w and riv_mask[r2, c2]:
                p1 = transform * (ci + 0.5, ri + 0.5)
                p2 = transform * (c2 + 0.5, r2 + 0.5)
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
