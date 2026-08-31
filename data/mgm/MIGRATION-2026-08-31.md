# MGM İstasyon Sicili Geçişi — 2026-08-31

## Kaynak ve çalışma zamanı

- Kanonik dosya: `data/mgm/mgm-istasyonlari.json`
- Kaynak kopya: `/home/ismet/dev/mgm-data-fetcher/data/all-cities.json`
- MGM uç noktası: `https://servis.mgm.gov.tr/web/istasyonlar/ilDetay?plaka={plate}`
- İndirme aracı: kardeş depodaki `mgm_scraper.py`; kesin indirme zamanı kaydedilmemiştir.
- Boyut: 960.649 bayt
- SHA-256: `b2292f030e4b085a8c8a1912397b6295c5fe2cc308006bd4e8fac37270130525`
- Kaynak dosyada gözlenen tarih: 2026-08-17; MGM yayın/indirme zamanı olarak yorumlanmaz.
- Kapsam: 81 il, 1.913 benzersiz `istNo`, 19 tanımlı alan.

Çalışma zamanı sicili doğrudan JSON'dan bir kez yükler. Ağdan veya kardeş depodan
veri çekmez. Yenileme için aday dosya önce
`python tools/mgm_veritabani_olustur.py /aday/yolu.json` ile doğrulanır; istatistik
farkları incelendikten sonra kanonik dosya elle değiştirilir.

## Eski verinin arşivi ve kapsam farkı

- Arşiv: `archive/mgm-legacy-2026-08-31.sqlite`
- Boyut: 13.221.888 bayt
- SHA-256: `47c2dbd6d97d139e5c8b9d3b7ed533632fe35360ecc7a203df3a1377e02589c5`
- Arşiv çalışma zamanında açılmaz; yalnız denetim ve geri dönüş içindir.

Eski veri 1.290, yeni sicil 1.913 istasyon içerir. Kimlik kesişimi 248;
1.665 kayıt yalnız yeni sicilde, 1.042 kayıt yalnız eski veridedir. Kesişen
kimliklerden 37'si açık kimlik çakışmasıdır. Bu nedenle otomatik çapraz eşleme
yapılmadı. Eski `seri` (9.614 satır), `yillik_maks` (45.059 satır, 1926–2023),
`kurum`, `bolge`, `dosya` ve türetilmiş `maks_*` alanları yeni sicilde yoktur.
`/api/mgm-seri`, `/api/mgm-frekans` ve `/api/mgm-eslestir` bu yüzden açıklayıcı
404 döndürür; P2–P100/OEY değerleri manuel girilir.

## Sicil kalite özeti

- Eksik/null: `Indikator=1470`, `YagisSensor=4`, `KarSensor=4`.
- Dört kayıtta iki sensör anahtarı kaynak JSON'da yoktur; çalışma zamanı bunları
  `null` olarak korur.
- Tam ad tekrarı: 2 grup / 4 kayıt.
- Normalize ad tekrarı: 18 grup / 36 kayıt.
- Tam koordinat tekrarı: 7 grup / 14 kayıt.
- `YagisSensor=1`: 370 kayıt; bu alt kümede ad/normalize ad/koordinat tekrarı yoktur.

`YagisSensor=1`, yalnız güncel yağış sensörü işaretidir; tarihsel seri uzunluğu
veya frekans analizine uygunluk iddiası değildir.

## PLV eşleştirme denetimi

`data/tables/mgm_plv_2020.json` içindeki 236 oran satırı manuel seçimde korunur.
Kanonik sicille tek anlamlı ad eşleşmesi bulunan 215 kayıt otomatik en-yakın
seçime katılır. Aşağıdaki 17 kayıt birden çok aday nedeniyle dışlanır:

- ADANA: 17351, 17352
- AFYONKARAHİSAR: 17189, 17190, 17839, 18750, 18757, 19164
- ANKARA: 17128, 17127, 17131, 17130
- BALIKESİR: 17158, 17674, 17150, 17143
- DİYARBAKIR: 17281, 17280, 19916
- ELAZIĞ: 17202, 17201, 18191, 19083, 18766, 19262, 20508
- ERZURUM: 17096, 17095
- ESKİŞEHİR: 17124, 17123, 17126
- GAZİANTEP: 17261, 20527
- KAYSERİ: 17196, 17195, 17802, 20520
- KONYA: 17304, 17476, 17244, 17245
- KUMKÖY: 17059, 19227
- LÜLEBURGAZ: 17631, 18796, 19113
- SAMSUN: 17030, 17031, 18536, 20515, 17391
- SİVAS: 17090, 20518
- TRABZON: 17037, 17038, 17464
- İZMİR: 17220, 17225, 17219, 17821, 18445

Çözülemeyen dört kayıt: BOZOYÜK, DOĞUBEYAZIT, GÖZTEPE MARMARA ve VAN.
Belirsiz adaylar arasında bulanık, ilk-kayıt veya koordinat tahmini yapılmaz.

## Yerel eski çıktılar

Geçiş sırasında çalışma ağacında bulunan `data/mgm/csv/`,
`mgm_stations_full_correct_list.csv` ve `tools/mgm_csv_cikar.py` eski SQLite'tan
üretilmiş yerel çıktılardır. Kanonik sicile veya arşive alınmadılar;
`data/mgm/csv/` yeniden yanlışlıkla eklenmemesi için yok sayılır. Diğer iki
izlenmeyen kullanıcı dosyası değiştirilmeden bırakılmıştır.