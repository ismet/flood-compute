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
| `data/regions/` | YZD alansal dağılım bölgeleri (`YZD_ALANLAR.kmz`, A/B/C poligonları). Havza çıkarıldığında bölge (A/B/C) otomatik seçilir (havzayla en çok örtüşen bölge). |
| `data/tables/mgm_plv_2020.json` | MGM 2020 PLV: 236 istasyonun 24 saatlik tekerrürlü yağışları (P2–P500) + 14 PLV oranı. `MGM PLV 2020 son2.xlsx`'ten `tools/extract_mgm_plv.py` ile üretilir. Adım 5'te istasyon başına P2–P100 ve DPLV seçimi için kullanılır (`/api/mgm-stations`). |
| `data/projects/` | Kaydedilen projeler (JSON). |

## İş akışı (6 adım)

1. **Havza** — Haritada outlet'e tıklanır; pyflwdir ile (pit doldurma → D8 akış
   yönü → birikim → outlet kenetleme) havza sınırı, dere ağı, en uzun akış yolu
   (L), ağırlık merkezi hizasına kanal mesafesi (Lc) ve alan çıkarılır.
2. **Parametre** — Ana kanal boyunca 11 kot (harmonik eğim profili) DEM'den
   otomatik dolar, elle düzeltilebilir. Bölge sınıfı (A/B/C — YZD eğrisi)
   `data/regions/YZD_ALANLAR.kmz`'den havza konumuna göre **otomatik seçilir**
   (en çok örtüşen bölge; gerekirse elle değiştirilir). Baz akım, opsiyonel kar
   erimesi (KAR1: derece-gün, dağıtım paterni).
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
   * **Snyder** (opsiyonel, `SNYDER V7.xlsm`): tp=Ct·(L·Lc)^0.30, tr=tp/5.5,
     qp=2760·Cp/tp, Qp=A·qp·10⁻³/10, Tp=tr/2+tp, Tb=(3+3tp/24)·24. W50/W75
     genişlik noktalarıyla kurulan, hacmi 1 mm'ye dengelenmiş birim hidrograf;
     24 sa sağanak tr saatlik n=24/tr bloğa bölünüp (YZDO dağılımı + YALD alansal
     azaltma + 1.13 maksimizasyon + SCS akış) tr saat kaydırmayla süperpoze edilir.
     Q2–Q100 CII, QOET CIII; Q500/1000/10000 ekstrapolasyon. Parametreler ve
     Q2–Q100 pikleri Excel ile birebir (`backend/tests/test_snyder_golden.py`).
     W50/W75 girilmezse **ŞEKİL 1 (DSİ Snyder abağı)** formülüyle otomatik okunur:
     W50=5.87/(Qp/A)^1.08/2.54, W75=3.35/(Qp/A)^1.08/2.54 (qp'den; `snyder.w50_w75`).
   * Hidrograf grafiği, CSV/JSON dışa aktarım, debiden tekerrür yılı bulma
     (`Yıl_Ara` makrosunun analitik çözümü: Q = Q10 + (0.99·log₁₀T − 0.98)·(Q100−Q10)).
   * **⚖ Yöntem Karşılaştırma** (tam ekran): dört yöntemi (DSİ/Mockus/Rasyonel/Snyder)
     yan yana kıyaslar. *Pik Debiler* sekmesinde tekerrüre göre bar grafik + yöntem×tekerrür
     tablosu (DSİ = KABULET zarfı, Mockus için K seçilir, maks/min oranı). *Hidrograflar*
     sekmesinde seçili tekerrür için üst üste bindirilmiş hidrograflar — DSİ (hakim süre) ve
     Snyder gerçek süperpozisyon; Mockus/Rasyonel üçgen yaklaşımla (kesikli çizgi).
   * **📄 Word Raporu** (tek tuş, `/api/report`): rapor bölümü (varsayılan no `4.7.3`,
     Boztepe Bölüm 4.7.x biçiminde) `.docx` olarak üretilir — anlatım metni (baz akım,
     yağış analizi, seçilen yöntemlerin paragrafları bu projenin sayılarıyla), tablolar
     (yinelenme pikleri, hidrograf koordinatları, yöntem karşılaştırması) ve şekiller
     (matplotlib ile çizilen taşkın hidrografları) gömülü. **Rapora dahil yöntemler**
     onay kutularıyla seçilir; biri **seçilen (kabul edilen) yöntem** olarak işaretlenir —
     rapor sonunda “… ile hesaplanan taşkın yinelenme değerlerinin projelendirmede esas
     alınması uygun bulunmuştur” gerekçesi ve tasarım debileri tablosu bu yönteme göre
     yazılır; karşılaştırma tablosunda seçilen yöntem koyu gösterilir. `backend/core/report.py`.

## Ara Havza (çok parçalı havza) modu

Üst kısımdaki **Ara Havza** düğmesiyle geçilir. Panelde net numaralı sıra izlenir
(Boztepe Bölüm 4.7 metodolojisi):

1. **Ortak veri** — istasyon (Adım 4) ve yağış (Adım 5) “Tek Havza” modundan paylaşılır;
   panel üstünde yüklü/eksik durumu gösterilir.
2. **Noktalar** — haritada önce **mansap** (çıkış), sonra bir/birkaç **memba** (üst havza çıkışı).
3. **Ayarlar & yöntemler** — dere eşiği, zemin grubu, mansap baz akımı ve **hesaplanacak
   yöntemler** (DSİ zorunlu; Mockus/Rasyonel/Snyder onay kutuları + Ct/Cp).
4. **Çöz ve hesapla** — iki aşama:
   - **① Havzaları Çöz:** `/api/multi-delineate` tek DEM geçişinde mansap ve her memba havzasını
     çıkarır; **ara havza = mansap − ∪memba** (alan korunumu birebir). Her alt havza için A, L, Lc,
     11 kot, Tc (Kirpich/DSİ), YZD bölgesi bulunur ve alt havza tablosu gösterilir.
   - **② Hesapla ve Ötele:** her alt havza seçili yöntemlerle otomatik hesaplanır (Thiessen
     ağırlıkları + CORINE-CN + bölge; baz akım alan oranıyla dağıtılır), sonra `/api/route`
     memba hidrograflarını **ara havzanın Tc'si kadar öteleyip** ara havzaya ekler:
     `Q_mansap(t) = Q_ara(t) + Σ Q_memba(t − Tc_ara)`. **Her yöntem ayrı ötelenir** — DSİ ve
     Snyder gerçek süperpozisyon, Mockus ve Rasyonel üçgen hidrografla. Sonuç: alt havza tablosu,
     **yöntem × tekerrür mansap pik tablosu**, seçilen yöntemin hidrograf grafiği + CSV.
     `backend/core/routing.py` (`route(..., methods)`), `gis.multi_delineate`.

## Rezervuar (Hazne) Taşkın Ötelemesi

Hesap sonuçlarındaki **🏞 Rezervuar Ötelemesi** düğmesiyle açılır (tek havza ve
ara havza mansap sonuçları için). **Storage-Indication / Modified Puls** yöntemi
(Söylemez T28 sayfasının birebir karşılığı — `backend/tests/test_reservoir_golden.py`
ile çıkış piki, maks su kotu, sönümleme makine hassasiyetinde doğrulandı):

    (2S/Δt+O)_{t+1} = (I_t+I_{t+1}) + (2S/Δt−O)_t,  O = φ⁻¹(2S/Δt+O)

- **Girdi hidrografı:** hesaplanan hidrograflardan seçilir (DSİ hakim süre / Snyder /
  ara havza mansap; yöntem × tekerrür).
- **Hacim-satıh eğrisi**, **kret kotu** ve **yaklaşım taban kotu** varsayılanları
  Söylemez'den (`data/tables/soylemez_reservoir.json`, `/api/reservoir-defaults`).
- **Dolusavak debisi:** ya Söylemez rating tablosu, ya da **geometriden** kontrolsüz
  dolusavak: Q=C·L_e·He^1.5, L_e=L+2·He·tan(apron giriş açısı).
- **Çıktı:** ötelenmiş çıkış hidrografı, su kotu, giriş/çıkış pik, **pik sönümleme %**,
  pik gecikmesi, maks su kotu; grafik + koordinat tablosu + CSV. `backend/core/reservoir.py`.

### Kapaklı (kontrollü) dolusavak — kapak optimizasyonu

Rezervuar panelinde **Tip = Kapaklı** seçilir. Kapak altı akım
Q=(2/3)√(2g)·C·L_ef·(H1^1.5−H2^1.5)+W1 (Excel `1512_FloodRouting` sayfası; varsayılanlar
`data/tables/kapakli_reservoir.json`, `/api/reservoir-controlled-defaults`). Kapaklar bir
**optimizasyon programıyla** işletilir: su kotu **izin verilen maks kotu geçmez**, çıkış
**girişi aşmaz** (O≤I) ve **çıkış piki minimum** olur — başlangıç kotu (öteleme başlangıç
kotu, girdi) ile maks kot arasındaki depolama kullanılarak *pik-tavan (peak-shaving)*
uygulanır (min uygulanabilir tavan ikili aramayla bulunur). Çıktı: ötelenmiş çıkış, su kotu
ve **kapak açıklığı programı** (grafik + tablo + CSV). `reservoir.route_controlled`,
`/api/reservoir-controlled`.

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
* Snyder biriim hidrografı Excel'de elle (kırmızı hücreler) hacim dengesine
  ayarlanır; burada W50/W75 noktalı kanonik şekil üstel kuyrukla otomatik
  hacim-dengelenir (pik=Qp ve hacim=1 mm korunur). QOET Excel'de 6 saatlik
  bloklarla hesaplandığından tek tr kullanan bu uygulamada ~%0.2 sapar; Q2–Q100
  birebirdir. Q500/1000/10000 uygulama genelindeki gibi Q10–Q100'den ekstrapole
  edilir (Excel'in ayrı P500… girdileri yerine).

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
python backend/tests/test_golden.py        :: DSİ/Mockus birebir (49 pik + BH + önhesap)
python backend/tests/test_snyder_golden.py :: Snyder birebir (parametreler + Q2–Q100 pik)
python backend/tests/test_api_smoke.py     :: API uçtan uca duman testi
```
