# -*- coding: utf-8 -*-
"""Thiessen poligonları: KMZ/KML'deki meteoroloji istasyonlarından
havza poligonu içinde alan ağırlıkları.
"""
import io
import math
import re
import xml.etree.ElementTree as ET
import zipfile

import numpy as np
from pyproj import Transformer
from scipy.spatial import Voronoi
from shapely.geometry import Polygon, shape

def parse_kmz(data: bytes):
    """KMZ/KML içeriğinden [{name, lat, lon}] listesi (nokta Placemark'lar).

    Namespace'ten bağımsızdır; Google Earth Pro'nun bildirmeden kullandığı
    xsi: gibi önekler için kök etikete eksik bildirimleri ekler.
    """
    if data[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            kml_name = next(n for n in z.namelist() if n.lower().endswith(".kml"))
            xml = z.read(kml_name)
    else:
        xml = data
    txt = xml.decode("utf-8", "replace")
    # bildirilmemiş önekleri kök <kml ...> etiketine ekle (ör. xsi:schemaLocation)
    used = set(re.findall(r"[<\s]([A-Za-z_][\w.-]*):", txt)) - {"xmlns", "http", "https"}
    declared = set(re.findall(r"xmlns:([\w.-]+)", txt)) | {"xml"}
    missing = used - declared
    if missing:
        decls = "".join(f' xmlns:{p}="urn:x-ignore:{p}"' for p in missing)
        txt = re.sub(r"<kml\b", "<kml" + decls, txt, count=1)
    root = ET.fromstring(txt)
    out = []
    for pm in root.findall(".//{*}Placemark"):
        name_el = pm.find("{*}name")
        name = (name_el.text or "").strip() if name_el is not None else f"IST-{len(out)+1}"
        coord_el = pm.find(".//{*}Point/{*}coordinates")
        if coord_el is None or not coord_el.text:
            continue
        first = coord_el.text.strip().split()[0]
        parts = first.split(",")
        lon, lat = float(parts[0]), float(parts[1])
        out.append({"name": name, "lat": lat, "lon": lon})
    return out


def _utm_epsg(lon, lat):
    zone = int((lon + 180) // 6) + 1
    return 32600 + zone if lat >= 0 else 32700 + zone


def weights(basin_geojson, stations):
    """Havza içinde her istasyonun Thiessen alan oranı.

    Dönen ağırlıklar Excel DATAGİR H kolonuna (alan oranı) karşılık gelir.
    """
    basin = shape(basin_geojson)
    cen = basin.centroid
    epsg = _utm_epsg(cen.x, cen.y)
    fwd = Transformer.from_crs(4326, epsg, always_xy=True)

    bx, by = fwd.transform(*basin.exterior.xy) if basin.geom_type == "Polygon" else (None, None)
    basin_m = Polygon(zip(bx, by))
    pts = np.array([fwd.transform(s["lon"], s["lat"]) for s in stations])

    if len(stations) == 1:
        cells = [basin_m]
    else:
        # uzak köşe noktalarıyla sınırlı Voronoi
        cx, cy = basin_m.centroid.x, basin_m.centroid.y
        span = max(basin_m.bounds[2] - basin_m.bounds[0],
                   basin_m.bounds[3] - basin_m.bounds[1],
                   np.ptp(pts[:, 0]) if len(pts) > 1 else 1,
                   np.ptp(pts[:, 1]) if len(pts) > 1 else 1) * 100 + 1e5
        far = [(cx - span, cy - span), (cx + span, cy - span),
               (cx - span, cy + span), (cx + span, cy + span)]
        vor = Voronoi(np.vstack([pts, far]))
        cells = []
        for i in range(len(stations)):
            reg = vor.regions[vor.point_region[i]]
            if -1 in reg or not reg:
                cells.append(Polygon())
                continue
            cells.append(Polygon(vor.vertices[reg]))

    tot = basin_m.area
    inv = Transformer.from_crs(epsg, 4326, always_xy=True)
    out = []
    for s, cell in zip(stations, cells):
        inter = cell.intersection(basin_m) if not cell.is_empty else cell
        w = inter.area / tot if tot > 0 else 0.0
        gj = None
        if not inter.is_empty:
            def to_ll(geom):
                if geom.geom_type == "Polygon":
                    ext = [inv.transform(x, y) for x, y in geom.exterior.coords]
                    return Polygon(ext)
                return None
            if inter.geom_type == "Polygon":
                ll = to_ll(inter)
            else:
                polys = [to_ll(g) for g in inter.geoms if g.geom_type == "Polygon"]
                ll = max(polys, key=lambda p: p.area) if polys else None
            gj = ll.__geo_interface__ if ll else None
        out.append({**s, "agirlik": round(w, 4), "alan_km2": round(inter.area / 1e6, 3),
                    "poligon_geojson": gj})
    # toplam 1'e normalle (havza dışında kalan istasyonlar 0 alır)
    tw = sum(o["agirlik"] for o in out)
    if tw > 0:
        for o in out:
            o["agirlik"] = round(o["agirlik"] / tw, 4)
    return out
