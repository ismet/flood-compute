/**
 * @fileoverview Thiessen istasyon kümeleri ve ağırlıklar — manuel ekle/çıkar + aday katmanı.
 * @module wizard/thiessen
 * Owns: S.stBase, S.stExclude, S.stExtra, S.stKaynak, S.istasyonlar, S.thiessen, S.thElenen; layers.thiessenAday OWNER-CREATED
 * Exports: kurumColor, stKey, effectiveStations, loadStationSet, recomputeThiessen, renderExcluded, renderAdaylar, renderAdayMarkers, addStation, restoreStation, runThiessen, removeStation, useDefaultStations
 * Notes:
 *  - Allowed pull (§3.1): thiessen→rain (recolorThiessen, renderRainTable, mgmDbListesi)
 *  - kurumColor module-local (constants admission ≥2 gerekir, burada tek tüketici)
 *  - Rank 2 (wizard).
 * @typedef {Object} ThiessenPayload
 * @property {Object} havza_geojson - Havza Polygon/MultiPolygon
 * @property {Array<Object>} istasyonlar - [{name,lat,lon,kurum}]
 * @property {number} min_agirlik - Küçük pay eşiği 0..1
 */

import { S } from "../core/state.js";
import { $, setStatus } from "../ui/dom.js";
import { api } from "../core/api.js";
import { _esc } from "../core/format.js";
import { map, layers } from "../map/init.js";
import { recolorThiessen, renderRainTable, mgmDbListesi } from "./rain.js";
import { mgmTriangleIcon, elleCircleMarker, STATION_TOOLTIP_MGM, STATION_TOOLTIP_ELLE } from "../map/station-markers.js";

// layers.thiessenAday: aday + çıkarılan hayalet marker’lar (thiessen.js sahibi, registry-bag)
if (layers.thiessenAday) {
  try {
    map.removeLayer(layers.thiessenAday);
  } catch (e) {}
}
layers.thiessenAday = L.layerGroup().addTo(map);

export const kurumColor = (k) =>
  k === "DSİ" ? "#e65100" : k === "DMİ" ? "#1565c0" : k === "Elle" ? "#2e7d32" : "#7d6e4f";
export const stKey = (s) => `${s.name}|${(+s.lat).toFixed(5)}|${(+s.lon).toFixed(5)}`;
S.stExclude = new Set();
if (!S.stKorumali) S.stKorumali = new Set();
export function effectiveStations() {
  const base = (S.stBase || []).filter((s) => !S.stExclude.has(stKey(s)));
  return base.concat(S.stExtra);
}
export async function loadStationSet(list, kaynak) {
  S.stBase = list;
  S.stExclude = new Set();
  S.stExtra = [];
  S.stKorumali = new Set();
  await runThiessen(effectiveStations(), kaynak);
}
// --- Thiessen manuel ekle/çıkar yardımcıları ---
let _thiessenBusy = false;
let _thiessenBekleyen = false; // hesap sürerken gelen ekle/çıkar: kuyruğa alınır, sessizce düşürülmez
function _havzaMerkez() {
  if (!S.havza) return null;
  try {
    const gj = S.havza.features ? S.havza.features[0].geometry : S.havza.geometry || S.havza;
    const coords = gj.type === "MultiPolygon" ? gj.coordinates.flat(2) : gj.type === "Polygon" ? gj.coordinates.flat(1) : [];
    if (!coords.length) return null;
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    coords.forEach(([lon, lat]) => { if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat; if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon; });
    return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
  } catch (e) { return null; }
}
function _mesafeKm(aLat, aLon, bLat, bLon) {
  const R = 6371, dLat = (bLat - aLat) * Math.PI / 180, dLon = (bLon - aLon) * Math.PI / 180;
  const s1 = Math.sin(dLat / 2), s2 = Math.sin(dLon / 2);
  const aa = s1 * s1 + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * s2 * s2;
  return 2 * R * Math.asin(Math.sqrt(aa));
}
function _normalizeMgmEntry(e) {
  return {
    name: e.ad || e.name || e.istasyon || "",
    lat: e.enlem ?? e.lat,
    lon: e.boylam ?? e.lon,
    kod: e.kod || e.no || "",
    kurum: e.kurum || "MGM",
    yil_sayisi: e.yil_sayisi ?? e.maks_yil,
    _orig: e,
  };
}
export function addStation(kodOrObj) {
  if (!kodOrObj) return;
  if (typeof kodOrObj === "string") {
    const kod = kodOrObj;
    const src = (S.mgmDbYakin || []).find((x) => (x.kod || x.no) === kod);
    if (!src) return setStatus("thStatus", `İstasyon bulunamadı: ${kod}`, "err");
    const n = _normalizeMgmEntry(src);
    if (n.lat == null || n.lon == null) return setStatus("thStatus", "Koordinatı eksik istasyon eklenemez", "err");
    const sk = stKey(n);
    const aktif = (S.thiessen || []).filter((t) => t.agirlik > 0);
    const aktifKeys = new Set(aktif.map(stKey));
    const aktifKod = new Set(aktif.map((t) => t.kod).filter(Boolean));
    if (aktifKeys.has(sk) || (n.kod && aktifKod.has(n.kod))) return setStatus("thStatus", `${n.name} zaten Thiessen’de`, "");
    // çıkarılanlar içindeyse geri al
    if (S.stExclude.has(sk)) {
      S.stExclude.delete(sk);
      // korumalıysa da sil (tekrar korumaya gerek yok, zaten etkili)
      if (S.stKorumali) S.stKorumali.delete(sk);
      if (S.stKorumali && n.kod) S.stKorumali.delete(n.kod);
    } else {
      // stBase’de var mı? Varsa korumalıya ekle, yoksa stExtra’ya ekle
      const inBase = (S.stBase || []).some((s) => stKey(s) === sk || (n.kod && s.kod === n.kod));
      if (inBase) {
        if (!S.stKorumali) S.stKorumali = new Set();
        // stKey ve kod ikisini de korumalıya ekle (backend ikisini de kontrol ediyor)
        S.stKorumali.add(sk);
        if (n.kod) S.stKorumali.add(n.kod);
      } else {
        S.stExtra.push({ name: n.name, lat: n.lat, lon: n.lon, kurum: n.kurum, kod: n.kod });
      }
    }
    map.closePopup();
    recomputeThiessen();
    return;
  }
  // doğrudan obje (Elle)
  const st = kodOrObj;
  S.stExtra.push(st);
  map.closePopup();
  recomputeThiessen();
}
export function restoreStation(key) {
  if (!S.stExclude.has(key)) return;
  S.stExclude.delete(key);
  map.closePopup();
  recomputeThiessen();
}
export async function recomputeThiessen() {
  if (!S.stBase && !S.stExtra.length) return;
  if (_thiessenBusy) {
    _thiessenBekleyen = true; // sürün hesap bitince effectiveStations() yeniden alınarak koşacak
    return;
  }
  await runThiessen(effectiveStations(), S.stKaynak || "Güncel liste");
}
function _pinKaldir(kod, sk) {
  if (S.stKorumali) {
    if (kod) S.stKorumali.delete(kod);
    if (sk) S.stKorumali.delete(sk);
  }
  recomputeThiessen();
}
function _adaylariBul() {
  if (!S.havza || !S.mgmDbYakin || !S.mgmDbYakin.length) return [];
  // aday = mgmDbYakin içinde olup aktif Thiessen’de (agirlik>0) olmayanlar
  // efektif değil aktif bazlı: stBase’deki ama ağırlığı 0 veya elenenler de aday sayılır
  const aktif = (S.thiessen || []).filter((t) => t.agirlik > 0);
  const aktifKeys = new Set(aktif.map(stKey));
  const aktifKod = new Set(aktif.map((t) => t.kod).filter(Boolean));
  const out = [];
  for (const e of S.mgmDbYakin) {
    const n = _normalizeMgmEntry(e);
    if (n.lat == null || n.lon == null) continue;
    const sk = stKey(n);
    if (aktifKeys.has(sk) || (n.kod && aktifKod.has(n.kod))) continue;
    if (S.stExclude.has(sk)) continue; // çıkarılan hayalet ayrı
    const pinli = S.stKorumali && (S.stKorumali.has(sk) || (n.kod && S.stKorumali.has(n.kod)));
    // korumalı ama henüz aktif değil: ya hesap sürüyor ya da hücresi havzaya ulaşmadı
    // (ağırlık 0). Kaybetme — "pay düşmedi" etiketiyle listede kalsın, koruması kaldırılabilsin.
    out.push(pinli ? { ...n, _pinli: true, _stKey: sk } : n);
  }
  return out;
}
export function renderAdaylar() {
  const el = $("thAdaylar");
  const wrap = $("thAdayWrap");
  if (!el) return;
  if (!S.havza) { el.innerHTML = ""; if (wrap) wrap.style.display = "none"; return; }
  if (wrap) wrap.style.display = "";
  // mgmDbYakin henüz yoksa yüklemeyi tetikle
  if (!S.mgmDbYakin) {
    el.innerHTML = `<div class="small">Yakın istasyonlar yükleniyor…</div>`;
    mgmDbListesi().then(() => { renderAdaylar(); renderAdayMarkers(); });
    return;
  }
  const adaylar = _adaylariBul();
  if (!adaylar.length) {
    el.innerHTML = `<div class="small">Aday istasyon yok — havza çevresindeki tüm yakın istasyonlar zaten dahil.</div>`;
    return;
  }
  const merkez = _havzaMerkez();
  if (merkez) adaylar.forEach((a) => a._mesafe = _mesafeKm(merkez.lat, merkez.lon, a.lat, a.lon));
  else adaylar.forEach((a) => a._mesafe = 9999);
  adaylar.sort((a, b) => a._mesafe - b._mesafe);
  const limit = 30;
  const goster = adaylar.slice(0, limit);
  const kalan = adaylar.length - goster.length;
  const _satir = (a) => {
    const mes = a._mesafe < 9000 ? ` ${a._mesafe.toFixed(1)} km` : "";
    const yil = a.yil_sayisi ? ` · ${a.yil_sayisi} yıl` : "";
    const btn = a._pinli
      ? ` <em class="small" title="Eklendi ama Voronoi hücresi havzaya ulaşmıyor — daha yakın istasyonlar gölgeledi">ekli — pay düşmedi</em>` +
        ` <button class="link-btn" data-unpin="${_esc(a.kod)}" data-unpin-key="${_esc(a._stKey || "")}" title="Ekleme korumasını kaldır">− Çıkar</button>`
      : ` <button class="link-btn" data-add="${_esc(a.kod)}" title="Thiessen'e ekle">+ Ekle</button>`;
    return `<span class="small">${_esc(a.name)} (${_esc(a.kod)})${mes}${yil}${btn}</span>`;
  };
  let h = `<div class="small aday-baslik">${adaylar.length} aday istasyon (havza dışı, yakınlık sıralı) — haritada soluk üçgen, tıkla ekle:</div>`;
  h += goster.map(_satir).join(" · ");
  if (kalan > 0) h += `<div class="small" style="margin-top:4px"><button class="link-btn" id="btnAdayDaha" title="Kalan adayları göster">+ ${kalan} aday daha göster</button></div>`;
  el.innerHTML = h;
  el.querySelectorAll("button[data-add]").forEach((b) => b.onclick = () => addStation(b.dataset.add));
  el.querySelectorAll("button[data-unpin]").forEach((b) => (b.onclick = () => _pinKaldir(b.dataset.unpin, b.dataset.unpinKey)));
  const daha = el.querySelector("#btnAdayDaha");
  if (daha) daha.onclick = () => {
    el.innerHTML = `<div class="small aday-baslik">${adaylar.length} aday istasyon:</div>` + adaylar.map(_satir).join(" · ");
    el.querySelectorAll("button[data-add]").forEach((b) => b.onclick = () => addStation(b.dataset.add));
    el.querySelectorAll("button[data-unpin]").forEach((b) => (b.onclick = () => _pinKaldir(b.dataset.unpin, b.dataset.unpinKey)));
  };
}
export function renderAdayMarkers() {
  if (!layers.thiessenAday) return;
  layers.thiessenAday.clearLayers();
  if (!S.havza) return;
  // adaylar
  const adaylar = _adaylariBul();
  const merkez = _havzaMerkez();
  if (merkez) adaylar.forEach((a) => a._mesafe = _mesafeKm(merkez.lat, merkez.lon, a.lat, a.lon));
  adaylar.sort((a, b) => (a._mesafe ?? 9999) - (b._mesafe ?? 9999));
  // haritada çok kalabalık olmasın: en yakın 60 aday göster
  adaylar.slice(0, 60).forEach((a) => {
    const mk = L.marker([a.lat, a.lon], { icon: mgmTriangleIcon({ inside: false, candidate: true }) }).addTo(layers.thiessenAday);
    const mes = a._mesafe != null ? ` · ${a._mesafe.toFixed(1)} km` : "";
    mk.bindTooltip(`${_esc(a.name)} (${_esc(a.kod)}) — aday${mes}`, STATION_TOOLTIP_MGM);
    mk.bindPopup(`${_esc(a.name)} (${_esc(a.kod)})${mes ? "<br>" + mes : ""}<br><button class="link-btn" data-add-pop="${_esc(a.kod)}">+ Thiessen’e ekle</button>`);
    mk.on("popupopen", (ev) => {
      const btn = ev.popup.getElement().querySelector("button[data-add-pop]");
      if (btn) btn.onclick = () => addStation(btn.dataset.addPop);
    });
  });
  // çıkarılan hayaletler
  const cikarilan = (S.stBase || []).filter((s) => S.stExclude.has(stKey(s)));
  cikarilan.forEach((s) => {
    const mk = L.marker([s.lat, s.lon], { icon: mgmTriangleIcon({ inside: false, excluded: true }) }).addTo(layers.thiessenAday);
    mk.bindTooltip(`${_esc(s.name)} — çıkarıldı (tıkla geri al)`, STATION_TOOLTIP_MGM);
    const k = stKey(s);
    mk.bindPopup(`${_esc(s.name)} — çıkarıldı<br><button class="link-btn" data-restore="${_esc(k)}">↺ Geri al</button>`);
    mk.on("popupopen", (ev) => {
      const btn = ev.popup.getElement().querySelector("button[data-restore]");
      if (btn) btn.onclick = () => restoreStation(btn.dataset.restore);
    });
  });
}
export function renderExcluded() {
  const el = $("thExcluded");
  if (!el) return;
  const list = (S.stBase || []).filter((s) => S.stExclude.has(stKey(s)));
  const elenen = S.thElenen || [];
  if (!list.length && !S.stExtra.length && !elenen.length) {
    el.innerHTML = "";
    return;
  }
  let h = "";
  if (elenen.length)
    h +=
      `<div class="small"><b>Küçük pay eşiğinin altında elenenler:</b> ` +
      elenen.map((x) => `${_esc(x.name)} (%${(x.agirlik * 100).toFixed(1)})`).join(", ") +
      ` — alanları komşu istasyonlara dağıtıldı.</div>`;
  if (S.stExtra.length)
    h +=
      `<div class="small"><b>Elle eklenenler:</b> ` +
      S.stExtra.map((s, i) => `${_esc(s.name)} <button class="link-btn" data-x="${i}" title="Kaldır">✕</button>`).join(", ") +
      `</div>`;
  if (list.length)
    h +=
      `<div class="small"><b>Çıkarılanlar:</b> ` +
      list.map((s) => `${_esc(s.name)} <button class="link-btn" data-r="${_esc(stKey(s))}" title="Geri al">↺</button>`).join(", ") +
      `</div>`;
  if (S.stExclude.size)
    h += `<div style="margin-top:6px"><button id="btnResetStations" class="small-btn">↺ Çıkarılanları geri al</button></div>`;
  el.innerHTML = h;
  el.querySelectorAll("button[data-r]").forEach(
    (b) =>
      (b.onclick = () => {
        S.stExclude.delete(b.dataset.r);
        recomputeThiessen();
      }),
  );
  el.querySelectorAll("button[data-x]").forEach(
    (b) =>
      (b.onclick = () => {
        S.stExtra.splice(+b.dataset.x, 1);
        recomputeThiessen();
      }),
  );
  const rb = el.querySelector("#btnResetStations");
  if (rb)
    rb.onclick = () => {
      S.stExclude = new Set();
      recomputeThiessen();
    };
}
export async function runThiessen(stations, kaynak) {
  if (!S.havza) return setStatus("thStatus", "Önce havzayı çıkarın (Adım 1)", "err");
  if (_thiessenBusy) return;
  // son istasyon koruması: effectiveStations() zaten filtrelenmiş, ama kullanıcı son-1’i çıkarmaya çalışırsa engelle
  if (stations.length <= 0) return setStatus("thStatus", "En az 1 istasyon kalmalı", "err");
  if (stations.length === 1 && S.stExclude.size) {
    // tek istasyon kaldıysa ve bu çağrı bir çıkarma sonrasıysa uyar (removeStation zaten engeller ama direkt çağrı için)
  }
  _thiessenBusy = true;
  setStatus("thStatus", "Thiessen hesaplanıyor…", "loading");
  // aday katmanını temizle (yeniden çizilecek)
  try { layers.thiessenAday.clearLayers(); } catch (e) {}
  try {
    S.istasyonlar = stations;
    S.stKaynak = kaynak;
    if (!S.stBase) S.stBase = stations; // doğrudan çağrılırsa temel liste bu olsun
    const minW = Math.max(0, (+$("inpMinW").value || 0) / 100);
    const korumaliRaw = []
      .concat((S.stExtra || []).map((s) => s.kod).filter(Boolean))
      .concat((S.stExtra || []).map((s) => stKey(s)))
      .concat([...(S.stKorumali || [])]);
    const kSet = [...new Set(korumaliRaw.filter(Boolean))];
    const r2 = await api("/api/thiessen", { havza_geojson: S.havza, istasyonlar: S.istasyonlar, min_agirlik: minW, korumali: kSet });
    S.thiessen = r2.sonuc;
    S.thElenen = r2.elenen || [];
    layers.thiessen.clearLayers();
    layers.markers.clearLayers();
    if (S.outlet) L.marker([S.outlet.snap_lat, S.outlet.snap_lon]).addTo(layers.markers).bindPopup("Outlet");
    const aktif = S.thiessen.filter((t) => t.agirlik > 0);
    let h = `<div class="th-legend">
      <span><i class="mgm-tri"></i> MGM</span>
      <span><i class="elle-dot"></i> Elle eklenen</span></div>
      <table class="tbl"><tr><th>İstasyon</th><th>Kurum</th><th>Ağırlık</th><th>Alan (km²)</th><th></th></tr>`;
    aktif.forEach((t) => {
      if (t.poligon_geojson)
        layers.thiessen.addData({ type: "Feature", properties: { name: t.name }, geometry: t.poligon_geojson });
      const isElle = t.kurum === "Elle";
      const mk = isElle
        ? elleCircleMarker([t.lat, t.lon]).addTo(layers.markers)
        : L.marker([t.lat, t.lon], { icon: mgmTriangleIcon({ inside: true }) }).addTo(layers.markers);
      mk.bindTooltip(
        `${_esc(t.name)}${t.kurum ? " [" + _esc(t.kurum) + "]" : ""} (w=${(t.agirlik * 100).toFixed(1)}%)`,
        isElle ? STATION_TOOLTIP_ELLE : STATION_TOOLTIP_MGM,
      );
      mk.bindPopup(
        `${_esc(t.name)}${t.kurum ? " [" + _esc(t.kurum) + "]" : ""} (w=${(t.agirlik * 100).toFixed(1)}%)` +
          `<br><button class="link-btn" data-pop-del="1">✕ Bu istasyonu çıkar</button>`,
      );
      const key = stKey(t);
      // hover → pop-up (✕ çıkar butonu); fare çekilince gecikmeli kapan, pop-up üzerinde kalınırsa açık tut
      let popTimer = null;
      const _popIptal = () => clearTimeout(popTimer);
      mk.on("mouseover", () => {
        _popIptal();
        mk.openPopup();
      });
      mk.on("mouseout", () => {
        popTimer = setTimeout(() => mk.closePopup(), 300);
      });
      mk.on("popupopen", (ev) => {
        const el = ev.popup.getElement();
        el.addEventListener("mouseenter", _popIptal);
        el.addEventListener("mouseleave", () => {
          popTimer = setTimeout(() => mk.closePopup(), 200);
        });
        const btn = el.querySelector("button[data-pop-del]");
        if (btn) btn.onclick = () => removeStation(key);
      });
      h +=
        `<tr class="sel"><td>${_esc(t.name)}</td><td>${_esc(t.kurum || "—")}</td><td>${(t.agirlik * 100).toFixed(1)}%</td><td>${t.alan_km2}</td>` +
        `<td><button class="link-btn" data-del="${_esc(stKey(t))}" title="Bu istasyonu çıkar">✕</button></td></tr>`;
    });
    $("thTable").innerHTML = h + "</table>";
    $("thTable")
      .querySelectorAll("button[data-del]")
      .forEach((b) => (b.onclick = () => removeStation(b.dataset.del)));
    renderExcluded();
    renderAdaylar();
    renderAdayMarkers();
    recolorThiessen();
    const nEk = S.stExtra.length,
      nCik = S.stExclude.size,
      nEle = (S.thElenen || []).length;
    // elle eklenen/pinlenen ama havzada pay almayan (ağırlık 0) istasyonlar —
    // poligonun değişmemesinin açıklaması
    const manuelAnahtar = new Set(
      [
        ...(S.stExtra || []).map(stKey),
        ...(S.stExtra || []).map((s) => s.kod).filter(Boolean),
        ...(S.stKorumali || []),
      ]
        .filter(Boolean)
        .map(String),
    );
    const nPayYok = (S.thiessen || []).filter(
      (t) => t.agirlik <= 0 && ((t.kod && manuelAnahtar.has(String(t.kod))) || manuelAnahtar.has(stKey(t))),
    ).length;
    setStatus(
      "thStatus",
      `${kaynak}: ${stations.length} istasyondan ${aktif.length} tanesi havzada pay alıyor` +
        (nCik ? ` | ${nCik} elle çıkarıldı` : "") +
        (nEk ? ` | ${nEk} elle eklendi` : "") +
        (nEle ? ` | ${nEle} istasyon küçük pay eşiğinin altında kaldığı için elendi` : "") +
        (nPayYok
          ? ` | ${nPayYok} eklenen istasyona havzada pay düşmedi (daha yakın istasyonlar gölgeledi — adaylar listesinde işaretli)`
          : ""),
      "ok",
    );
    // birleşik adımda done yalnızca ağırlıklı yağış hazır olunca yanar (recalcRain → markDone(3))
    renderRainTable();
  } catch (e) {
    setStatus("thStatus", "Hata: " + e.message, "err");
  } finally {
    _thiessenBusy = false;
    if (_thiessenBekleyen) {
      // hesap sürerken gelen ekle/çıkar bekliyordu — güncel listeyle bir kez daha koş
      _thiessenBekleyen = false;
      recomputeThiessen();
    }
  }
}
export function removeStation(key) {
  // son istasyon koruması
  const eff = effectiveStations();
  if (eff.length <= 1) {
    const tekKey = eff.length === 1 ? stKey(eff[0]) : null;
    if (tekKey && tekKey === key) return setStatus("thStatus", "En az 1 istasyon kalmalı — son istasyon çıkarılamaz", "err");
    if (eff.length <= 1) return setStatus("thStatus", "En az 1 istasyon kalmalı", "err");
  }
  S.stExclude.add(key);
  const i = S.stExtra.findIndex((s) => stKey(s) === key);
  if (i >= 0) S.stExtra.splice(i, 1); // elle eklenmişse listeden sil
  // korumalı stBase için silme yok: çıkarılan hayalet olarak kalır, geri alınırsa koruması sürer
  map.closePopup();
  recomputeThiessen();
}
export async function useDefaultStations() {
  setStatus("thStatus", "MGM istasyonları yükleniyor…", "loading");
  try {
    const r = await api("/api/stations/default");
    if (!r.istasyonlar.length)
      return setStatus("thStatus", "İstasyon kümesi boş (python tools/mgm_veritabani_olustur.py)", "err");
    await loadStationSet(
      r.istasyonlar,
      `MGM ölçüm ağı — ${r.istasyonlar.length} istasyon (≥${r.en_az_yil} yıl yağış ölçümü)`,
    );
  } catch (e) {
    setStatus("thStatus", "Hata: " + e.message, "err");
  }
}
const _btnDef = $("btnDefaultSt");
if (_btnDef) _btnDef.onclick = useDefaultStations;

// Thiessen self-wiring
$("inpMinW")?.addEventListener("change", () => {
  if (S.thiessen && S.thiessen.length) recomputeThiessen();
});
