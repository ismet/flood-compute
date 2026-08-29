/**
 * @fileoverview Uygulama durumu tekil nesnesi (S) ve havza değişim gözlemcisi.
 * @module core/state
 * @description Global singleton S — tüm modüller tek kaynaktan okur/yazar.
 *   clearSingleBasin KÖK'te (app.js) kalır, burada değil.
 * Owns: S singleton (bkz. AppState), _havzaListeners
 * Exports: S, onHavzaChanged, _notifyHavzaChanged
 * Notes:
 *  - §3.1 push reactions yalnızca onHavzaChanged ile (consumer: su.suHavzaGuncelle);
 *    doğrudan wizard→modes push yasaktır.
 *  - Proje geri yüklemede toptan Object.assign(S, …) izinli (proje.js).
 *  - Rank: core (0) — en alt katman, yukarı bağımlılık yok.
 * @typedef {Object} AppState
 * @property {Object|null} outlet - Seçili çıkış noktası {lat,lon,snap_lat,snap_lon}
 * @property {Object|null} havza - GeoJSON Polygon/MultiPolygon havza sınırı
 * @property {Array<number|string>} kotlar - 11 kot (outlet→memba)
 * @property {Object|null} dere - Dere ağı GeoJSON
 * @property {Object|null} kanal - Ana kanal GeoJSON
 * @property {Object|null} yzdBolge - YZD bölge bilgisi {bolge,yontem}
 * @property {Array} thiessen - Thiessen ağırlık listesi [{name,agirlik,alan_km2,poligon_geojson}]
 * @property {Array} istasyonlar - Ham istasyon listesi
 * @property {Array} yagis - Yağış satırları (legacy)
 * @property {Object} rainValues - {istasyonAd: [P2..P100,OET]} 7 değer
 * @property {Object} rainMeta - {istasyonAd: {yil_sayisi,dagilim,yontem,mesafe_km}}
 * @property {Object|null} P24w - Ağırlıklı P2..P100 {2,5,10,25,50,100}
 * @property {number|null} OETw - Ağırlıklı OET
 * @property {number|null} rainColorCol - Alan boyaması sütun indeksi (0..6)
 * @property {Array|null} mgmDbYakin - Havza yakınındaki MGM istasyonları
 * @property {Object|null} cnSonuc - CORINE CN sonucu {CN2,CN3,dokum,rasyonel_C}
 * @property {Object|null} zemin - Zemin grubu {grup,dagilim,pay_yuzde,yontem,ksat_araligi_mm_sa}
 * @property {string|null} cSecim - Rasyonel C seçimi (C_min/C_orta/C_max)
 * @property {Object|null} rasyonelCKaynak - {deger,secim,kaynak}
 * @property {boolean} dplvManual - DPLV elle değiştirildi mi (MGM otomatik vs elle)
 * @property {Object|null} dplvAuto - Otomatik seçilen MGM PLV {ad,kod,mesafe_km,plv}
 * @property {Array|null} dplvValues - 14 oran (MGM veya elle)
 * @property {Array} mgm - MGM station list
 * @property {Object} mgmByNorm - mgmNorm→station
 * @property {Object|null} mgmDb - /api/mgm-bilgi
 * @property {string|null} mode - wizard|multi|dilekce|su
 * @property {Array|null} stBase - Temel istasyon kümesi
 * @property {Set<string>} stExclude - Çıkarılan istasyon anahtarları
 * @property {Array} stExtra - Elle eklenen istasyonlar
 * @property {string|null} stKaynak - Thiessen kaynak etiketi
 * @property {Array} thElenen - Küçük pay eşiğiyle elenenler
 * @property {string|null} agiSecili - Seçili AGİ (noktasal NTFA)
 * @property {Set<string>} agiBolgesel - Bölgesel BTFA seçili kodlar
 * @property {Array} agiListe - AGİ liste
 * @property {Object|null} tfa - Son NTFA sonucu
 * @property {Object|null} btfa - Son BTFA sonucu
 * @property {Object|null} mmy - Son MMY sonucu
 * @property {Object|null} sonuc - /api/compute sonucu
 * @property {Object|null} girdi - Son compute girdisi
 * @property {Object|null} abak2 - /api/abak2 verisi
 * @property {Object|null} ctcp - /api/snyder-ctcp verisi {Ct,Cp}
 * @property {Array|null} cmpCoords - Karşılaştırma hidrograf koordinatları
 * @property {Array} infoLayers - Bilgi katmanları [{ad,layer,renk,gorunur,sayi}]
 * @property {Array} rasterLayers - Raster altlıklar [{meta,layer,gorunur,saydam}]
 * @property {Object|null} yagisHavza - Havza iklim ortalaması
 * @property {Set<string>} suSecili - Su potansiyeli seçili kodlar
 * @property {Array} suListe
 * @property {Object|null} suPeriyot
 * @property {Object|null} suTamam
 * @property {Object|null} multi - Ara havza {mansap,mansapAuto,membalar,place}
 * @property {Object|null} multiMd
 * @property {Object} multiQbazVals
 * @property {Object|null} multiSonuc
 * @property {boolean} multiShowRes
 * @property {Object|null} resPoints
 * @property {Object|null} resSonuc
 * @property {Object|null} resMarker
 * @property {Object|null} resVolGrid
 * @property {Object|null} ratGrid
 * @property {Object|null} resDefaults
 * @property {Object|null} resConDefaults
 * @property {Set<string>} rapFilter - Rapor/Mukayese hariç tutulan yöntemler (comparison→hesap, KABULET CSV dışı değil sadece rapor filtresi)
 * @property {Set<string>} seciliYontemler - Hesap adımında seçili sentetik yöntemler (hesap→S: dsi/mockus/rasyonel/snyder; DSİ zorunlu)
 */

export const S = {
  outlet: null,
  havza: null,
  kotlar: Array(11).fill(""),
  istasyonlar: [],
  thiessen: [],
  yagis: [],
  sonuc: null,
  dplvManual: false,
  dplvAuto: null,
  dplvValues: null,
  rapFilter: new Set(),
  seciliYontemler: new Set(["dsi", "mockus"]),
};

const _havzaListeners = [];
export function onHavzaChanged(fn) {
  _havzaListeners.push(fn);
}
export function _notifyHavzaChanged() {
  _havzaListeners.forEach((fn) => fn());
}
