# Taşkın Hesap

Sentetik yöntemlerle taşkın debisi hesaplama aracı: havza çıkarımı, yağış
analizi ve frekans analizi tek iş akışında.

## Language

**Adım**:
Tek Havza modundaki beş aşamalı iş akışından biri (Havza → Parametre →
Yağış → Hesap → Frekans). Yağış adımı Thiessen kümesi ve ağırlıkları ile yinelenmeli yağışları birlikte içerir (eskiden Adım 3+4). UI metinlerinde numarayla anılır.
_Avoid_: sekme, bölüm

**Parametre**:
Havzanın fiziksel girdileri (A, L, Lc, kotlar, YZD bölgesi, Q_baz) ve CN.
_Avoid_: ayar

**CN**:
Curve Number — CORINE arazi örtüsünün hidrolojik zemin grubuna göre
alan-ağırlıklı değeri; akış hacmini belirleyen birimsiz girdi.
_Avoid_: SCS sayısı

**Akış katsayısı C**:
Rasyonel yöntemin akış katsayısı; CORINE kesitinden alansal ağırlıklı türetilir,
alt/önerilen/üst aralığı olarak sunulur. Genel bir C'dir — hesap girdisi değildir.
_Avoid_: rasyonel katsayı, C değeri

**C100**:
Tekrar süresi 100 yıla karşılık gelen rasyonel katsayı; hesabın doğrudan
kullandığı girdidir. Küçük tekerrürler C_T = C100·(T/100)^üs ile ölçeklenir.
_Avoid_: genel C

**Thiessen kümesi**:
Havzaya düşen yağı taşıyan istasyon takımı; her hücre kendi ölçtüğü yağı taşır.
_Avoid_: Voronoi ağı, yağış ağı
