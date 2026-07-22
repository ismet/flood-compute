# -*- coding: utf-8 -*-
"""CORINE 2018'i EEA'nın herkese açık CLC2018 MapServer'ından indirir.

Havza bbox'ı için ~100 m çözünürlükte görüntü çekilir (EPSG:3857), resmi CLC
lejand renkleri sınıf koduna (111..523) çevrilir ve sonuç data/corine/cache
altına kod değerli GeoTIFF olarak önbelleklenir (tekrar kullanım için).
"""
import hashlib
import os

import numpy as np
import requests

from . import tables

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE_DIR = os.path.join(ROOT, "data", "corine", "cache")
EXPORT_URL = ("https://image.discomap.eea.europa.eu/arcgis/rest/services/"
              "Corine/CLC2018_WM/MapServer/export")
RES_M = 100.0        # hedef çözünürlük (CORINE orijinali 100 m)
MAX_PX = 2000        # servis tek istekte ~4096 px sınırı; 2000 px @ 100 m = 200 km yeterli
COLOR_TOL = 12       # anti-aliasing için en yakın renk toleransı (kanal başına)


def _color_lut():
    """RGB -> kod eşlemesi (dizi olarak)."""
    tab = tables.load("clc_colors")["renkler"]
    codes = np.array([int(k) for k in tab], dtype=np.int32)
    cols = np.array([v for v in tab.values()], dtype=np.int16)
    return codes, cols


def _classify_rgb(rgb, alpha=None):
    """(H,W,3) RGB görüntüyü sınıf kodlarına çevirir; eşleşmeyen/şeffaf -> 0."""
    codes, cols = _color_lut()
    h, w, _ = rgb.shape
    flat = rgb.reshape(-1, 3).astype(np.int16)
    # her piksel için en yakın lejand rengi (44 renk — bellek dostu döngü)
    best_d = np.full(flat.shape[0], 10 ** 9, dtype=np.int32)
    best_i = np.zeros(flat.shape[0], dtype=np.int32)
    for i, c in enumerate(cols):
        d = np.abs(flat - c).sum(axis=1).astype(np.int32)
        m = d < best_d
        best_d[m] = d[m]
        best_i[m] = i
    out = codes[best_i]
    out[best_d > COLOR_TOL * 3] = 0
    out = out.reshape(h, w)
    if alpha is not None:
        out[alpha < 128] = 0
    return out.astype(np.int16)


def _bbox_3857(bbox_wgs84):
    from pyproj import Transformer
    tr = Transformer.from_crs(4326, 3857, always_xy=True)
    w, s, e, n = bbox_wgs84
    x1, y1 = tr.transform(w, s)
    x2, y2 = tr.transform(e, n)
    return x1, y1, x2, y2


def fetch_classified(bbox_wgs84, pad_ratio=0.05):
    """bbox (w,s,e,n WGS84) için kod değerli raster döner: (arr, transform, crs_epsg).

    Sonuç önbelleklenir; aynı bbox tekrar istenirse indirme yapılmaz.
    """
    import rasterio
    from rasterio.io import MemoryFile
    from rasterio.transform import from_bounds

    w, s, e, n = bbox_wgs84
    pw, ph = (e - w) * pad_ratio, (n - s) * pad_ratio
    bbox_wgs84 = (w - pw, s - ph, e + pw, n + ph)

    key = hashlib.md5(("clc2018|%.4f|%.4f|%.4f|%.4f" % bbox_wgs84).encode()).hexdigest()[:12]
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache = os.path.join(CACHE_DIR, f"clc2018_{key}.tif")
    if os.path.exists(cache):
        with rasterio.open(cache) as src:
            return src.read(1), src.transform, 3857

    x1, y1, x2, y2 = _bbox_3857(bbox_wgs84)
    px_w = int((x2 - x1) / RES_M)
    px_h = int((y2 - y1) / RES_M)
    scale = max(px_w / MAX_PX, px_h / MAX_PX, 1.0)
    px_w = max(2, int(px_w / scale))
    px_h = max(2, int(px_h / scale))

    r = requests.get(EXPORT_URL, params={
        "bbox": f"{x1},{y1},{x2},{y2}",
        "bboxSR": "3857", "imageSR": "3857",
        "size": f"{px_w},{px_h}",
        "format": "png32", "transparent": "true", "f": "image",
    }, timeout=180)
    if r.status_code != 200 or not r.content[:8].startswith(b"\x89PNG"):
        raise RuntimeError(
            "EEA CLC2018 servisinden görüntü alınamadı "
            f"(HTTP {r.status_code}). Yerel CORINE rasteri kullanın (data/corine/).")

    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", rasterio.errors.NotGeoreferencedWarning)
        with MemoryFile(r.content) as mf, mf.open() as src:
            bands = src.read()
    rgb = np.transpose(bands[:3], (1, 2, 0))
    alpha = bands[3] if bands.shape[0] > 3 else None
    codes = _classify_rgb(rgb, alpha)
    transform = from_bounds(x1, y1, x2, y2, codes.shape[1], codes.shape[0])

    with rasterio.open(cache, "w", driver="GTiff", height=codes.shape[0],
                       width=codes.shape[1], count=1, dtype="int16",
                       crs="EPSG:3857", transform=transform, nodata=0,
                       compress="deflate") as dst:
        dst.write(codes, 1)
    return codes, transform, 3857
