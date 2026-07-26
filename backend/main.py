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

# Heavy GIS modules (pyflwdir→numba, rasterio) are
# imported lazily inside endpoints to keep startup memory low.
# Python caches in sys.modules, so repeated imports are free.

import threading
_delineate_lock = threading.Lock()

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


class MultiDelineateReq(BaseModel):
    mansap: dict            # {lat, lon}
    membalar: list         # [{lat, lon}, ...]
    river_km2: float = 1.0


class RouteReq(BaseModel):
    ara_sonuc: dict                 # engine.compute sonucu (ara havza)
    memba_sonuclari: list           # [engine.compute sonucu, ...]
    lag_saat: float                 # öteleme süresi (ara havza Tc'si)
    yontemler: list | None = None   # ["dsi","snyder","mockus","rasyonel"]


class ReservoirReq(BaseModel):
    inflow: list                    # giriş hidrografı [m³/s]
    dt_saat: float = 1.0
    kret_kotu: float                # dolusavak kret kotu (m)
    hacim_satih: list               # [[kot_m, alan_km2, hacim_hm3], ...]
    rating: list | None = None      # [[He_m, Q_m3s], ...] verilirse kullanılır
    # rating yoksa geometriden hesap:
    yaklasim_taban_kotu: float | None = None
    apron_giris_acisi: float = 0.0  # derece
    kret_uzunlugu: float = 40.0     # m (L)
    debi_katsayisi: float | None = None  # C; None ⇒ USBR P/He eğrisinden türet


class ReservoirControlledReq(BaseModel):
    inflow: list                    # giriş hidrografı [m³/s]
    dt_saat: float = 1.0
    hacim_satih: list               # [[kot_m, hacim_hm3], ...]
    esik_kotu: float                # kapak eşik (DSEK) kotu (m)
    lef: float                      # efektif kapak genişliği (m)
    baslangic_kotu: float           # öteleme başlangıç su kotu (m)
    maks_su_kotu: float             # izin verilen maksimum su kotu (m)
    taban_debi: float = 0.0         # W1 — kapak kapalıyken taban/serbest debi (m³/s)
    kapak_adedi: int = 1            # n — kapak adedi (her biri lef genişlikte)


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
    snyder: bool = False
    snyder_par: dict | None = None   # {Ct, Cp, W50, W75, YALD?}
    kar: dict | None = None   # {daily_tmax, a_kar_km2, h_kar_m, h_ist_m, melt_rate, period}


class ReportReq(BaseModel):
    girdi: dict
    sonuc: dict
    meta: dict | None = None


class SaveReq(BaseModel):
    ad: str
    durum: dict


class DilekceReq(BaseModel):
    il: str = ""
    istasyonlar: list = []          # [{no, ad, aralik}]
    veri_turleri: list | None = None
    eposta: str = ""
    gsm: str = ""
    adres: str = ""
    imza: str = ""
    kase: str = ""
    format: str = "docx"           # "docx" | "pdf"
    imza_b64: str = ""             # yüklenen imza/kaşe görseli (data URL veya base64)
    use_default_imza: bool = True  # görsel yoksa varsayılan imza/kaşe kullanılsın mı


class YilAraReq(BaseModel):
    q: float
    q10: float
    q100: float


# ------------------------------------------------------------------- uçlar
@app.post("/api/delineate")
def api_delineate(req: DelineateReq):
    """Havza çıkarımını ayrı sürece (subprocess) yollar — pyflwdir+numba
    belleği süreç çıkışında işletim sistemine iade edilir."""
    import math
    if not (-90 <= req.lat <= 90 and -180 <= req.lon <= 180
            and math.isfinite(req.lat) and math.isfinite(req.lon)
            and req.river_km2 > 0 and math.isfinite(req.river_km2)):
        return _err(ValueError("lat/lon/river_km2 geçersiz"))
    acquired = _delineate_lock.acquire(blocking=False)
    if not acquired:
        return JSONResponse(status_code=503,
            content={"hata": "Havza çıkarımı devam ediyor, lütfen bekleyip tekrar deneyin."})
    try:
        import subprocess, sys
        proc = subprocess.run(
            [sys.executable, "-m", "backend.core._delineate_subprocess",
             str(req.lat), str(req.lon), str(req.river_km2)],
            capture_output=True, text=True, timeout=480,
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        if proc.returncode != 0:
            msg = proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else "subprocess failed"
            raise RuntimeError(msg)
        result = json.loads(proc.stdout.strip().splitlines()[-1])
        # YZD alansal dağılım bölgesini (A/B/C) havzadan otomatik bul
        try:
            from backend.core import yzd_region
            gj = result.get("havza_geojson")
            result["yzd_bolge"] = yzd_region.detect(
                basin_geojson=gj, lat=req.lat, lon=req.lon)
        except Exception as e:
            result["yzd_bolge"] = {"bolge": None, "yontem": None, "hata": str(e)}
        return result
    except subprocess.TimeoutExpired:
        return _err(RuntimeError("Havza çıkarımı zaman aşımına uğradı (8 dk) — DEM indirme çok yavaş olabilir"))
    except Exception as e:
        return _err(e)
    finally:
        _delineate_lock.release()


@app.post("/api/multi-delineate")
def api_multi_delineate(req: MultiDelineateReq):
    """En mansap + memba noktalarından ara havza (ve alt havzalar) çıkarır."""
    import math
    pts = [req.mansap] + list(req.membalar)
    for p in pts:
        if not (isinstance(p, dict) and -90 <= p.get("lat", 999) <= 90
                and -180 <= p.get("lon", 999) <= 180):
            return _err(ValueError("Geçersiz nokta (lat/lon)"))
    if not req.membalar:
        return _err(ValueError("En az bir memba noktası gerekli"))
    acquired = _delineate_lock.acquire(blocking=False)
    if not acquired:
        return JSONResponse(status_code=503,
            content={"hata": "Havza çıkarımı devam ediyor, lütfen bekleyip tekrar deneyin."})
    try:
        import subprocess, sys
        payload = json.dumps({"mansap": req.mansap, "membalar": req.membalar,
                              "river_km2": req.river_km2})
        proc = subprocess.run(
            [sys.executable, "-m", "backend.core._multi_delineate_subprocess"],
            input=payload, capture_output=True, text=True, timeout=300,
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        if proc.returncode != 0:
            msg = proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else "subprocess failed"
            raise RuntimeError(msg)
        result = json.loads(proc.stdout.strip().splitlines()[-1])
        # ara havza + memba havzaları için YZD bölgesini otomatik ekle
        try:
            from backend.core import yzd_region
            result["ara"]["yzd_bolge"] = yzd_region.detect(basin_geojson=result["ara"]["havza_geojson"])
            for mb in result["membalar"]:
                mb["yzd_bolge"] = yzd_region.detect(basin_geojson=mb["havza_geojson"])
        except Exception:
            pass
        return result
    except subprocess.TimeoutExpired:
        return _err(RuntimeError("Çok parçalı havza çıkarımı zaman aşımına uğradı (5 dk)"))
    except Exception as e:
        return _err(e)
    finally:
        _delineate_lock.release()


@app.post("/api/route")
def api_route(req: RouteReq):
    """Memba hidrograflarını ara havza Tc'si kadar öteleyip mansap hidrografı bulur."""
    from backend.core import routing
    try:
        return routing.route(req.ara_sonuc, req.memba_sonuclari, req.lag_saat, req.yontemler)
    except Exception as e:
        return _err(e)


@app.post("/api/cn")
def api_cn(req: CNReq):
    from backend.core import corine
    try:
        return corine.cn_from_basin(req.havza_geojson, req.zemin_grubu)
    except Exception as e:
        return _err(e)


@app.post("/api/yzd-region")
def api_yzd_region(req: CNReq):
    """Havza poligonundan YZD alansal dağılım bölgesini (A/B/C) bulur."""
    from backend.core import yzd_region
    try:
        return yzd_region.detect(basin_geojson=req.havza_geojson)
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


@app.get("/api/mgm-stations")
def api_mgm_stations():
    """MGM 2020 PLV: istasyon 24 saatlik tekerrürlü yağışları + PLV oranları."""
    from backend.core import tables
    try:
        return tables.load("mgm_plv_2020")
    except Exception as e:
        return _err(e)


@app.get("/api/geocode")
def api_geocode(q: str = ""):
    """İl/ilçe/mahalle adres araması — OSM Nominatim proxy'si (Türkiye).

    Sunucu tarafından tek User-Agent'la çağrılır (Nominatim kullanım
    politikası); CORS/rate sorunlarını önler. [{ad, lat, lon, tur}].
    """
    import requests
    q = (q or "").strip()
    if len(q) < 2:
        return []
    try:
        r = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": q, "format": "jsonv2", "countrycodes": "tr",
                    "addressdetails": 1, "accept-language": "tr", "limit": 8},
            headers={"User-Agent": "TaskinHesap/1.0 (flood-compute)"},
            timeout=12)
        r.raise_for_status()
        out = []
        for it in r.json():
            out.append({
                "ad": it.get("display_name", ""),
                "lat": float(it["lat"]), "lon": float(it["lon"]),
                "tur": it.get("addresstype") or it.get("type", ""),
                "sinir": it.get("boundingbox"),  # [s, n, w, e]
            })
        return out
    except Exception as e:
        return _err(e)


@app.get("/api/snyder-ctcp")
def api_snyder_ctcp():
    """Snyder Ct-Cp abağı (metrik) — Cp↔Ct log-log interpolasyonu için tablo."""
    from backend.core import tables
    try:
        return tables.load("snyder_ct_cp")
    except Exception as e:
        return _err(e)


@app.get("/api/abak2")
def api_abak2():
    """ABAK2 alansal azaltma (YAD/ADK) tablosu — canlı YALD gösterimi için."""
    from backend.core import tables
    try:
        return tables.load("abak2_yad")
    except Exception as e:
        return _err(e)


@app.get("/api/reservoir-defaults")
def api_reservoir_defaults():
    """Söylemez haznesi varsayılan değerleri (hacim-satıh, rating, kret, taban)."""
    from backend.core import tables
    try:
        return tables.load("soylemez_reservoir")
    except Exception as e:
        return _err(e)


@app.get("/api/reservoir-controlled-defaults")
def api_reservoir_controlled_defaults():
    """Kapaklı (kontrollü) dolusavak varsayılanları (1512 sayfası)."""
    from backend.core import tables
    try:
        return tables.load("kapakli_reservoir")
    except Exception as e:
        return _err(e)


@app.post("/api/reservoir-controlled")
def api_reservoir_controlled(req: ReservoirControlledReq):
    """Kapaklı dolusavak ötelemesi + kapak optimizasyonu (min çıkış piki)."""
    from backend.core import reservoir
    try:
        return reservoir.route_controlled(
            req.inflow, req.dt_saat, req.hacim_satih, req.esik_kotu, req.lef,
            req.baslangic_kotu, req.maks_su_kotu, W1=req.taban_debi,
            n_kapak=req.kapak_adedi)
    except Exception as e:
        return _err(e)


@app.post("/api/reservoir-route")
def api_reservoir_route(req: ReservoirReq):
    """Hazne (rezervuar) taşkın ötelemesi — Storage-Indication."""
    from backend.core import reservoir
    try:
        rating = req.rating
        P = None
        if not rating:
            if req.yaklasim_taban_kotu is not None:
                P = req.kret_kotu - req.yaklasim_taban_kotu
            rating = reservoir.rating_from_geometry(
                req.kret_kotu, req.apron_giris_acisi, req.kret_uzunlugu,
                C=req.debi_katsayisi, P=P)
        res = reservoir.route(req.inflow, req.dt_saat, req.kret_kotu,
                              req.hacim_satih, rating)
        res["kullanilan_rating"] = rating
        if not req.rating and req.debi_katsayisi is None:
            # C, P/He eğrisinden türetildi — He başına C'yi de döndür
            res["yaklasim_P"] = P
            res["dolusavak_C"] = [[he, round(reservoir.coeff_from_ph(P, he), 3)]
                                  for he, _ in rating[1:]]
        return res
    except Exception as e:
        return _err(e)


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
        if req.snyder and req.snyder_par:
            from backend.core import snyder
            sg = {**g, **req.snyder_par}
            res["snyder"] = snyder.compute(sg)
        return res
    except Exception as e:
        return _err(e)


@app.post("/api/yil-ara")
def api_yil_ara(req: YilAraReq):
    from backend.core import engine
    t = engine.find_return_period(req.q, req.q10, req.q100)
    return {"tekerrur_yili": t}


@app.post("/api/report")
def api_report(req: ReportReq):
    """Hesap sonuçlarından Word (.docx) taşkın raporu (Bölüm 4.7.x) üretir."""
    from fastapi.responses import Response
    from backend.core import report
    try:
        g = dict(req.girdi)
        if "P24" in g:
            g["P24"] = {str(k): v for k, v in g["P24"].items()}
        data = report.build_report(g, req.sonuc, req.meta or {})
        ad = _safe((req.meta or {}).get("proje_adi") or g.get("ad") or "rapor")
        # HTTP başlığı ASCII olmalı: Türkçe karakterleri sadeleştir
        tr = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
        fn = re.sub(r"[^A-Za-z0-9_.-]+", "_", ad.translate(tr)).strip("_") + "_Taskin_Bolum.docx"
        return Response(
            content=data,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{fn}"'})
    except Exception as e:
        return _err(e)


@app.get("/api/dilekce-defaults")
def api_dilekce_defaults():
    """Dilekçe için varsayılan iletişim bilgileri + varsayılan imza/kaşe var mı."""
    from backend.core import dilekce
    return {**dilekce.DEFAULTS,
            "veri_turleri": dilekce.DEFAULT_VERI,
            "imza_var": bool(dilekce.default_imza_bytes())}


@app.get("/api/dilekce-imza")
def api_dilekce_imza():
    """Varsayılan imza/kaşe görselini döndürür (önizleme için)."""
    from fastapi.responses import Response
    from backend.core import dilekce
    data = dilekce.default_imza_bytes()
    if not data:
        raise HTTPException(404, "Varsayılan imza/kaşe yok")
    return Response(content=data, media_type="image/png")


@app.post("/api/dilekce")
def api_dilekce(req: DilekceReq):
    """MGM veri talebi dilekçesi (.docx / .pdf) üretir (örnek biçimi)."""
    import base64
    from fastapi.responses import Response
    from backend.core import dilekce
    try:
        imza = None
        if req.imza_b64:
            b = req.imza_b64.split(",", 1)[-1]          # data URL ön ekini at
            imza = base64.b64decode(b)
        elif req.use_default_imza:
            imza = dilekce.default_imza_bytes()
        fmt = "pdf" if (req.format or "").lower() == "pdf" else "docx"
        data = dilekce.build(req.model_dump(), imza_bytes=imza, fmt=fmt)
        sts = req.istasyonlar or []
        base_ad = (str(sts[0].get("ad")) if sts and sts[0].get("ad") else req.il) or "MGM"
        tr = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
        fn = re.sub(r"[^A-Za-z0-9_.-]+", "_", base_ad.translate(tr)).strip("_") + "_MGM_Dilekce." + fmt
        media = ("application/pdf" if fmt == "pdf"
                 else "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        return Response(content=data, media_type=media,
                        headers={"Content-Disposition": f'attachment; filename="{fn}"'})
    except Exception as e:
        return _err(e)


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


@app.delete("/api/project/{ad}")
def api_delete(ad: str):
    path = os.path.join(PROJECTS, _safe(ad) + ".json")
    if not os.path.exists(path):
        raise HTTPException(404, "Proje bulunamadı")
    os.remove(path)
    return {"tamam": True, "silinen": _safe(ad)}


# ------------------------------------------------------------------ frontend
app.mount("/static", StaticFiles(directory=FRONTEND), name="static")


@app.get("/")
def index():
    return FileResponse(os.path.join(FRONTEND, "index.html"))
