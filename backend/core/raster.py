# -*- coding: utf-8 -*-
"""Koordinatlı raster altlıklar (1/25000 paftalar vb.) için XYZ karo servisi.

Kullanıcının georeferanslı raster'ı (GeoTIFF) `data/raster/` altına alınır ve
Leaflet'in istediği Web Mercator (EPSG:3857) XYZ karolarına çevrilerek sunulur.
Kaynak hangi projeksiyonda olursa olsun (ör. ED50/WGS84 UTM) karo üretimi
sırasında yeniden projeksiyonlanır.

MrSID (.sid) NOTU: MrSID tescilli bir formattır ve GDAL sürücüsü ancak
LizardTech DSDK ile derlenirse gelir — PyPI rasterio tekerleklerinde YOKTUR.
Bu yüzden .sid doğrudan okunamaz; QGIS/GeoExpress gibi bir araçla bir kez
GeoTIFF'e çevrilip buraya yüklenmelidir. `.sid` yüklenirse anlaşılır bir hata
döner (sessizce başarısız olmaz).

Georeferans dosyada gömülü değilse (ArcInfo world file .sdw/.tfw ile gelen
taramalarda CRS çoğu kez tanımsızdır) `crs` parametresiyle EPSG kodu verilir.
"""
import glob
import json
import math
import os
import re
import shutil
import subprocess
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RASTER_DIR = os.path.join(ROOT, "data", "raster")

KARO = 256                       # XYZ karo kenarı (piksel)
ORIGIN = 20037508.342789244      # Web Mercator yarı-genişlik (m)

_kilit = threading.Lock()
_acik = {}                       # {ad: rasterio DatasetReader} — açık dosya önbelleği


def _dizin():
    os.makedirs(RASTER_DIR, exist_ok=True)
    return RASTER_DIR


def _temiz_ad(ad):
    """Dosya adından güvenli katman kimliği (yol geçişi engellenir)."""
    ad = os.path.splitext(os.path.basename(ad or ""))[0]
    ad = re.sub(r"[^\w\-]+", "_", ad, flags=re.UNICODE).strip("_")
    return ad or "katman"


def _meta_yolu(ad):
    return os.path.join(_dizin(), ad + ".json")


def _meta_oku(ad):
    try:
        with open(_meta_yolu(ad), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def karo_sinirlari(z, x, y):
    """XYZ karosunun EPSG:3857 sınırları (xmin, ymin, xmax, ymax)."""
    n = 2 ** z
    boy = 2 * ORIGIN / n
    xmin = -ORIGIN + x * boy
    ymax = ORIGIN - y * boy
    return xmin, ymax - boy, xmin + boy, ymax


def _kaynak(ad):
    """Katmanın rasterio veri kümesini (önbellekten) döndürür.

    CRS yükleme sırasında dosyaya yazıldığı için burada override gerekmez.
    """
    with _kilit:
        ds = _acik.get(ad)
        if ds is not None and not ds.closed:
            return ds
        meta = _meta_oku(ad)
        if not meta:
            raise RuntimeError(f"Raster katmanı bulunamadı: {ad}")
        import rasterio
        ds = rasterio.open(os.path.join(_dizin(), meta["dosya"]))
        _acik[ad] = ds
        return ds


def _kapat(ad):
    with _kilit:
        ds = _acik.pop(ad, None)
    if ds is not None:
        try:
            ds.close()
        except Exception:
            pass


_CEVIRICI = None    # (gdal_translate yolu, MrSID destekliyor mu) — bir kez aranır

# MrSID okuyabilen gdal_translate'in aranacağı yerler. GDAL_TRANSLATE ortam
# değişkeni her şeyin önüne geçer.
CEVIRICI_ADAYLARI = [
    r"C:\OSGeo4W\bin\gdal_translate.exe",
    r"C:\OSGeo4W64\bin\gdal_translate.exe",
    r"C:\Program Files\QGIS*\bin\gdal_translate.exe",
    r"C:\Program Files\GDAL\gdal_translate.exe",
]

KURULUM_YARDIMI = (
    "Bu biçim rasterio'nun paketlediği GDAL ile okunamıyor. MrSID (.sid) ve ECW "
    "gibi tescilli formatların kod çözücüsü ayrı bir eklenti gerektirir.\n"
    "Çözüm — OSGeo4W'den hazır eklentiyi kurun (QGIS gerekmez, ~11 MB):\n"
    "  1) https://trac.osgeo.org/osgeo4w/ adresinden osgeo4w-setup.exe indirin\n"
    "  2) Advanced Install → paketlerden 'gdal' ve 'gdal-mrsid' seçin\n"
    "  3) Sunucuyu yeniden başlatın — uygulama C:\\OSGeo4W\\bin\\gdal_translate.exe'yi "
    "kendiliğinden bulup dosyayı GeoTIFF'e çevirir\n"
    "Farklı bir yere kurduysanız GDAL_TRANSLATE ortam değişkenine tam yolu yazın.\n"
    "Alternatif: dosyayı elle GeoTIFF'e çevirip onu yükleyin "
    "(GeoTIFF doğrudan, dönüşümsüz yüklenir)."
)


def cevirici_durumu():
    """Arayüzde göstermek için: MrSID dönüştürücü var mı, nerede."""
    yol, var = _gdal_translate_bul()
    return {"mrsid": var, "gdal_translate": yol}


def crs_coz(metin):
    """Kullanıcının yazdığı koordinat sistemini CRS nesnesine çevirir.

    Sadece "EPSG:23035" değil, "23035" / "epsg 23035" / "EPSG: 23035" gibi
    yaygın yazımları da kabul eder. Çıplak sayı doğrudan verilirse rasterio onu
    WKT sanıp "The WKT could not be parsed. OGR Error code 5" hatası veriyordu.
    """
    from rasterio.crs import CRS

    ham = (metin or "").strip()
    if not ham:
        return None
    # "epsg 23035", "EPSG: 23035", "23035" → "EPSG:23035"
    sade = re.sub(r"(?i)^epsg[\s:_-]*", "", ham).strip()
    if re.fullmatch(r"\d{4,6}", sade):
        ham = "EPSG:" + sade
    try:
        return CRS.from_user_input(ham)
    except Exception as e:
        raise RuntimeError(
            f"Koordinat sistemi anlaşılamadı: “{metin}”. "
            "EPSG kodunu yazın — ör. 23035 veya EPSG:23035 "
            "(ED50/UTM 35N = Ege, 23036 = İç Anadolu batı, 23037, "
            "23038 = Doğu Anadolu; WGS84 karşılıkları 32635–32638). "
            f"[ayrıntı: {str(e)[:120]}]") from e


def _gdal_ortam(exe):
    """OSGeo4W/QGIS gdal_translate'i için gerekli ortam değişkenleri.

    ÖNEMLİ: MrSID bir EKLENTİdir (gdal_MrSID.dll). GDAL_DRIVER_PATH kurulmazsa
    eklenti yüklenmez ve `--formats` çıktısında MrSID hiç görünmez — kurulum
    doğru olsa bile "destek yok" sanılır.
    """
    env = dict(os.environ)
    kok = os.path.dirname(os.path.dirname(exe))        # ...\bin\gdal_translate.exe → kök
    for anahtar, altlar in (
        ("GDAL_DRIVER_PATH", [r"apps\gdal\lib\gdalplugins", r"lib\gdalplugins", "gdalplugins"]),
        ("GDAL_DATA", [r"apps\gdal\share\gdal", r"share\gdal"]),
        ("PROJ_LIB", [r"share\proj", r"apps\proj\share\proj"]),
    ):
        if env.get(anahtar):
            continue
        for alt in altlar:
            y = os.path.join(kok, alt)
            if os.path.isdir(y):
                env[anahtar] = y
                break
    return env


def _gdal_translate_bul():
    """MrSID okuyabilen bir gdal_translate.exe arar → (yol, destekliyor_mu)."""
    global _CEVIRICI
    if _CEVIRICI is not None:
        return _CEVIRICI
    adaylar = []
    if os.environ.get("GDAL_TRANSLATE"):
        adaylar.append(os.environ["GDAL_TRANSLATE"])
    for kalip in CEVIRICI_ADAYLARI:
        adaylar += sorted(glob.glob(kalip))
    yoldaki = shutil.which("gdal_translate")
    if yoldaki:
        adaylar.append(yoldaki)

    bulunan = None
    for a in adaylar:
        if not a or not os.path.exists(a):
            continue
        bulunan = bulunan or a
        try:
            p = subprocess.run([a, "--formats"], capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=90,
                               env=_gdal_ortam(a))
            if "MrSID" in (p.stdout or ""):
                _CEVIRICI = (a, True)
                return _CEVIRICI
        except Exception:
            continue
    # gdal_translate var ama MrSID'siz olabilir; yolu yine de bildir
    _CEVIRICI = (bulunan, False)
    return _CEVIRICI


def _harici_geotiff_cevir(kaynak, ilk_hata=None):
    """rasterio'nun okuyamadığı bir raster'ı harici GDAL ile GeoTIFF'e çevirir.

    Yanındaki world file (.sdw/.tfw) ve .prj de aynı kök adla durduğu için
    gdal_translate onları kendiliğinden kullanır.
    """
    yol, var = _gdal_translate_bul()
    if not var:
        ek = ""
        if yol:
            ek = f"\n(Bulunan gdal_translate: {yol} — bu derlemede ilgili sürücü yok.)"
        if ilk_hata:
            ek += f"\n(rasterio hatası: {str(ilk_hata)[:160]})"
        raise RuntimeError(KURULUM_YARDIMI + ek)
    hedef = os.path.splitext(kaynak)[0] + ".tif"
    sid_yolu = kaynak
    p = subprocess.run(
        [yol, "-of", "GTiff", "-co", "TILED=YES", "-co", "COMPRESS=DEFLATE",
         "-co", "BIGTIFF=IF_SAFER", sid_yolu, hedef],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=3600, env=_gdal_ortam(yol))
    if p.returncode != 0 or not os.path.exists(hedef):
        hata = (p.stderr or p.stdout or "").strip().splitlines()
        raise RuntimeError("GeoTIFF dönüşümü başarısız: "
                           + (hata[-1] if hata else f"çıkış kodu {p.returncode}"))
    try:
        os.unlink(sid_yolu)                      # ham kaynağa artık gerek yok
    except OSError:
        pass
    return hedef


def _piramit_kur(yol):
    """Büyük raster'lara genel bakış (overview) ekler — düşük zoom'da karo hızı."""
    import rasterio
    from rasterio.enums import Resampling
    try:
        with rasterio.open(yol, "r+") as ds:
            if max(ds.width, ds.height) < 2048 or ds.overviews(1):
                return
            kat = [2, 4, 8, 16, 32]
            ds.build_overviews(kat, Resampling.average)
            ds.update_tags(ns="rio_overview", resampling="average")
    except Exception:
        pass                                     # piramit şart değil, sadece hızlandırır


def ekle(veri, dosya_adi, crs=None, baslik=None, yardimci=None):
    """Yeni raster altlık kaydeder ve meta bilgisini üretir.

    veri      : ana dosyanın baytları
    dosya_adi : özgün dosya adı (uzantısı biçimi belirler)
    crs       : "EPSG:32637" gibi — dosyada CRS yoksa zorunlu
    yardimci  : [(ad, bayt), ...] yan dosyalar (.sdw/.tfw world file, .prj,
                .aux.xml). Ana dosyayla AYNI kök adla yan yana yazılır ki GDAL
                onları kendiliğinden bulsun. Kullanıcının 1/25000 paftalarında
                georeferans yalnız .sdw içinde olduğu için bu şart.
    """
    import rasterio
    from rasterio.warp import transform_bounds

    # CRS'i EN BAŞTA çöz: hatalıysa dosyaları yazmadan, anlaşılır biçimde patla
    crs_nesnesi = crs_coz(crs)
    uzanti = os.path.splitext(dosya_adi or "")[1].lower()
    ad = _temiz_ad(baslik or dosya_adi)
    hedef = os.path.join(_dizin(), ad + (uzanti or ".tif"))
    with open(hedef, "wb") as f:
        f.write(veri)

    # yan dosyaları ana dosyanın kök adıyla yaz (h48c2.sdw → <ad>.sdw)
    yazilan_yan = []
    for yan_ad, yan_veri in (yardimci or []):
        yan_uz = os.path.splitext(yan_ad or "")[1].lower()
        if not yan_uz or yan_uz == uzanti:
            continue
        # .sid.aux.xml gibi çift uzantıları koru
        if (yan_ad or "").lower().endswith(".aux.xml"):
            yan_uz = uzanti + ".aux.xml"
        yan_yol = os.path.join(_dizin(), ad + yan_uz)
        with open(yan_yol, "wb") as f:
            f.write(yan_veri)
        yazilan_yan.append(yan_yol)

    try:
        # GeoTIFF/VRT/IMG gibi rasterio'nun açabildiği biçimler DOĞRUDAN kullanılır;
        # dönüşüm yalnızca açılamayan biçimler (MrSID, ECW…) için devreye girer.
        ilk_hata = None
        try:
            with rasterio.open(hedef):
                pass
        except Exception as e:
            ilk_hata = e
        if ilk_hata is not None:
            hedef = _harici_geotiff_cevir(hedef, ilk_hata)
            uzanti = ".tif"
    except Exception:
        for y in yazilan_yan + [hedef]:
            try:
                os.unlink(y)
            except OSError:
                pass
        raise

    try:
        with rasterio.open(hedef) as src:
            kaynak_crs = src.crs
        if kaynak_crs is None and crs_nesnesi is None:
            raise RuntimeError(
                "Dosyada koordinat sistemi tanımlı değil. Yükleme formundaki "
                "CRS alanına EPSG kodunu yazın (ör. ED50/UTM 37N için EPSG:23037, "
                "WGS84/UTM 37N için EPSG:32637).")
        if crs_nesnesi is not None:
            # CRS'i dosyaya KALICI yaz. Çalışma anında "şu CRS'miş gibi oku"
            # demek güvenilir değil: rasterio.warp.reproject, kaynak bir Band
            # olduğunda src_crs'i veri kümesinden alır ve dışarıdan verilen
            # değeri yok sayar (karo tamamen saydam çıkar).
            with rasterio.open(hedef, "r+") as src:
                src.crs = crs_nesnesi
        with rasterio.open(hedef) as src:
            if src.crs is None:
                raise RuntimeError("Koordinat sistemi dosyaya yazılamadı.")
            sinir = transform_bounds(src.crs, "EPSG:4326", *src.bounds, densify_pts=21)
            meta = {
                "ad": ad,
                "baslik": baslik or ad,
                "dosya": os.path.basename(hedef),
                "crs": crs_nesnesi.to_string() if crs_nesnesi is not None else None,
                "etkin_crs": src.crs.to_string(),
                "genislik": src.width, "yukseklik": src.height,
                "bant": src.count,
                # Leaflet sırası: [[güney, batı], [kuzey, doğu]]
                "sinir": [[sinir[1], sinir[0]], [sinir[3], sinir[2]]],
            }
    except Exception:
        for y in yazilan_yan + [hedef]:
            try:
                os.unlink(y)
            except OSError:
                pass
        raise

    _piramit_kur(hedef)
    with open(_meta_yolu(ad), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    _kapat(ad)
    return meta


def listele():
    """Kayıtlı raster altlıkların meta listesi."""
    out = []
    for f in sorted(os.listdir(_dizin())):
        if f.lower().endswith(".json"):
            m = _meta_oku(os.path.splitext(f)[0])
            if m:
                out.append(m)
    return out


def sil(ad):
    ad = _temiz_ad(ad)
    meta = _meta_oku(ad)
    if not meta:
        raise RuntimeError(f"Raster katmanı bulunamadı: {ad}")
    _kapat(ad)
    # ana dosya + yan dosyalar (.sdw/.prj/.aux.xml/.ovr) + meta
    for yol in glob.glob(os.path.join(_dizin(), ad + ".*")):
        try:
            os.unlink(yol)
        except OSError:
            pass
    return {"silindi": ad}


def _rgba(src, dst_transform, sayi=KARO):
    """Kaynağı hedef karo çerçevesine yeniden projeksiyonlayıp RGBA üretir."""
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import reproject

    bant_sayisi = src.count
    renk = src.colormap(1) if (bant_sayisi == 1 and _paletli(src)) else None
    okunacak = [1, 2, 3] if bant_sayisi >= 3 else [1]

    kanallar = []
    for b in okunacak:
        hedef = np.zeros((sayi, sayi), dtype="float32")
        reproject(
            source=rasterio.band(src, b),
            destination=hedef,
            dst_transform=dst_transform, dst_crs="EPSG:3857",
            resampling=Resampling.bilinear if renk is None else Resampling.nearest,
            src_nodata=src.nodata, dst_nodata=np.nan,
        )
        kanallar.append(hedef)

    # geçerlilik maskesi: NaN olmayan yerler
    gecerli = ~np.isnan(kanallar[0])
    for k in kanallar[1:]:
        gecerli &= ~np.isnan(k)

    if renk is not None:
        idx = np.nan_to_num(kanallar[0], nan=0).astype("uint16")
        lut = np.zeros((max(renk) + 1, 4), dtype="uint8")
        for i, c in renk.items():
            lut[i] = c if len(c) == 4 else tuple(c) + (255,)
        idx = np.clip(idx, 0, lut.shape[0] - 1)
        rgba = lut[idx]
        rgba[..., 3] = np.where(gecerli, rgba[..., 3], 0)
        return rgba

    duz = [np.nan_to_num(k, nan=0) for k in kanallar]
    if len(duz) == 1:
        # tek bant: 8 bit değilse görüntülenebilir aralığa ölçekle
        g = duz[0]
        if src.dtypes[0] != "uint8":
            gecerli_deger = g[gecerli]
            if gecerli_deger.size:
                alt, ust = np.percentile(gecerli_deger, [2, 98])
                if ust > alt:
                    g = np.clip((g - alt) / (ust - alt) * 255.0, 0, 255)
        duz = [g, g, g]

    rgba = np.zeros((sayi, sayi, 4), dtype="uint8")
    for i in range(3):
        rgba[..., i] = np.clip(duz[i], 0, 255).astype("uint8")
    rgba[..., 3] = np.where(gecerli, 255, 0).astype("uint8")
    return rgba


def _paletli(src):
    try:
        from rasterio.enums import ColorInterp
        return src.colorinterp and src.colorinterp[0] == ColorInterp.palette
    except Exception:
        return False


def karo(ad, z, x, y):
    """Tek bir XYZ karosunu PNG baytları olarak üretir."""
    import io

    import numpy as np
    from PIL import Image
    from rasterio.transform import from_bounds
    from rasterio.warp import transform_bounds

    ad = _temiz_ad(ad)
    src = _kaynak(ad)
    xmin, ymin, xmax, ymax = karo_sinirlari(z, x, y)

    # karo, kaynağın kapsamı dışındaysa boşuna okuma yapma
    try:
        kaynak_3857 = transform_bounds(src.crs, "EPSG:3857", *src.bounds, densify_pts=21)
        if (xmax <= kaynak_3857[0] or xmin >= kaynak_3857[2]
                or ymax <= kaynak_3857[1] or ymin >= kaynak_3857[3]):
            return None
    except Exception:
        pass

    dst_transform = from_bounds(xmin, ymin, xmax, ymax, KARO, KARO)
    rgba = _rgba(src, dst_transform)
    if not rgba[..., 3].any():
        return None                      # tamamen saydam → 204 döndürülecek

    tampon = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(tampon, format="PNG", optimize=False)
    return tampon.getvalue()
