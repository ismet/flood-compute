# -*- coding: utf-8 -*-
"""Bilgi katmanı vector format adapters."""
import math
import os
import shutil
import subprocess
import tempfile

from . import vektor

NCZ_HATASI = (
    "NCZ dosyaları doğrudan desteklenmiyor. Dosyayı Netcad veya NView ile "
    "GeoJSON, KML/KMZ, DXF veya SHP/ZIP biçimine aktarın ve dışa aktarılan "
    "dosyayı yeniden yükleyin."
)


def _crs_nesnesi(crs):
    if not crs:
        return None
    from rasterio.crs import CRS
    try:
        return CRS.from_user_input(crs)
    except Exception as e:
        raise RuntimeError(f"Koordinat sistemi anlaşılamadı: {crs}") from e


def _donustur(geometry, kaynak):
    if not kaynak:
        return geometry
    from pyproj import Transformer
    from shapely.geometry import shape, mapping
    from shapely.ops import transform
    try:
        transformer = Transformer.from_crs(kaynak, "EPSG:4326", always_xy=True)
        return mapping(transform(lambda x, y, z=None: transformer.transform(x, y), shape(geometry)))
    except Exception as e:
        raise RuntimeError(f"Koordinat dönüşümü başarısız: {e}") from e


def _finite_xy(points):
    return all(len(p) >= 2 and math.isfinite(float(p[0])) and math.isfinite(float(p[1])) for p in points)


def _dxf_points(entity):
    try:
        return [(float(p[0]), float(p[1])) for p in entity.get_points()]
    except AttributeError:
        return [(float(p.dxf.location.x), float(p.dxf.location.y)) for p in entity.vertices]


def _dxf_oku(veri, crs):
    try:
        import ezdxf
    except ImportError as e:
        raise RuntimeError("DXF desteği için ezdxf bağımlılığını kurun.") from e
    fd, path = tempfile.mkstemp(suffix=".dxf")
    os.close(fd)
    try:
        with open(path, "wb") as f:
            f.write(veri)
        doc = ezdxf.readfile(path)
    except Exception as e:
        raise RuntimeError(f"DXF dosyası okunamadı: {e}") from e
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
    features = []
    warnings = {}
    msp = doc.modelspace()
    for entity in msp:
        typ = entity.dxftype()
        geometry = None
        if typ == "POINT":
            p = entity.dxf.location
            geometry = {"type": "Point", "coordinates": [float(p.x), float(p.y)]}
        elif typ == "LINE":
            a, b = entity.dxf.start, entity.dxf.end
            geometry = {"type": "LineString", "coordinates": [[float(a.x), float(a.y)], [float(b.x), float(b.y)]]}
        elif typ in ("LWPOLYLINE", "POLYLINE"):
            points = _dxf_points(entity)
            if len(points) >= 2 and _finite_xy(points):
                closed = bool(entity.closed) if hasattr(entity, "closed") else bool(getattr(entity.dxf, "flags", 0) & 1)
                if closed:
                    unique = points[:-1] if points[0] == points[-1] else points
                    if len(unique) >= 3:
                        ring = unique + [unique[0]]
                        geometry = {"type": "Polygon", "coordinates": [ring]}
                else:
                    geometry = {"type": "LineString", "coordinates": points}
        if geometry is None:
            if typ not in ("SEQEND", "VERTEX"):
                warnings[typ] = warnings.get(typ, 0) + 1
            continue
        geometry = _donustur(geometry, crs)
        _ad = vektor._temiz(str(getattr(entity.dxf, "layer", "") or ""))
        props = {"ad": _ad, "layer": _ad}
        features.append({"type": "Feature", "properties": props, "geometry": geometry})
    if not features:
        raise RuntimeError("DXF dosyasında gösterilebilir geometri bulunamadı")
    out = {"type": "FeatureCollection", "features": features}
    return out, warnings


def _oda_yolu():
    adaylar = [
        os.environ.get("ODA_FILE_CONVERTER", ""),
        "/opt/oda-file-converter/oda-file-converter",
        "/usr/bin/ODAFileConverter",
        "/usr/bin/oda-file-converter",
    ]
    for yol in adaylar:
        if yol and os.path.isabs(yol) and os.path.isfile(yol) and os.access(yol, os.X_OK):
            return yol
    return None


def _oda_env(exe):
    env = dict(os.environ)
    env.pop("DISPLAY", None)
    env["NO_AT_BRIDGE"] = "1"
    if os.path.realpath(exe).startswith("/opt/oda-file-converter/"):
        env["LD_LIBRARY_PATH"] = "/opt/oda-file-converter" + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
    return env


def _dwg_oku(veri, crs):
    if len(veri) < 6 or not veri[:6].startswith(b"AC10"):
        raise RuntimeError("Geçerli DWG başlığı bulunamadı")
    exe = _oda_yolu()
    if not exe:
        raise RuntimeError("DWG desteği için lisanslı ODA File Converter kurulup ODA_FILE_CONVERTER ile tanımlanmalıdır.")
    with tempfile.TemporaryDirectory(prefix="taskin-oda-") as tmp:
        inp = os.path.join(tmp, "input")
        out = os.path.join(tmp, "output")
        os.makedirs(inp)
        os.makedirs(out)
        src = os.path.join(inp, "layer.dwg")
        with open(src, "wb") as f:
            f.write(veri)
        komut = [exe, inp, out, "ACAD2018", "DXF", "0", "1"]
        if os.name != "nt":
            xvfb = shutil.which("xvfb-run")
            if not xvfb:
                raise RuntimeError(
                    f"ODA bulundu ({exe}), ancak başsız Linux ortamında çalıştırmak için xvfb-run kurulmalıdır")
            komut = [xvfb, "-a", "-s", "-screen 0 1280x1024x24 -nolisten tcp"] + komut
        try:
            p = subprocess.run(
                komut, shell=False, capture_output=True, text=True, timeout=120,
                env=_oda_env(exe),
            )
        except subprocess.TimeoutExpired as e:
            raise RuntimeError("DWG dönüştürme zaman aşımına uğradı") from e
        if p.returncode != 0:
            raise RuntimeError("DWG dönüştürme başarısız: " + (p.stderr or p.stdout or str(p.returncode)).strip()[-300:])
        candidates = []
        for root, _, names in os.walk(out):
            for name in names:
                if name.lower().endswith(".dxf"):
                    candidates.append(os.path.join(root, name))
        if len(candidates) != 1:
            raise RuntimeError("DWG dönüştürücüsü tek bir DXF çıktısı üretmedi")
        with open(candidates[0], "rb") as f:
            return _dxf_oku(f.read(), crs)


def oku(veri: bytes, dosya_adi: str = "", crs: str | None = None):
    ad = os.path.basename(dosya_adi or "").lower()
    if ad.endswith(".ncz"):
        raise RuntimeError(NCZ_HATASI)
    kaynak = _crs_nesnesi(crs)
    if ad.endswith((".dxf", ".dwg")) and kaynak is None:
        raise RuntimeError("DXF/DWG dosyası için CRS alanına EPSG kodunu yazın")
    if ad.endswith(".dxf"):
        fc, warnings = _dxf_oku(veri, kaynak)
    elif ad.endswith(".dwg"):
        fc, warnings = _dwg_oku(veri, kaynak)
    else:
        fc = vektor.oku_tum(veri, dosya_adi)
        warnings = {}
    if kaynak and not (ad.endswith(".dxf") or ad.endswith(".dwg")):
        raise RuntimeError("Bu dosya türü için CRS alanı kullanılamaz")
    return fc, warnings
