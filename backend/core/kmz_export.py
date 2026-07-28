# -*- coding: utf-8 -*-
"""Nihai havza sınırı, dere ağı ve tekerrürlü pik debilerin KMZ çıktısı.

Projedeki diğer KML kodu (thiessen.parse_kmz, vektor.oku, yzd_region) yalnızca
OKUR; yazan tek yer burasıdır. Çıktı Google Earth'te açılan bir .kmz'dir
(içinde tek `doc.kml`).

Debiler skaler olduğu için hem <ExtendedData> (makine tarafı: Google Earth'ün
tablo görünümü, ArcGIS/QGIS öznitelik olarak okur) hem de <description>
içinde CDATA HTML tablosu (insan tarafı: balon penceresi) olarak yazılır.
"""
import io
import zipfile

# KML renkleri aabbggrr sırasındadır (RGB'nin tersi) — arayüzdeki renklerle eşleşir
STIL = {
    "havza":  {"cizgi": "ff635c0d", "dolgu": "40635c0d", "kalinlik": 2.4},   # #0d5c63
    "dere":   {"cizgi": "ffa58e3b", "dolgu": "00000000", "kalinlik": 1.6},   # #3b8ea5
    "kanal":  {"cizgi": "ff3a3ec7", "dolgu": "00000000", "kalinlik": 2.6},   # #c73e3a
}

# Tekerrür etiketleri — frontend'deki CMP_RPS ile aynı sıra
TEKERRUR_SIRA = ["2", "5", "10", "25", "50", "100", "500", "1000", "10000", "OET"]


def _esc(t):
    """XML metin kaçışı."""
    t = "" if t is None else str(t)
    for a, b in (("&", "&amp;"), ("<", "&lt;"), (">", "&gt;"),
                 ('"', "&quot;"), ("'", "&apos;")):
        t = t.replace(a, b)
    return t


def _sayi(v, ondalik=2):
    """Sayıyı sabit ondalıkla yazar; None/sayı olmayan için boş döner."""
    try:
        if v is None:
            return ""
        return f"{float(v):.{ondalik}f}"
    except (TypeError, ValueError):
        return ""


def _koord(noktalar):
    """[(lon, lat), ...] → KML <coordinates> metni."""
    return " ".join(f"{float(p[0]):.8f},{float(p[1]):.8f},0" for p in noktalar
                    if p is not None and len(p) >= 2)


def _halka_kapat(halka):
    """LinearRing kapalı olmalı: ilk nokta sonda yoksa ekle."""
    if len(halka) >= 3 and (halka[0][0] != halka[-1][0] or halka[0][1] != halka[-1][1]):
        return list(halka) + [halka[0]]
    return list(halka)


def _poligon_kml(halkalar):
    """GeoJSON Polygon halkaları → KML <Polygon> (ilk halka dış, kalanı iç)."""
    if not halkalar:
        return ""
    p = ["<Polygon><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode>",
         "<outerBoundaryIs><LinearRing><coordinates>",
         _koord(_halka_kapat(halkalar[0])),
         "</coordinates></LinearRing></outerBoundaryIs>"]
    for ic in halkalar[1:]:
        p += ["<innerBoundaryIs><LinearRing><coordinates>",
              _koord(_halka_kapat(ic)),
              "</coordinates></LinearRing></innerBoundaryIs>"]
    p.append("</Polygon>")
    return "".join(p)


def _cizgi_kml(noktalar):
    return ("<LineString><tessellate>1</tessellate>"
            "<altitudeMode>clampToGround</altitudeMode><coordinates>"
            + _koord(noktalar) + "</coordinates></LineString>")


def _geom_kml(geom):
    """GeoJSON geometrisi → KML geometri parçaları listesi."""
    if not isinstance(geom, dict):
        return []
    t = (geom.get("type") or "").lower()
    k = geom.get("coordinates")
    if t == "polygon":
        return [_poligon_kml(k)] if k else []
    if t == "multipolygon":
        return [_poligon_kml(p) for p in (k or []) if p]
    if t == "linestring":
        return [_cizgi_kml(k)] if k else []
    if t == "multilinestring":
        return [_cizgi_kml(c) for c in (k or []) if c]
    if t == "point":
        return [f"<Point><coordinates>{_koord([k])}</coordinates></Point>"] if k else []
    if t == "geometrycollection":
        out = []
        for g in geom.get("geometries") or []:
            out += _geom_kml(g)
        return out
    return []


def _ozellikler(gj):
    """GeoJSON (FeatureCollection / Feature / ham geometri) → [(ad, geometry)]."""
    if not gj:
        return []
    t = (gj.get("type") or "") if isinstance(gj, dict) else ""
    if t == "FeatureCollection":
        out = []
        for f in gj.get("features") or []:
            out += _ozellikler(f)
        return out
    if t == "Feature":
        ozn = gj.get("properties") or {}
        ad = ozn.get("ad") or ozn.get("name") or ""
        g = gj.get("geometry")
        return [(ad, g)] if g else []
    if t:
        return [("", gj)]
    return []


def _stil_kml(ad, s):
    return (f'<Style id="{ad}">'
            f'<LineStyle><color>{s["cizgi"]}</color><width>{s["kalinlik"]}</width></LineStyle>'
            f'<PolyStyle><color>{s["dolgu"]}</color><fill>{1 if s["dolgu"][:2] != "00" else 0}</fill>'
            f'<outline>1</outline></PolyStyle>'
            f'</Style>')


def _debi_listesi(debiler):
    """{rp: Q} veya [{rp, q}] → [(tekerrür, Q)] listesi, standart sırada."""
    if not debiler:
        return []
    if isinstance(debiler, dict):
        cift = {str(k): v for k, v in debiler.items()}
    else:
        cift = {}
        for d in debiler:
            if isinstance(d, dict):
                rp = d.get("rp") or d.get("tekerrur") or d.get("t")
                if rp is not None:
                    cift[str(rp)] = d.get("q", d.get("Q"))
    sirali = [(rp, cift[rp]) for rp in TEKERRUR_SIRA if rp in cift and cift[rp] is not None]
    # sırada olmayan ekstra anahtarlar sona
    sirali += [(k, v) for k, v in cift.items()
               if k not in TEKERRUR_SIRA and v is not None]
    return sirali


def _debi_tablo_html(debiler, yontem_ad):
    """Balon penceresinde görünecek HTML debi tablosu."""
    if not debiler:
        return ""
    satir_basi = "".join(f"<th style='padding:2px 8px'>Q{rp}</th>" for rp, _ in debiler)
    satir_deger = "".join(f"<td style='padding:2px 8px;text-align:right'>{_sayi(q)}</td>"
                          for _, q in debiler)
    return (f"<p><b>Tekerrürlü pik debiler — {_esc(yontem_ad)}</b> (m³/s)</p>"
            f"<table border='1' cellspacing='0' style='border-collapse:collapse'>"
            f"<tr>{satir_basi}</tr><tr>{satir_deger}</tr></table>")


def _ozet_tablo_html(ozet):
    """Havza parametreleri tablosu."""
    if not ozet:
        return ""
    alanlar = [("Alan A", ozet.get("A_km2"), "km²", 3),
               ("Ana kol uzunluğu L", ozet.get("L_km"), "km", 3),
               ("Merkeze uzaklık Lc", ozet.get("Lc_km"), "km", 3),
               ("Harmonik eğim S", ozet.get("S_harmonik"), "m/m", 5),
               ("CN II", ozet.get("CN2"), "", 1),
               ("CN III", ozet.get("CN3"), "", 1),
               ("Baz akım", ozet.get("Qbaz"), "m³/s", 2),
               ("YZD bölgesi", ozet.get("bolge"), "", None)]
    sat = []
    for ad, v, birim, ond in alanlar:
        if v is None or v == "":
            continue
        deger = _esc(v) if ond is None else _sayi(v, ond)
        sat.append(f"<tr><td style='padding:2px 8px'>{_esc(ad)}</td>"
                   f"<td style='padding:2px 8px;text-align:right'>{deger}</td>"
                   f"<td style='padding:2px 8px'>{_esc(birim)}</td></tr>")
    if not sat:
        return ""
    return ("<p><b>Havza parametreleri</b></p>"
            "<table border='1' cellspacing='0' style='border-collapse:collapse'>"
            + "".join(sat) + "</table>")


def _extended_data(ozet, debiler, yontem_ad):
    """Öznitelik olarak okunabilir <ExtendedData> bloğu."""
    ciftler = []
    if yontem_ad:
        ciftler.append(("Yontem", yontem_ad))
    for anahtar, ond in (("A_km2", 3), ("L_km", 3), ("Lc_km", 3),
                         ("S_harmonik", 5), ("CN2", 1), ("CN3", 1), ("Qbaz", 2)):
        v = (ozet or {}).get(anahtar)
        if v is not None:
            ciftler.append((anahtar, _sayi(v, ond)))
    if (ozet or {}).get("bolge"):
        ciftler.append(("YZD_bolge", ozet["bolge"]))
    for rp, q in debiler:
        ciftler.append((f"Q{rp}_m3s", _sayi(q)))
    if not ciftler:
        return ""
    return ("<ExtendedData>" + "".join(
        f'<Data name="{_esc(a)}"><value>{_esc(v)}</value></Data>' for a, v in ciftler)
        + "</ExtendedData>")


def build(veri):
    """KMZ baytları üretir.

    veri = {ad, yontem_ad, havza_geojson, dere_geojson?, kanal_geojson?,
            outlet?{lat,lon}, debiler, girdi_ozeti?}
    """
    ad = (veri.get("ad") or "Havza").strip() or "Havza"
    yontem_ad = veri.get("yontem_ad") or ""
    ozet = veri.get("girdi_ozeti") or {}
    debiler = _debi_listesi(veri.get("debiler"))

    aciklama = _ozet_tablo_html(ozet) + _debi_tablo_html(debiler, yontem_ad)
    ext = _extended_data(ozet, debiler, yontem_ad)

    p = ['<?xml version="1.0" encoding="UTF-8"?>',
         '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
         f"<name>{_esc(ad)}</name>"]
    if yontem_ad:
        p.append(f"<description>{_esc('Yöntem: ' + yontem_ad)}</description>")
    for sad, s in STIL.items():
        p.append(_stil_kml(sad, s))

    # --- havza poligonu (öznitelikler ve debiler burada)
    havza = _ozellikler(veri.get("havza_geojson"))
    if havza:
        p.append(f"<Folder><name>{_esc('Havza sınırı')}</name>")
        for i, (fad, g) in enumerate(havza):
            parcalar = _geom_kml(g)
            if not parcalar:
                continue
            baslik = fad or (ad if len(havza) == 1 else f"{ad} {i + 1}")
            govde = "".join(parcalar)
            if len(parcalar) > 1:
                govde = "<MultiGeometry>" + govde + "</MultiGeometry>"
            p.append(f"<Placemark><name>{_esc(baslik)}</name>"
                     f"<styleUrl>#havza</styleUrl>"
                     + (f"<description><![CDATA[{aciklama}]]></description>" if aciklama else "")
                     + ext + govde + "</Placemark>")
        p.append("</Folder>")

    # --- dere ağı ve ana kanal
    for anahtar, stil, klasor in (("dere_geojson", "dere", "Dere ağı"),
                                  ("kanal_geojson", "kanal", "Ana kanal")):
        ozl = _ozellikler(veri.get(anahtar))
        if not ozl:
            continue
        p.append(f"<Folder><name>{_esc(klasor)}</name>")
        for i, (fad, g) in enumerate(ozl):
            parcalar = _geom_kml(g)
            if not parcalar:
                continue
            govde = "".join(parcalar)
            if len(parcalar) > 1:
                govde = "<MultiGeometry>" + govde + "</MultiGeometry>"
            p.append(f"<Placemark><name>{_esc(fad or f'{klasor} {i + 1}')}</name>"
                     f"<styleUrl>#{stil}</styleUrl>{govde}</Placemark>")
        p.append("</Folder>")

    # --- çıkış noktası (debi tablosu burada da görünsün)
    o = veri.get("outlet")
    if o and o.get("lat") is not None and o.get("lon") is not None:
        p.append(f"<Placemark><name>{_esc('Çıkış noktası')}</name>"
                 + (f"<description><![CDATA[{aciklama}]]></description>" if aciklama else "")
                 + ext
                 + f"<Point><coordinates>{float(o['lon']):.8f},{float(o['lat']):.8f},0"
                   f"</coordinates></Point></Placemark>")

    p.append("</Document></kml>")
    kml = "".join(p).encode("utf-8")

    tampon = io.BytesIO()
    with zipfile.ZipFile(tampon, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("doc.kml", kml)
    return tampon.getvalue()
