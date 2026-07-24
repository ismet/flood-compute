# -*- coding: utf-8 -*-
"""YZD (yağış alansal dağılım) bölgesini havza konumundan otomatik bulur.

`data/regions/YZD_ALANLAR.kmz` içindeki A/B/C bölge poligonları okunur; havza
poligonuyla en çok alan örtüşmesi olan bölge seçilir (havza sınıra denk gelirse
ağırlıklı çoğunluk). Nokta için basit içerme sınaması yapılır.
"""
import io
import os
import re
import xml.etree.ElementTree as ET
import zipfile
from functools import lru_cache

from shapely.geometry import Point, Polygon, shape
from shapely.ops import unary_union

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REGION_DIR = os.path.join(ROOT, "data", "regions")


def _find_kmz():
    for d in (REGION_DIR, ROOT):
        if os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                if "yzd" in f.lower() and f.lower().endswith((".kmz", ".kml")):
                    return os.path.join(d, f)
    return None


def _polys_from_placemark(pm, ns):
    """Placemark içindeki tüm Polygon dış sınırlarını Shapely Polygon olarak döner."""
    out = []
    for poly in pm.findall(".//{*}Polygon"):
        ring = poly.find(".//{*}outerBoundaryIs/{*}LinearRing/{*}coordinates")
        if ring is None or not ring.text:
            continue
        pts = []
        for tok in ring.text.split():
            parts = tok.split(",")
            if len(parts) >= 2:
                pts.append((float(parts[0]), float(parts[1])))
        if len(pts) >= 3:
            out.append(Polygon(pts))
    return out


@lru_cache(maxsize=1)
def load_regions():
    """{'A': geom, 'B': geom, 'C': geom} — bölge etiketine göre birleşik poligon."""
    path = _find_kmz()
    if not path:
        raise RuntimeError("YZD bölge dosyası bulunamadı (data/regions/YZD_ALANLAR.kmz)")
    with open(path, "rb") as f:
        data = f.read()
    if data[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            kml = z.read(next(n for n in z.namelist() if n.lower().endswith(".kml")))
    else:
        kml = data
    txt = kml.decode("utf-8", "replace")
    # Google Earth'ün bildirmediği önekleri kök etikete ekle (thiessen ile aynı yama)
    used = set(re.findall(r"[<\s]([A-Za-z_][\w.-]*):", txt)) - {"xmlns", "http", "https"}
    declared = set(re.findall(r"xmlns:([\w.-]+)", txt)) | {"xml"}
    missing = used - declared
    if missing:
        decls = "".join(f' xmlns:{p}="urn:x-ignore:{p}"' for p in missing)
        txt = re.sub(r"<kml\b", "<kml" + decls, txt, count=1)
    root = ET.fromstring(txt)

    groups = {}
    for pm in root.findall(".//{*}Placemark"):
        name_el = pm.find("{*}name")
        label = (name_el.text or "").strip().upper() if name_el is not None else ""
        if label not in ("A", "B", "C"):
            continue
        polys = _polys_from_placemark(pm, None)
        if polys:
            groups.setdefault(label, []).extend(polys)
    if not groups:
        raise RuntimeError("YZD bölge poligonu okunamadı (A/B/C bulunamadı)")
    return {k: unary_union(v).buffer(0) for k, v in groups.items()}


def detect(basin_geojson=None, lat=None, lon=None):
    """Havza poligonundan (veya nokta lat/lon) YZD bölgesini bulur.

    Dönen: {"bolge": "A/B/C", "yontem": "...", "ortusme": {A,B,C alan payları}}
    """
    regions = load_regions()
    overlaps = {}
    result = {"bolge": None, "yontem": None, "ortusme": {}}

    if basin_geojson is not None:
        basin = shape(basin_geojson).buffer(0)
        total = basin.area or 1e-12
        for k, geom in regions.items():
            try:
                a = basin.intersection(geom).area
            except Exception:
                a = 0.0
            overlaps[k] = round(a / total, 4)
        result["ortusme"] = overlaps
        best = max(overlaps, key=overlaps.get)
        if overlaps[best] > 0:
            result["bolge"] = best
            result["yontem"] = "havza örtüşmesi (alan ağırlıklı)"
            return result
        # havza hiçbir bölgeyle örtüşmüyorsa merkeze en yakın bölgeye düş
        lat = lat if lat is not None else basin.centroid.y
        lon = lon if lon is not None else basin.centroid.x

    if lat is not None and lon is not None:
        p = Point(lon, lat)
        for k, geom in regions.items():
            if geom.contains(p):
                result["bolge"] = k
                result["yontem"] = "nokta içerme"
                return result
        # içermiyorsa en yakın bölge
        nearest = min(regions, key=lambda k: regions[k].distance(p))
        result["bolge"] = nearest
        result["yontem"] = "en yakın bölge (nokta dışarıda)"
        return result

    raise RuntimeError("Bölge tespiti için havza poligonu veya lat/lon gerekli")
