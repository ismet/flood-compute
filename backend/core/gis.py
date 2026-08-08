# -*- coding: utf-8 -*-
"""Havza çıkarımı: DEM temini (yerel klasör + Copernicus GLO-30 online),
pyflwdir ile akış yönü/birikim/pit doldurma, havza sınırı, dere ağı,
L, Lc ve harmonik kot profili.
"""
import math
import os
from contextlib import contextmanager

import numpy as np

# Ağır kütüphaneler (pyflwdir→numba, rasterio, shapely) fonksiyon içinden
# yüklenir — bellek tasarrufu için.
# from pyproj import Geod
# from rasterio import features as rfeatures
# from shapely.geometry import LineString, shape
# from shapely.ops import unary_union

# GEOD = Geod(ellps="WGS84")
_GEOD = None
def _geod():
    global _GEOD
    if _GEOD is None:
        from pyproj import Geod
        _GEOD = Geod(ellps="WGS84")
    return _GEOD
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEM_DIR = os.path.join(ROOT, "data", "dem")
CACHE_DIR = os.path.join(DEM_DIR, "cache")
COP30_URL = ("https://copernicus-dem-30m.s3.amazonaws.com/"
             "Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM/"
             "Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM.tif")

# D8 yön kodlaması (pyflwdir/D8 standart) -> (dsatır, dsütun)
D8 = {64: (-1, 0), 128: (-1, 1), 1: (0, 1), 2: (1, 1),
      4: (1, 0), 8: (1, -1), 16: (0, -1), 32: (-1, -1)}

@contextmanager
def _flw_gecici_transform(flw):
    """pyflwdir 0.5.12'nin @njit fonksiyonlarına Affine yerine düz float64
    tuple'ı verir. numba 0.66+ sıradan tuple alt sınıflarını yazamıyor;
    Affine (tuple alt sınıfı) bu fonksiyonlarda "Cannot determine Numba type
    of <affine.Affine>" ile reddediliyor. Bu çağrılar transform'u yalnız
    index'leriyle okuduğundan (transform[0]=xres, [4]=yres, [5]=north) aynı
    değerlerin düz tuple'ı yeterlidir. Kapsamdan çıkınca Affine geri verilir;
    başka kodlar `transform * (x, y)` çarpımını ve `~transform` tersini ister.
    """
    eski = flw.transform
    flw.transform = (eski.a, eski.b, eski.c, eski.d, eski.e, eski.f)
    try:
        yield
    finally:
        flw.transform = eski

# Havza çıkarımında bir DEM penceresi için üst hücre sınırı. Pencere bundan
# büyükse DEM kabalaştırılır (bkz. get_dem_mosaic). Büyütmek doğruluğu artırır
# ama belleği/süreyi de artırır; düşük bellekli sunucuda ortam değişkeniyle
# düşürülebilir (ör. 512 MB plan için 4_000_000).
MAX_CELLS = int(os.environ.get("DELINEATE_MAX_CELLS", 8_000_000))

# Kenetleme, akarsu ağını bulana kadar arama yarıçapını bu değere kadar
# ikiye katlayarak büyütür (bkz. _akarsuya_kenetle). Kullanıcının verdiği
# snap_m yalnız başlangıç yarıçapıdır; doğru değeri kullanıcının bilmesi
# beklenmez.
MAKS_ARAMA_M = float(os.environ.get("SNAP_MAKS_ARAMA_M", "2000"))

# --- 10 m ulusal DEM (opsiyonel, çok büyük) --------------------------------
# ERDAS .img, 165031×71347 = 11.8 milyar hücre (23.5 GB), ED50 üzerinde özel
# bir Lambert Conformal Conic projeksiyonunda. Karolu (64×64) ve piramitli
# olduğu için pencere okuması hızlıdır: bir havza penceresi ~1 saniye.
#
# WGS84'e dönüştürmenin bir bedeli var ve gizlenmemeli: kaynakta TOWGS84
# parametresi yok, PROJ "ED50 to WGS 84 (1)" dönüşümünü seçiyor ve onun ilan
# edilen doğruluğu 10 m — yani tam bir hücre. Türkiye'de yaygın kullanılan
# (-84,-107,-120) parametreleriyle arasındaki fark ölçüldü: 18 m. Dolayısıyla
# 10 m DEM'in konum doğruluğu 30 m DEM'inkinden iyi ama "10 m" etiketinin
# vaat ettiği kadar değil; kazanç ÇÖZÜNÜRLÜKTE (vadi tabanı, kanal ayrıntısı),
# mutlak konumda değil.
# Ulusal 10 m DEM kaynağı. Varsayılan, bu makinedeki yerel kopya
# (repo kökündeki 10M/ klasörü); başka makinede bir kez indirilen/kopyalanan
# kaynağa DEM_10M ortam değişkeniyle işaret edilir (ör. Windows'ta
# D:\demdata\Yukseklik_10mDEM\10M\tr10clip.img). 10M/ .gitignore'lıdır —
# 23.5 GB'lık dosya depoya girmemelidir.
DEM_10M = os.environ.get(
    "DEM_10M", os.path.join(ROOT, "10M", "tr10clip.img"))


# Depoyla taşınan 10 m KESİTLERİ. Kaynağın tamamı 23.5 GB — GitHub'ın dosya
# başına 100 MB sınırının 236, Git LFS'in 2 GB sınırının 12 katı; gönderilemez.
# Ama çalışılan bölgenin kesiti ucuz: bir havza + 500 m tampon sıkıştırılmış
# 0.1 MB, 55×55 km'lik bir alan 11 MB. tools/dem10_kes.py bunları üretir.
#
# Kesitler data/dem/ İÇİNE KONMAZ, ayrı klasörde durur. data/dem/ 30 m havuzu
# ve get_dem_mosaic oradaki dosyaları merge ediyor; merge karışık çözünürlükte
# ilk dosyanınkini dayatır, yani 10 m kesit ya 30 m'ye düşürülür ya da bütün
# pencereyi 10 m'ye çıkarıp belleği patlatır. Ayrı tutmak bu ikilemi kaldırır.
DEM10_DIR = os.path.join(ROOT, "data", "dem10")
_DEM10_KESIT_CACHE = None


def _10m_kesitler():
    """data/dem10 altındaki WGS84 kesitler -> [(yol, bounds)]."""
    global _DEM10_KESIT_CACHE
    if _DEM10_KESIT_CACHE is not None:
        return _DEM10_KESIT_CACHE
    import rasterio
    out = []
    if os.path.isdir(DEM10_DIR):
        for fn in sorted(os.listdir(DEM10_DIR)):
            if not fn.lower().endswith((".tif", ".tiff")):
                continue
            try:
                with rasterio.open(os.path.join(DEM10_DIR, fn)) as s:
                    if s.crs and s.crs.to_epsg() == 4326:
                        out.append((os.path.join(DEM10_DIR, fn), s.bounds))
            except Exception:
                pass
    _DEM10_KESIT_CACHE = out
    return out


def _kesit_bul(bbox):
    """bbox'ı tümüyle kapsayan kesit varsa yolunu döner."""
    w, s, e, n = bbox
    for yol, b in _10m_kesitler():
        if b.left <= w and b.bottom <= s and b.right >= e and b.top >= n:
            return yol
    return None


def dem_10m_var_mi():
    """10 m verisi bir biçimde erişilebilir mi (tam kaynak ya da kesit)."""
    return (bool(DEM_10M) and os.path.exists(DEM_10M)) or bool(_10m_kesitler())


def _kesitten_pencere(kesit, bbox, max_cells=None):
    """Depodaki 10 m kesitten bbox penceresini geçici GeoTIFF'e yazar."""
    import rasterio
    import tempfile
    from rasterio.windows import from_bounds

    w, s, e, n = bbox
    with rasterio.open(kesit) as src:
        win = from_bounds(w, s, e, n, src.transform)
        oku = max(1, int(round(math.sqrt(
            (win.width * win.height) / float(max_cells))))) if (
            max_cells and win.width * win.height > max_cells) else 1
        arr = src.read(1, window=win,
                       out_shape=(1, max(2, int(win.height // oku)),
                                  max(2, int(win.width // oku))))[0] \
            if oku > 1 else src.read(1, window=win)
        tr = src.window_transform(win)
        if oku > 1:
            tr = rasterio.Affine(tr.a * oku, tr.b, tr.c, tr.d, tr.e * oku, tr.f)
        profil = {"driver": "GTiff", "height": arr.shape[0], "width": arr.shape[1],
                  "count": 1, "dtype": arr.dtype, "crs": src.crs,
                  "transform": tr, "nodata": src.nodata}
    fd, yol = tempfile.mkstemp(suffix="_10m.tif")
    os.close(fd)
    with rasterio.open(yol, "w", **profil) as dst:
        dst.write(arr, 1)
    return yol


def _10m_pencere(bbox, max_cells=None):
    """10 m DEM'den bbox penceresini kesip WGS84 GeoTIFF olarak yazar.

    bbox: (w, s, e, n) WGS84. Döner: geçici dosya yolu.

    Kaynak projeksiyon eğri (Lambert) olduğu için hedef dikdörtgenin KENARLARI
    yoğunlaştırılarak dönüştürülür — yalnız dört köşeyi dönüştürmek pencereyi
    eksik açar ve çıktının köşeleri boş kalır (prototipte %14'ü boştu).
    """
    import rasterio
    import tempfile
    from pyproj import Transformer
    from rasterio.warp import calculate_default_transform, reproject, Resampling
    from rasterio.windows import from_bounds, Window

    w, s, e, n = bbox
    kesit = _kesit_bul(bbox)
    if kesit:
        # Depoyla gelen kesit zaten WGS84; yeniden projeksiyon gerekmez.
        return _kesitten_pencere(kesit, bbox, max_cells)
    if not (DEM_10M and os.path.exists(DEM_10M)):
        raise RuntimeError(
            "Bu alan için 10 m verisi yok.\n"
            f"  · Tam kaynak ({DEM_10M}) bu makinede bulunamadı; yolu DEM_10M "
            "ortam değişkeniyle verebilirsiniz.\n"
            f"  · data/dem10 altında bu alanı kapsayan kesit de yok "
            f"({len(_10m_kesitler())} kesit var). Kaynağın bulunduğu makinede "
            "`python tools/dem10_kes.py --bbox ...` ile üretip depoya ekleyin.")
    with rasterio.open(DEM_10M) as src:
        tr = Transformer.from_crs("EPSG:4326", src.crs, always_xy=True)
        # kenarları yoğunlaştır (20 nokta/kenar) — eğri projeksiyonda köşeler yetmez
        k = 20
        xs, ys = [], []
        for i in range(k + 1):
            f = i / k
            xs += [w + f * (e - w), w + f * (e - w), w, e]
            ys += [s, n, s + f * (n - s), s + f * (n - s)]
        px, py = tr.transform(xs, ys)
        pay = 20 * abs(src.transform.a)          # 20 hücre emniyet payı
        win = from_bounds(min(px) - pay, min(py) - pay, max(px) + pay,
                          max(py) + pay, src.transform)
        win = win.intersection(Window(0, 0, src.width, src.height))
        if win.width < 2 or win.height < 2:
            raise RuntimeError(
                "Havza 10 m DEM'in kapsamı dışında (DEM Türkiye ile sınırlı).")
        arr = src.read(1, window=win)
        wtr = src.window_transform(win)
        # Hedef ızgara doğrudan İSTENEN kutudan kurulur, kaynak penceresinin
        # sınırlarından değil: Lambert'ten WGS84'e geçerken dikdörtgen dönüyor
        # ve kaynak sınırından türetilen hedefin köşeleri boş kalıyor (ölçüldü:
        # çıktının %14'ü). İstenen kutuyu üretmek hem tümüyle dolu hem küçük.
        coz = abs(src.transform.a)               # kaynak hücre (m)
        orta = math.radians((s + n) / 2.0)
        res_lat = coz / 110540.0
        res_lon = coz / (111320.0 * max(math.cos(orta), 1e-6))
        dw = max(2, int(math.ceil((e - w) / res_lon)))
        dh = max(2, int(math.ceil((n - s) / res_lat)))
        # hücre sınırı: 10 m'de büyük havza belleği patlatır, kabalaştır
        if max_cells and dw * dh > max_cells:
            f = math.sqrt(dw * dh / float(max_cells))
            dw, dh = max(2, int(dw / f)), max(2, int(dh / f))
        dst_tr = rasterio.transform.from_bounds(w, s, e, n, dw, dh)
        out = np.full((dh, dw), src.nodata, dtype=arr.dtype)
        reproject(arr, out, src_transform=wtr, src_crs=src.crs,
                  dst_transform=dst_tr, dst_crs="EPSG:4326",
                  src_nodata=src.nodata, dst_nodata=src.nodata,
                  resampling=Resampling.bilinear)
        profil = {"driver": "GTiff", "height": dh, "width": dw, "count": 1,
                  "dtype": arr.dtype, "crs": "EPSG:4326", "transform": dst_tr,
                  "nodata": src.nodata}
    fd, yol = tempfile.mkstemp(suffix="_10m.tif")
    os.close(fd)
    with rasterio.open(yol, "w", **profil) as dst:
        dst.write(out, 1)
    return yol


# ------------------------------------------------------------------ DEM temini
_LOCAL_DEM_CACHE = None


def _local_dems():
    """data/dem altındaki EPSG:4326 DEM'ler -> [(yol, bounds)].

    GeoTIFF (.tif/.tiff), GDAL VRT (.vrt), ERDAS (.img) ve ESRI ArcInfo Grid
    (içinde hdr.adf olan klasör) desteklenir. VRT sayesinde büyük bir bölgesel
    DEM (ör. tüm Türkiye ASTER 30 m) kopyalanmadan bağlanabilir.
    Alt klasörler taranmaz — indirilen Copernicus karoları data/dem/cache
    altında kalır ve yerel kapsamla karışmaz.
    """
    global _LOCAL_DEM_CACHE
    if _LOCAL_DEM_CACHE is not None:
        return _LOCAL_DEM_CACHE
    import rasterio
    out = []
    if not os.path.isdir(DEM_DIR):
        return out
    for fn in sorted(os.listdir(DEM_DIR)):
        p = os.path.join(DEM_DIR, fn)
        if os.path.isdir(p):
            if not os.path.exists(os.path.join(p, "hdr.adf")):
                continue                      # ESRI Grid değil (ör. cache/)
        elif fn.lower().endswith(".vrt"):
            # VRT aynı isimli bir ESRI Grid klasörünü referans alıyorsa
            # grid zaten listede olacağından çift kaynağı önlemek için atla
            base = os.path.splitext(fn)[0]
            if os.path.isdir(os.path.join(DEM_DIR, base)):
                continue
        elif not fn.lower().endswith((".tif", ".tiff", ".img")):
            continue
        try:
            with rasterio.open(p) as src:
                if src.crs and src.crs.to_epsg() == 4326:
                    out.append((p, src.bounds))
        except Exception:
            pass
    _LOCAL_DEM_CACHE = out
    return out


def _download_cop30(lat_i, lon_i):
    import requests
    os.makedirs(CACHE_DIR, exist_ok=True)
    ns = "N" if lat_i >= 0 else "S"
    ew = "E" if lon_i >= 0 else "W"
    url = COP30_URL.format(ns=ns, lat=abs(lat_i), ew=ew, lon=abs(lon_i))
    dest = os.path.join(CACHE_DIR, os.path.basename(url))
    if os.path.exists(dest):
        return dest
    r = requests.get(url, timeout=300)
    if r.status_code != 200:
        raise RuntimeError(f"DEM karosu indirilemedi ({r.status_code}): {url}")
    with open(dest, "wb") as f:
        f.write(r.content)
    return dest


def _locally_covered(bbox):
    """bbox tümüyle yerel DEM'lerle kapsanıyor mu (indirme gerekmez mi)?"""
    from shapely.geometry import box as sbox, shape
    from shapely.ops import unary_union
    dems = _local_dems()
    if not dems:
        return False
    w, s, e, n = bbox
    polys = [sbox(b.left, b.bottom, b.right, b.top) for _, b in dems]
    try:
        return unary_union(polys).contains(sbox(w, s, e, n))
    except Exception:
        return False


def get_dem_mosaic(bbox, max_cells=None, dem_source="auto"):
    """bbox (w,s,e,n) kapsayan DEM mozaiğini geçici GeoTIFF olarak döner.

    Önce data/dem altındaki yerel dosyalara bakar; kapsam eksikse
    Copernicus GLO-30 karolarını indirir (data/dem/cache).

    max_cells verilirse ve pencere doğal çözünürlükte bundan çok hücre
    içeriyorsa, DEM kabalaştırılarak (decimation) okunur. Büyük havzalarda
    (binlerce km²) 30 m çözünürlük hem gereksiz hem de bellek/süre olarak
    uygulanamaz; havza alanı toplam bir büyüklük olduğundan kabalaştırma
    alanı bozmaz.
    """
    import rasterio
    from rasterio.merge import merge
    from shapely.geometry import shape, box as sbox
    from shapely.ops import unary_union

    w, s, e, n = bbox
    if dem_source == "10m":                 # ulusal 10 m DEM (ED50 LCC -> WGS84)
        return _10m_pencere(bbox, max_cells=max_cells)
    srcs = []
    covered = False
    if dem_source != "copernicus":          # yerel DEM'leri kullan
        for p, b in _local_dems():
            if not (b.right < w or b.left > e or b.top < s or b.bottom > n):
                srcs.append(p)
        if srcs:
            u = unary_union([shape({
                "type": "Polygon",
                "coordinates": [[(b.left, b.bottom), (b.right, b.bottom),
                                 (b.right, b.top), (b.left, b.top), (b.left, b.bottom)]]})
                for p, b in _local_dems() if p in srcs])
            covered = u.contains(sbox(w, s, e, n))
    if dem_source == "yerel" and not covered:
        raise RuntimeError(
            "Seçilen yerel DEM bu havzayı kapsamıyor "
            f"(gerekli alan: {w:.2f}–{e:.2f}° D, {s:.2f}–{n:.2f}° K). "
            "DEM kaynağını 'Copernicus (indir)' veya 'Otomatik' yapın.")
    if not covered:                          # eksik kalan bölgeyi indirerek tamamla
        for lat_i in range(math.floor(s), math.floor(n) + 1):
            for lon_i in range(math.floor(w), math.floor(e) + 1):
                try:
                    srcs.append(_download_cop30(lat_i, lon_i))
                except RuntimeError:
                    if not srcs:
                        raise
    if not srcs:
        raise RuntimeError("Bölgeyi kapsayan DEM bulunamadı (yerel yok, indirme başarısız)")
    dss = [rasterio.open(p) for p in srcs]
    try:
        # pencere çok büyükse doğal çözünürlük yerine kabalaştırılmış oku
        res = None
        if max_cells:
            rx, ry = abs(dss[0].transform.a), abs(dss[0].transform.e)
            ncell = ((e - w) / rx) * ((n - s) / ry)
            if ncell > max_cells:
                f = math.sqrt(ncell / float(max_cells))
                res = (rx * f, ry * f)
        src_nodata = dss[0].nodata
        arr, transform = merge(dss, bounds=(w, s, e, n), res=res, nodata=src_nodata)
    finally:
        for d in dss:
            d.close()

    # nodata'yı NaN'a çevir. ASTER gibi DEM'lerde nodata -32768'dir; maskelenmezse
    # gerçek kot sanılıp akış yönlerini bozar (her şey oraya akar).
    band = arr[0].astype("float32")
    if src_nodata is not None and np.isfinite(src_nodata):
        band[band == np.float32(src_nodata)] = np.nan
    band[band <= -1e6] = np.nan
    meta = {
        "height": arr.shape[1], "width": arr.shape[2], "transform": transform,
        "driver": "GTiff", "count": 1, "dtype": "float32", "crs": "EPSG:4326",
        "nodata": None,
    }
    import tempfile
    os.makedirs(CACHE_DIR, exist_ok=True)
    tmp = tempfile.NamedTemporaryFile(suffix='.tif', delete=False, dir=CACHE_DIR)
    tmp.close()
    try:
        with rasterio.open(tmp.name, "w", **meta) as dst:
            dst.write(band, 1)
    except Exception:
        os.unlink(tmp.name)
        raise
    del arr
    return tmp.name


# ------------------------------------------------------------- havza çıkarımı


def _seg_len_m(lon1, lat1, lon2, lat2):
    _, _, d = _geod().inv(lon1, lat1, lon2, lat2)
    return d


def _monoton_profil(prof, min_dh=0.1):
    """11 noktalı kot profilini kesin artan hale getirir.

    Harmonik eğim S = (10 / Σ√(l/Δh))² formülü **en düz segmente** aşırı
    duyarlıdır: tek bir segmente yapay olarak 0.1 m verilirse √(l/Δh) terimi
    diğer dokuzunun toplamını ezip eğimi (dolayısıyla Tc'yi) gerçekdışı yapar.
    Bu yüzden artmayan bir "düz koşu", bir sonraki gerçekten daha yüksek kota
    kadar **doğrusal olarak paylaştırılır**; ancak profilin sonunda hiç daha
    yüksek kot yoksa min_dh'lik asgari artış uygulanır.
    """
    p = [float(v) if v is not None and np.isfinite(v) else np.nan for v in prof]
    n = len(p)
    # geçersiz (NaN) noktaları komşulardan doldur
    ilk = next((i for i in range(n) if np.isfinite(p[i])), None)
    if ilk is None:
        return [0.0 + i * min_dh for i in range(n)]
    for i in range(ilk):
        p[i] = p[ilk]
    for i in range(ilk + 1, n):
        if not np.isfinite(p[i]):
            p[i] = p[i - 1]
    i = 1
    while i < n:
        if p[i] > p[i - 1]:
            i += 1
            continue
        j = i
        while j < n and p[j] <= p[i - 1]:
            j += 1
        if j < n:                       # düz koşuyu bir sonraki yüksek kota dağıt
            adim = (p[j] - p[i - 1]) / float(j - (i - 1))
            for k in range(i, j):
                p[k] = p[i - 1] + adim * (k - (i - 1))
        else:                           # profilin sonu: asgari artış
            for k in range(i, n):
                p[k] = p[k - 1] + min_dh
        i = max(j, i + 1)
    return p


def delineate(lat, lon, buffer_deg=0.08, river_km2=1.0, max_tries=8,
              snap_m=500.0, max_cells=None, max_span_deg=8.0, dem_source="auto",
              hedef_alan_km2=None):
    """Outlet (lat, lon) için havza çıkarımı. GeoJSON + fiziksel parametreler döner.

    Pencere, havzanın **taştığı kenarlar** yönünde büyütülerek yinelenir; böylece
    büyük havzalar (binlerce km²) da tümüyle kapsanır. Pencere büyüdükçe DEM
    kabalaştırılır (bkz. ``get_dem_mosaic(max_cells=...)``) — aksi halde 30 m
    çözünürlükte bellek/süre uygulanamaz hale gelir ve havza kenardan kesilip
    alan olduğundan çok küçük çıkar.
    """
    if max_cells is None:
        max_cells = MAX_CELLS
    w, s, e, n = lon - buffer_deg, lat - buffer_deg, lon + buffer_deg, lat + buffer_deg
    best = None          # şimdiye dek bulunan en büyük (en güvenilir) havza
    for attempt in range(max_tries):
        res = _delineate_once(lat, lon, (w, s, e, n), river_km2,
                              snap_m=snap_m, max_cells=max_cells,
                              dem_source=dem_source,
                              hedef_alan_km2=hedef_alan_km2)
        if res is None:
            # akış yoluna oturmadı: pencereyi her yönde büyütüp tekrar dene
            gw, gh = (e - w), (n - s)
            w, s, e, n = w - gw / 2, s - gh / 2, e + gw / 2, n + gh / 2
            if (e - w) > max_span_deg or (n - s) > max_span_deg:
                break
            continue
        edges, out = res
        kapali = not any(edges.values())      # havza tümüyle pencere içinde mi
        # Kenara değmeyen sonuç doğası gereği güvenilirdir: alan artık kesik
        # değil. Ancak kabalaşan DEM'de kenetleme bozulup ÇOK küçük bir havza
        # da "kapalı" görünebilir. Bu yüzden kapalı sonucu, o ana kadar
        # görülen en büyük alanın %90'ından büyükse kabul et; çok küçükse
        # (bozuk pencere) yut ve büyütmeye devam et. %90 payı, çözünürlük
        # değiştikçe alanın doğal olarak birkaç yüzde oynamasına izin verir.
        if best is None or out["alan_km2"] > best["alan_km2"]:
            best = out
        if kapali and out["alan_km2"] >= 0.9 * best["alan_km2"]:
            return _kenetleme_uyar(out)      # kesilmemiş, güvenilir sonuç
        # yalnız taşan kenarları büyüt (havza membaya doğru uzar; her yönü
        # büyütmek hücre sayısını 4'e katlar, tek yön 2'ye)
        gw, gh = (e - w), (n - s)
        if (e - w) >= max_span_deg and (n - s) >= max_span_deg:
            break                            # sınıra gelindi, elde olanı döndür
        if edges.get("w"):
            w -= gw
        if edges.get("e"):
            e += gw
        if edges.get("s"):
            s -= gh
        if edges.get("n"):
            n += gh
        if kapali:
            # kenara değmiyor ama alan çok küçük (bozuk pencere) — yine de büyüt
            w, s, e, n = w - gw / 2, s - gh / 2, e + gw / 2, n + gh / 2
        w, e = max(w, lon - max_span_deg), min(e, lon + max_span_deg)
        s, n = max(s, lat - max_span_deg), min(n, lat + max_span_deg)
    if best is None:
        raise RuntimeError("Havza çıkarılamadı: tıklanan nokta bir akış yoluna oturmuyor olabilir")
    return _kenetleme_uyar(best)  # en büyük/güvenilir sonuç (kenara değiyorsa uyarıyla)


YAKIN_PAY = 0.2       # yarıçapın bu kadarı "tıklamanın dibi" sayılır
SICRAMA_KAT = 1.5     # seçilen kanal, dipteki en büyüğün bu katıysa atlamıştır


def delineate_iki_asamali(lat, lon, tampon_m=500.0, river_km2=1.0, snap_m=500.0,
                          hedef_alan_km2=None, max_cells=None,
                          ilk_kaynak="auto"):
    """İki aşamalı havza çıkarımı: 30 m ile bul, 10 m ile ölç.

    10 m DEM 11.8 milyar hücre; havzanın nerede olduğunu bilmeden ondan okuma
    yapılamaz. O yüzden sıra şu:

      1. 30 m DEM ile havza çıkarılır — hızlı, ülke çapında kapsamlı.
      2. Havza sınırına `tampon_m` kadar pay eklenir. Pay şart: 10 m akış
         yolları 30 m'dekinden biraz farklı gider ve su bölümü çizgisi birkaç
         yüz metre oynayabilir; pencere tam sınırdan kesilirse havza kenardan
         budanır.
      3. 10 m DEM (ED50 Lambert) o pencereden kesilip WGS84'e döndürülür.
      4. Havza karakteristikleri (alan, L, Lc, kot profili) 10 m'den yeniden
         hesaplanır.

    İKİNCİ AŞAMA BİRİNCİNİN ALANINI HEDEF ALIR. Kavşakta 10 m ağı, 30 m'nin
    oturduğundan başka bir kola oturabilir ve iki aşama farklı havzayı anlatır.
    Kullanıcı bir hedef vermediyse birinci aşamanın alanı hedef yapılır; böylece
    iki aşama aynı havzayı ölçer, yalnız çözünürlük değişir.
    """
    ilk = delineate(lat, lon, river_km2=river_km2, snap_m=snap_m,
                    max_cells=max_cells, dem_source=ilk_kaynak,
                    hedef_alan_km2=hedef_alan_km2)
    gj = ilk.get("havza_geojson") or {}
    koord = gj.get("coordinates") or []
    halkalar = koord if gj.get("type") == "Polygon" else [h for p in koord for h in p]
    xs = [p[0] for h in halkalar for p in h]
    ys = [p[1] for h in halkalar for p in h]
    if not xs:
        raise RuntimeError("Birinci aşamada havza sınırı üretilemedi")
    tam = max(0.0, float(tampon_m))
    orta = math.radians((min(ys) + max(ys)) / 2.0)
    dlat = tam / 110540.0
    dlon = tam / (111320.0 * max(math.cos(orta), 1e-6))
    bbox = (min(xs) - dlon, min(ys) - dlat, max(xs) + dlon, max(ys) + dlat)

    # 10 m'nin kazandırdığı yer var mı? Havza çıkarımı MAX_CELLS ile sınırlı;
    # 10 m'de hücre sayısı onu aşınca DEM kabalaştırılır ve fiilen 30 m'ye
    # döner. Ölçüldü: 800 km²'ye kadar tam 10 m, 2000 km²'de 15.8 m,
    # 7500 km²'de 30.6 m — yani büyük havzada iki aşama koşmanın anlamı yok.
    sinir_km2 = (max_cells or MAX_CELLS) * 100.0 / 1e6
    alan1 = ilk.get("alan_km2") or 0.0
    kazanc_uyarisi = None
    if alan1 > 8 * sinir_km2:
        kazanc_uyarisi = (
            f"Havza {alan1:.0f} km²; 10 m'de {alan1*1e4:,.0f} hücre eder ve "
            f"hücre sınırı ({max_cells or MAX_CELLS:,}) yüzünden DEM "
            f"~{10*(alan1*1e4/(max_cells or MAX_CELLS))**0.5:.0f} m'ye "
            "kabalaştırılır — yani 30 m ile aynı yere çıkar. 10 m'nin kazancı "
            f"kabaca {8*sinir_km2:.0f} km²'nin altındaki havzalarda görülür.")

    hedef = hedef_alan_km2 or ilk.get("alan_km2")
    edges, out = _delineate_once(lat, lon, bbox, river_km2, snap_m=snap_m,
                                 max_cells=max_cells, dem_source="10m",
                                 hedef_alan_km2=hedef)
    out = _kenetleme_uyar(out)
    out["ilk_asama"] = {
        "kaynak": ilk_kaynak, "alan_km2": ilk.get("alan_km2"),
        "L_km": ilk.get("L_km"), "Lc_km": ilk.get("Lc_km"),
        "cozunurluk_m": ilk.get("cozunurluk_m"),
    }
    out["tampon_m"] = tam
    out["dem_kaynagi"] = "10m"
    if kazanc_uyarisi:
        out.setdefault("uyarilar", []).append(kazanc_uyarisi)
    if any(edges.values()):
        out.setdefault("uyarilar", []).append(
            f"Havza, {tam:.0f} m tamponla açılan 10 m penceresinin kenarına "
            "değiyor — alan budanmış olabilir. Tamponu büyütüp tekrar deneyin.")
    # ÖLÇEK UYARISI. Akarsu uzunluğu ölçeğe bağlı bir büyüklüktür: çözünürlük
    # arttıkça akış yolu her kıvrımı sayar ve uzar. Ölçüldü — Beyağaç'ta 30 m'de
    # L=9.10 Lc=4.80, 10 m'de L=10.76 Lc=6.88. Alan %1 aynı, uzunluklar %18/%43
    # uzun. Bu, DSİ'nin Ct/Cp katsayılarıyla çelişir: onlar HARİTADAN ölçülmüş
    # (~1-2 km genelleme) uzunluklarla kalibre edilmiştir. tp = Ct·(L·Lc)^0.30
    # olduğu için 10 m uzunlukları tp'yi büyütür ve pik debiyi DÜŞÜRÜR.
    l1, l2 = ilk.get("L_km"), out.get("L_km")
    c1, c2 = ilk.get("Lc_km"), out.get("Lc_km")
    if l1 and l2 and c1 and c2 and (l2 * c2) > 1.2 * (l1 * c1):
        tp_kat = ((l2 * c2) / (l1 * c1)) ** 0.30
        out.setdefault("uyarilar", []).append(
            f"10 m'de L={l2:.2f} Lc={c2:.2f} km, 30 m'de L={l1:.2f} Lc={c1:.2f} km. "
            "Akarsu uzunluğu ÖLÇEĞE BAĞLIDIR — ince DEM her kıvrımı sayar. "
            f"Snyder/DSİ'nin Ct katsayısı haritadan ölçülmüş uzunluklara göre "
            f"kalibrelidir; bu L/Lc ile tp %{(tp_kat-1)*100:.0f} büyür ve pik "
            "debi o oranda düşer. ALAN ve KOT profili için 10 m'yi kullanın, "
            "L/Lc için 30 m değerlerini (ya da haritadan ölçüleni) tercih edin.")
    a1, a2 = ilk.get("alan_km2"), out.get("alan_km2")
    if a1 and a2 and abs(a2 - a1) > 0.15 * a1:
        out.setdefault("uyarilar", []).append(
            f"10 m alanı ({a2:.2f} km²) 30 m alanından ({a1:.2f} km²) "
            f"%{abs(a2/a1-1)*100:.0f} farklı. Çözünürlük değişince su bölümü "
            "biraz oynar, ama bu kadarı iki aşamanın FARKLI KOLA oturduğuna "
            "işaret edebilir — 'beklenen alan' verip tekrar deneyin.")
    return out


def _kenetleme_uyar(out):
    """Kenetleme BAŞKA BİR AKARSUYA atladıysa uyarır.

    Kenetleme kuralı "yarıçap içindeki en yüksek akış birikimi"dir (ArcHydro /
    QGIS 'Snap Pour Point' geleneği). O gelenek, kullanıcının yatağın ÜSTÜNE
    tıkladığını ve yarıçapın DEM'in konum hatasını (bir iki hücre) karşıladığını
    varsayar. Yarıçap büyüdükçe kural hep daha uzaktaki daha büyük nehri seçer
    ve alan yakınsamaz: Beyağaç'ta 1000 m'de 25 km², 2000 m'de 215 km² çıkıyor,
    çünkü 2 km ötede bambaşka bir akarsu var.

    Ama kenetlemenin pencere kenarına oturması TEK BAŞINA kusur değildir —
    aynı nehir üzerinde mansaba kaymak alanı değiştirmez. Aynı Beyağaç
    noktasında 500 m yarıçapla kenetleme 477 m gidiyor ve sonuç doğru
    (24.58 km²), çünkü 31 m'deki kolun ta kendisine oturuyor, sadece biraz
    aşağısına. Sırf mesafeye bakıp uyarmak yanlış alarm olurdu.

    O yüzden ölçüt şu: tıklamanın DİBİNDEKİ en büyük kolla seçilen alanı
    karşılaştır. Seçilen, dipdekinin katına çıkmışsa gerçekten başka bir
    akarsuya atlanmıştır ve alan yarıçapın rastlantısal bir fonksiyonudur.
    """
    if not out.get("kenetleme_doymus"):
        return out
    r = out.get("kenetleme_yaricapi_m") or 0.0
    secilen = out.get("alan_km2") or 0.0
    en_yakin = out.get("yakin_en_buyuk_km2")
    if not en_yakin or secilen <= SICRAMA_KAT * en_yakin:
        return out                       # aynı kol üzerinde kaymış, sorun yok
    out.setdefault("uyarilar", []).append(
        f"Çıkış noktası {out['snap_mesafe_m']:.0f} m ötedeki bir akarsuya "
        f"kenetlendi ({r:.0f} m'lik arama yarıçapının kenarı) ve seçilen havza "
        f"{secilen:.1f} km², oysa tıklamanın dibindeki kol {en_yakin:.1f} km². "
        "Kenetleme büyük olasılıkla KOMŞU BİR AKARSUYA atladı — alan yarıçapa "
        "bağımlı hale geldi. Kenetleme yarıçapını küçültün, noktayı yatağın "
        "üstüne alın ya da 'yakındaki diğer kollar'dan doğru olanı seçin.")
    return out


def _delineate_once(lat, lon, bbox, river_km2, snap_m=500.0, max_cells=None,
                    dem_source="auto", hedef_alan_km2=None):
    import gc
    import pyflwdir
    from rasterio import features as rfeatures
    from shapely.geometry import LineString, shape
    from shapely.ops import unary_union

    dem_path = get_dem_mosaic(bbox, max_cells=max_cells, dem_source=dem_source)

    # DEM'i oku + pit doldur + akış yönü (pyflwdir tek çağrıda)
    import rasterio
    try:
        with rasterio.open(dem_path) as src:
            dem_arr = src.read(1)
            transform = src.transform
    finally:
        os.unlink(dem_path)  # clean up tempfile
    dem_arr = dem_arr.astype(np.float64)
    dem_arr[dem_arr <= -1e6] = np.nan

    # Pit doldurulmuş DEM + D8 akış yönü (tek geçişte)
    dem_raw = dem_arr  # raw elevations (harmonik profil için sakla)
    filled_dem, d8 = pyflwdir.fill_depressions(np.copy(dem_arr), nodata=np.nan)
    flw = pyflwdir.from_array(d8, ftype='d8', transform=transform, latlon=True)
    del d8
    gc.collect()

    acc = flw.upstream_area('cell')

    # hücre alanı (yaklaşık, merkez enlemde)
    dx = abs(transform.a) * 111320.0 * math.cos(math.radians(lat))
    dy = abs(transform.e) * 110540.0
    cell_km2 = dx * dy / 1e6

    # outlet'i AKARSU AĞINA kenetle: eşiği aşan en yakın hücre (bkz.
    # _akarsuya_kenetle). snap_m artık bir üst sınırdır, hedef yarıçap değil.
    h, w = flw.shape
    esik_hucre = max(1.0, river_km2 / cell_km2)
    hedef_hucre = (hedef_alan_km2 / cell_km2) if hedef_alan_km2 else None
    row, col, x_snap, y_snap, _kenet_m, _kenet_esik = _akarsuya_kenetle(
        acc, transform, dx, dy, lat, lon, h, w, esik_hucre, snap_m,
        hedef_hucre=hedef_hucre)
    idx_out = row * w + col

    # havza maskesi
    flw.add_pits(xy=([x_snap], [y_snap]))
    basin_ids = flw.basins(xy=([x_snap], [y_snap]))
    outlet_id = basin_ids[row, col]
    if outlet_id == 0:
        return None
    catch_arr = np.asarray(basin_ids == outlet_id, dtype=bool)
    n_cells = int(catch_arr.sum())
    if n_cells < 4:
        return None
    area_km2 = n_cells * cell_km2

    # havza hangi pencere kenarlarına değiyor? (yalnız o yönde büyütmek için)
    edges = {"n": bool(catch_arr[0, :].any()), "s": bool(catch_arr[-1, :].any()),
             "w": bool(catch_arr[:, 0].any()), "e": bool(catch_arr[:, -1].any())}
    touches = any(edges.values())

    # havza poligonu
    shapes = list(rfeatures.shapes(catch_arr.astype(np.uint8),
                                   mask=catch_arr, transform=transform))
    poly = unary_union([shape(g) for g, v in shapes]).simplify(abs(transform.a) / 2)
    del shapes
    gc.collect()
    if poly.geom_type == "MultiPolygon":
        poly = max(poly.geoms, key=lambda p: p.area)

    fdir_arr = flw.to_array('d8')
    acc_arr = np.asarray(acc)
    # rakip kolları acc serbest bırakılmadan ÖNCE çıkar (aşağıda del ediliyor)
    adaylar = aday_kanallar(acc_arr, transform, dx, dy, lat, lon, h, w,
                            cell_km2, maks_m=max(snap_m, 800.0))
    # Tıklamanın DİBİNDEKİ en büyük kol — kenetlemenin komşu akarsuya atlayıp
    # atlamadığını sınamak için referans (bkz. _kenetleme_uyar). `adaylar`
    # listesine bakılamaz: o yalnız en büyük dördü döndürür, geniş yarıçapta
    # yakındaki küçük kollar listeden düşer ve atlama görünmez olur.
    yakin = aday_kanallar(acc_arr, transform, dx, dy, lat, lon, h, w, cell_km2,
                          maks_m=min(max(snap_m * 0.25, 150.0), 500.0),
                          en_fazla=6)
    yakin_en_buyuk = max((k["alan_km2"] for k in yakin), default=None)
    del acc
    gc.collect()

    # ---- en uzun akış yolu: akış mesafesi havza içinde max olan hücreden
    with _flw_gecici_transform(flw):
        dist_arr = flw.stream_distance(unit='m')
        dist_arr = np.where(catch_arr & np.isfinite(dist_arr), dist_arr, -1)
        head_idx = int(np.argmax(dist_arr))

        path_idxs, _ = flw.path(idxs=np.array([head_idx]))
    path_idxs = np.asarray(path_idxs[0])

    # outlet'e kadar olan kısmı al
    outlet_found = None
    for i in range(len(path_idxs)):
        if path_idxs[i] == idx_out:
            outlet_found = i
            break
    if outlet_found is None:
        outlet_found = len(path_idxs) - 1
    path_idxs = path_idxs[:outlet_found + 1]
    path = [(int(x) // w, int(x) % w) for x in path_idxs]

    xs, ys = flw.xy(path_idxs)
    path_ll = [(float(xs[i]), float(ys[i])) for i in range(len(xs))]
    del dist_arr
    gc.collect()

    # metrik uzunluk (kümülatif)
    cum = [0.0]
    for i in range(1, len(path_ll)):
        cum.append(cum[-1] + _seg_len_m(*path_ll[i - 1], *path_ll[i]))
    L_m = cum[-1]

    # ---- Lc: ana kanal üzerinde ağırlık merkezine en yakın noktaya kadar mesafe
    cen = poly.centroid
    dmin, imin = 1e30, 0
    for i, (px, py) in enumerate(path_ll):
        d = (px - cen.x) ** 2 + (py - cen.y) ** 2
        if d < dmin:
            dmin, imin = d, i
    Lc_m = L_m - cum[imin]

    # ---- harmonik profil: yol boyunca 11 eşit aralıklı kot (ham DEM'den)
    prof = []
    for k in range(11):
        target = L_m * k / 10.0
        j = min(range(len(cum)), key=lambda i: abs((L_m - cum[i]) - target))
        r, c = path[j]
        prof.append(float(dem_raw[r, c]))
    del dem_raw, filled_dem
    gc.collect()
    prof = _monoton_profil(prof)

    # ---- dere ağı
    thr = max(30, int(river_km2 / cell_km2))
    riv_mask = (acc_arr >= thr) & catch_arr
    lines = []
    for ri, ci in zip(*np.nonzero(riv_mask)):
        d = int(fdir_arr[ri, ci])
        if d in D8:
            dr, dc = D8[d]
            r2, c2 = ri + dr, ci + dc
            if 0 <= r2 < h and 0 <= c2 < w and riv_mask[r2, c2]:
                p1 = transform * (ci + 0.5, ri + 0.5)
                p2 = transform * (c2 + 0.5, r2 + 0.5)
                lines.append(LineString([p1, p2]))
    rivers = unary_union(lines) if lines else None
    del riv_mask, fdir_arr, acc_arr, catch_arr
    gc.collect()

    out = {
        "outlet": {"lat": lat, "lon": lon, "snap_lat": y_snap, "snap_lon": x_snap},
        "alan_km2": round(area_km2, 3),
        "L_km": round(L_m / 1000.0, 3),
        "Lc_km": round(Lc_m / 1000.0, 3),
        "kotlar": [round(p, 1) for p in prof],
        "havza_geojson": poly.__geo_interface__,
        "dere_geojson": rivers.__geo_interface__ if rivers else None,
        "ana_kanal_geojson": LineString(path_ll).__geo_interface__,
        "kenar_uyarisi": bool(touches),
        # teşhis: kullanılan çözünürlük, snap mesafesi, pencere
        "cozunurluk_m": round((dx + dy) / 2.0, 1),
        "snap_mesafe_m": round(_seg_len_m(lon, lat, x_snap, y_snap), 1),
        # Kenetleme arama penceresinin KENARINA oturduysa sonuç yarıçapa
        # bağımlıdır ve yakınsamamıştır. Kural "yarıçap içindeki en yüksek
        # birikim" olduğu için, pencere büyüdükçe hep daha uzaktaki daha büyük
        # nehir seçilir: Beyağaç'ta 1000 m'de 25 km², 2000 m'de 215 km² çıkıyor
        # — 2 km ötedeki BAŞKA bir akarsuya atlıyor. Kullanıcı bu sıçramayı
        # göremezse, yarıçapın rastlantısal değerini havza alanı sanır.
        "kenetleme_doymus": bool(
            _seg_len_m(lon, lat, x_snap, y_snap) > 0.8 * snap_m),
        "kenetleme_yaricapi_m": round(float(snap_m), 1),
        "yakin_en_buyuk_km2": yakin_en_buyuk,
        "pencere_deg": [round(v, 4) for v in bbox],
        # tıklama çevresindeki rakip kollar: kenetleme belirsizse arayüz
        # bunları alternatif olarak sunar (bkz. aday_kanallar)
        "aday_kanallar": adaylar,
    }
    return edges, out


# ==================== ÇOK PARÇALI HAVZA (ARA HAVZA) ====================
def _akarsuya_kenetle(acc, transform, dx, dy, lat, lon, h, w,
                      esik_hucre, maks_m, hedef_hucre=None):
    """Tıklanan noktayı EN YAKIN akarsu hücresine kenetler.

    `hedef_hucre` verilirse (beklenen yağış alanının hücre karşılığı) kural
    değişir: yarıçap içindeki hücreler arasından birikimi HEDEFE EN YAKIN olan
    seçilir, eşitlikte tıklamaya yakın olan. Sebebi somut — Beyağaç'ta tıklanan
    noktanın 31 m yanında 8.2 km²'lik kol var ama "en yüksek birikim" kuralı
    477 m yürüyüp iki kolun birleştiği 24.6 km²'yi seçiyor. Kullanıcı havzanın
    ~10 km² olduğunu biliyorsa doğru kolu göstermenin en dolaysız yolu budur;
    aynı yöntem doğrulama çalışmasında 500 m'de başarısız olan 14 AGİ havzasının
    14'ünü de kurtarmıştı (bkz. tools/net_yagis_dogrulama.py `_havza_bul`).

    Bu, "sonucu istenen yere çekmek" DEĞİLDİR: kalibre edilen büyüklük havza
    alanı değil ÇIKIŞ NOKTASININ YERİdir, alan ise bağımsız olarak bilinir.

    Eski kural "arama kutusundaki en yüksek birikim"di ve İKİ YÖNLÜ hata
    veriyordu:
      - yarıçap küçükse yatağa hiç ulaşamayıp yamaç hücresinde kalıyor,
        havza yanlış/eksik çıkıyordu;
      - yarıçap büyükse yakındaki küçük yatağı geçip komşu BÜYÜK kola
        atlıyor, havzayı şişiriyordu.
    Kullanıcının doğru yarıçapı tahmin etmesi gerekiyordu ki bunu bilemez.

    Yeni kural: akarsu ağı (birikim >= esik_hucre) içindeki en yakın hücre;
    eşit uzaklıkta birikimi büyük olan. Böylece `maks_m` yalnızca bir ÜST
    SINIRDIR — büyük tutmak zararsızdır, çünkü yakında yatak varken uzaktaki
    büyük nehre atlanmaz. Küçük havzada eşik ağı boşaltıyorsa eşik kademeli
    düşürülür; hiçbiri tutmazsa eski davranışa (en yüksek birikim) dönülür.

    Döner: (row, col, x, y, mesafe_m, esik_kullanilan) — esik_kullanilan None
    ise ağ bulunamamış, en yüksek birikime kenetlenmiştir.
    """
    col = min(max(int((lon - transform.c) / transform.a), 0), w - 1)
    row = min(max(int((lat - transform.f) / transform.e), 0), h - 1)

    # KURAL: menzildeki en yüksek akış birikimi (ArcHydro / QGIS "Snap Pour
    # Point" ile aynı). Kısa süre "en yakın dere"yi denedim; bu, ana kanaldan
    # 70 m daha yakın duran önemsiz bir yan kola oturup havzayı 10 km²'den
    # 1.8 km²'ye düşürdü. Standart kural doğru; eski koddaki gerçek kusur
    # `max(8, ...)` gizli tabanıydı: 30 m DEM'de kullanıcı 50 m yazsa bile
    # 240 m aranıyordu, yani ayarı uygulanmıyordu.
    yaricap = max(1, int(math.ceil(maks_m / max(1e-9, min(dx, dy)))))
    r0, r1 = max(0, row - yaricap), min(h, row + yaricap + 1)
    c0, c1 = max(0, col - yaricap), min(w, col + yaricap + 1)
    pencere = np.asarray(acc[r0:r1, c0:c1])
    d_satir = (np.arange(r0, r1) - row)[:, None] * dy
    d_sutun = (np.arange(c0, c1) - col)[None, :] * dx
    mesafe = np.hypot(d_satir, d_sutun)
    menzil = mesafe <= max(maks_m, min(dx, dy) * 0.5)

    if hedef_hucre and hedef_hucre > 0:
        # Hedef alan verildi: birikimi hedefe en yakın kanal hücresini seç.
        # Mesafe, eşitliği bozan ikincil ölçüt — aynı kol boyunca birikim çok
        # yavaş değiştiği için yüzlerce hücre benzer puan alır ve bunların
        # tıklamaya en yakını doğru olandır.
        aday = menzil & (pencere >= esik_hucre)
        if aday.any():
            fark = np.where(aday, np.abs(pencere - hedef_hucre), np.inf)
            en_iyi = float(fark[aday].min())
            # %2'lik bir bant: aynı kolun komşu hücreleri arasında mesafe karar versin
            bant = aday & (fark <= en_iyi + 0.02 * max(hedef_hucre, 1.0))
            m = np.where(bant, mesafe, np.inf)
            ri, ci = np.unravel_index(int(np.argmin(m)), m.shape)
            row2, col2 = r0 + int(ri), c0 + int(ci)
            x, y = transform * (col2 + 0.5, row2 + 0.5)
            return (row2, col2, float(x), float(y), float(mesafe[ri, ci]),
                    float(pencere[ri, ci]))

    puan = np.where(menzil, pencere, -1.0)
    ri, ci = np.unravel_index(int(np.argmax(puan)), puan.shape)
    kullanilan = float(pencere[ri, ci]) if pencere[ri, ci] >= esik_hucre else None

    row2, col2 = r0 + int(ri), c0 + int(ci)
    x, y = transform * (col2 + 0.5, row2 + 0.5)
    return row2, col2, float(x), float(y), float(mesafe[ri, ci]), kullanilan


def aday_kanallar(acc, transform, dx, dy, lat, lon, h, w, cell_km2,
                  maks_m=800.0, en_fazla=4):
    """Tıklanan noktanın çevresindeki belirgin akarsu kollarını listeler.

    Kenetleme belirsizliğini GİZLEMEK yerine göstermek için: iki DEM aynı
    dereyi farklı yerlere koyabilir ve 300 m yarıçapta alanları 2/10/16 km²
    olan ayrı kollar bulunabilir. Hangisinin kullanıcının kastettiği outlet
    olduğu koddan bilinemez; arayüz bunları alternatif olarak sunar.

    Döner: [{alan_km2, mesafe_m, lat, lon}] — alana göre büyükten küçüğe.
    """
    col = min(max(int((lon - transform.c) / transform.a), 0), w - 1)
    row = min(max(int((lat - transform.f) / transform.e), 0), h - 1)
    yaricap = max(1, int(math.ceil(maks_m / max(1e-9, min(dx, dy)))))
    r0, r1 = max(0, row - yaricap), min(h, row + yaricap + 1)
    c0, c1 = max(0, col - yaricap), min(w, col + yaricap + 1)
    pencere = np.asarray(acc[r0:r1, c0:c1], dtype=np.float64)
    d_satir = (np.arange(r0, r1) - row)[:, None] * dy
    d_sutun = (np.arange(c0, c1) - col)[None, :] * dx
    mesafe = np.hypot(d_satir, d_sutun)

    aday = (mesafe <= maks_m) & (pencere * cell_km2 >= 1.0)
    puan = np.where(aday, pencere, -1.0)
    out = []
    for _ in range(en_fazla):
        if puan.max() <= 0:
            break
        ri, ci = np.unravel_index(int(np.argmax(puan)), puan.shape)
        buyukluk = float(pencere[ri, ci])
        # aynı kola ait hücreler: birikimi yakın olanlar
        ayni_kol = np.abs(pencere - buyukluk) < buyukluk * 0.35
        m = np.where(ayni_kol & aday, mesafe, np.inf)
        rj, cj = np.unravel_index(int(np.argmin(m)), m.shape)
        x, y = transform * (c0 + cj + 0.5, r0 + rj + 0.5)
        out.append({"alan_km2": round(buyukluk * cell_km2, 3),
                    "mesafe_m": round(float(m[rj, cj]), 1),
                    "lat": round(float(y), 6), "lon": round(float(x), 6)})
        puan = np.where(ayni_kol, -1.0, puan)
    return out


def _snap_idx(acc, transform, dx, lat, lon, h, w, snap_m=500.0,
              cell_km2=None, river_km2=1.0):
    """Çok parçalı akışta kenetleme — tek havzayla aynı kuralı kullanır."""
    dy = dx if cell_km2 is None else (cell_km2 * 1e6 / dx)
    esik = 1.0 if cell_km2 is None else max(1.0, river_km2 / cell_km2)
    row, col, x, y, _, _ = _akarsuya_kenetle(
        acc, transform, dx, dy, lat, lon, h, w, esik, snap_m)
    return row, col, x, y


def _params_from_mask(flw, transform, acc_arr, dem_raw, dist_all, mask, outlet_idx,
                      cell_km2, h, w):
    """Bir havza maskesinden A, L, Lc, kotlar, poligon ve ana kanal üretir.

    Ana kanal: maske içindeki (outlet'e akış mesafesi en büyük) hücreden outlet'e.
    """
    from rasterio import features as rfeatures
    from shapely.geometry import LineString, shape
    from shapely.ops import unary_union

    n_cells = int(mask.sum())
    if n_cells < 4:
        return None
    area_km2 = n_cells * cell_km2

    shapes = list(rfeatures.shapes(mask.astype(np.uint8), mask=mask, transform=transform))
    poly = unary_union([shape(g) for g, v in shapes]).simplify(abs(transform.a) / 2)
    if poly.geom_type == "MultiPolygon":
        poly = max(poly.geoms, key=lambda p: p.area)

    d = np.where(mask & np.isfinite(dist_all), dist_all, -1)
    head_idx = int(np.argmax(d))
    with _flw_gecici_transform(flw):
        path_idxs, _ = flw.path(idxs=np.array([head_idx]))
    path_idxs = np.asarray(path_idxs[0])
    cut = len(path_idxs) - 1
    for i in range(len(path_idxs)):
        if path_idxs[i] == outlet_idx:
            cut = i
            break
    path_idxs = path_idxs[:cut + 1]
    path = [(int(x) // w, int(x) % w) for x in path_idxs]
    xs, ys = flw.xy(path_idxs)
    path_ll = [(float(xs[i]), float(ys[i])) for i in range(len(xs))]

    cum = [0.0]
    for i in range(1, len(path_ll)):
        cum.append(cum[-1] + _seg_len_m(*path_ll[i - 1], *path_ll[i]))
    L_m = cum[-1] or 1.0

    cen = poly.centroid
    imin = min(range(len(path_ll)),
               key=lambda i: (path_ll[i][0] - cen.x) ** 2 + (path_ll[i][1] - cen.y) ** 2)
    Lc_m = L_m - cum[imin]

    prof = []
    for k in range(11):
        target = L_m * k / 10.0
        j = min(range(len(cum)), key=lambda i: abs((L_m - cum[i]) - target))
        r, c = path[j]
        prof.append(float(dem_raw[r, c]))
    prof = _monoton_profil(prof)

    return {
        "alan_km2": round(area_km2, 3),
        "L_km": round(L_m / 1000.0, 3),
        "Lc_km": round(Lc_m / 1000.0, 3),
        "kotlar": [round(p, 1) for p in prof],
        "havza_geojson": poly.__geo_interface__,
        "ana_kanal_geojson": LineString(path_ll).__geo_interface__,
    }


def _ana_kol_dere_agindan(dere_gj, havza_geom, dem_arr, transform):
    """İçe aktarılan dere ağından ana kolu (en uzun akış yolu) çıkarır.

    Dere ağı dendritik (ağaç) olduğundan, çıkış düğümünden her düğüme tek bir
    yol vardır; en uzak düğüme giden yol ana koldur. Çıkış düğümü, ağ
    düğümleri içinde DEM kotu en düşük olandır.

    Döner: [(lon, lat), ...] çıkıştan yukarı doğru ana kol noktaları.
    """
    import heapq
    from shapely.geometry import shape
    from shapely.ops import linemerge

    geom = shape(dere_gj)
    try:
        geom = geom.intersection(havza_geom)     # havza dışını at
    except Exception:
        pass
    if geom.is_empty:
        return None
    parcalar = []
    gs = [geom] if geom.geom_type == "LineString" else list(getattr(geom, "geoms", []))
    for g in gs:
        if g.geom_type == "LineString" and len(g.coords) >= 2:
            parcalar.append(g)
        elif g.geom_type == "MultiLineString":
            parcalar += [x for x in g.geoms if len(x.coords) >= 2]
    if not parcalar:
        return None
    try:
        birlesik = linemerge(parcalar)
        parcalar = ([birlesik] if birlesik.geom_type == "LineString"
                    else [x for x in birlesik.geoms if len(x.coords) >= 2])
    except Exception:
        pass

    TOL = 6                                    # ~1 m'lik düğüm yuvarlama
    dugum = lambda p: (round(p[0], TOL), round(p[1], TOL))
    komsu = {}
    for ls in parcalar:
        ko = list(ls.coords)
        a, b = dugum(ko[0]), dugum(ko[-1])
        uz = 0.0
        for i in range(1, len(ko)):
            uz += _seg_len_m(ko[i - 1][0], ko[i - 1][1], ko[i][0], ko[i][1])
        if a == b or uz <= 0:
            continue
        komsu.setdefault(a, []).append((b, uz, ko))
        komsu.setdefault(b, []).append((a, uz, ko[::-1]))
    if not komsu:
        return None

    def kot(p):
        c = int((p[0] - transform.c) / transform.a)
        r = int((p[1] - transform.f) / transform.e)
        if 0 <= r < dem_arr.shape[0] and 0 <= c < dem_arr.shape[1]:
            v = dem_arr[r, c]
            if np.isfinite(v):
                return float(v)
        return float("inf")

    cikis = min(komsu.keys(), key=kot)          # en alçak düğüm = çıkış
    # ağaç üzerinde Dijkstra (tek yol olduğundan en uzak düğüm = ana kol ucu)
    uzaklik = {cikis: 0.0}
    onceki = {}
    kuyruk = [(0.0, cikis)]
    while kuyruk:
        d, u = heapq.heappop(kuyruk)
        if d > uzaklik.get(u, float("inf")):
            continue
        for v, uz, ko in komsu.get(u, []):
            nd = d + uz
            if nd < uzaklik.get(v, float("inf")):
                uzaklik[v] = nd
                onceki[v] = (u, ko)
                heapq.heappush(kuyruk, (nd, v))
    if len(uzaklik) < 2:
        return None
    uc = max(uzaklik, key=lambda k: uzaklik[k])
    # uçtan çıkışa yolu topla, sonra çıkış→yukarı yönüne çevir
    yol = []
    cur = uc
    while cur in onceki:
        u, ko = onceki[cur]
        yol = list(ko) + yol                    # ko: u -> cur yönünde
        cur = u
    if len(yol) < 2:
        return None
    return [(float(x), float(y)) for x, y in yol]


def params_from_basin_polygon(havza_gj, river_km2=1.0, max_cells=None,
                              dem_source="auto", marj_deg=0.02, dere_gj=None):
    """Dışarıdan çizilmiş havza sınırından DEM ile parametre üretir.

    Kullanıcı havza poligonunu (CAD/GIS'te sayısallaştırılmış) verir; alan
    poligonun **kendisinden** (jeodezik) hesaplanır, L / Lc / 11 nokta kot
    profili ve dere ağı ise poligonun içine düşen DEM hücrelerinden akış
    yönleriyle türetilir. Çıkış noktası, poligon içindeki en yüksek akış
    birikimine sahip hücredir.

    Döner: delineate() ile aynı biçimde sözlük (havza_geojson kullanıcının
    çizdiği sınırdır, rasterleştirilmiş hali değil).
    """
    import gc
    import pyflwdir
    import rasterio
    from rasterio import features as rfeatures
    from shapely.geometry import LineString, shape

    if max_cells is None:
        max_cells = MAX_CELLS
    geom = shape(havza_gj)
    if geom.geom_type == "MultiPolygon":
        geom = max(geom.geoms, key=lambda p: p.area)
    if geom.geom_type != "Polygon":
        raise RuntimeError("Havza sınırı bir poligon olmalı")
    w0, s0, e0, n0 = geom.bounds
    bbox = (w0 - marj_deg, s0 - marj_deg, e0 + marj_deg, n0 + marj_deg)
    lat_m = (s0 + n0) / 2.0

    dem_path = get_dem_mosaic(bbox, max_cells=max_cells, dem_source=dem_source)
    with rasterio.open(dem_path) as src:
        dem_arr = src.read(1).astype(np.float64)
        transform = src.transform
    os.unlink(dem_path)
    dem_arr[dem_arr <= -1e6] = np.nan
    dem_raw = dem_arr
    filled, d8 = pyflwdir.fill_depressions(np.copy(dem_arr), nodata=np.nan)
    flw = pyflwdir.from_array(d8, ftype="d8", transform=transform, latlon=True)
    del d8, filled
    gc.collect()
    acc = np.asarray(flw.upstream_area("cell"))
    h, w = flw.shape
    dx = abs(transform.a) * 111320.0 * math.cos(math.radians(lat_m))
    dy = abs(transform.e) * 110540.0
    cell_km2 = dx * dy / 1e6

    mask = rfeatures.geometry_mask([geom.__geo_interface__], out_shape=(h, w),
                                   transform=transform, invert=True)
    if int(mask.sum()) < 4:
        raise RuntimeError("Havza poligonu DEM üzerinde çok küçük veya kapsam dışı")

    # çıkış noktası: poligon içindeki en yüksek akış birikimi
    a_in = np.where(mask, acc, -1)
    r_o, c_o = np.unravel_index(int(np.argmax(a_in)), a_in.shape)
    idx_out = r_o * w + c_o
    x_out, y_out = transform * (c_o + 0.5, r_o + 0.5)

    with _flw_gecici_transform(flw):
        dist_all = np.asarray(flw.stream_distance(unit="m"))
    res = _params_from_mask(flw, transform, acc, dem_raw, dist_all, mask, idx_out,
                            cell_km2, h, w)
    if res is None:
        raise RuntimeError("Havza parametreleri çıkarılamadı (poligon çok küçük olabilir)")

    # alan: rasterleştirmeden değil, kullanıcının poligonundan (jeodezik)
    try:
        alan_m2, _ = _geod().geometry_area_perimeter(geom)
        res["alan_km2"] = round(abs(alan_m2) / 1e6, 3)
    except Exception:
        pass
    res["havza_geojson"] = geom.__geo_interface__      # çizilen sınır korunur
    res["outlet"] = {"lat": float(y_out), "lon": float(x_out),
                     "snap_lat": float(y_out), "snap_lon": float(x_out)}
    res["kenar_uyarisi"] = False
    res["cozunurluk_m"] = round((dx + dy) / 2.0, 1)
    res["kaynak"] = "ice_aktarim"
    res["parametre_kaynagi"] = "dem"

    # --- dere ağı verildiyse L / Lc / kot profilini ONDAN üret ---
    if dere_gj:
        yol = _ana_kol_dere_agindan(dere_gj, geom, dem_raw, transform)
        if yol and len(yol) >= 2:
            kum = [0.0]
            for i in range(1, len(yol)):
                kum.append(kum[-1] + _seg_len_m(*yol[i - 1], *yol[i]))
            L_m = kum[-1]
            if L_m > 0:
                # Lc: ana kol üzerinde ağırlık merkezine en yakın noktaya mesafe
                cen = geom.centroid
                imin = min(range(len(yol)),
                           key=lambda i: (yol[i][0] - cen.x) ** 2 + (yol[i][1] - cen.y) ** 2)
                # 11 eşit aralıklı noktada DEM kotu (çıkıştan yukarı)
                prof = []
                for k in range(11):
                    hedef = L_m * k / 10.0
                    j = min(range(len(kum)), key=lambda i: abs(kum[i] - hedef))
                    px, py = yol[j]
                    c2 = int((px - transform.c) / transform.a)
                    r2 = int((py - transform.f) / transform.e)
                    v = (dem_raw[r2, c2] if 0 <= r2 < h and 0 <= c2 < w else np.nan)
                    prof.append(float(v) if np.isfinite(v) else np.nan)
                prof = _monoton_profil(prof)
                from shapely.geometry import LineString as _LS
                # yol çıkıştan yukarı sıralı → kum[i] = çıkışa uzaklık,
                # dolayısıyla Lc doğrudan kum[imin]'dir (DEM sürümünde yol
                # tersine sıralı olduğu için orada L−cum[imin] kullanılır).
                L_dem = res.get("L_km")
                res["L_km"] = round(L_m / 1000.0, 3)
                res["Lc_km"] = round(kum[imin] / 1000.0, 3)
                # dere ağı su bölümüne kadar uzanmıyorsa L eksik kalır
                if L_dem and L_m / 1000.0 < 0.7 * L_dem:
                    res.setdefault("uyarilar", []).append(
                        f"İçe aktarılan dere ağından bulunan ana kol {L_m/1000.0:.2f} km; "
                        f"DEM akış yolu ise {L_dem:.2f} km. Dere ağı su bölümü çizgisine "
                        "kadar uzanmıyor olabilir — L olduğundan kısa çıkar ve pik debiyi "
                        "abartır. Dereleri yukarı uçlara kadar sayısallaştırın veya dere "
                        "dosyasını kaldırıp L'yi DEM'den hesaplatın.")
                res["kotlar"] = [round(p, 1) for p in prof]
                res["ana_kanal_geojson"] = _LS(yol).__geo_interface__
                res["outlet"] = {"lat": float(yol[0][1]), "lon": float(yol[0][0]),
                                 "snap_lat": float(yol[0][1]), "snap_lon": float(yol[0][0])}
                res["parametre_kaynagi"] = "dere_agi"

    # dere ağı (poligon içi, eşik river_km2)
    thr = max(30, int(river_km2 / cell_km2))
    riv = (acc >= thr) & mask
    fdir = flw.to_array("d8")
    lines = []
    for ri, ci in zip(*np.nonzero(riv)):
        d = int(fdir[ri, ci])
        if d in D8:
            dr, dc = D8[d]
            r2, c2 = ri + dr, ci + dc
            if 0 <= r2 < h and 0 <= c2 < w and riv[r2, c2]:
                lines.append(LineString([transform * (ci + 0.5, ri + 0.5),
                                         transform * (c2 + 0.5, r2 + 0.5)]))
    if lines:
        from shapely.ops import unary_union
        res["dere_geojson"] = unary_union(lines).__geo_interface__
    else:
        res["dere_geojson"] = None
    return res


def multi_delineate(down, ups, river_km2=1.0, snap_m=500.0, max_cells=None,
                    dem_source="auto"):
    """En mansap noktası (down) ve memba noktaları (ups) için ara havza çözümü.

    down/ups: {"lat":.., "lon":..}. Döner:
      {"mansap": {outlet, alan_km2, havza_geojson, ...},
       "membalar": [ {outlet, ...}, ... ],
       "ara": {alan_km2, L_km, Lc_km, kotlar, havza_geojson, ...},
       "uyari": [...] }
    """
    import gc
    import pyflwdir
    import rasterio
    from shapely.geometry import shape
    from shapely.ops import unary_union

    if max_cells is None:
        max_cells = MAX_CELLS
    lats = [down["lat"]] + [u["lat"] for u in ups]
    lons = [down["lon"]] + [u["lon"] for u in ups]
    span = max(max(lats) - min(lats), max(lons) - min(lons))
    buf = max(0.15, span * 0.6)
    bbox = (min(lons) - buf, min(lats) - buf, max(lons) + buf, max(lats) + buf)

    # Pencereyi mansap havzasını TÜMÜYLE kapsayacak şekilde belirle. Nokta
    # merkezli sabit tampon büyük havzalarda yetmiyor ve havza kenardan
    # kesiliyordu ("Mansap havzası pencere kenarına değiyor"). delineate()
    # pencereyi taşan kenarlar yönünde büyüttüğü için sınırı ondan alıyoruz.
    try:
        d0 = delineate(down["lat"], down["lon"], river_km2=river_km2,
                       snap_m=snap_m, max_cells=max_cells, dem_source=dem_source)
        gj = d0.get("havza_geojson") or {}
        halkalar = gj.get("coordinates") or []
        xs = [c[0] for halka in halkalar for c in halka]
        ys = [c[1] for halka in halkalar for c in halka]
        if xs and ys:
            marj = max(0.02, 0.05 * max(max(xs) - min(xs), max(ys) - min(ys)))
            bbox = (min(min(xs) - marj, min(lons) - 0.02),
                    min(min(ys) - marj, min(lats) - 0.02),
                    max(max(xs) + marj, max(lons) + 0.02),
                    max(max(ys) + marj, max(lats) + 0.02))
    except Exception:
        pass                      # belirlenemezse nokta merkezli tamponla devam

    dem_path = get_dem_mosaic(bbox, max_cells=max_cells, dem_source=dem_source)
    with rasterio.open(dem_path) as src:
        dem_arr = src.read(1).astype(np.float64)
        transform = src.transform
    os.unlink(dem_path)
    dem_arr[dem_arr <= -1e6] = np.nan
    dem_raw = dem_arr
    filled, d8 = pyflwdir.fill_depressions(np.copy(dem_arr), nodata=np.nan)
    flw = pyflwdir.from_array(d8, ftype="d8", transform=transform, latlon=True)
    del d8, filled
    gc.collect()
    acc = np.array(flw.upstream_area("cell"))
    h, w = flw.shape
    dx = abs(transform.a) * 111320.0 * math.cos(math.radians(down["lat"]))
    dy = abs(transform.e) * 110540.0
    cell_km2 = dx * dy / 1e6
    with _flw_gecici_transform(flw):
        dist_all = np.asarray(flw.stream_distance(unit="m"))

    # mansap havzası
    dr, dc, xod, yod = _snap_idx(acc, transform, dx, down["lat"], down["lon"], h, w,
                                 snap_m, cell_km2=cell_km2, river_km2=river_km2)
    d_idx = dr * w + dc
    d_mask = np.asarray(flw.basins(xy=([xod], [yod])) > 0)
    if d_mask.sum() < 4:
        raise RuntimeError("Mansap havzası çıkarılamadı (nokta akış yoluna oturmuyor)")

    uyari = []
    # memba havzaları
    u_masks, membalar = [], []
    for k, u in enumerate(ups):
        ur, uc, xou, you = _snap_idx(acc, transform, dx, u["lat"], u["lon"], h, w,
                                     snap_m, cell_km2=cell_km2, river_km2=river_km2)
        u_idx = ur * w + uc
        um = np.asarray(flw.basins(xy=([xou], [you])) > 0)
        if um.sum() < 4:
            uyari.append(f"{k+1}. memba noktası havza çıkarmadı, atlandı")
            continue
        if (um & ~d_mask).sum() > 0.02 * um.sum():
            uyari.append(f"{k+1}. memba havzası mansap havzasının dışına taşıyor "
                         "(mansabın üstünde değil olabilir)")
        um = um & d_mask  # mansap içine kırp
        pm = _params_from_mask(flw, transform, acc, dem_raw, dist_all, um, u_idx,
                               cell_km2, h, w)
        if pm is None:
            continue
        pm["outlet"] = {"lat": u["lat"], "lon": u["lon"], "snap_lat": you, "snap_lon": xou}
        membalar.append(pm)
        u_masks.append(um)

    # ara havza = mansap − ∪ memba
    inter_mask = d_mask.copy()
    for um in u_masks:
        inter_mask &= ~um
    ara = _params_from_mask(flw, transform, acc, dem_raw, dist_all, inter_mask, d_idx,
                            cell_km2, h, w)
    if ara is None:
        raise RuntimeError("Ara havza çok küçük (memba noktaları mansaba çok yakın olabilir)")
    ara["outlet"] = {"lat": down["lat"], "lon": down["lon"], "snap_lat": yod, "snap_lon": xod}

    # mansap havzası poligonu (referans)
    dshapes = list(__import__("rasterio").features.shapes(
        d_mask.astype(np.uint8), mask=d_mask, transform=transform))
    dpoly = unary_union([shape(g) for g, v in dshapes]).simplify(abs(transform.a) / 2)
    if dpoly.geom_type == "MultiPolygon":
        dpoly = max(dpoly.geoms, key=lambda p: p.area)

    touches = bool(d_mask[0, :].any() or d_mask[-1, :].any()
                   or d_mask[:, 0].any() or d_mask[:, -1].any())
    if touches:
        uyari.append("Mansap havzası pencere kenarına değiyor; sonuçları kontrol edin")

    return {
        "mansap": {
            "outlet": {"lat": down["lat"], "lon": down["lon"], "snap_lat": yod, "snap_lon": xod},
            "alan_km2": round(int(d_mask.sum()) * cell_km2, 3),
            "havza_geojson": dpoly.__geo_interface__,
        },
        "membalar": membalar,
        "ara": ara,
        "uyari": uyari,
    }
