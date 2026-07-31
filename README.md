# Taşkın Hesap — Sentetik Yöntemler Web Uygulaması

`11.Tayakadın Deresi SENTETİK YÖNTEMLER TABLOLU.xlsm` (harici referans Excel)
çalışma kitabının hesap mantığının **birebir** web uygulamasına taşınmış hâli.
Hesap motoru, Tayakadın örneğinin tüm Excel çıktılarıyla doğrulanmıştır
(`backend/tests/test_golden.py`, tol=1e-6).

## Kurulum ve çalıştırma

```bat
pip install -r requirements.txt
python run.py
```

Tarayıcı otomatik açılır: http://127.0.0.1:8737

## Veri hazırlığı

| Klasör | İçerik |
|---|---|
| `data/dem/` | (Opsiyonel) yerel DEM'ler (EPSG:4326 GeoTIFF, VRT, ERDAS .img veya ESRI Grid klasörü). ASTER 30 m grid'i `data/dem/aster30m/` altına yerleştirin. Yoksa Copernicus GLO-30 karoları otomatik indirilir (`data/dem/cache/`). |
| `data/corine/` | (Opsiyonel) yerel CORINE 2018 GeoTIFF (sınıf kodları 111–523 veya grid kodu 1–44). Havzayı kapsayan yerel raster yoksa **EEA CLC2018 servisinden otomatik indirilir** (100 m, resmi lejand renklerinden sınıflandırılır, `data/corine/cache/` altına önbelleklenir). |
| `data/tables/` | Excel'den çıkarılmış sabit tablolar (BH2 boyutsuz eğri, YZD, ABAK2, DPLV, CN dönüşümleri). Elle düzenlemeyin; yeniden üretmek için `python tools/extract_tables.py`. |
| `data/stations/` | Varsayılan istasyon seti (`bir_cikti.kml`, 2315 istasyon). Adım 4'e girildiğinde otomatik kullanılır; arayüzden farklı bir KMZ/KML de yüklenebilir. |
| `data/regions/` | YZD alansal dağılım bölgeleri (`YZD_ALANLAR.kmz`, A/B/C poligonları). Havza çıkarıldığında bölge (A/B/C) otomatik seçilir (havzayla en çok örtüşen bölge). |
| `data/tables/mgm_plv_2020.json` | MGM 2020 PLV: 236 istasyonun 24 saatlik tekerrürlü yağışları (P2–P500) + 14 PLV oranı. `MGM PLV 2020 son2.xlsx`'ten `tools/extract_mgm_plv.py` ile üretilir. Adım 5'te istasyon başına P2–P100 ve DPLV seçimi için kullanılır (`/api/mgm-stations`). |
| `data/raster/` | Yüklenen raster altlıklar (1/25000 pafta vb.) + `.json` kenar dosyaları (gitignore'lu). |
| `data/projects/` | Kaydedilen projeler (JSON). |
| `data/agi/` | `agi.sqlite` — DSİ ve EİE Akım Gözlem Yıllıklarından çıkarılmış yıllık pik akım veri tabanı (1935–2020, 2732 istasyon / 36.5 bin istasyon-yıl). Adım 7'deki frekans analizinin girdisidir. Yeniden üretmek: `python tools/agi_veritabani_olustur.py <pik_veritabani.csv>`. |
| `data/su/` | `su.sqlite` — AGİ **günlük** akım serileri (1934–2015, 2909 istasyon, 8,9 milyon gün). **Su Potansiyeli** sekmesinin girdisidir. 1,68 GB'lık `Data.db`'den üretilir: `python tools/su_veritabani_olustur.py Data.db` (11,5 MB'a iner — her istasyonun serisi tek sıkıştırılmış float32 dizisi). |

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
4. **Thiessen** — Varsayılan `bir_cikti.kml` istasyonları otomatik yüklenir (veya
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
      W50=5.87/(qp/1000)^1.08/2.54, W75=3.35/(qp/1000)^1.08/2.54 (`snyder.w50_w75`).
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

7. **Frekans** — *Noktasal Taşkın Frekans Analizi (NTFA)*. Sentetik yöntemlerden
   bağımsız ikinci yol: **gözlenmiş** yıllık pik akımlara dayanır. Havza
   çıkarıldıktan sonra “AGİ'leri haritaya getir” ile havza içindeki ve (tampon
   kadar) çevresindeki Akım Gözlem İstasyonları haritaya ve listeye gelir;
   biri seçilip analiz çalıştırılır. Altı dağılım (Normal, Log-Normal 2P/3P,
   Pearson Tip-3, Log-Pearson Tip-3, Gumbel) moment yöntemiyle uydurulur,
   T = 2…10 000 yıl debileri hesaplanır ve **Simirnov-Kolmogorov** testiyle
   karşılaştırılır; D<sub>maks</sub>'ı en küçük olan dağılım kabul edilir.
   Çıktı, DSİ frekans analizi Excel'inin (`ornek.xlsm`) `SONUÇLAR` sayfasıyla
   aynı üç bloktur: tekerrür debileri, istatistik parametreler, K-S testi.
   `backend/core/tfa.py`, golden test: `backend/tests/test_tfa_golden.py`.

   Aynı adımın altında **BTFA (Bölgesel Taşkın Frekans Analizi)** vardır:
   listeden birden çok AGİ işaretlenir, her biri için NTFA yapılır, boyutsuz
   büyüme eğrileri (Q<sub>T</sub>/Q<sub>2</sub>) ortalanarak bölgesel eğri
   kurulur ve havzanın indeks debisi alan–debi bağıntısından
   (Q<sub>2</sub> = a·A<sup>b</sup>) bulunarak Q<sub>2</sub>…Q<sub>10000</sub>
   üretilir. Havzada AGİ yoksa veya seri kısaysa noktasal analizden
   güvenilirdir. Karşılaştırma için tek istasyondan alan oranıyla aktarım
   (Q<sub>havza</sub> = Q<sub>AGİ</sub>·(A/A<sub>AGİ</sub>)<sup>2/3</sup>) da
   ayrı satır olarak verilir. `backend/core/btfa.py`, golden test:
   `backend/tests/test_btfa_golden.py` (Karamandere).

   BTFA sonucunda **homojenlik testi** (Dalrymple, 1960) da verilir: her
   istasyonun kendi Q<sub>10</sub>/Q<sub>2</sub> oranı bölgesel eğri üzerinde
   hangi tekerrüre denk geliyor bulunur ve serinin kısalığından beklenen %95
   bandıyla karşılaştırılır. Sonuç **grafik olarak** da çizilir: yatayda kayıt
   uzunluğu, düşeyde eşdeğer tekerrür (log), taralı alan %95 zarfı — kısa
   serilerde bandın ne kadar genişlediği ancak böyle görülüyor. Banda sığmayan
   istasyonlar kırmızı üçgenle gösterilir.

   **"Aykırıları çıkarıp tekrarla"** kutusu işaretliyse analiz bir kez daha
   koşulur ve iki durum yan yana verilir: her tekerrür için tüm istasyonlarla
   ve aykırısız debiler, aralarındaki yüzde fark (%10'u aşan farklar kırmızı),
   aykırısız büyüme eğrisi ve indeks debi bağıntısı. Aykırıyı atma kararı,
   hangi sayının ne kadar değiştiği görülmeden verilmemeli.

   Aynı adımda **MMY (Muhtemel Maksimum Yağış)** hesabı vardır: bir meteoroloji
   istasyonunun 1 günlük yıllık en büyük yağış serisinden Hershfield yöntemiyle
   MMY = P<sub>ort</sub>·M1·M2 + K<sub>m</sub>·S·M1·M2. K<sub>m</sub>, 9
   bölgeye ait zarf eğrilerinden düzeltilmiş ortalamaya göre okunur. Çıkan
   derinlik 6. adımdaki **OET** yağışına yazılarak muhtemel maksimum feyezan
   (Q<sub>OET</sub>) elde edilir. `backend/core/mmy.py`, golden test:
   `backend/tests/test_mmy_golden.py` (Binkılıç + Karamandere T7.3).

## Su Potansiyeli modu

Üst kısımdaki **Su Potansiyeli** düğmesiyle geçilir; taşkın hesabından
bağımsızdır. Burada pik değil **hacim** sorulur. Panel beş adımda ilerler:

1. **Havza** — Outlet'e tıklanır; havza sınırı ve alanı taşkın modundaki 1.
   adımın aynısıyla (DEM'den) çıkarılır. Orada zaten çıkarıldıysa otomatik
   kullanılır; alan elle de yazılabilir.
2. **Yıl aralığı** — Su yılı (1 Ekim – 30 Eylül) ilk/son yılı, istasyon
   uzunluk eşiği ve havza dışını da kapsayacak tampon.
3. **Civardaki AGİ'ler** — Havza poligonunun içindeki ve tampon kadar
   çevresindeki günlük akım istasyonları haritaya ve listeye gelir; havza
   içinde olanlar ayrıca işaretlenir. Analize girecekler onay kutusuyla seçilir
   (yağış alanı bilinmeyenler seçilemez — havzaya taşınamazlar).
4. **Ölçüm periyotları** — İstasyon × su yılı matrisi: yeşil = tam yıl,
   sarı = eksik (kısmi gözlem), gri = veri yok. Altında istasyon çiftlerinin
   yıllık ortalama akım regresyonları (r, r², ortak yıl) sıralanır.
5. **Tamamlama ve taşıma** — Havzayı temsil edecek AGİ seçilir; eksik su
   yılları, r² eşiğini geçen en iyi ilişkili istasyondan
   `Q = kesim + eğim·Q_verici` ile doldurulur. Doldurulan yıllar sarı, hiçbir
   istasyonda veri olmadığı için boş kalanlar kırmızı gösterilir — **uydurma
   yapılmaz**. Tamamlanan seri son olarak alan oranıyla havza çıkışına taşınır
   (`Q_havza = Q_AGİ·(A_havza/A_AGİ)^üs`, hacimde üs ≈ 1) ve Q<sub>ort</sub>,
   yıllık hacim (hm³), özgül verim (L/s/km²) ve yıllık verim (mm) verilir.

Tek istasyonun kendi başına potansiyeli (aylık dağılım, debi süreklilik eğrisi,
güvenilir debiler Q50/Q75/Q90/Q95 ve bir talebin karşılanma güvenilirliği) için
`POST /api/su` ucu ayrıca kullanılabilir. `backend/core/su.py`.

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

## Raster altlıklar (1/25000 pafta vb.)

Harita panelindeki **🗺 1/25000 altlık** aracı ile koordinatlı raster pafta yüklenir
(GeoTIFF, MrSID `.sid` + world file `.sdw`). Altlık EPSG:3857'ye yeniden
projeksiyonlanarak XYZ karo servisi üzerinden haritada gösterilir
(`/api/raster/{ad}/{z}/{x}/{y}.png`). `backend/core/raster.py`,
`backend/tests/test_raster.py`.

**MrSID (`.sid`) desteği ortama bağlıdır.** Sürücü tescillidir (Extensis DSDK ile
derlenir) ve ne PyPI rasterio tekerleklerinde ne de Debian'ın `gdal-bin`
paketinde bulunur:

* **Yerelde (Windows):** OSGeo4W'den `gdal` + `gdal-mrsid` paketlerini kurun;
  uygulama `C:\OSGeo4W\bin\gdal_translate.exe`'yi kendiliğinden bulup dosyayı
  GeoTIFF'e çevirir. Başka yere kurulduysa `GDAL_TRANSLATE` ortam değişkenine
  tam yolu yazın.
* **Sunucuda (Docker):** kod çözücü **yoktur ve kurulamaz**. Dosyayı kendi
  bilgisayarınızda bir kez GeoTIFF'e çevirip onu yükleyin —
  `gdal_translate -of GTiff pafta.sid pafta.tif` ya da QGIS → Dışa Aktar →
  Farklı Kaydet → GeoTIFF. GeoTIFF dönüşümsüz yüklenir.

Arayüz `.sid` seçilir seçilmez (`/api/raster-converter`) ortama uygun uyarıyı
gösterir; desteklenmiyorsa yükleme hiç başlatılmaz.

## KMZ dışa aktarımı

Hesap sonuçlarındaki **🌍 KMZ indir** düğmesiyle havza sınırı + dere ağı + seçili
yöntemin tüm tekerrürlü pik debileri (Q2–Q10000) tek bir `.kmz` dosyası olarak
indirilir. Geometri haritadaki güncel hâliyle (elle düzenlemeler dahil) yazılır.
`backend/core/kmz_export.py`, `backend/tests/test_kmz_export.py`.

## Haritada geometri düzenleme (✏️ Havza / dere düzenle)

Havza çıkarıldıktan sonra **✏️ Havza / dere düzenle** düğmesiyle GeoMan eklentisi
üzerinden havza sınırı ve dere ağı haritada elle düzenlenir: köşe sürükleme, yeni
köşe ekleme (çift tık), köşe silme (sağ tık). Dere ağı tek tek kollara ayrılır;
istenmeyen kollar silinebilir veya yeni kol çizilebilir. DEM'den gelen piksel
merdivenini azaltmak için Douglas-Peucker sadeleştirme aracı bulunur. "Uygula"
denince düzenlenmiş geometriden `/api/basin-from-geometry` ile alan, L, Lc ve
kot profili yeniden üretilir.

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
* Snyder birim hidrografı Excel'de elle (kırmızı hücreler) hacim dengesine
  ayarlanır; burada W50/W75 noktalı kanonik şekil üstel kuyrukla otomatik
  hacim-dengelenir (pik=Qp ve hacim=1 mm korunur). QOET Excel'de 6 saatlik
  bloklarla hesaplandığından tek tr kullanan bu uygulamada ~%0.2 sapar; Q2–Q100
  birebirdir. Q500/1000/10000 uygulama genelindeki gibi Q10–Q100'den ekstrapole
  edilir (Excel'in ayrı P500… girdileri yerine).
* NTFA'da (adım 7) tersi geçerlidir: DSİ frekans şablonuyla **birebir** uyum
  hedeflendiği için şablonun üç tuhaflığı korunmuştur — normal kuyruk
  yaklaşımında √(2π) yerine √(44/7), polinomun 3. katsayısı 1.78147937
  (literatürde 1.781477937) ve Normal dağılımın D<sub>maks</sub>'ına eklenen
  sabit +0.01. Bunlar hangi dağılımın kabul edildiğini değiştirebildiği için
  “düzeltmek” sonuçları Excel'den ayırırdı; `backend/core/tfa.py` içinde
  `_CDF_B` ve `NORMAL_DMAX_DUZELTME` olarak işaretlidir.
* BTFA'da alan–debi üssü **veriden hesaplanır**; örnek dosyadaki (Karamandere)
  0.8968 üssü o dosyanın kendi 15 istasyonunun en küçük kareler uyumundan
  çıkmıyor (serbest uyum 0.0827·A<sup>1.3146</sup>), elle girilmiş. Rapordaki
  sayıyı birebir tutturmak gerekirse arayüzdeki **Üs** kutusuna yazın; boş
  bırakılırsa seçili istasyonlardan hesaplanan bağıntı kullanılır. Her iki
  bağıntı (a=1 ve a serbest) R² ile birlikte ekranda gösterilir.
* MMY'de M1/M2 düzeltme katsayıları **girdi**dir (varsayılan 1.0). Kaynak
  Excel'lerde bu değerler hücrede formül değil, makroyla/elle yazılmış
  sayılardır; Hershfield abaklarının sayısal karşılığı dosyalarda yok. Uydurma
  bir eğri koymak sonucu sessizce kaydırırdı, bu yüzden hesaplanan oranlar
  (P<sub>ort</sub>(−P<sub>maks</sub>)/P<sub>ort</sub> ve S(−P<sub>maks</sub>)/S)
  ile N ekranda gösterilir; kullanıcı abaktan okuyup girer. K<sub>m</sub> ise
  Excel'den çıkarılan zarf eğrilerinden **birebir** okunur.

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
python backend/tests/test_golden.py              :: DSİ/Mockus birebir (49 pik + BH + önhesap)
python backend/tests/test_snyder_golden.py       :: Snyder birebir (parametreler + Q2–Q100 pik)
python backend/tests/test_reservoir_golden.py    :: Rezervuar öteleme birebir (çıkış piki, su kotu, sönümleme)
python backend/tests/test_kmz_export.py          :: KMZ yazıcı gidiş-dönüş (vektör.oku ile)
python backend/tests/test_raster.py              :: Raster altlık XYZ karo servisi + CRS
python backend/tests/test_tfa_golden.py          :: NTFA birebir (6 dağılım × T2–T10000 + K-S)
python backend/tests/test_btfa_golden.py         :: BTFA birebir (Karamandere indeks-debi)
python backend/tests/test_mmy_golden.py          :: MMY birebir (Hershfield, iki kaynak dosya)
python backend/tests/test_api_smoke.py           :: API uçtan uca duman testi
```
