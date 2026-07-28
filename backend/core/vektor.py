# -*- coding: utf-8 -*-
"""Dışarıdan sayısallaştırılmış havza sınırı / dere ağı okuma.

Desteklenen biçimler: GeoJSON (.geojson/.json), KML/KMZ, zip'lenmiş
shapefile (.zip) ve tek .gpkg. Havza olarak en büyük poligon, dere ağı
olarak tüm çizgiler alınır.
"""
import io
import json
import os
import re
import tempfile
import xml.etree.ElementTree as ET
import zipfile


def _kml_koordinatlar(metin):
    """KML <coordinates> metnini [(lon, lat), ...] listesine çevirir."""
    pts = []
    for parca in (metin or "").replace("\n", " ").split():
        alan = parca.split(",")
        if len(alan) >= 2:
            try:
                pts.append((float(alan[0]), float(alan[1])))
            except ValueError:
                pass
    return pts


def _kml_oku(xml_bytes):
    """KML içeriğinden poligon ve çizgileri çıkarır."""
    txt = xml_bytes.decode("utf-8", "replace")
    # bildirilmemiş önekleri kök etikete ekle (Google Earth xsi: gibi)
    used = set(re.findall(r"[<\s]([A-Za-z_][\w.-]*):", txt)) - {"xmlns", "http", "https"}
    declared = set(re.findall(r"xmlns:([\w.-]+)", txt)) | {"xml"}
    eksik = used - declared
    if eksik:
        decls = "".join(f' xmlns:{p}="urn:x-ignore:{p}"' for p in eksik)
        txt = re.sub(r"<kml\b", "<kml" + decls, txt, count=1)
    root = ET.fromstring(txt)
    poligonlar, cizgiler = [], []
    for poly in root.findall(".//{*}Polygon"):
        dis = poly.find(".//{*}outerBoundaryIs//{*}coordinates")
        if dis is None or not dis.text:
            continue
        halka = _kml_koordinatlar(dis.text)
        if len(halka) >= 4:
            poligonlar.append({"type": "Polygon", "coordinates": [halka]})
    for ls in root.findall(".//{*}LineString"):
        co = ls.find("{*}coordinates")
        if co is None or not co.text:
            continue
        pts = _kml_koordinatlar(co.text)
        if len(pts) >= 2:
            cizgiler.append({"type": "LineString", "coordinates": pts})
    return poligonlar, cizgiler


def _geojson_oku(nesne):
    poligonlar, cizgiler = [], []

    def ekle(g):
        if not g:
            return
        t = g.get("type")
        if t == "Polygon":
            poligonlar.append(g)
        elif t == "MultiPolygon":
            for c in g["coordinates"]:
                poligonlar.append({"type": "Polygon", "coordinates": c})
        elif t in ("LineString", "MultiLineString"):
            cizgiler.append(g)
        elif t == "GeometryCollection":
            for gg in g.get("geometries", []):
                ekle(gg)

    t = nesne.get("type")
    if t == "FeatureCollection":
        for f in nesne.get("features", []):
            ekle(f.get("geometry"))
    elif t == "Feature":
        ekle(nesne.get("geometry"))
    else:
        ekle(nesne)
    return poligonlar, cizgiler


def _fiona_oku(veri, ad):
    """Shapefile(zip)/GPKG gibi biçimleri fiona ile okur (EPSG:4326'ya çevirir)."""
    import fiona
    from fiona.transform import transform_geom
    uzanti = ".zip" if ad.lower().endswith(".zip") else os.path.splitext(ad)[1] or ".gpkg"
    fd, yol = tempfile.mkstemp(suffix=uzanti)
    os.close(fd)
    with open(yol, "wb") as f:
        f.write(veri)
    poligonlar, cizgiler = [], []
    try:
        yollar = [f"zip://{yol}"] if uzanti == ".zip" else [yol]
        for p in yollar:
            katmanlar = fiona.listlayers(p)
            for kat in katmanlar:
                with fiona.open(p, layer=kat) as src:
                    kaynak_crs = src.crs
                    for ozn in src:
                        g = dict(ozn["geometry"])
                        if kaynak_crs and kaynak_crs != "EPSG:4326":
                            try:
                                g = transform_geom(kaynak_crs, "EPSG:4326", g)
                            except Exception:
                                pass
                        pg, cz = _geojson_oku(g)
                        poligonlar += pg
                        cizgiler += cz
    finally:
        try:
            os.unlink(yol)
        except OSError:
            pass
    return poligonlar, cizgiler


def _temiz(t):
    """Haritada innerHTML ile gösterileceği için XSS'e karşı kaçış."""
    t = (t or "").strip()
    for a, b in (("&", "&amp;"), ("<", "&lt;"), (">", "&gt;"),
                 ('"', "&quot;"), ("'", "&#x27;")):
        t = t.replace(a, b)
    return t


def _kml_ozellikler(xml_bytes):
    """KML'den ad'lı tüm geometriler: [{ad, geometry}] (nokta/çizgi/poligon)."""
    txt = xml_bytes.decode("utf-8", "replace")
    used = set(re.findall(r"[<\s]([A-Za-z_][\w.-]*):", txt)) - {"xmlns", "http", "https"}
    declared = set(re.findall(r"xmlns:([\w.-]+)", txt)) | {"xml"}
    eksik = used - declared
    if eksik:
        decls = "".join(f' xmlns:{p}="urn:x-ignore:{p}"' for p in eksik)
        txt = re.sub(r"<kml\b", "<kml" + decls, txt, count=1)
    root = ET.fromstring(txt)
    out = []
    for pm in root.findall(".//{*}Placemark"):
        el = pm.find("{*}name")
        ad = (el.text or "").strip() if el is not None and el.text else ""
        if not ad:
            for sd in pm.findall(".//{*}SimpleData"):
                if sd.text and sd.text.strip():
                    ad = sd.text.strip()
                    break
        for p in pm.findall(".//{*}Point/{*}coordinates"):
            pts = _kml_koordinatlar(p.text)
            if pts:
                out.append({"ad": ad, "geometry": {"type": "Point",
                                                   "coordinates": list(pts[0])}})
        for ls in pm.findall(".//{*}LineString/{*}coordinates"):
            pts = _kml_koordinatlar(ls.text)
            if len(pts) >= 2:
                out.append({"ad": ad, "geometry": {"type": "LineString", "coordinates": pts}})
        for poly in pm.findall(".//{*}Polygon"):
            dis = poly.find(".//{*}outerBoundaryIs//{*}coordinates")
            if dis is None or not dis.text:
                continue
            halka = _kml_koordinatlar(dis.text)
            if len(halka) >= 4:
                out.append({"ad": ad, "geometry": {"type": "Polygon", "coordinates": [halka]}})
    return out


def oku_tum(veri: bytes, dosya_adi: str = ""):
    """Bilgi amaçlı katman: dosyadaki TÜM geometrileri GeoJSON olarak döner.

    Hesaba girmez, yalnız haritada gösterim içindir. KML/KMZ, GeoJSON ve
    fiona'nın açabildiği biçimler (zip'li shapefile, gpkg) desteklenir.
    """
    ad = (dosya_adi or "").lower()
    ozn = []
    if veri[:2] == b"PK" and not ad.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(veri)) as z:
            kml = next((n for n in z.namelist() if n.lower().endswith(".kml")), None)
            if kml:
                ozn = _kml_ozellikler(z.read(kml))
    if not ozn:
        if ad.endswith(".kml") or b"<kml" in veri[:2000]:
            ozn = _kml_ozellikler(veri)
        elif ad.endswith((".geojson", ".json")) or veri.lstrip()[:1] == b"{":
            nesne = json.loads(veri.decode("utf-8", "replace"))
            if nesne.get("type") == "FeatureCollection":
                for f in nesne.get("features", []):
                    if f.get("geometry"):
                        pr = f.get("properties") or {}
                        adi = next((str(pr[k]) for k in ("name", "ad", "Name", "AD", "isim")
                                    if pr.get(k)), "")
                        ozn.append({"ad": adi, "geometry": f["geometry"]})
            elif nesne.get("type") == "Feature":
                ozn.append({"ad": "", "geometry": nesne.get("geometry")})
            else:
                ozn.append({"ad": "", "geometry": nesne})
        else:
            try:
                pg, cz = _fiona_oku(veri, ad or "veri.zip")
            except Exception:
                raise RuntimeError(
                    "Dosya biçimi tanınmadı. Desteklenenler: KML, KMZ, GeoJSON, "
                    "zip'lenmiş shapefile ve GeoPackage.")
            ozn = [{"ad": "", "geometry": g} for g in (pg + cz)]
    ozn = [o for o in ozn if o.get("geometry")]
    if not ozn:
        raise RuntimeError("Dosyada gösterilebilir geometri bulunamadı")
    return {"type": "FeatureCollection",
            "features": [{"type": "Feature", "properties": {"ad": _temiz(o["ad"])},
                          "geometry": o["geometry"]} for o in ozn]}


def oku(veri: bytes, dosya_adi: str = "", poligon_zorunlu: bool = True):
    """Dosya içeriğinden {havza, dereler, poligon_sayisi, cizgi_sayisi} döner.

    Havza = en büyük alanlı poligon; dereler = tüm çizgilerin birleşimi.
    poligon_zorunlu=False ise (ayrı dere dosyası) poligon aranmaz.
    """
    ad = (dosya_adi or "").lower()
    poligonlar, cizgiler = [], []
    if veri[:2] == b"PK" and (ad.endswith(".kmz") or not ad.endswith(".zip")):
        # KMZ (zip içinde kml)
        with zipfile.ZipFile(io.BytesIO(veri)) as z:
            kml = next((n for n in z.namelist() if n.lower().endswith(".kml")), None)
            if kml:
                poligonlar, cizgiler = _kml_oku(z.read(kml))
    if not poligonlar and not cizgiler:
        if ad.endswith((".kml",)) or veri.lstrip()[:5] == b"<?xml" or b"<kml" in veri[:2000]:
            poligonlar, cizgiler = _kml_oku(veri)
        elif ad.endswith((".geojson", ".json")) or veri.lstrip()[:1] == b"{":
            poligonlar, cizgiler = _geojson_oku(json.loads(veri.decode("utf-8", "replace")))
        else:
            poligonlar, cizgiler = _fiona_oku(veri, ad or "veri.zip")
    if poligon_zorunlu and not poligonlar:
        raise RuntimeError("Dosyada havza sınırı (poligon) bulunamadı")
    if not poligon_zorunlu and not cizgiler:
        raise RuntimeError("Dere dosyasında çizgi (LineString) bulunamadı")

    from shapely.geometry import shape
    from shapely.ops import unary_union
    havza = None
    if poligonlar:
        havza = max((shape(p) for p in poligonlar), key=lambda g: g.area)
    dereler = None
    if cizgiler:
        try:
            dereler = unary_union([shape(c) for c in cizgiler]).__geo_interface__
        except Exception:
            dereler = None
    return {"havza": havza.__geo_interface__ if havza is not None else None,
            "dereler": dereler,
            "poligon_sayisi": len(poligonlar), "cizgi_sayisi": len(cizgiler)}
