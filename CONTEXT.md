# Taşkın Hesap

Sentetik yöntemlerle taşkın debisi hesaplama aracı: havza çıkarımı, yağış
analizi ve frekans analizi tek iş akışında.

## Language

**Adım**:
Tek Havza modundaki altı aşamalı iş akışından biri (Havza → Parametre →
Thiessen → Yağış → Hesap → Frekans). UI metinlerinde numarayla anılır.
_Avoid_: sekme, bölüm

**Parametre**:
Havzanın fiziksel girdileri (A, L, Lc, kotlar, YZD bölgesi, Q_baz) ve CN.
_Avoid_: ayar

**CN**:
Curve Number — CORINE arazi örtüsünün hidrolojik zemin grubuna göre
alan-ağırlıklı değeri; akış hacmini belirleyen birimsiz girdi.
_Avoid_: SCS sayısı

**Thiessen kümesi**:
Havzaya düşen yağı taşıyan istasyon takımı; her hücre kendi ölçtüğü yağı taşır.
_Avoid_: Voronoi ağı, yağış ağı
