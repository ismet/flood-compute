# -*- coding: utf-8 -*-
"""Taşkın Hesap Web Uygulaması — FastAPI backend."""
import json
import os
import re
import subprocess
import traceback

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, model_validator

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
    snap_m: float = 500.0   # tıklanan noktayı kanala kenetleme yarıçapı (m)
    dem_source: str = "auto"  # auto | yerel (ASTER) | copernicus | 10m
    # "10m" seçilirse iki aşamalı çalışır: önce 30 m ile havza bulunur, sınırına
    # bu kadar pay eklenir, 10 m ulusal DEM (ED50 Lambert) o pencereden kesilip
    # WGS84'e döndürülür ve karakteristikler ondan hesaplanır. Pay şart: 10 m
    # akış yolları biraz farklı gider, tam sınırdan kesilirse havza budanır.
    tampon_m: float = 500.0
    # Beklenen yağış alanı (km²). Verilirse kenetleme "en yüksek birikim"
    # yerine "birikimi bu alana en yakın kanal" kuralını kullanır. Beyağaç'ta
    # tıklamanın 31 m yanındaki 8.2 km²'lik kol yerine 477 m ötedeki birleşik
    # 24.6 km² seçiliyordu; hedef verilince doğru kola 78 m'de oturuyor.
    hedef_alan_km2: float = 0.0


class MultiDelineateReq(BaseModel):
    mansap: dict            # {lat, lon}
    membalar: list         # [{lat, lon}, ...]
    river_km2: float = 1.0
    snap_m: float = 500.0
    dem_source: str = "auto"


class RouteReq(BaseModel):
    ara_sonuc: dict                 # engine.compute sonucu (ara havza)
    memba_sonuclari: list           # [engine.compute sonucu, ...]
    lag_saat: float                 # öteleme süresi (ara havza Tc'si)
    yontemler: list | None = None   # ["dsi","snyder","mockus","rasyonel"]
    rezervuarlar: list | None = None  # membalarla aynı sırada; dolu olan noktada hazne ötelemesi


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
    pik_sonrasi_bosalt: bool = True  # pik geçince O > I serbest (hazneyi boşalt)


class CNReq(BaseModel):
    havza_geojson: dict
    # Varsayılan bilerek "C": Türkiye'nin %92'si bu gruba düşüyor (bkz.
    # tools/zemin_grubu_uret.py). Eskiden "B" idi ve hiçbir gerekçesi yoktu —
    # ülkenin yalnız %1.6'sına uyuyor, üstelik grup Q100'ü kat kat değiştiriyor.
    # Arayüz zaten /api/zemin-grubu ile havzadan belirleyip gönderiyor; bu
    # varsayılan yalnız doğrudan API çağıranlar için son çare.
    zemin_grubu: str = "C"


class ThiessenReq(BaseModel):
    havza_geojson: dict
    istasyonlar: list
    min_agirlik: float = 0.05   # payı bunun altındaki istasyonlar elenir (0 = eleme yok)


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


class RasterSilReq(BaseModel):
    ad: str


class BasinGeomReq(BaseModel):
    """Haritada elle düzenlenmiş havza/dere geometrisinden parametre üretimi."""
    havza_geojson: dict
    dere_geojson: dict | None = None
    river_km2: float = 1.0
    dem_source: str = "auto"


class KmzReq(BaseModel):
    """Nihai havza + dere + tekerrürlü debilerin KMZ çıktısı için istek."""
    ad: str | None = None
    yontem_ad: str | None = None
    havza_geojson: dict | None = None
    dere_geojson: dict | None = None
    kanal_geojson: dict | None = None
    outlet: dict | None = None       # {lat, lon}
    debiler: dict | list | None = None   # {"100": 128.9, ...} veya [{rp, q}]
    girdi_ozeti: dict | None = None


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
             str(req.lat), str(req.lon), str(req.river_km2), "0.08", str(req.snap_m),
             str(req.dem_source), str(req.hedef_alan_km2 or 0.0),
             str(req.tampon_m)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=480,
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


@app.post("/api/bilgi-katmani")
async def api_bilgi_katmani(file: UploadFile = File(...), crs: str = Form("")):
    """Bilgi amaçlı harita katmanı: dosyadaki tüm geometrileri GeoJSON döner.

    Hesaba girmez; yalnız haritada bağlam göstermek içindir."""
    from backend.core import katman
    try:
        dosya_adi = os.path.basename(file.filename or "").lower()
        if dosya_adi.endswith(".ncz"):
            raise RuntimeError(katman.NCZ_HATASI)
        if dosya_adi.endswith((".dxf", ".dwg")) and not crs.strip():
            raise RuntimeError("DXF/DWG dosyası için CRS alanına EPSG kodunu yazın")
        fc, warnings = katman.oku(await file.read(), file.filename or "", crs.strip() or None)
        turler = {}
        for f in fc["features"]:
            t = f["geometry"].get("type", "?")
            turler[t] = turler.get(t, 0) + 1
        result = {"geojson": fc, "ad": file.filename, "sayi": len(fc["features"]),
                  "turler": turler}
        if warnings:
            result["uyarilar"] = warnings
        return result
    except Exception as e:
        return _err(e)


def _geometri_al(gj, cizgi=False):
    """GeoJSON FeatureCollection / Feature / ham geometri → tek geometri sözlüğü.

    Poligonlarda en büyüğü seçilir (havza sınırı), çizgilerde hepsi tek bir
    MultiLineString'te birleştirilir. gis.params_from_basin_polygon shapely
    `shape()` ile ham geometri beklediği için normalleştirme burada yapılır.
    """
    if not gj:
        return None
    from shapely.geometry import mapping, shape

    def geometriler(x):
        if not isinstance(x, dict):
            return []
        t = x.get("type") or ""
        if t == "FeatureCollection":
            out = []
            for f in x.get("features") or []:
                out += geometriler(f)
            return out
        if t == "Feature":
            return geometriler(x.get("geometry"))
        if t == "GeometryCollection":
            out = []
            for g in x.get("geometries") or []:
                out += geometriler(g)
            return out
        return [x] if t else []

    ham = []
    for g in geometriler(gj):
        try:
            ham.append(shape(g))
        except Exception:
            pass
    if not ham:
        return None
    if cizgi:
        parcalar = []
        for g in ham:
            if g.geom_type == "LineString":
                parcalar.append(g)
            elif g.geom_type == "MultiLineString":
                parcalar += list(g.geoms)
        if not parcalar:
            return None
        from shapely.geometry import MultiLineString
        return mapping(MultiLineString(parcalar))
    poligonlar = []
    for g in ham:
        if g.geom_type == "Polygon":
            poligonlar.append(g)
        elif g.geom_type == "MultiPolygon":
            poligonlar += list(g.geoms)
    if not poligonlar:
        return None
    return mapping(max(poligonlar, key=lambda p: p.area))


def _havza_parametreleri(havza_gj, dere_gj=None, river_km2=1.0, dem_source="auto"):
    """Havza poligonundan DEM ile parametre üretir (alt süreçte).

    Hem dosyadan içe aktarmada hem haritada elle düzenlemede kullanılan ortak
    yol. Alt süreç, numba/rasyonel bellek kullanımını ana süreçten ayırır.
    """
    import sys
    payload = json.dumps({"havza": havza_gj, "river_km2": river_km2,
                          "dem_source": dem_source, "dere": dere_gj})
    proc = subprocess.run(
        [sys.executable, "-m", "backend.core._import_basin_subprocess"],
        input=payload, capture_output=True, text=True, encoding="utf-8",
        errors="replace", timeout=480, cwd=ROOT)
    if proc.returncode != 0:
        msg = proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else "subprocess failed"
        raise RuntimeError(msg)
    return json.loads(proc.stdout.strip().splitlines()[-1])


def _yzd_ekle(result):
    """Sonuca YZD alansal dağılım bölgesini ekler (hata olursa boş bırakır)."""
    try:
        from backend.core import yzd_region
        result["yzd_bolge"] = yzd_region.detect(
            basin_geojson=result.get("havza_geojson"),
            lat=result["outlet"]["lat"], lon=result["outlet"]["lon"])
    except Exception as e:
        result["yzd_bolge"] = {"bolge": None, "yontem": None, "hata": str(e)}
    return result


@app.post("/api/basin-from-geometry")
def api_basin_from_geometry(req: BasinGeomReq):
    """Haritada elle düzenlenmiş havza sınırı (+dere) için parametreleri
    yeniden üretir. /api/import-basin ile aynı işi yapar, farkı girdinin
    dosya değil doğrudan GeoJSON olması."""
    acquired = _delineate_lock.acquire(blocking=False)
    if not acquired:
        return JSONResponse(status_code=503,
            content={"hata": "Havza çıkarımı devam ediyor, lütfen bekleyip tekrar deneyin."})
    try:
        havza = _geometri_al(req.havza_geojson)
        if havza is None:
            raise RuntimeError("Havza sınırı bir poligon olmalı")
        dere = _geometri_al(req.dere_geojson, cizgi=True)
        result = _havza_parametreleri(havza, dere, req.river_km2, req.dem_source)
        if dere:
            result["dere_geojson"] = req.dere_geojson
            result["dere_kaynagi"] = "duzenleme"
        else:
            result["dere_kaynagi"] = "dem"
        result["kaynak"] = "duzenleme"
        return _yzd_ekle(result)
    except subprocess.TimeoutExpired:
        return _err(RuntimeError("İşlem zaman aşımına uğradı (8 dk)"))
    except Exception as e:
        return _err(e)
    finally:
        _delineate_lock.release()


@app.post("/api/import-basin")
async def api_import_basin(file: UploadFile = File(...),
                           dere_file: UploadFile | None = File(None),
                           river_km2: float = 1.0, dem_source: str = "auto"):
    """Dışarıdan çizilmiş havza sınırı (+dere) dosyasını okur ve kalan
    parametreleri (A, L, Lc, kotlar, dere ağı, çıkış noktası) DEM'den üretir."""
    from backend.core import vektor
    acquired = _delineate_lock.acquire(blocking=False)
    if not acquired:
        return JSONResponse(status_code=503,
            content={"hata": "Havza çıkarımı devam ediyor, lütfen bekleyip tekrar deneyin."})
    try:
        veri = await file.read()
        gj = vektor.oku(veri, file.filename or "")
        # ayrı dere dosyası verildiyse onun çizgilerini kullan
        if dere_file is not None and getattr(dere_file, "filename", ""):
            dgj = vektor.oku(await dere_file.read(), dere_file.filename or "", poligon_zorunlu=False)
            if dgj.get("dereler"):
                gj["dereler"] = dgj["dereler"]
                gj["cizgi_sayisi"] = dgj["cizgi_sayisi"]
        result = _havza_parametreleri(gj["havza"], gj.get("dereler"),
                                      river_km2, dem_source)
        # kullanıcı dere ağı da verdiyse DEM'den türetilen yerine onu göster
        if gj.get("dereler"):
            result["dere_geojson"] = gj["dereler"]
            result["dere_kaynagi"] = "ice_aktarim"
        else:
            result["dere_kaynagi"] = "dem"
        result["ice_aktarim"] = {"poligon_sayisi": gj["poligon_sayisi"],
                                 "cizgi_sayisi": gj["cizgi_sayisi"],
                                 "dosya": file.filename}
        return _yzd_ekle(result)
    except subprocess.TimeoutExpired:
        return _err(RuntimeError("İşlem zaman aşımına uğradı (8 dk)"))
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
                              "river_km2": req.river_km2, "snap_m": req.snap_m,
                              "dem_source": req.dem_source})
        proc = subprocess.run(
            [sys.executable, "-m", "backend.core._multi_delineate_subprocess"],
            input=payload, capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=300,
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
        return routing.route(req.ara_sonuc, req.memba_sonuclari, req.lag_saat,
                             req.yontemler, rezervuarlar=req.rezervuarlar)
    except Exception as e:
        return _err(e)


@app.post("/api/cn")
def api_cn(req: CNReq):
    from backend.core import corine
    try:
        return corine.cn_from_basin(req.havza_geojson, req.zemin_grubu)
    except Exception as e:
        return _err(e)


@app.post("/api/zemin-grubu")
def api_zemin_grubu(req: CNReq):
    """Havzanın hidrolojik zemin grubu (A/B/C/D) — toprağından belirlenir.

    Grup, CN üzerinden sonucu en çok değiştiren girdidir; eskiden gerekçesiz
    bir varsayılan (B) olarak duruyordu. Artık SoilGrids dokusundan NRCS
    ölçütüyle belirlenir ve GEREKÇESİ döndürülür — kullanıcı görüp
    değiştirebilsin diye.
    """
    from backend.core import zemin
    try:
        if not zemin.var_mi():
            return {"var": False}
        return {"var": True, **zemin.havza(req.havza_geojson)}
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
def api_stations_default(en_az_yil: int = 10):
    """Thiessen'in varsayılan istasyon kümesi — yalnız MGM ölçüm veri tabanı.

    Yıllık maksimum serisi `en_az_yil` uzunluğunda olan istasyonlar döner, yani
    her Thiessen hücresi kendi ölçtüğü yağışı taşır ve Adım 3’teki P24
    bağlanması kimlik eşleşmesidir.

    Eski `data/stations/bir_cikti.kml` artık otomatik yüklenmiyor; dosya
    duruyor ve `POST /api/stations` ile elle yüklenebilir (o zaman istasyonlar
    kod taşımadığı için P24 en yakın uygun MGM istasyonundan koordinatla gelir).
    """
    from backend.core import mgm
    try:
        sts = mgm.thiessen_kumesi(en_az_yil)
        return {"istasyonlar": sts, "kaynak": "mgm", "dosya": "mgm.sqlite",
                "en_az_yil": en_az_yil, "olcumlu": len(sts)}
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
        sonuc, elenen = thiessen.weights(req.havza_geojson, req.istasyonlar,
                                         min_agirlik=req.min_agirlik)
        return {"sonuc": sonuc, "elenen": elenen}
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
    # Hazır istasyon kaldırıldı — tek kaynak MGM PLV (otomatik) + manuel 14 oran
    # 404: istemci GET /api/dplv çağırıyorsa artık yok; /api/mgm-stations veya /api/plv-en-yakin kullan
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=404, content={"hata": "Hazır istasyon kaldırıldı — MGM PLV (otomatik) veya elle 14 oran kullanın. Kaynak: /api/mgm-stations, /api/plv-en-yakin"})


@app.get("/api/mgm-stations")
def api_mgm_stations():
    """MGM 2020 tablosu — YALNIZ plüviyograf (PLV) oranları.

    Bu tablonun P24 sütunları bilerek döndürülmüyor. P2…P100 artık
    `/api/mgm-frekans` ile 1290 istasyonun ham yıllık maksimum ölçümünden
    hesaplanıyor; hazır tekerrür tablosunu paralelde tutmak, iki farklı
    kaynaktan iki farklı yağış üretip hangisinin kullanıldığını belirsiz
    bırakırdı. Uçtan tümüyle çıkarmak, kazara yeniden bağlanmasını da önler.
    """
    from backend.core import tables
    try:
        d = tables.load("mgm_plv_2020")
        return {**d, "istasyonlar": [{"no": s.get("no"), "ad": s["ad"],
                                      "plv": s["plv"]}
                                     for s in d["istasyonlar"]]}
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
            n_kapak=req.kapak_adedi,
            pik_sonrasi_bosalt=req.pik_sonrasi_bosalt)
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
        # DPLV 14 oran zorunlu — tek doğrulama (tables.dogrula_dplv)
        tables.dogrula_dplv(g.get("dplv_ratios"))
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


@app.get("/api/akarsu-bilgi")
def api_akarsu_bilgi():
    """DSİ akarsu ağı katmanı kurulu mu, hangi ölçekte kaç kol var."""
    from backend.core import akarsu
    try:
        return akarsu.bilgi()
    except Exception as e:
        return _err(e)


@app.get("/api/akarsu")
def api_akarsu(bati: float, guney: float, dogu: float, kuzey: float,
               olcek: str = "oto", sinir: int = 0):
    """Görünen pencere içindeki DSİ akarsu kollarını GeoJSON olarak verir.

    Türkiye geneli üç ölçekte ~405.000 çizgi olduğu için tamamı gönderilmez;
    R*Tree indeksiyle yalnız pencere döndürülür. Bu katman hesaba girmez."""
    from backend.core import akarsu
    try:
        return akarsu.sorgula((bati, guney, dogu, kuzey), olcek=olcek,
                              sinir=sinir or akarsu.VARSAYILAN_SINIR)
    except Exception as e:
        return _err(e)


@app.get("/api/agi-bilgi")
def api_agi_bilgi():
    """AGİ pik akım veri tabanı kurulu mu, kaç istasyon/kayıt var."""
    from backend.core import agi
    try:
        return agi.bilgi()
    except Exception as e:
        return _err(e)


@app.get("/api/agi")
def api_agi(bati: float, guney: float, dogu: float, kuzey: float,
            en_az_yil: int = 10, kurum: str = ""):
    """Pencere içindeki AGİ'ler (frekans analizine uygun uzunlukta olanlar)."""
    from backend.core import agi
    try:
        return {"istasyonlar": agi.pencere((bati, guney, dogu, kuzey),
                                           en_az_yil=en_az_yil, kurum=kurum or None)}
    except Exception as e:
        return _err(e)


class AgiHavzaGirdi(BaseModel):
    geometri: dict                      # havza poligonu (GeoJSON geometry)
    tampon_derece: float = 0.25         # havza dışını da göster (bölgesel analiz için)
    en_az_yil: int = 10
    kurum: str = ""


@app.post("/api/agi-havza")
def api_agi_havza(g: AgiHavzaGirdi):
    """Çıkarılan havzanın içindeki ve çevresindeki AGİ'ler."""
    from backend.core import agi
    try:
        return {"istasyonlar": agi.poligon(g.geometri, tampon_derece=g.tampon_derece,
                                           en_az_yil=g.en_az_yil, kurum=g.kurum or None)}
    except Exception as e:
        return _err(e)


@app.get("/api/agi-seri")
def api_agi_seri(kod: str, ilk_yil: int = 0, son_yil: int = 0,
                 dusuk_guveni_at: bool = False):
    """Bir AGİ'nin yıllık maksimum akım serisi (analiz öncesi gözden geçirmek için)."""
    from backend.core import agi
    try:
        return {"istasyon": agi.istasyon(kod),
                "seri": agi.seri(kod, ilk_yil or None, son_yil or None, dusuk_guveni_at)}
    except Exception as e:
        return _err(e)


@app.get("/api/mgm-bilgi")
def api_mgm_bilgi():
    """MGM meteoroloji veri tabanı kurulu mu, kaç istasyon frekansa uygun."""
    from backend.core import mgm
    try:
        return mgm.bilgi()
    except Exception as e:
        return _err(e)


@app.get("/api/mgm")
def api_mgm(bati: float, guney: float, dogu: float, kuzey: float,
            en_az_yil: int = 10):
    """Pencere içindeki MGM istasyonları (yıllık maksimum serisi olanlar)."""
    from backend.core import mgm
    try:
        return {"istasyonlar": mgm.pencere((bati, guney, dogu, kuzey),
                                           en_az_yil=en_az_yil)}
    except Exception as e:
        return _err(e)


@app.get("/api/mgm-seri")
def api_mgm_seri(kod: str, tur: str = ""):
    """Bir MGM istasyonunun yıllık maksimum serisi ya da istenen rasat türü."""
    from backend.core import mgm
    try:
        out = {"istasyon": mgm.istasyon(kod), "turler": mgm.turler(kod)}
        out["seri"] = mgm.seri(kod, tur) if tur else mgm.yillik_maks(kod)
        return out
    except Exception as e:
        return _err(e)


class MgmFrekansGirdi(BaseModel):
    kod: str
    ilk_yil: int = 0
    son_yil: int = 0


@app.post("/api/mgm-frekans")
def api_mgm_frekans(g: MgmFrekansGirdi):
    """Yağış frekans analizi — NTFA ile aynı hesap, girdi yıllık en büyük
    günlük yağış (mm). Sonuçtaki `P24`, Adım 3 tablosunun P2…P100 sütunları."""
    from backend.core import mgm
    try:
        return mgm.frekans(g.kod, g.ilk_yil or None, g.son_yil or None)
    except Exception as e:
        return _err(e)


class MgmEslesGirdi(BaseModel):
    istasyonlar: list[dict]             # [{ad|name, lat, lon}] — Thiessen satırları
    en_az_yil: int = 10
    en_cok_km: float = 25.0
    tercih_yil: int = 25                # yarıçap içinde bu uzunluktaki seri yeğlenir
    hesapla: bool = True                # eşleşenler için P2…P100'ü de üret


@app.post("/api/mgm-eslestir")
def api_mgm_eslestir(g: MgmEslesGirdi):
    """Thiessen istasyonlarını MGM veri tabanına bağlar ve P2…P100 hesaplar.

    Önce koordinat, sonra ad denenir — KMZ'deki ad serbest metindir, koordinat
    ölçülmüş büyüklüktür. Eşleşmenin hangi yolla ve kaç km'den kurulduğu
    döndürülür ki kullanıcı kararı denetleyebilsin."""
    from backend.core import mgm
    try:
        out = mgm.eslestir(g.istasyonlar, en_az_yil=g.en_az_yil,
                           en_cok_km=g.en_cok_km, tercih_yil=g.tercih_yil)
        if g.hesapla:
            onbellek = {}
            for k in out:
                e = k.get("eslesen")
                if not e:
                    continue
                kod = e["kod"]
                if kod not in onbellek:
                    try:
                        f = mgm.frekans(kod)
                        onbellek[kod] = {"P24": f["P24"],
                                         "dagilim": f["kabul_edilen_adi"],
                                         "yil_sayisi": f["parametreler"]["yil_sayisi"]}
                    except Exception as hata:
                        onbellek[kod] = {"hata": str(hata)}
                k["frekans"] = onbellek[kod]
        return {"eslesme": out}
    except Exception as e:
        return _err(e)


class PlvEnYakinGirdi(BaseModel):
    havza_geojson: dict | None = None       # Polygon/Feature/FeatureCollection
    lat: float | None = None
    lon: float | None = None

    @model_validator(mode="after")
    def _validate(self):
        has_hj = self.havza_geojson is not None
        has_ll = self.lat is not None or self.lon is not None
        has_both_ll = self.lat is not None and self.lon is not None
        if has_hj and has_ll:
            raise ValueError("havza_geojson ve lat/lon aynı anda verilemez")
        if not has_hj and not has_ll:
            raise ValueError("havza_geojson veya lat/lon gerekli")
        if has_ll and not has_both_ll:
            raise ValueError("lat ve lon birlikte verilmeli")
        return self


@app.post("/api/plv-en-yakin")
def api_plv_en_yakin(g: PlvEnYakinGirdi):
    """Havzaya en yakın MGM PLV istasyonu (DPLV oranı için).

    Havza verilirse centroid’i üzerinden, yoksa lat/lon doğrudan kullanılır.
    Küresel en yakın — yarıçap limiti yok, mesafe _mesafe_km ile.
    """
    from backend.core import mgm
    try:
        return mgm.plv_en_yakin(havza_geojson=g.havza_geojson, lat=g.lat, lon=g.lon)
    except Exception as e:
        return _err(e)


@app.get("/api/plv-en-yakin")
def api_plv_en_yakin_get(lat: float, lon: float):
    """GET varyantı — havza yokken nokta için en yakın PLV."""
    from backend.core import mgm
    try:
        return mgm.plv_en_yakin(lat=lat, lon=lon)
    except Exception as e:
        return _err(e)


class TfaGirdi(BaseModel):
    kod: str = ""                       # AGİ kodu (veriyi veri tabanından al)
    x: list[float] | None = None        # ya da doğrudan seri ver
    yillar: list[int] | None = None
    ilk_yil: int = 0
    son_yil: int = 0
    dusuk_guveni_at: bool = False
    # Fiziksel olarak olanaksız kayıtları ele (Creager dünya zarfı + aykırı
    # işaret × oran). Varsayılan AÇIK: kapalıyken D24A029'un bozuk 1981 kaydı
    # Q100'ü 1301 yerine 7314 m³/s veriyordu.
    olanaksizi_at: bool = True
    # Grubbs-Beck aykırılarını çıkarıp analizi bir kez daha koş; ikinci sonuç
    # `aykirisiz` altında döner. Asıl sonuç değişmez — amaç karşılaştırma.
    aykiri_disla: bool = False


@app.post("/api/tfa")
def api_tfa(g: TfaGirdi):
    """Noktasal Taşkın Frekans Analizi (NTFA) — DSİ ekstrem dağılım hesabı.

    Altı dağılım moment yöntemiyle uydurulur, Simirnov-Kolmogorov testiyle
    karşılaştırılır; Dmax'ı en küçük olan "kabul edilen" dağılımdır."""
    from backend.core import agi, tfa
    try:
        ad, x, yillar, elenen = g.kod, g.x, g.yillar, []
        if g.kod:
            ist = agi.istasyon(g.kod)
            s, elenen = agi.seri_denetimli(
                g.kod, g.ilk_yil or None, g.son_yil or None,
                g.dusuk_guveni_at, g.olanaksizi_at)
            x = [k["q"] for k in s]
            yillar = [k["yil"] for k in s]
            ad = f"{ist['kod']} {ist['ad']}".strip()
        if not x:
            raise ValueError("Analiz için seri gerekli (kod ya da x)")
        sonuc = tfa.ozet(x, istasyon=ad, yillar=yillar,
                         aykiri_disla=g.aykiri_disla)
        if g.kod:
            sonuc["istasyon_bilgi"] = agi.istasyon(g.kod)
        # Elenen kayıtlar sonuçla birlikte döner: hangi değerin neden analiz
        # dışı kaldığı görünmezse, bir sessiz varsayılanı başkasıyla
        # değiştirmiş oluruz.
        sonuc["elenen_kayitlar"] = elenen
        return sonuc
    except Exception as e:
        return _err(e)


class BtfaGirdi(BaseModel):
    kodlar: list[str]                   # bölgesel analize girecek AGİ'ler
    alan_km2: float                     # proje havzasının yağış alanı
    us: float | None = None             # alan-debi üssü (boşsa veriden hesaplanır)
    katsayi: float | None = None        # bağıntı katsayısı (üs elle verildiyse, vars. 1)
    katsayi_serbest: bool = False       # regresyonda a serbest mi, a=1 mi
    disla: list[str] = []               # büyüme eğrisine katılmayacaklar
    transfer_kod: str = ""              # tek istasyondan alan oranıyla aktarım
    transfer_ussu: float = 2.0 / 3.0
    aykiri_disla: bool = False          # homojen olmayanları çıkarıp tekrar koş
    ilk_yil: int = 0
    son_yil: int = 0
    dusuk_guveni_at: bool = False


@app.post("/api/btfa")
def api_btfa(g: BtfaGirdi):
    """Bölgesel Taşkın Frekans Analizi (BTFA) — indeks-debi yöntemi.

    Seçilen AGİ'lerin her biri için NTFA yapılır, boyutsuz büyüme eğrileri
    (QT/Q2) ortalanır ve havzanın indeks debisi alan-debi bağıntısından
    bulunarak Q2…Q10000 üretilir."""
    from backend.core import agi, btfa
    try:
        seriler = []
        for kod in g.kodlar:
            ist = agi.istasyon(kod)
            s = agi.seri(kod, g.ilk_yil or None, g.son_yil or None, g.dusuk_guveni_at)
            seriler.append({"kod": kod, "ad": ist["ad"], "alan": ist["yagis_alani"],
                            "x": [k["q"] for k in s]})
        eksik = [s["kod"] for s in seriler if not s["alan"]]
        if eksik:
            raise ValueError("Yağış alanı bilinmeyen istasyon bölgesel analize "
                             f"giremez: {', '.join(eksik)}")
        return btfa.bolgesel(seriler, g.alan_km2, us=g.us, katsayi=g.katsayi,
                             katsayi_serbest=g.katsayi_serbest, disla=g.disla,
                             transfer_kod=g.transfer_kod or None,
                             transfer_ussu=g.transfer_ussu,
                             aykiri_disla=g.aykiri_disla)
    except Exception as e:
        return _err(e)


@app.get("/api/mmy-bolgeler")
def api_mmy_bolgeler():
    """Km zarf eğrisi tanımlı bölgeler (MMY hesabı için)."""
    from backend.core import mmy
    try:
        return {"bolgeler": mmy.bolgeler()}
    except Exception as e:
        return _err(e)


class MmyGirdi(BaseModel):
    p: list[float]                      # 1 günlük yıllık en büyük yağışlar (mm)
    bolge_no: int
    m1_ort: float = 1.0                 # Hershfield abaklarından okunur
    m2_ort: float = 1.0
    m1_s: float = 1.0
    m2_s: float = 1.0
    gun_katsayisi: bool = False         # sabit saat -> gerçek 24 saat (1.13)
    istasyon: str = ""


@app.post("/api/mmy")
def api_mmy(g: MmyGirdi):
    """Muhtemel Maksimum Yağış (MMY/PMP) — Hershfield yöntemi.

    Çıkan yağış derinliği, hesap adımındaki P24_OET girdisine yazılarak
    muhtemel maksimum feyezan (QOET) elde edilir."""
    from backend.core import mmy
    try:
        return mmy.hesapla(g.p, g.bolge_no, m1_ort=g.m1_ort, m2_ort=g.m2_ort,
                           m1_s=g.m1_s, m2_s=g.m2_s,
                           gun_katsayisi=g.gun_katsayisi, istasyon=g.istasyon)
    except Exception as e:
        return _err(e)


@app.get("/api/su-bilgi")
def api_su_bilgi():
    """Su potansiyeli (günlük akım) veri tabanı kurulu mu."""
    from backend.core import su
    try:
        return su.bilgi()
    except Exception as e:
        return _err(e)


@app.get("/api/su-istasyon")
def api_su_istasyon(bati: float, guney: float, dogu: float, kuzey: float,
                    en_az_yil: int = 5):
    """Pencere içindeki günlük akım istasyonları."""
    from backend.core import su
    try:
        return {"istasyonlar": su.pencere((bati, guney, dogu, kuzey),
                                          en_az_yil=en_az_yil)}
    except Exception as e:
        return _err(e)


class SuGirdi(BaseModel):
    kod: str
    ilk_yil: int = 0                    # su yılı sınırları (boş = tümü)
    son_yil: int = 0
    talep_ls: float | None = None       # sürekli su talebi (L/s)


class SuHavzaGirdi(BaseModel):
    geometri: dict                      # havza poligonu (GeoJSON geometry)
    tampon_derece: float = 0.35
    en_az_yil: int = 10


@app.post("/api/su-havza")
def api_su_havza(g: SuHavzaGirdi):
    """Havzanın içindeki ve çevresindeki günlük akım istasyonları."""
    from backend.core import su
    try:
        return {"istasyonlar": su.havza(g.geometri, g.tampon_derece, g.en_az_yil)}
    except Exception as e:
        return _err(e)


class SuPeriyotGirdi(BaseModel):
    kodlar: list[str]
    ilk_yil: int
    son_yil: int


@app.post("/api/su-periyot")
def api_su_periyot(g: SuPeriyotGirdi):
    """İstasyon × su yılı ölçüm durumu (tam / eksik / yok) + çift korelasyonlar."""
    from backend.core import su
    try:
        return {"tablo": su.periyot_tablosu(g.kodlar, g.ilk_yil, g.son_yil),
                "korelasyon": su.korelasyon(g.kodlar, g.ilk_yil, g.son_yil)}
    except Exception as e:
        return _err(e)


class SuTamamlaGirdi(BaseModel):
    hedef: str                          # havzayı temsil edecek AGİ
    vericiler: list[str]                # eksik yılların doldurulacağı istasyonlar
    ilk_yil: int
    son_yil: int
    en_az_r2: float = 0.5
    havza_alani_km2: float | None = None
    us: float = 1.0                     # alan oranı üssü (hacimde ~1)


@app.post("/api/su-tamamla")
def api_su_tamamla(g: SuTamamlaGirdi):
    """Eksik su yıllarını regresyonla tamamlar, sonra havza çıkışına taşır."""
    from backend.core import su
    try:
        o = su.tamamla(g.hedef, g.vericiler, g.ilk_yil, g.son_yil, g.en_az_r2)
        o["istasyon"] = su.istasyon(g.hedef)
        if g.havza_alani_km2:
            o["outlet"] = su.outlet(o["seri"], o["istasyon"]["alan_km2"],
                                    g.havza_alani_km2, g.us)
        return o
    except Exception as e:
        return _err(e)


@app.post("/api/su")
def api_su(g: SuGirdi):
    """Su potansiyeli: ortalama akım, aylık dağılım, yıllık hacim, süreklilik
    eğrisi, güvenilir debiler ve (talep verilirse) karşılanma güvenilirliği."""
    from backend.core import su
    try:
        return su.potansiyel(g.kod, g.ilk_yil or None, g.son_yil or None,
                             talep_ls=g.talep_ls)
    except Exception as e:
        return _err(e)


@app.get("/api/yagis-bilgi")
def api_yagis_bilgi():
    """Yıllık toplam yağış katmanı kurulu mu, kaynağı/lejantı nedir."""
    from backend.core import yagis
    try:
        return yagis.bilgi()
    except Exception as e:
        return _err(e)


@app.get("/api/yagis/{katman}/{z}/{x}/{y}.png")
def api_yagis_karo(katman: str, z: int, x: int, y: int):
    """Yağış/PET/net yağış XYZ karo servisi (renk merdivenli, saydam)."""
    from fastapi.responses import Response
    from backend.core import yagis
    try:
        if not (0 <= z <= 22):
            raise ValueError("geçersiz zoom")
        png = yagis.karo(z, x, y, katman)
    except Exception as e:
        return _err(e)
    if png is None:
        return Response(status_code=204)
    return Response(content=png, media_type="image/png",
                    headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/yagis-nokta")
def api_yagis_nokta(lat: float, lon: float):
    """Tıklanan noktada yağış / PET / net yağış (mm/yıl)."""
    from backend.core import yagis
    try:
        return yagis.nokta(lat, lon)
    except Exception as e:
        return _err(e)


class YagisHavzaGirdi(BaseModel):
    geometri: dict


@app.post("/api/yagis-havza")
def api_yagis_havza(g: YagisHavzaGirdi):
    """Havza üzerindeki alansal ortalama yıllık yağış."""
    from backend.core import yagis
    try:
        return yagis.havza_ortalamasi(g.geometri)
    except Exception as e:
        return _err(e)


@app.get("/api/raster-layers")
def api_raster_layers():
    """Kayıtlı koordinatlı raster altlıklar (1/25000 paftalar vb.)."""
    from backend.core import raster
    try:
        return {"katmanlar": raster.listele()}
    except Exception as e:
        return _err(e)


# ana raster sayılan uzantılar; kalanlar yan dosya (.sdw/.tfw/.prj/.aux.xml)
RASTER_UZANTI = (".tif", ".tiff", ".geotiff", ".vrt", ".img", ".sid", ".png", ".jpg", ".jpeg", ".ecw")


@app.post("/api/raster-add")
async def api_raster_add(files: list[UploadFile] = File(...),
                         crs: str = "", baslik: str = ""):
    """Koordinatlı raster altlık yükler.

    Birden çok dosya gönderilebilir: ilk raster dosyası ana katman, kalanlar
    yan dosya olarak (world file .sdw/.tfw, .prj, .aux.xml) yanına yazılır —
    georeferans dosyanın içinde değil de .sdw'de olduğunda bu şarttır.
    .sid gönderilirse harici GDAL ile GeoTIFF'e çevrilir.
    crs, dosyada CRS yoksa zorunlu (EPSG:23037 = ED50/UTM 37N,
    EPSG:32637 = WGS84/UTM 37N)."""
    from backend.core import raster
    try:
        okunan = [(f.filename or "", await f.read()) for f in files]
        if not okunan:
            raise RuntimeError("Dosya seçilmedi")
        ana = next((i for i, (n, _) in enumerate(okunan)
                    if n.lower().endswith(RASTER_UZANTI)), None)
        if ana is None:
            raise RuntimeError(
                "Raster dosyası bulunamadı. Ana dosya şu biçimlerden biri olmalı: "
                + ", ".join(RASTER_UZANTI))
        ad, veri = okunan[ana]
        ana_kok = os.path.splitext(os.path.basename(ad))[0].lower()
        yan = []
        for i, (yan_ad, yan_veri) in enumerate(okunan):
            if i == ana:
                continue
            yan_ad_kucuk = os.path.basename(yan_ad).lower()
            if yan_ad_kucuk.endswith(".ovr") or (
                yan_ad_kucuk.endswith(".xml") and not yan_ad_kucuk.endswith(".aux.xml")
            ):
                raise RuntimeError("Yalnızca eşleşen raster yan dosyaları kabul edilir; .ovr ve genel .xml yüklenemez")
            yan_uzanti = (".aux.xml" if yan_ad_kucuk.endswith(".aux.xml")
                          else os.path.splitext(yan_ad_kucuk)[1])
            if yan_uzanti not in (".tfw", ".wld", ".sdw", ".prj", ".aux.xml"):
                raise RuntimeError(f"Desteklenmeyen raster yan dosyası: {yan_ad}")
            beklenen = (ana_kok + yan_uzanti if yan_uzanti != ".aux.xml"
                        else os.path.basename(ad).lower() + yan_uzanti)
            if yan_ad_kucuk != beklenen:
                raise RuntimeError(f"Raster yan dosyası ana dosyayla eşleşmiyor: {yan_ad}")
            yan.append((yan_ad, yan_veri))
        return raster.ekle(veri, ad, crs=crs.strip() or None,
                           baslik=baslik.strip() or None, yardimci=yan)
    except Exception as e:
        return _err(e)


@app.get("/api/raster-converter")
def api_raster_converter():
    """MrSID (.sid) dönüştürücüsü kurulu mu — arayüzde uyarı göstermek için."""
    from backend.core import raster
    try:
        return raster.cevirici_durumu()
    except Exception as e:
        return _err(e)


@app.post("/api/raster-delete")
def api_raster_delete(req: RasterSilReq):
    from backend.core import raster
    try:
        return raster.sil(req.ad)
    except Exception as e:
        return _err(e)


@app.get("/api/raster/{ad}/{z}/{x}/{y}.png")
def api_raster_tile(ad: str, z: int, x: int, y: int):
    """XYZ karo servisi — Leaflet L.tileLayer bu adresi çağırır."""
    from fastapi.responses import Response
    from backend.core import raster
    try:
        if not (0 <= z <= 22):
            raise ValueError("geçersiz zoom")
        png = raster.karo(ad, z, x, y)
    except Exception as e:
        return _err(e)
    if png is None:
        return Response(status_code=204)          # kapsam dışı / tamamen saydam
    return Response(content=png, media_type="image/png",
                    headers={"Cache-Control": "public, max-age=86400"})


@app.post("/api/kmz-export")
def api_kmz_export(req: KmzReq):
    """Nihai havza sınırı, dere ağı ve seçili yöntemin tekerrürlü pik
    debilerini Google Earth'te açılan tek bir .kmz olarak döndürür."""
    from fastapi.responses import Response
    from backend.core import kmz_export
    try:
        veri = req.model_dump()
        if not veri.get("havza_geojson"):
            raise RuntimeError("Havza sınırı yok — önce havzayı çıkarın")
        data = kmz_export.build(veri)
        # HTTP başlığı ASCII olmalı: Türkçe karakterleri sadeleştir
        tr = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
        ad = _safe(req.ad or "havza")
        fn = re.sub(r"[^A-Za-z0-9_.-]+", "_", ad.translate(tr)).strip("_") + "_havza.kmz"
        return Response(
            content=data,
            media_type="application/vnd.google-earth.kmz",
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
# /static altındaki JS/CSS hiç önbelleklenmesin: modül yapısında derin içe
# aktarmalar ?v= damgasıyla tek tek sürümlenemez; dosya değişince tarayıcı
# aynı oturumda taze kod görmeli. Karolar/API yanıtları etkilenmez.
@app.middleware("http")
async def _static_no_cache(request, call_next):
    response = await call_next(request)
    p = request.url.path
    if p.startswith("/static") and (p.endswith(".js") or p.endswith(".css")):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


app.mount("/static", StaticFiles(directory=FRONTEND), name="static")


@app.get("/")
def index():
    # index.html de önbelleğe alınmamalı: içindeki script/link referansları
    # eski kalırsa yeni eklenen alanlar (ör. DEM kaynağı seçici) arayüzde
    # hiç görünmez. /static/*.{js,css} için yukarıdaki middleware aynısını yapar.
    return FileResponse(
        os.path.join(FRONTEND, "index.html"),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate",
                 "Pragma": "no-cache", "Expires": "0"})
