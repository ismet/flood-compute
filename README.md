# Taşkın Hesap — Sentetik Yöntemler Web Uygulaması

`11.Tayakadın Deresi SENTETİK YÖNTEMLER TABLOLU.xlsm` çalışma kitabının hesap
mantığının **birebir** web uygulamasına taşınmış hâli. Hesap motoru, Tayakadın
örneğinin tüm Excel çıktılarıyla makine hassasiyetinde (≈1e-16) doğrulanmıştır
(`backend/tests/test_golden.py`).

## Kurulum ve çalıştırma

```bat
pip install -r requirements.txt
python run.py
```

Tarayıcı otomatik açılır: http://127.0.0.1:8737

## Veri hazırlığı

| Klasör | İçerik |
|---|---|
| `data/dem/` | (Opsiyonel) yerel DEM GeoTIFF'leri (EPSG:4326). Yoksa Copernicus GLO-30 karoları otomatik indirilir (`data/dem/cache/`). |
| `data/corine/` | (Opsiyonel) yerel CORINE 2018 GeoTIFF (sınıf kodları 111–523 veya grid kodu 1–44). Havzayı kapsayan yerel raster yoksa **EEA CLC2018 servisinden otomatik indirilir** (100 m, resmi lejand renklerinden sınıflandırılır, `data/corine/cache/` altına önbelleklenir). |
| `data/tables/` | Excel'den çıkarılmış sabit tablolar (BH2 boyutsuz eğri, YZD, ABAK2, DPLV, CN dönüşümleri). Elle düzenlemeyin; yeniden üretmek için `python tools/extract_tables.py`. |
| `data/stations/` | Varsayılan istasyon seti (`DMİ.kmz`, 684 istasyon). Adım 4'e girildiğinde otomatik kullanılır; arayüzden farklı bir KMZ/KML de yüklenebilir. |
| `data/projects/` | Kaydedilen projeler (JSON). |

## İş akışı (6 adım)

1. **Havza** — Haritada outlet'e tıklanır; pyflwdir ile (pit doldurma → D8 akış
   yönü → birikim → outlet kenetleme) havza sınırı, dere ağı, en uzun akış yolu
   (L), ağırlık merkezi hizasına kanal mesafesi (Lc) ve alan çıkarılır.
2. **Parametre** — Ana kanal boyunca 11 kot (harmonik eğim profili) DEM'den
   otomatik dolar, elle düzeltilebilir. Bölge sınıfı (A/B/C — YZD eğrisi),
   baz akım, opsiyonel kar erimesi (KAR1: derece-gün, dağıtım paterni).
3. **CN** — CORINE rasteri havza ile kesilir (yerel yoksa EEA CLC2018'den
   otomatik indirilir); seçilen hidrolojik zemin grubuna (A/B/C/D) göre
   `data/tables/corine_cn.json` tablosundan alansal ağırlıklı CN(II);
   CN(III) Excel'deki dönüşüm tablosuyla.
4. **Thiessen** — Varsayılan `DMİ.kmz` istasyonları otomatik yüklenir (veya
   KMZ/KML yüklenir); Voronoi hücreleri havzaya kesilerek alan ağırlıkları
   (DATAGİR H kolonu karşılığı) bulunur. Haritada yalnız pay alan istasyonlar çizilir.
5. **Yağış** — Her istasyon satırı `Ad P2 P5 P10 P25 P50 P100 [OEY]` formatında
   yapıştırılır; Thiessen ağırlıklı P24'ler hesaplanır. DPLV zaman-dağılım
   istasyonu seçilir (TEKİRDAĞ/ÇORLU/KARTAL) veya 14 oran elle yapıştırılır.
6. **Hesap** — Tek tıkla:
   * **DSİ Sentetik**: qp = 414·A⁻⁰·²²⁵·(L·Lc/√S)⁻⁰·¹⁶ → BH2 boyutsuz birim
     hidrograf 0.5 sa adıma örneklenir; 2/4/6/8/12/18/24 saatlik sağanaklar
     2'şer saatlik bloklara (YZD eğrisi) ayrılıp SCS artım akışlarıyla süperpoze
     edilir → KABULET pik matrisi (+ Q500/1000/10000 ekstrapolasyonu).
   * **Mockus** (süperpozesiz): Tc (Kirpich-metrik), D=2√Tc, Tp; K1/K2/K3.
   * **Rasyonel** (A ≤ 1 km² ise): Tc'de PLV eğrisinden şiddet, C_T = C100·(T/100)^0.2.
   * Hidrograf grafiği, CSV/JSON dışa aktarım, debiden tekerrür yılı bulma
     (`Yıl_Ara` makrosunun analitik çözümü: Q = Q10 + (0.99·log₁₀T − 0.98)·(Q100−Q10)).

## Excel makrolarının karşılıkları

| Makro | Uygulamadaki karşılığı |
|---|---|
| `KAY` (satır arşivle) | Proje kaydet (💾) — tüm durum JSON olarak `data/projects/` |
| `Yıl_Ara` (GoalSeek) | "Tekerrür yılı ara" kutusu — analitik ters çözüm |
| `Makro2` (biçim) | Gerek yok (arayüz otomatik) |

## Excel'den bilinçli sapmalar

* Rasyonel yöntemde yağış şiddeti, ABAK3'teki sayısallaştırılmış nomogram
  yerine **seçili DPLV istasyonunun eğrisinden** okunur (istasyona özgü,
  şeffaf eşdeğer). C100 kullanıcı girdisidir.
* Kar erimesi hidrografı OET pikine sabit değer (Qkar piki) olarak eklenir;
  Excel'de KAR2'deki zaman hizalaması kullanılır. Fark güvenli taraftadır.

## Web'e deploy

Uygulama Docker ile paketlenmiştir. Public'e açılacaksa mutlaka `APP_PASSWORD`
tanımlayın (HTTP Basic parola koruması).

```bash
docker build -t taskin-hesap .
docker run -d -p 8737:8737 -e APP_PASSWORD=gizli-parola \
  -v taskin_data:/app/data taskin-hesap
```

* **VPS / şirket sunucusu**: yukarıdaki komutlar + önüne Caddy/Nginx (HTTPS).
* **Render / Railway / Fly.io**: repo'yu bağlayın, Dockerfile otomatik algılanır;
  `PORT` değişkenini platform verir, `APP_PASSWORD`'ü panelden ekleyin.
  Not: DEM/CORINE önbelleği için kalıcı disk (volume) tanımlayın, yoksa her
  yeniden başlatmada karolar tekrar indirilir.
* Ortam değişkenleri: `HOST`, `PORT`, `APP_PASSWORD`.
* İlk havza çıkarımında ~50-100 MB DEM karosu indirilir; ücretsiz planlarda
  istek zaman aşımını (timeout) 300 s'ye çıkarın (Dockerfile'da ayarlı).

## Testler

```bat
python backend/tests/test_golden.py     :: Excel birebir doğrulama (49 pik + BH + önhesap)
python backend/tests/test_api_smoke.py  :: API uçtan uca duman testi
```
