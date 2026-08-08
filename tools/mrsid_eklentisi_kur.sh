#!/usr/bin/env bash
# Bare-metal Debian'da MrSID (`.sid`) GDAL eklentisini derler/kurar.
# Kullanım: tools/mrsid_eklentisi_kur.sh <DSDK-tarball.tar.gz>
#
# Önkoşullar:
#   - GDAL ≥ 3.10 (standalone CMake plugin yöntemi 3.10'da eklendi —
#     gdal.org/.../mrsid.html#standalone-plugin-compilation).
#   - Extensis MrSID Decode SDK (DSDK); geliştirme/iç kullanım için ücretsiz
#     (EULA arkasında, indirme sırasında kabul edilir).
#     https://www.extensis.com/support/developers-sdk-version-downloads
#   - Backup: Path A (yerel `gdal_translate -of GTiff pafta.sid pafta.tif`
#     → GeoTIFF yükle) — her GDAL sürümünde çalışır.
set -euo pipefail

DSDK_TAR="${1:?Kullanım: $0 <DSDK-tarball.tar.gz>}"
[ -f "$DSDK_TAR" ] || { echo "DSDK tarball bulunamadı: $DSDK_TAR"; exit 1; }

# gdal-bin kurulu mu? (libgdal-dev de şart — cmake için)
command -v gdal-config >/dev/null 2>&1 \
  || { echo "gdal-bin kurulu değil: sudo apt install -y gdal-bin libgdal-dev build-essential cmake"; exit 1; }

# Debian 3.10.3+dfsg-1 → "3.10.3" (paket soneki atılır)
VER=$(gdal-config --version)
MAJ_MIN=$(echo "$VER" | cut -d. -f1,2)

# Standalone CMake plugin yöntemi yalnız ≥ 3.10'da var (mrsid.rst)
awk -v v="$VER" 'BEGIN{split(v,a,"."); if(a[1]<3 || (a[1]==3 && a[2]<10)) exit 1}' \
  || { echo "HATA: GDAL $VER < 3.10 — standalone CMake plugin yöntemi 3.10'da eklendi (gdal.org mrsid.rst)."
       echo "Çözüm: trixie/stable'a yükselt (3.10+) ya da Path A kullan (README)."
       exit 1; }
echo "GDAL sürümü: $VER (plugin ABI alt-dizini: $MAJ_MIN)"

# 1) DSDK'yi /opt altına aç ve MRSID_ROOT'u lt_base.h'den bul.
#    FindMRSID.cmake'nin birincil probu lt_base.h'tır — tarball top-level adını
#    tahmin etmek yerine dosyayı arayıp kökünü çıkartırız.
sudo mkdir -p /opt
sudo tar -xzf "$DSDK_TAR" -C /opt
LT_BASE=$(sudo find /opt -maxdepth 5 -type f -name 'lt_base.h' 2>/dev/null | head -1)
[ -n "$LT_BASE" ] \
  || { echo "lt_base.h bulunamadı — DSDK tarball layout beklenenden farklı; /opt altını inceleyin:"
       sudo find /opt -maxdepth 3 -type d; exit 1; }
SDK_ROOT=$(dirname "$(dirname "$LT_BASE")")   # <root>/include/lt_base.h → <root>
sudo ln -sfn "$SDK_ROOT" /opt/mrsidsdk
echo "DSDK root: $SDK_ROOT → /opt/mrsidsdk"

# ldconfig: DSDK .so'ları bulunabilir olsun (plugin dlopen için şart).
# FindMRSID.cmake'nin aradığı liblti_dsdk'dur.
echo /opt/mrsidsdk/lib | sudo tee /etc/ld.so.conf.d/mrsid.conf
sudo ldconfig
ldconfig -p | grep -iq lti_dsdk \
  || { echo "UYARI: liblti_dsdk ldconfig'te değil — /opt/mrsidsdk/lib içeriğini inceleyin:"
       ls -la /opt/mrsidsdk/lib; }

# 2) GDAL kaynağını birebir eşit sürümle al.
#    SetupStandalonePlugin.cmake kaynak/libgdal sürüm eşitliğini zorunlu kılar
#    (ihlal → FATAL_ERROR; IGNORE_GDAL_VERSION_MISMATCH=ON ile yutulabilir ama önerilmez).
SRC="gdal-$VER"
if [ ! -d "$SRC" ]; then
  URL="https://github.com/OSGeo/gdal/releases/download/v$VER/gdal-$VER.tar.gz"
  echo "GDAL $VER kaynağı indiriliyor: $URL"
  # Not: Debian yamalı sürüm (3.10.3+dfsg-1) için `apt source gdal` (deb-src etkinse)
  #       abi daha güvenli; üstteki github tarball'u yukarı akış kaynak versiyonuyla eşleşir.
  curl -fL "$URL" -o "/tmp/$SRC.tar.gz" || { echo "indirme başarısız: $URL"; exit 1; }
  tar -xzf "/tmp/$SRC.tar.gz"
fi

# 3) Standalone CMake plugin buildi (mrsid.rst resmî yöntemi, GDAL ≥3.10).
#    find_package(GDAL) — Debian libgdal-dev /usr/lib/.../cmake/gdal/GDALConfig.cmake
#    libgdal-dev → libgeotiff-dev (>=1.5.0) → libtiff-dev bağımlılığı transitive gelir.
BUILD="build_mrsid_$VER"
cmake -S "$SRC/frmts/mrsid" -B "$BUILD" -DMRSID_ROOT=/opt/mrsidsdk
cmake --build "$BUILD"
# add_gdal_driver: PREFIX "" + LIBRARY_OUTPUT_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
# → çıktı doğrudan $BUILD/gdal_MrSID.so'dur.
[ -f "$BUILD/gdal_MrSID.so" ] \
  || { echo "gdal_MrSID.so üretilmedi — $BUILD/CMakeFiles/CMakeOutput.log ve .err dosyalarını inceleyin"; exit 1; }

# 4) Plugin'i Debian multiarch plugin yoluna (ABI sürüm alt-dizini) kopyala.
#    Debian gdal-plugins deb bu dizinde drivers.ini taşır; AutoLoadDrivers önce
#    <path>/<MAJ.MIN>/ alt-dizinini tarar (gdaldrivermanager.cpp GetSearchPaths).
PLUGIN_DIR="/usr/lib/x86_64-linux-gnu/gdalplugins/$MAJ_MIN"
sudo mkdir -p "$PLUGIN_DIR"
sudo cp "$BUILD/gdal_MrSID.so" "$PLUGIN_DIR/"
sudo ldconfig

# 5) Doğrula — gdal_translate --formats'te MrSID görünmeli.
#    AutoLoadDrivers plugin'i sistemli başlangıçta yükler; 3.10'dan beri
#    "systematically loaded" (mrsid.rst).
gdal_translate --formats | grep -i 'MrSID' \
  || { echo "HATA: gdal_translate --formats'te MrSID yok — plugin yüklenmemiş olabilir."
       echo "      _gdal_ortam (backend/core/raster.py:189) GDAL_DRIVER_PATH'ı override"
       echo "      ediyor olabilir (/usr/lib/gdalplugins yaratıldıysa)."
       echo "      Escape hatch: export GDAL_DRIVER_PATH=\"$PLUGIN_DIR\""
       exit 1; }

echo "TAMAM. Uygulamayı YENİDEN BAŞLATIN (_CEVIRICI modül-globalsinde önbelleğe alınır —"
echo "      backend/core/raster.py:215). Sonra:"
echo "  curl http://127.0.0.1:8737/api/raster-converter  →  \"mrsid\": true beklenir."