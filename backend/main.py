# -*- coding: utf-8 -*-
"""Taşkın Hesap Web Uygulaması — FastAPI backend."""
import json
import os
import re
import traceback

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Heavy GIS modules (pysheds→scikit-image→numba→llvmlite, rasterio, scipy) are
# imported lazily inside endpoints to keep startup memory low enough for the
# 512 MB free plan. Python caches in sys.modules, so repeated imports are free.

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(ROOT, "frontend")
PROJECTS = os.path.join(ROOT, "data", "projects")
os.makedirs(PROJECTS, exist_ok=True)

app = FastAPI(title="Taşkın Hesap", version="1.0")

# APP_PASSWORD ortam değişkeni tanımlıysa tüm istekler HTTP Basic ile korunur
# (public deploy için). Kullanıcı adı serbest, parola eşleşmeli.
_PASSWORD = os.environ.get("APP_PASSWORD")
if _PASSWORD:
    import base64
    import secrets

    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.responses import Response

    class _BasicAuth(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            hdr = request.headers.get("authorization", "")
            ok = False
            if hdr.startswith("Basic "):
                try:
                    _, pw = base64.b64decode(hdr[6:]).decode().split(":", 1)
                    ok = secrets.compare_digest(pw, _PASSWORD)
                except Exception:
                    ok = False
            if not ok:
                return Response(status_code=401, headers={
                    "WWW-Authenticate": 'Basic realm="Taskin Hesap"'})
            return await call_next(request)

    app.add_middleware(_BasicAuth)


def _err(e):
    traceback.print_exc()
    return JSONResponse(status_code=400, content={"hata": str(e)})


# ------------------------------------------------------------------ modeller
class DelineateReq(BaseModel):
    lat: float
    lon: float
    river_km2: float = 1.0


class CNReq(BaseModel):
    havza_geojson: dict
    zemin_grubu: str = "B"


class ThiessenReq(BaseModel):
    havza_geojson: dict
    istasyonlar: list


class RainParseReq(BaseModel):
    metin: str


class ComputeReq(BaseModel):
    girdi: dict           # engine.compute girdisi
    rasyonel: bool = False
    c100: float = 0.2
    us: float = 0.2       # C_T = C100 * (T/100)^us
    kar: dict | None = None   # {daily_tmax, a_kar_km2, h_kar_m, h_ist_m, melt_rate, period}


class SaveReq(BaseModel):
    ad: str
    durum: dict


class YilAraReq(BaseModel):
    q: float
    q10: float
    q100: float


# ------------------------------------------------------------------- uçlar
@app.post("/api/delineate")
def api_delineate(req: DelineateReq):
    """Havza çıkarımını ayrı sürece (subprocess) yollar — 512 MB planında
    pysheds+numba belleği süreç çıkışında işletim sistemine iade edilir."""
    import subprocess, sys
    try:
        proc = subprocess.run(
            [sys.executable, "-m", "backend.core._delineate_subprocess",
             str(req.lat), str(req.lon), str(req.river_km2)],
            capture_output=True, text=True, timeout=240,
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        if proc.returncode != 0:
            msg = proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else "subprocess failed"
            raise RuntimeError(msg)
        return json.loads(proc.stdout.strip().splitlines()[-1])
    except subprocess.TimeoutExpired:
        return _err(RuntimeError("Havza çıkarımı zaman aşımına uğradı (4 dk) — DEM indirme çok yavaş olabilir"))
    except Exception as e:
        return _err(e)


@app.post("/api/cn")
def api_cn(req: CNReq):
    from backend.core import corine
    try:
        return corine.cn_from_basin(req.havza_geojson, req.zemin_grubu)
    except Exception as e:
        return _err(e)


@app.get("/api/stations/default")
def api_stations_default():
    """data/stations (yoksa proje kökü) altındaki ilk KMZ/KML'yi varsayılan
    istasyon seti olarak döner."""
    try:
        cands = []
        for d in (os.path.join(ROOT, "data", "stations"), ROOT):
            if os.path.isdir(d):
                cands += [os.path.join(d, f) for f in sorted(os.listdir(d))
                          if f.lower().endswith((".kmz", ".kml"))]
        if not cands:
            return {"istasyonlar": [], "dosya": None}
        from backend.core import thiessen
        with open(cands[0], "rb") as f:
            sts = thiessen.parse_kmz(f.read())
        return {"istasyonlar": sts, "dosya": os.path.basename(cands[0])}
    except Exception as e:
        return _err(e)


@app.post("/api/stations")
async def api_stations(file: UploadFile = File(...)):
    try:
        from backend.core import thiessen
        data = await file.read()
        sts = thiessen.parse_kmz(data)
        if not sts:
            raise RuntimeError("KMZ içinde nokta Placemark bulunamadı")
        return {"istasyonlar": sts}
    except Exception as e:
        return _err(e)


@app.post("/api/thiessen")
def api_thiessen(req: ThiessenReq):
    from backend.core import thiessen
    try:
        return {"sonuc": thiessen.weights(req.havza_geojson, req.istasyonlar)}
    except Exception as e:
        return _err(e)


@app.post("/api/rainfall/parse")
def api_rain_parse(req: RainParseReq):
    """Yapıştırılan yağış tablosunu çözümle.

    Beklenen: her satır bir istasyon; ilk hücre ad (opsiyonel), sonra
    P2 P5 P10 P25 P50 P100 [OEY] değerleri (sekme/;/boşluk ayraçlı, virgül ondalık olabilir).
    """
    try:
        rows = []
        for line in req.metin.strip().splitlines():
            if not line.strip():
                continue
            parts = re.split(r"[\t;]+", line.strip())
            if len(parts) == 1:
                parts = line.split()
            nums, name_parts = [], []
            for p in parts:
                p2 = p.strip().replace(",", ".")
                try:
                    nums.append(float(p2))
                except ValueError:
                    if not nums:
                        name_parts.append(p.strip())
            if len(nums) < 6:
                continue
            rows.append({
                "ad": " ".join(name_parts) or f"İstasyon-{len(rows)+1}",
                "P24": nums[:6],
                "OET": nums[6] if len(nums) > 6 else None,
            })
        if not rows:
            raise RuntimeError("Satırlarda en az 6 sayısal değer (P2..P100) bulunamadı")
        return {"satirlar": rows}
    except Exception as e:
        return _err(e)


@app.get("/api/dplv")
def api_dplv():
    from backend.core import tables
    return tables.load("dplv_stations")


@app.post("/api/compute")
def api_compute(req: ComputeReq):
    from backend.core import engine, rational, snowmelt, tables
    try:
        g = dict(req.girdi)
        kar_res = None
        if req.kar and req.kar.get("daily_tmax"):
            k = req.kar
            kar_res = snowmelt.compute(
                k["daily_tmax"], k["a_kar_km2"], k["h_kar_m"], k["h_ist_m"],
                k.get("melt_rate", 1.08), k.get("period", 15))
            g["kar_qmax"] = kar_res["Qkar_pik"]
        g["P24"] = {int(k): v for k, v in g["P24"].items()}
        if not g.get("CN3"):
            g["CN3"] = tables.cn2_to_cn3(g["CN2"])
        res = engine.compute(g)
        if kar_res:
            res["kar"] = kar_res
        if req.rasyonel or g["A_km2"] <= 1.0:
            res["rasyonel"] = rational.compute(g, c100=req.c100, exponent=req.us)
        return res
    except Exception as e:
        return _err(e)


@app.post("/api/yil-ara")
def api_yil_ara(req: YilAraReq):
    from backend.core import engine
    t = engine.find_return_period(req.q, req.q10, req.q100)
    return {"tekerrur_yili": t}


# ------------------------------------------------------- proje kayıt (KAY)
def _safe(name):
    return re.sub(r"[^\w\-çğıöşüÇĞİÖŞÜ ]", "_", name).strip() or "proje"


@app.post("/api/project/save")
def api_save(req: SaveReq):
    path = os.path.join(PROJECTS, _safe(req.ad) + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(req.durum, f, ensure_ascii=False, indent=1)
    return {"tamam": True, "dosya": os.path.basename(path)}


@app.get("/api/project/list")
def api_list():
    out = []
    for fn in sorted(os.listdir(PROJECTS)):
        if fn.endswith(".json"):
            out.append(fn[:-5])
    return {"projeler": out}


@app.get("/api/project/load/{ad}")
def api_load(ad: str):
    path = os.path.join(PROJECTS, _safe(ad) + ".json")
    if not os.path.exists(path):
        raise HTTPException(404, "Proje bulunamadı")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ------------------------------------------------------------------ frontend
app.mount("/static", StaticFiles(directory=FRONTEND), name="static")


@app.get("/")
def index():
    return FileResponse(os.path.join(FRONTEND, "index.html"))
