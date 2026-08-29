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
| Harita altlıkları | Sağ üstteki katman kutusundan **Harita** (OpenStreetMap), **Uydu** (Esri World Imagery) ve **Topoğrafya** (OpenTopoMap — eş yükselti eğrileri + kabartma gölgelemesi, CC-BY-SA). Outlet'i yatağın üstüne koyarken vadi tabanını görmek için topoğrafya altlığı işe yarar; OSM'de dere çizgisi çoğu yerde yok, uyduda ağaç altında görünmüyor. |
| `data/dem10/` | **10 m DEM kesitleri** — depoyla taşınır. Kaynağın tamamı 23.5 GB (GitHub dosya sınırının 236, Git LFS sınırının 12 katı) ve gönderilemez; ama çalışılan bölgenin kesiti ucuz: bir havza + tampon **0.2 MB**, ~55×55 km 11 MB. `python tools/dem10_kes.py --havza <kmz>` ya da `--bbox b g d k` ile üretilir; WGS84, sıkıştırılmış, +300 m emniyet paylı. Kesit depoda olduğunda 10 m seçeneği kaynağın bulunmadığı makinelerde (deploy dahil) da çalışır. `data/dem/` içine **konmaz**: orası 30 m havuzu ve merge karışık çözünürlükte ilk dosyanınkini dayatır. |
| Ulusal 10 m DEM (tam) | (Opsiyonel) repo kökündeki `10M/` klasörü (23.5 GB kopya, gitignore'lı — depoya girmez; ED50 üzerinde özel Lambert). Yolu `DEM_10M` ile değiştirilir (ör. Windows'ta `D:\demdata\Yukseklik_10mDEM\10M\tr10clip.img`). Yalnız kesit ÜRETMEK için gerekir; günlük kullanımda kesitler yeter. |
| `data/dem/` | (Opsiyonel) yerel DEM'ler (EPSG:4326 GeoTIFF, VRT, ERDAS .img veya ESRI Grid klasörü). ASTER 30 m grid'i `data/dem/aster30m/` altına yerleştirin. Yoksa Copernicus GLO-30 karoları otomatik indirilir (`data/dem/cache/`). |
| `data/corine/` | (Opsiyonel) yerel CORINE 2018 GeoTIFF (sınıf kodları 111–523 veya grid kodu 1–44). Havzayı kapsayan yerel raster yoksa **EEA CLC2018 servisinden otomatik indirilir** (100 m, resmi lejand renklerinden sınıflandırılır, `data/corine/cache/` altına önbelleklenir). |
| `data/tables/` | Excel'den çıkarılmış sabit tablolar (BH2 boyutsuz eğri, YZD, ABAK2, CN dönüşümleri — DPLV hazır `dplv_stations.json` kaldırıldı, süre ekseni `backend/core/tables.py:DURATIONS_MIN` sabit). Elle düzenlemeyin; yeniden üretmek için `python tools/extract_tables.py`. |
| `data/stations/` | Eski istasyon ağı (`bir_cikti.kml`, 2315 istasyon). **Artık otomatik yüklenmiyor** — istasyon numarası taşımadığı için ölçüm veri tabanına numarayla bağlanamıyor ve yağışını komşu istasyondan ödünç alıyordu. Dosya duruyor, arayüzden elle yüklenebilir. |
| `data/regions/` | YZD alansal dağılım bölgeleri (`YZD_ALANLAR.kmz`, A/B/C poligonları). Havza çıkarıldığında bölge (A/B/C) otomatik seçilir (havzayla en çok örtüşen bölge). |
| `data/tables/mgm_plv_2020.json` | MGM 2020 tablosu — **yalnız 14 plüviyograf (PLV) oranı** için kullanılır. Dosyadaki P2–P500 sütunları duruyor ama `/api/mgm-stations` bunları **bilerek döndürmüyor**: P2–P100 artık `data/mgm/mgm.sqlite`'taki ham ölçümden hesaplanıyor. İki yağış kaynağını paralel tutmak, bir projede hangisinin kullanıldığını belirsiz bırakıyordu. `tools/extract_mgm_plv.py` ile üretilir. |
| `data/zemin/` | `hsg_tr.tif` — hidrolojik zemin grubu (A/B/C/D), ~1 km, 80 kB. SoilGrids dokusundan Saxton & Rawls Ksat'ı hesaplanıp NRCS NEH-630 Tablo 7-1 sınırlarına vurulur; grup **profildeki en geçirimsiz katmana** göre verilir. Türkiye: %92.3 C, %6.1 D, %1.6 B. Üretmek: `python tools/zemin_grubu_uret.py`. Ana kayaya derinliği içermez, bu yüzden **alt sınırdır** — dağlık havzada gerçek grup bir kademe daha geçirimsiz olabilir. |
| `data/mgm/` | `mgm.sqlite` — 1290 MGM/DSİ rasat istasyonunun **bütün sekmeleri** (yağış, sıcaklık, nem, rüzgâr, buharlaşma, kar… 78 tür, 9614 seri, 1925–2023) + `yillik_maks` tablosu (45 bin istasyon-yıl, yıllık en büyük günlük yağış). Adım 3’teki P2–P100’ün kaynağıdır; 1184 istasyon frekans analizine yetecek uzunlukta. `DMI-tümü/*.xls`'ten üretilir: `python tools/mgm_veritabani_olustur.py` (191 MB → 13 MB; seriler tür başına tek sıkıştırılmış float32 dizisi). |
| `data/raster/` | Yüklenen raster altlıklar (1/25000 pafta vb.) + `.json` kenar dosyaları (gitignore'lu). |
| `data/projects/` | Kaydedilen projeler (JSON). |
| `data/agi/` | ⚠ Eski yıllıkların (1979–1986) çıkarımında **118 pik kaydının başına fazladan bir rakam yapışmış** (D24A029 1981: 9500 m³/s, diğer 29 yıl 68–1033). NTFA/BTFA bunları varsayılan olarak eler ve hangisini neden elediğini sonuçta gösterir. `agi.sqlite` — DSİ ve EİE Akım Gözlem Yıllıklarından çıkarılmış yıllık pik akım veri tabanı (1935–2020, 2732 istasyon / 36.5 bin istasyon-yıl). Adım 5’teki frekans analizinin girdisidir. Yeniden üretmek: `python tools/agi_veritabani_olustur.py <pik_veritabani.csv>`. |
| `data/yagis/` | `yagis_tr.tif` (yağış), `pet_tr.tif` (potansiyel evapotranspirasyon), `net_tr.tif` (net yağış = P − AET) — CHELSA v2.1, 1981–2010 normali, ~1 km piksel, toplam 6.6 MB. Haritada tematik katman; nokta ve havza alansal ortalaması sorgulanır. Yeniden üretmek: `python tools/yagis_haritasi_indir.py`. |
| `data/su/` | `su.sqlite` — AGİ **günlük** akım serileri (1934–2015, 2909 istasyon, 8,3 milyon ölçülü gün). **Su Potansiyeli** sekmesinin girdisidir (şu anda UI CSS ile gizli, API aktif). 1,68 GB'lık `Data.db`'den üretilir: `python tools/su_veritabani_olustur.py Data.db` (11,5 MB'a iner — her istasyonun serisi tek sıkıştırılmış float32 dizisi). |

## İş akışı (5 adım)

1. **Havza** — Haritada outlet'e tıklanır; pyflwdir ile (pit doldurma → D8 akış
   yönü → birikim → outlet kenetleme) havza sınırı, dere ağı, en uzun akış yolu
   (L), ağırlık merkezi hizasına kanal mesafesi (Lc) ve alan çıkarılır.

   **Kavşağa tıklarsanız "beklenen alan" kutusunu doldurun.** Kenetleme
   varsayılan olarak yarıçap içindeki *en büyük* kola oturur (ArcHydro/QGIS
   "Snap Pour Point" geleneği) ve bu, kolların birleştiği yerde hep birleşik
   havzayı seçer. Beyağaç'ta (28.88968 D, 37.24602 K) tıklamanın 31 m yanında
   8.2 km²'lik kol var ama kural 477 m yürüyüp 24.6 km²'yi alıyor. Beklenen
   alanı yazınca kural "alanı buna en yakın kol"a döner: hedef 10 km² → 8.27 km²
   ve nokta 477 m değil **78 m** kayar. Alan bağımsız olarak bilindiği için bu
   sonucu istenen yere çekmek değildir — kalibre edilen şey çıkış noktasının
   yeridir.

   ⚠ Kenetleme yarıçapını büyütmek çözüm değildir, çünkü sonuç **yakınsamaz**:
   aynı noktada 1000 m'de 25 km², 2000 m'de 215 km² çıkıyor — 2 km ötedeki
   *başka* bir akarsuya atlıyor. Uygulama bu atlamayı artık uyarıyla bildirir
   (`_kenetleme_uyar`).

   **Ulusal 10 m DEM (iki aşamalı).** DEM kaynağından seçilir. 10 m veri
   11.8 milyar hücre olduğu için doğrudan okunamaz; havzanın nerede olduğunu
   önce 30 m söyler. Sıra: 30 m ile havza → sınıra **tampon** (varsayılan
   500 m) → 10 m'den o pencere kesilir, ED50 Lambert'ten WGS84'e döndürülür →
   alan, L, Lc ve 11 kot profili 10 m'den yeniden hesaplanır. İkinci aşama
   birincinin alanını hedef alır ki iki aşama aynı kolu anlatsın. Beyağaç
   örneği, uçtan uca 8 saniye:

   | | alan | L | Lc | çözünürlük |
   |---|--:|--:|--:|--:|
   | 30 m | 8.274 km² | 9.10 km | 4.80 km | 28 m |
   | 10 m | 8.372 km² | 10.76 km | 6.88 km | 10.0 m |

   ⚠ **Alan için 10 m'yi, L/Lc için 30 m'yi kullanın.** Alan %1 farkla aynı
   çıkıyor (aynı havza), ama uzunluklar %18 ve %43 uzuyor — akarsu uzunluğu
   ölçeğe bağlı bir büyüklüktür, ince DEM her kıvrımı sayar. DSİ'nin Ct/Cp
   katsayıları **haritadan** ölçülmüş uzunluklarla kalibrelidir;
   t<sub>p</sub> = C<sub>t</sub>·(L·L<sub>c</sub>)<sup>0.30</sup> olduğu için
   10 m uzunlukları t<sub>p</sub>'yi %17 büyütür ve pik debiyi o oranda
   düşürür. Uygulama bunu uyarı olarak yazar. 10 m'nin gerçek kazancı
   **kot profili ve alan** ayrıntısındadır.

   **10 m nereye kadar işe yarar:** havza çıkarımı `MAX_CELLS` (8 milyon) ile
   sınırlı. 10 m'de hücre sayısı bunu aşınca DEM kabalaştırılır ve fiilen 30 m'ye
   döner — 800 km²'ye kadar tam 10 m, 2000 km²'de 15.8 m, 7500 km²'de 30.6 m.
   Yani **~5000 km² üstünde 10 m seçmenin hiçbir kazancı yok**; uygulama ve
   kesme aracı bunu uyarı olarak yazar.

   ⚠ **Datum notu:** kaynakta `TOWGS84` parametresi yok; PROJ "ED50 to WGS 84
   (1)" dönüşümünü seçiyor ve ilan edilen doğruluğu **10 m** — tam bir hücre.
   Türkiye'de yaygın (−84, −107, −120) parametreleriyle arasındaki fark
   ölçüldü: 18 m. Yani kazanç çözünürlüktedir, mutlak konumda değil.
2. **Parametre** — Ana kanal boyunca 11 kot (harmonik eğim profili) DEM'den
   otomatik dolar, elle düzeltilebilir. Bölge sınıfı (A/B/C — YZD eğrisi)
   `data/regions/YZD_ALANLAR.kmz`'den havza konumuna göre **otomatik seçilir**
   (en çok örtüşen bölge; gerekirse elle değiştirilir). Baz akım (Q<sub>baz</sub>).

   **CN de bu adımdadır** — CORINE rasteri havza ile kesilir (yerel yoksa EEA
   CLC2018 servisinden otomatik indirilir); seçilen hidrolojik zemin grubuna
   (A/B/C/D) göre `data/tables/corine_cn.json` tablosundan alansal ağırlıklı
   CN(II); CN(III) Excel'deki dönüşüm tablosuyla. Aynı kesitten rasyonel
   yöntemin akış katsayısı C'si de türetilir; seçimi Adım 4’teki **Rasyonel
   yöntem seçenekleri** kutusundadır.

   **Zemin grubu havzanın toprağından otomatik seçilir** (`data/zemin/hsg_tr.tif`,
   `/api/zemin-grubu`) ve gerekçesi ekranda yazar: hangi grubun havzanın yüzde
   kaçını kapladığı, dayandığı Ksat aralığı. Kullanıcı değiştirebilir; baskın
   grup %60'ın altındaysa "havza karışık" uyarısı çıkar.

   ⚠ **Bu, hesabın en kritik girdisidir.** Karakurt havzasında (7500 km²,
   Aras) yalnız zemin grubunu B'den C'ye almak Q100'ü **296 → 771 m³/s**
   çıkarıyor; A ile D arasında on kat oynuyor. Daha önce açılır listede
   gerekçesiz bir varsayılan (B) seçili geliyordu ve kullanıcı dokunmazsa
   sonucu sessizce o belirliyordu — oysa üretilen ülke haritasına göre B,
   Türkiye'nin **%1.6**'sına uyuyor (%92.3 C, %6.1 D). O varsayılan kaldırıldı.
3. **Yağış — Thiessen + Yağış birleşik** — Üstte **Thiessen**: varsayılan küme **MGM ölçüm ağıdır** — en az 10 yıllık günlük maksimum yağış ölçümü olan **1184 istasyon** (`data/mgm/mgm.sqlite`). Voronoi hücreleri havzaya kesilerek alan ağırlıkları (DATAGİR H kolonu karşılığı) bulunur; haritada yalnız pay alan istasyonlar çizilir. Kendi KMZ/KML’nizi de yükleyebilirsiniz. Küme bilerek ölçümü olan istasyonlarla sınırlı: böylece **her hücre kendi ölçtüğü yağışı taşır** ve alt tablodaki P2–P100 bağlanması **kimlik eşleşmesidir**. Altta **Yağış**: **📊 Ölçümden hesapla** düğmesi Thiessen istasyonlarını MGM ölçüm veritabanına (`data/mgm/mgm.sqlite`) bağlar ve P2–P100’ü her istasyonun **yıllık en büyük günlük yağış** serisinden frekans analiziyle üretir — NTFA ile aynı hesap (altı dağılım, moment yöntemi, Smirnov-Kolmogorov ile kabul). Değerler elle de girilebilir/yapıştırılabilir; OEY her hâlde elle girilir. Tabloda her satırın **kaynağı** görünür: kaç yıllık seri, kabul edilen dağılım, eşleşmenin nasıl kurulduğu. Varsayılan kümede eşleşme **kimlik** eşleşmesidir (`kod`, mesafe 0); yalnız elle yüklenen KMZ veya haritaya konan noktalar koordinatla bağlanır; orada da yarıçap içinde ≥25 yıllık seri varsa daha yakındaki kısa seriye yeğlenir — Lüleburgaz’da 5.7 km’de 10 yıllık, 6.3 km’de 74 yıllık istasyon var. DPLV zaman-dağılım istasyonu havza çıkınca **236 MGM PLV içinden havza centroid’ine en yakın** istasyondan otomatik seçilir (`POST /api/plv-en-yakin`, küresel en yakın; elle değiştirilebilir, `↺ Otomatik’e dön` ile geri alınır, projede saklanır) ve 14 oranı elle / Excel'den yapıştırılabilir (MGM PLV — otomatik, gerekirse elle).

   ⚠ **P100’e dikkat.** Kısa seride log-Pearson-3 çok ağır kuyruk üretebiliyor: SARAY (27 yıl) P100 = 200 mm, SARMISAKLI (46 yıl) P100 = 78 mm. Kaynak sütunu bunu görünür kılmak için var.

4. **Hesap** — Snyder ve kar erimesi seçenekleri doldurulup (opsiyonel) tek tıkla:
   * **DSİ Sentetik**: qp = 414·A⁻⁰·²²⁵·(L·Lc/√S)⁻⁰·¹⁶ → BH2 boyutsuz birim
     hidrograf 0.5 sa adıma örneklenir; 2/4/6/8/12/18/24 saatlik sağanaklar
     2'şer saatlik bloklara (YZD eğrisi) ayrılıp SCS artım akışlarıyla süperpoze
     edilir → KABULET pik matrisi (+ Q500/1000/10000 ekstrapolasyonu).
   * **Mockus** (süperpozesiz): Tc (Kirpich-metrik), D=2√Tc, Tp; K1/K2/K3.
   * **Rasyonel** (A ≤ 1 km² ise): Tc'de PLV eğrisinden şiddet, C_T = C100·(T/100)^0.2.
     C100 elle girilir; CN hesaplandıysa CORINE'den türeyen alansal ağırlıklı
     akış katsayısı C'nin alt/önerilen/üst değerleri aynı kutuda seçilebilir —
     seçim C100 alanına yazılır ve rasyonel yöntemi işaretler.
   * **Snyder** (opsiyonel, `SNYDER V7.xlsm`): tp=Ct·(L·Lc)^0.30, tr=tp/5.5,
     qp=2760·Cp/tp, Qp=A·qp·10⁻³/10, Tp=tr/2+tp, Tb=(3+3tp/24)·24. W50/W75
     genişlik noktalarıyla kurulan, hacmi 1 mm'ye dengelenmiş birim hidrograf;
     24 sa sağanak tr saatlik n=24/tr bloğa bölünüp (YZDO dağılımı + YALD alansal
     azaltma + 1.13 maksimizasyon + SCS akış) tr saat kaydırmayla süperpoze edilir.
     Q2–Q100 CII, QOET CIII; Q500/1000/10000 ekstrapolasyon. Parametreler ve
     Q2–Q100 pikleri Excel ile birebir (`backend/tests/test_snyder_golden.py`).
      W50/W75 girilmezse **ŞEKİL 1 (DSİ Snyder abağı)** formülüyle otomatik okunur:
      W50=5.87/(qp/1000)^1.08/2.54, W75=3.35/(qp/1000)^1.08/2.54 (`snyder.w50_w75`).
   * **Kar erimesi** (opsiyonel, KAR1): derece-gün, sıcaklıklar kar kotuna taşınır (0.5°C/100 m), en büyük ortaya dağıtım paterni — Qkar piki OET hidrografına eklenir. Hesap sekmesindeki `Kar erimesi (opsiyonel)` kutusunda doldurulur.
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

5. **Frekans** — *Noktasal Taşkın Frekans Analizi (NTFA)*. Sentetik yöntemlerden
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

   **Aykırı değer testi (Grubbs-Beck, Bulletin 17B).** Her analizde otomatik
   koşar ve sonuçla birlikte raporlanır: n, K<sub>n</sub>, üst/alt sınır ve
   sınır dışında kalan değerler. "Aykırıları çıkarıp karşılaştır" kutusu
   işaretlenirse analiz aykırısız bir kez daha koşulur ve iki sonuç tekerrür
   tekerrür yan yana, yüzde farkıyla verilir. **Asıl sonuç değişmez.**

   ⚠ **Yüksek aykırıyı atmak standart uygulama değildir.** Bulletin 17B, yüksek
   aykırıyı *hatalı olduğu kanıtlanmadıkça* seride tutmayı söyler: o değer üst
   kuyruk hakkındaki en bilgilendirici gözlemdir ve atılması tasarım debisini
   emniyetsiz tarafa, düşüğe çeker. Düşük aykırılar ise rutin olarak sansürlenir.
   Karşılaştırma bu yüzden var — atmak için değil, ne kadar fark ettiğini
   görmek için. (Aykırı atmakla "düzelmek" de garanti değil: D24A029'da tek
   düşük aykırının çıkarılması Q100'ü **1301'den 1481 m³/s'ye yükseltiyor**.)

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
   derinlik 3. adımdaki **OET** yağışına yazılarak muhtemel maksimum feyezan
   (Q<sub>OET</sub>) elde edilir. `backend/core/mmy.py`, golden test:
   `backend/tests/test_mmy_golden.py` (Binkılıç + Karamandere T7.3).

## Su Potansiyeli modu

> **Not:** Şu anda arayüzde CSS ile gizli (`frontend/style.css:175` — `display:none`); backend ve API uçları (`/api/su-*`) korunuyor. Görünür yapmak için o blok silinir.

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

1. **Ortak veri** — istasyon ve yağış (Adım 3 — birleşik) “Tek Havza” modundan paylaşılır;
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

## İklim katmanları (yağış · PET · net yağış)

Harita panelindeki **🌧 İklim katmanı** kutusuyla açılır, açılır listeden üç
katman seçilir. Hepsi aynı kaynak, dönem ve ızgaradan gelir: **CHELSA v2.1**,
1981–2010 normali, 30 arc-sec ≈ 1 km piksel, CC0.

| katman | nedir | Türkiye ort. |
|---|---|---|
| **P** | yıllık toplam yağış (bio12) | 740 mm |
| **PET** | potansiyel evapotranspirasyon, Penman-Monteith | 1138 mm |
| **net** | P − AET, ≈ yıllık ortalama akış yüksekliği | 170 mm |

Neden CHELSA: 1005 MGM istasyonuna karşı yapılan karşılaştırmada Türkiye'de
yıllık yağışta en yüksek uyumu veren ızgara veri seti — Lin uyum katsayısı
**0.824**; ERA5-Land 0.760, CHIRPS 0.742, WorldClim 0.712 (Keserci vd. 2026,
*Int. J. Climatology*). WorldClim, Akdeniz'in dağlık kesiminde yükselti–yağış
ilişkisini ters çevirecek kadar sapıyor (CCC 0.081); CHELSA orografik etkiyi
hesaba katıyor.

**Net yağış neden P − PET değil:** Türkiye'de PET (1138 mm) yağıştan (740 mm)
büyüktür; P − PET neredeyse her yerde negatif çıkar ve bu *iklimsel su
açığıdır*, akış değildir — buharlaşabilecek su düşenden çok olamaz.

**Neden aylık hesap:** Net yağış yıllık toplamlardan değil, **aylık su
bütçesinden** çıkarılır. Türkiye'de yağış kışa, buharlaşma isteği yaza yığılır;
yıllık toplamlar bu karşıtlığı yutup kışın doğrudan akışa geçen suyu görmez.
Her ay için: 0 °C altındaki yağış kar olarak birikir ve sıcaklıkla erir
(derece-gün, 2.5 mm/°C/gün); giren su PET'i aşarsa toprak dolar, AWC'yi aşan
kısım akışa geçer; açık kalırsa toprak neminden çekilir. Başlangıç neminin
etkisi sönsün diye 12 ay üç kez döndürülür.

**AWC toprak verisinden gelir.** Kullanılabilir su tutma kapasitesi sonucun
baskın parametresidir (50 mm ile 200 mm arasında ülke akışı 180'den 98 km³'e
iner), bu yüzden sabit varsayılmaz: ISRIC **SoilGrids v2.0**'dan (1 km, CC-BY)
kum, kil, organik karbon ve iri taneli malzeme okunup Saxton & Rawls (2006)
pedotransfer fonksiyonlarıyla türetilir — `python tools/awc_soilgrids.py`.
Derinlik kademeli yazılır (0-5 … 0-100 cm için 7, 19, 37, 71, 116 mm), çünkü
hidrolojik olarak etkin derinlik kalibre edilen bir parametredir.

### Katman ölçüme oturtulmuştur

Ham Thornthwaite-Mather bütçesi akışı **%35 eksik** veriyordu. Üç yapısal
parametre — etkin toprak derinliği, PET çarpanı (CHELSA'nın referans-çim
PET'ini gerçek örtüye ölçekler) ve doygunluk fazlası hızlı akış payı —
1981-2010 arasında en az 20 tam su yılı ölçmüş **41 doğal AGİ** havzasına
oturtuldu: `tools/net_kalibrasyon.py`, doğrulama `tools/net_yagis_dogrulama.py`.
Sonuç `etkin derinlik 0-100 cm, pet_carpan 0.80, hizli_pay 0.70`.

Doğallık, rezervuar envanteri olmadığı için serinin kendisinden elenir:
Mann-Kendall (gidiş), Pettitt (sıçrama) ve DEM havzasının DSİ'nin bildirdiği
alanla %20 içinde uyuşması. DSİ havza 5/6/7 (Gediz, Küçük ve Büyük Menderes)
tümüyle dışlanır — sulama alımı kayıttan önce başladığı için istatistiksel
eleme göremiyor; oradaki AGİ'ler alımdan *sonraki* akışı ölçüyor, katman ise
alımdan *önceki* doğal akışı hesaplıyor.

| | n | r | NSE | yanlılık |
|---|--:|--:|--:|--:|
| ham katman | 41 | — | +0.42 | −35% |
| **kalibre katman** | 41 | **0.86** | **+0.72** | **+1%** |
| çapraz doğrulama (5 kat) | 41 | — | +0.58 | |

Skor 5 katlı çapraz doğrulamayla da verilir: parametre, skorun ölçüldüğü
istasyonları görmez. Aynı istasyonlara uydurup sonra onlarla "doğruladık"
demek hiçbir şey kanıtlamaz; iki sayı arasındaki fark kazancın ne kadarının
gerçek olduğunu söyler.

**Kalan zayıflıklar — kapatılmadılar:** Akdeniz (r 0.97, NSE 0.82), İç Anadolu
(0.89 / 0.74) ve Karadeniz (0.84 / 0.59) tutuyor. **Ege/Marmara, sulama
havzaları çıkarıldıktan sonra da tutmuyor** (r 0.43, NSE 0.01; Susurluk ve
Meriç'te ~+70% fazla). Aras havzasında %44 fazla veriyor — kar egemen
havzalar, derece-gün katsayısı (2.5 mm/°C/gün) kalibre *edilmedi*. Sonuç
güzelleşene kadar istasyon elemek kalibrasyonu anlamsızlaştıracağı için
bunlara dokunulmadı.

**Ülke ölçeğinde:** Türkiye sınırı içinde P 740 mm (579 km³), net 280 mm
(219 km³), akış katsayısı **0.379** — DSİ'nin kendi su bütçesindeki
186/501 = 0.371 ile neredeyse birebir. Hacmin DSİ'nin 186 km³'ünden yüksek
çıkması akış üretiminden değil **yağıştan** geliyor: CHELSA Türkiye'ye 740 mm
veriyor, MGM/DSİ 574 mm. Bu, katmanın değil kaynak veri setinin farkıdır.

Sonuç kuraklık gradyanı boyunca doğru davranıyor: Konya'da **net = 0** —
kapalı havzada düşen suyun tamamı buharlaşır. Akışın büyük kısmı
kış+ilkbaharda, Nisan'da zirve (kar erimesi), Ağustos'ta ~2 mm.

Katman açıkken **haritaya tıklayınca** o noktanın P, PET, AET, net yağış ve
akış katsayısı balonda okunur; seçili katmanın satırı koyu gösterilir. Outlet
seçimi, ara havza noktası veya istasyon ekleme kipi açıkken sorgu yapılmaz —
o kipler önceliklidir.

**Havza ortalaması** düğmesi üç katmanın da **alansal ortalamasını** verir
(medyan, aralık, sapma) ve bunlardan AET ile akış katsayısını türetir — dağlık
havzada tek noktanın değeri yanıltıcıdır. `backend/core/yagis.py`.

⚠ **Ölçek uyarısı:** CHELSA'nın Türkiye ortalaması 740 mm, MGM'nin uzun dönem
istasyon ortalaması ise 574 mm (yukarıdaki "Ülke ölçeğinde" paragrafı). Fark,
istasyonların ovalarda yoğunlaşıp yüksek kesimleri örneklememesinden de
kaynaklanabilir (o durumda 740 daha doğru bir alansal ortalamadır), CHELSA'nın
ıslak sapmasından da. Kesin iş için havza ortalamasını yakındaki bir AGİ'nin
**özgül verimiyle** (Su Potansiyeli sekmesi) karşılaştırın. Katmanı üreten
bütçenin yapısal parametreleri `tools/su_butcesi.py` içinde durur
(`PET_CARPAN = 0.80`, `HIZLI_PAY = 0.70`, `DERECE_GUN = 2.5`, etkin derinlik
0–100 cm bandı); değiştirirseniz `python tools/net_yagis_dogrulama.py` ile
yeniden doğrulayın.

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
* NTFA'da (adım 5) tersi geçerlidir: DSİ frekans şablonuyla **birebir** uyum
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
python backend/tests/test_corine_c.py            :: CORINE → rasyonel C türetimi
python backend/tests/test_akarsu.py              :: DSİ akarsu katmanı (veri yoksa atlanır)
python backend/tests/test_kenetleme.py           :: outlet kenetleme sıçrama uyarısı (DEMsiz)
python backend/tests/test_frontend_modules.py    :: frontend ESM modül grafiği koruması (eksik/rank/döngü/yetim)
```
