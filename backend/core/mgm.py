# -*- coding: utf-8 -*-
"""MGM'nin kanonik istasyon kayıt defteri ve PLV eşleştirmesi."""
import hashlib
import json
import math
import os
import re
import unicodedata
from collections import Counter
from functools import lru_cache

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
JSON_YOLU = os.path.join(ROOT, "data", "mgm", "mgm-istasyonlari.json")
VARSAYILAN_SINIR = 3000

ALAN_ESLEME = (
    ("istNo", "istasyon_no"),
    ("istAd", "istasyon_adi"),
    ("enlem", "enlem"),
    ("boylam", "boylam"),
    ("yukseklik", "yukseklik"),
    ("ilPlaka", "il_plaka"),
    ("il", "il"),
    ("ilce", "ilce"),
    ("BirimId", "birim_id"),
    ("Indikator", "indikator"),
    ("BasincSensor", "basinc_sensor"),
    ("NemSensor", "nem_sensor"),
    ("RuzgarSensor", "ruzgar_sensor"),
    ("SicaklikSensor", "sicaklik_sensor"),
    ("ToprakSicSensor", "toprak_sic_sensor"),
    ("HaliHazirHavaSensor", "hali_hazir_hava_sensor"),
    ("OmgiGrupAdi", "omgi_grup_adi"),
    ("YagisSensor", "yagis_sensor"),
    ("KarSensor", "kar_sensor"),
)


def var_mi():
    return os.path.isfile(JSON_YOLU)


def _normalize(kayit):
    out = {hedef: kayit.get(kaynak) for kaynak, hedef in ALAN_ESLEME}
    out.update({
        "kod": str(out["istasyon_no"]),
        "ad": out["istasyon_adi"],
        "lat": out["enlem"],
        "lon": out["boylam"],
        "kot": out["yukseklik"],
    })
    return out


@lru_cache(maxsize=1)
def _kayitlar():
    if not var_mi():
        raise RuntimeError(f"MGM istasyon kayıt defteri yok: {JSON_YOLU}")
    with open(JSON_YOLU, encoding="utf-8") as f:
        iller = json.load(f)
    return tuple(_normalize(k) for satirlar in iller.values() for k in satirlar)


@lru_cache(maxsize=1)
def _kimlik_indeksi():
    return {k["kod"]: k for k in _kayitlar()}


def istasyon(kod):
    anahtar = str(kod or "").strip()
    if not anahtar.isdigit():
        raise ValueError(f"Geçersiz istasyon kodu: {kod}") from None
    kayit = _kimlik_indeksi().get(anahtar)
    if kayit is None:
        raise ValueError(f"İstasyon bulunamadı: {kod}")
    return dict(kayit)


def pencere(bbox, sinir=VARSAYILAN_SINIR):
    """Penceredeki bütün istasyonları döndür; sensör türüne göre eleme yapma."""
    b, g, d, k = (float(v) for v in bbox)
    if not (-180 <= b < d <= 180 and -90 <= g < k <= 90):
        raise ValueError("Geçersiz pencere (bbox)")
    n = max(1, min(int(sinir), 10000))
    satirlar = [s for s in _kayitlar()
                if s["lon"] is not None and s["lat"] is not None
                and b <= s["lon"] <= d and g <= s["lat"] <= k]
    return [dict(s) for s in sorted(satirlar, key=lambda x: (x["ad"], x["kod"]))[:n]]


def thiessen_kumesi():
    """Varsayılan Thiessen kümesi: yalnız yağış sensörü bulunan istasyonlar."""
    satirlar = sorted((s for s in _kayitlar() if s["yagis_sensor"] == 1),
                      key=lambda x: (x["ad"], x["kod"]))
    return [dict(s, name=s["ad"], kurum="MGM", kaynak="mgm") for s in satirlar]


_TR_BUYUK = str.maketrans("abcçdefgğhıijklmnoöprsştuüvyzqwx",
                          "ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZQWX")


def _normalize_base(ad):
    s = unicodedata.normalize("NFKD", str(ad or "").translate(_TR_BUYUK))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return (s.replace("Ğ", "G").replace("Ş", "S").replace("Ö", "O")
            .replace("Ü", "U").replace("Ç", "C").replace("İ", "I"))


def _norm(ad):
    s = re.sub(r"\(.*?\)", " ", _normalize_base(ad))
    return re.sub(r"[^A-Z0-9]", "", s)


def _norm_keep_parantez(ad):
    return re.sub(r"[^A-Z0-9]", "", _normalize_base(ad))


def _benzersiz(satirlar):
    return list({s["kod"]: s for s in satirlar}.values())


def _plv_adaylari(n, n_keep, ada_gore, ada_gore_keep):
    """Eski kesinlik sırasını koruyarak ilk aday üreten katmanı döndür."""
    katmanlar = [("tam", ada_gore.get(n, [])),
                 ("tam-keep", ada_gore_keep.get(n_keep, []))]
    if len(n) >= 5:
        katmanlar.extend([
            ("prefix", [s for a, grup in ada_gore.items()
                        if a.startswith(n) or n.startswith(a) for s in grup]),
            ("contains", [s for a, grup in ada_gore.items()
                          if n in a or a in n for s in grup]),
        ])
    if len(n_keep) >= 5:
        katmanlar.append(("contains-keep", [s for a, grup in ada_gore_keep.items()
                                            if n_keep in a or a in n_keep for s in grup]))
    for yontem, adaylar in katmanlar:
        adaylar = _benzersiz(adaylar)
        if adaylar:
            return yontem, adaylar
    return None, []


@lru_cache(maxsize=1)
def _plv_eslestirme():
    from backend.core import tables

    plv_list = tables.load("mgm_plv_2020").get("istasyonlar") or []
    ada_gore, ada_gore_keep = {}, {}
    for s in _kayitlar():
        ada_gore.setdefault(_norm(s["ad"]), []).append(s)
        ada_gore_keep.setdefault(_norm_keep_parantez(s["ad"]), []).append(s)
    eslesenler, belirsizler, cozulemeyenler = [], [], []
    for p in plv_list:
        yontem, adaylar = _plv_adaylari(
            _norm(p.get("ad")), _norm_keep_parantez(p.get("ad")), ada_gore, ada_gore_keep)
        temel = {"no": p.get("no"), "ad": p.get("ad"), "yontem": yontem}
        if len(adaylar) == 1:
            s = adaylar[0]
            eslesenler.append({**temel, "plv": p.get("plv"), "kod": s["kod"],
                               "lat": s["lat"], "lon": s["lon"]})
        elif adaylar:
            belirsizler.append({**temel, "adaylar": [s["kod"] for s in adaylar]})
        else:
            cozulemeyenler.append(temel)
    return {
        "toplam": len(plv_list),
        "eslesenler": tuple(eslesenler),
        "belirsizler": tuple(belirsizler),
        "cozulemeyenler": tuple(cozulemeyenler),
    }


def _plv_haritasi():
    return [dict(s) for s in _plv_eslestirme()["eslesenler"]]


def bilgi():
    if not var_mi():
        return {"var": False, "dosya": os.path.basename(JSON_YOLU)}
    satirlar = _kayitlar()
    plv = _plv_eslestirme()
    with open(JSON_YOLU, "rb") as f:
        sha256 = hashlib.sha256(f.read()).hexdigest()
    yontemler = Counter(s["yontem"] for s in plv["eslesenler"])
    plv_bilgi = {
        "toplam": plv["toplam"],
        "eslesen": len(plv["eslesenler"]),
        "belirsiz": len(plv["belirsizler"]),
        "cozulemeyen": len(plv["cozulemeyenler"]),
        "yontemler": dict(sorted(yontemler.items())),
        "belirsizler": [dict(s) for s in plv["belirsizler"]],
        "cozulemeyenler": [dict(s) for s in plv["cozulemeyenler"]],
    }
    return {
        "var": True,
        "tur": "json-kayit-defteri",
        "dosya": os.path.basename(JSON_YOLU),
        "sha256": sha256,
        "bayt": os.path.getsize(JSON_YOLU),
        "il": len({s["il_plaka"] for s in satirlar}),
        "istasyon": len(satirlar),
        "yagis_sensorlu": sum(s["yagis_sensor"] == 1 for s in satirlar),
        "null": {hedef: sum(s[hedef] is None for s in satirlar)
                 for _, hedef in ALAN_ESLEME},
        "sensor": {hedef: sum(s[hedef] == 1 for s in satirlar)
                   for kaynak, hedef in ALAN_ESLEME if kaynak.endswith("Sensor")},
        "plv": plv_bilgi,
    }


def _mesafe_km(lat1, lon1, lat2, lon2):
    dy = (lat2 - lat1) * 111.32
    dx = (lon2 - lon1) * 111.32 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dx, dy)


def _havza_centroid_lonlat(havza_geojson):
    if not havza_geojson:
        raise ValueError("Havza geometrisi gerekli")
    from shapely.geometry import shape

    def geometriler(x):
        if not isinstance(x, dict):
            return []
        tur = x.get("type") or ""
        if tur == "FeatureCollection":
            return [g for f in x.get("features") or [] for g in geometriler(f)]
        if tur == "Feature":
            return geometriler(x.get("geometry"))
        if tur == "GeometryCollection":
            return [x for g in x.get("geometries") or [] for x in geometriler(g)]
        return [x] if tur else []

    sekiller = []
    for geometri in geometriler(havza_geojson):
        try:
            sekiller.append(shape(geometri))
        except Exception:
            pass
    poligonlar = [p for s in sekiller
                  for p in ([s] if s.geom_type == "Polygon" else
                            list(s.geoms) if s.geom_type == "MultiPolygon" else [])]
    if not poligonlar:
        raise ValueError("Havza poligonu bulunamadı")
    merkez = max(poligonlar, key=lambda p: p.area).centroid
    return float(merkez.x), float(merkez.y)


def plv_en_yakin(havza_geojson=None, lat=None, lon=None):
    if havza_geojson is not None and (lat is not None or lon is not None):
        raise ValueError("havza_geojson ve lat/lon aynı anda verilemez")
    if havza_geojson is not None:
        lon, lat = _havza_centroid_lonlat(havza_geojson)
    if lat is None or lon is None:
        raise ValueError("Havza geometrisi veya lat/lon gerekli")
    lat, lon = float(lat), float(lon)
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("Geçersiz lat/lon")
    harita = _plv_haritasi()
    if not harita:
        raise RuntimeError("MGM PLV eşleştirme haritası boş")
    en = min(harita, key=lambda s: _mesafe_km(lat, lon, s["lat"], s["lon"]))
    return {**en, "mesafe_km": round(_mesafe_km(lat, lon, en["lat"], en["lon"]), 2),
            "centroid": {"lat": round(lat, 6), "lon": round(lon, 6)}}