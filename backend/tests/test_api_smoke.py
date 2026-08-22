# -*- coding: utf-8 -*-
"""API duman testi (delineation hariç — o ayrı, DEM indirmesi gerektirir)."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from fastapi.testclient import TestClient  # noqa: E402
from backend.main import app  # noqa: E402
from backend.core import tables  # noqa: E402

c = TestClient(app)

# --- dplv listesi
r = c.get("/api/dplv")
assert r.status_code == 200 and len(r.json()["stations"]) >= 3
print("dplv OK")

# --- yağış çözümleme
txt = "BİNKILIÇ\t79,57\t112,56\t138,43\t176,18\t208,20\t243,86\t452,6\nTERKOS 59.67 90.60 112.70 142.27 165.33 189.27 342.34"
r = c.post("/api/rainfall/parse", json={"metin": txt})
rows = r.json()["satirlar"]
assert len(rows) == 2 and abs(rows[0]["P24"][0] - 79.57) < 1e-9 and rows[1]["OET"] == 342.34
print("rainfall parse OK:", rows[0]["ad"], rows[1]["ad"])

# --- thiessen (sentetik havza + 3 istasyon)
basin = {"type": "Polygon", "coordinates": [[
    [28.5, 41.2], [28.7, 41.2], [28.7, 41.35], [28.5, 41.35], [28.5, 41.2]]]}
stations = [
    {"name": "IST-BATI", "lat": 41.28, "lon": 28.52},
    {"name": "IST-DOGU", "lat": 41.28, "lon": 28.68},
    {"name": "IST-UZAK", "lat": 40.5, "lon": 29.5},
]
r = c.post("/api/thiessen", json={"havza_geojson": basin, "istasyonlar": stations})
w = r.json()["sonuc"]
assert abs(sum(x["agirlik"] for x in w) - 1.0) < 0.01, w
assert w[2]["agirlik"] < 0.05, "uzak istasyon ~0 olmalı"
print("thiessen OK:", [(x["name"], x["agirlik"]) for x in w])

# --- compute (Tayakadın golden girdisi API üzerinden)
G = json.load(open(os.path.join(tables.TABLES, "golden_tayakadin.json"), encoding="utf-8"))
gi = G["girdi"]
p24 = gi["P24_agirlikli"]
dplv = next(s for s in tables.load("dplv_stations")["stations"] if s["name"] == "ÇORLU")
girdi = {
    "ad": gi["ad"], "A_km2": gi["A_km2"], "L_km": gi["L_km"], "Lc_km": gi["Lc_km"],
    "CN2": gi["CN2"], "CN3": gi["CN3"], "region": gi["bolge"],
    "elevations": gi["kotlar"], "Qbaz": gi["Qbaz"],
    "P24": {"2": p24[0], "5": p24[1], "10": p24[2], "25": p24[3], "50": p24[4], "100": p24[5]},
    "P24_OET": p24[6], "dplv_ratios": dplv["ratios"],
}
r = c.post("/api/compute", json={"girdi": girdi})
res = r.json()
assert "hata" not in res, res.get("hata")
want = G["beklenen"]["kabulet_pik"]["matris"]["Q100"][2]  # 6 saat Q100
got = res["kabulet"]["6"]["100"]
assert abs(got - want) < 1e-9, (got, want)
print(f"compute OK: Q100(6sa)={got:.3f} (excel={want:.3f})")

# --- yıl ara
r = c.post("/api/yil-ara", json={"q": 42.236, "q10": res["kabulet"]["6"]["10"],
                                 "q100": res["kabulet"]["6"]["100"]})
print("yil-ara OK: T =", round(r.json()["tekerrur_yili"], 1), "yıl")

# --- kar erimesi
kar = {"daily_tmax": [19.7, 18.8, 17.1, 12.6, 11.1, 9.5, 10.2, 11.1, 14.7, 12.6,
                      10.8, 11.3, 13.6, 10.7, 11.6],
       "a_kar_km2": 189.2, "h_kar_m": 1488, "h_ist_m": 799, "melt_rate": 1.08, "period": 15}
r = c.post("/api/compute", json={"girdi": girdi, "kar": kar})
res2 = r.json()
assert "kar" in res2 and res2["kar"]["Qkar_pik"] > 0
print("kar OK: Qkar_pik =", res2["kar"]["Qkar_pik"], "m³/s, dT =", res2["kar"]["dT"])

# --- rasyonel
girdi2 = dict(girdi); girdi2["A_km2"] = 0.8
r = c.post("/api/compute", json={"girdi": girdi2, "rasyonel": True, "c100": 0.45})
res3 = r.json()
assert "rasyonel" in res3 and res3["rasyonel"]["Q"]["100"] > 0
print("rasyonel OK: Q100 =", round(res3["rasyonel"]["Q"]["100"], 2), "m³/s")

# --- proje kayıt/yükleme
r = c.post("/api/project/save", json={"ad": "duman_testi", "durum": {"x": 1}})
assert r.json()["tamam"]
r = c.get("/api/project/load/duman_testi")
assert r.json()["x"] == 1
print("proje kayıt OK")

# --- AGİ veri tabanı + noktasal frekans analizi (kurulu değilse atlanır)
b = c.get("/api/agi-bilgi").json()
if not b.get("var"):
    print("AGİ atlandı: veri tabanı yok "
          "(tools/agi_veritabani_olustur.py ile üretilir)")
else:
    r = c.get("/api/agi", params={"bati": 32.0, "guney": 39.0, "dogu": 36.0,
                                  "kuzey": 41.0, "en_az_yil": 20}).json()
    assert r["istasyonlar"], "pencerede AGİ bulunamadı"
    kod = r["istasyonlar"][0]["kod"]
    o = c.post("/api/tfa", json={"kod": kod}).json()
    assert o["kabul_edilen"] in ("normal", "ln2", "ln3", "p3", "lp3", "gumbel")
    assert len(o["tekerrur"]) == 10 and len(o["debiler"]) == 6
    print(f"AGİ/NTFA OK: {b['istasyon']} istasyon, pencerede "
          f"{len(r['istasyonlar'])} — {kod} kabul edilen: {o['kabul_edilen_adi']}")

    kodlar = [s["kod"] for s in r["istasyonlar"] if s["yagis_alani"]][:8]
    if len(kodlar) >= 2:
        bt = c.post("/api/btfa", json={"kodlar": kodlar, "alan_km2": 115.0}).json()
        assert bt["kullanilan_sayisi"] >= 2, bt.get("hata")
        assert len(bt["buyume_egrisi"]) == 6 and bt["buyume_egrisi"][0] == 1.0
        assert len(bt["btfa"]["q"]) == 9 and bt["btfa"]["q"][0] > 0
        print(f"BTFA OK: {bt['kullanilan_sayisi']} istasyon, "
              f"Q2 = {bt['q2_indeks']:.1f}, Q100 = {bt['btfa']['q'][5]:.1f} m³/s")

# --- yıllık yağış katmanı (kurulu değilse atlanır)
yb = c.get("/api/yagis-bilgi").json()
if not yb.get("var"):
    print("Yağış katmanı atlandı: veri yok "
          "(tools/yagis_haritasi_indir.py ile indirilir)")
else:
    # bilinen normallere yakın mı — katman yanlış yere oturursa burada patlar
    for lat, lon, ad, alt, ust in ((41.02, 40.52, "Rize", 1800, 2800),
                                   (37.87, 32.49, "Konya", 250, 500),
                                   (39.92, 32.85, "Ankara", 300, 550)):
        n = c.get("/api/yagis-nokta", params={"lat": lat, "lon": lon}).json()
        assert alt <= n["yagis"] <= ust, f"{ad}: {n['yagis']} mm beklenen {alt}-{ust} dışında"
        # su bütçesi tutarlı olmalı: 0 <= net <= P ve PET pozitif
        if n.get("net") is not None:
            assert 0 <= n["net"] <= n["yagis"] + 1, f"{ad}: net={n['net']} > P={n['yagis']}"
        if n.get("pet") is not None:
            assert 300 < n["pet"] < 2500, f"{ad}: PET={n['pet']} mantıksız"
    for k in [x["anahtar"] for x in yb["katmanlar"]]:
        t = c.get(f"/api/yagis/{k}/8/148/97.png")
        assert t.status_code in (200, 204), f"{k} karosu {t.status_code}"
        if t.status_code == 200:
            assert t.content[:8] == b"\x89PNG\r\n\x1a\n", f"{k} karosu PNG değil"
    geo = {"type": "Polygon", "coordinates": [[[29.9, 40.5], [30.4, 40.5],
                                               [30.4, 40.9], [29.9, 40.9], [29.9, 40.5]]]}
    hv = c.post("/api/yagis-havza", json={"geometri": geo}).json()
    assert hv["yagis"]["piksel"] > 100, hv.get("hata")
    assert 200 < hv["yagis"]["ortalama_mm"] < 3000
    if "turetilmis" in hv:
        assert 0 < hv["turetilmis"]["akis_katsayisi"] < 1
    print(f"İklim katmanları OK: {len(yb['katmanlar'])} katman, "
          f"örnek havza P={hv['yagis']['ortalama_mm']:.0f}"
          + (f", net={hv['net']['ortalama_mm']:.0f} mm/yıl" if "net" in hv else ""))

# --- su potansiyeli (kurulu değilse atlanır)
sb = c.get("/api/su-bilgi").json()
if not sb.get("var"):
    print("Su potansiyeli atlandı: veri tabanı yok "
          "(tools/su_veritabani_olustur.py ile üretilir)")
else:
    r = c.get("/api/su-istasyon", params={"bati": 27.5, "guney": 40.5, "dogu": 30.5,
                                          "kuzey": 41.8, "en_az_yil": 20}).json()
    assert r["istasyonlar"], "pencerede günlük akım istasyonu yok"
    o = c.post("/api/su", json={"kod": r["istasyonlar"][0]["kod"],
                                "talep_ls": 250}).json()
    assert o["q_ort"] > 0 and o["yillik_hacim_hm3"] > 0, o.get("hata")
    assert len(o["aylik"]) == 12 and o["aylik"][0]["ad"] == "Ekim"
    assert 0 <= o["temin"]["guvenilirlik_yuzde"] <= 100
    print(f"Su potansiyeli OK: {sb['istasyon']} istasyon, "
          f"{o['istasyon']['kod']} Qort = {o['q_ort']:.2f} m³/s, "
          f"{o['yillik_hacim_hm3']:.0f} hm³/yıl")

    # havza akışı: poligondan AGİ -> periyot tablosu -> regresyonla tamamlama
    geo = {"type": "Polygon", "coordinates": [[[30.0, 40.6], [30.4, 40.6],
                                               [30.4, 40.9], [30.0, 40.9], [30.0, 40.6]]]}
    hv = c.post("/api/su-havza", json={"geometri": geo, "tampon_derece": 0.35,
                                       "en_az_yil": 20}).json()
    kod = [s["kod"] for s in hv["istasyonlar"] if s["alan_km2"]][:5]
    assert len(kod) >= 2, "havza çevresinde alanı bilinen istasyon yok"
    pr = c.post("/api/su-periyot", json={"kodlar": kod, "ilk_yil": 1975,
                                         "son_yil": 2005}).json()
    assert len(pr["tablo"]["yillar"]) == 31
    assert all(set(y["durum"] for y in s["yillar"]) <= {"tam", "eksik", "yok"}
               for s in pr["tablo"]["istasyonlar"])
    tm = c.post("/api/su-tamamla", json={"hedef": kod[0], "vericiler": kod,
                                         "ilk_yil": 1975, "son_yil": 2005,
                                         "havza_alani_km2": 115.0}).json()
    assert len(tm["seri"]) == 31 and tm["gozlem"] > 0, tm.get("hata")
    assert tm["outlet"]["q_ort"] > 0
    print(f"Su havza akışı OK: {len(hv['istasyonlar'])} AGİ, {kod[0]} → "
          f"{tm['gozlem']} gözlem + {tm['dolduruldu']} dolduruldu, "
          f"havza çıkışı {tm['outlet']['q_ort']:.3f} m³/s")

# --- MGM meteoroloji veri tabanı + yağış frekans analizi
b = c.get("/api/mgm-bilgi").json()
if not b.get("var"):
    print("MGM atlandı: veri tabanı yok "
          "(python tools/mgm_veritabani_olustur.py)")
else:
    r = c.get("/api/mgm", params={"bati": 27.0, "guney": 40.5, "dogu": 28.5,
                                  "kuzey": 41.5, "en_az_yil": 20}).json()
    assert r["istasyonlar"], "pencerede MGM istasyonu bulunamadı"
    kod = r["istasyonlar"][0]["kod"]
    f = c.post("/api/mgm-frekans", json={"kod": kod}).json()
    assert f["birim"] == "mm" and f["kabul_edilen"], f.get("hata")
    p = f["P24"]
    assert set(p) == {"2", "5", "10", "25", "50", "100"}
    # tekerrür arttıkça yağış artmalı — dağılım uydurması bozuksa burada patlar
    art = [p[k] for k in ("2", "5", "10", "25", "50", "100")]
    assert art == sorted(art), f"P24 tekerrürle artmıyor: {p}"

    # Thiessen satırlarından eşleştirme: koordinat önce, kısa seri yeğlenmez
    es = c.post("/api/mgm-eslestir", json={"istasyonlar": [
        {"ad": "Çorlu", "lat": 41.1667, "lon": 27.7833},
        {"ad": "LÜLEBURGAZ", "lat": None, "lon": None},
    ]}).json()["eslesme"]
    assert es[0]["yontem"] == "koordinat" and es[0]["eslesen"]["ad"] == "ÇORLU"
    assert es[1]["yontem"] == "ad", "koordinatsız satır adla eşleşmeliydi"
    assert es[0]["frekans"]["P24"]["100"] > es[0]["frekans"]["P24"]["2"]
    assert es[0]["frekans"]["yil_sayisi"] >= 25

    # Eski MGM 2020 tablosu ARTIK P24 VERMEMELİ — P2…P100'ün tek kaynağı ölçüm
    # veritabanıdır; hazır tekerrür tablosu yalnız plüviyograf oranları için
    # duruyor. İki kaynak paralel dururken hangisinin kullanıldığı belirsizdi.
    eski = c.get("/api/mgm-stations").json()["istasyonlar"]
    assert eski and "plv" in eski[0], "PLV oranları kayboldu"
    assert "P24" not in eski[0], "eski tablo hâlâ P24 döndürüyor"

    # Adım 3'ün varsayılan kümesi YALNIZ ölçüm veri tabanıdır. Her istasyonun
    # kendi yağış serisi olmalı — kümede ölçümsüz istasyon bulunması, bir
    # Thiessen hücresinin başka istasyonun yağışını taşıması demektir.
    d = c.get("/api/stations/default").json()
    sts = d["istasyonlar"]
    assert d["kaynak"] == "mgm", f"varsayılan küme MGM dışı: {d.get('kaynak')}"
    assert len(sts) > 1000, f"küme küçük: {len(sts)}"
    assert all(s.get("kod") for s in sts), "kümede kodsuz (ölçümsüz) istasyon var"
    assert all(s["yil_sayisi"] >= d["en_az_yil"] for s in sts)
    assert all(s.get("lat") is not None and s.get("lon") is not None for s in sts)

    # Varsayılan kümeden gelen istasyon Adım 4'te KİMLİKLE eşleşmeli
    kodlu = next(s for s in sts if s["yil_sayisi"] >= 25)
    e2 = c.post("/api/mgm-eslestir", json={"istasyonlar": [
        {"ad": kodlu["name"], "lat": kodlu["lat"], "lon": kodlu["lon"],
         "kod": kodlu["kod"]}]}).json()["eslesme"]
    assert e2[0]["yontem"] == "kod" and e2[0]["mesafe_km"] == 0.0
    # Elle yüklenen KMZ / haritaya konan nokta (kodsuz) koordinatla bağlanır
    e3 = c.post("/api/mgm-eslestir", json={"istasyonlar": [
        {"ad": "Elle konan nokta", "lat": 41.05, "lon": 27.80,
         "kod": None}]}).json()["eslesme"]
    assert e3[0]["yontem"] in ("koordinat", "koordinat-kısa"), e3[0]["yontem"]

    print(f"Thiessen kümesi OK: {len(sts)} istasyon, hepsi ≥{d['en_az_yil']} yıl "
          f"kendi ölçümüyle")
    print(f"MGM/yağış frekansı OK: {b['istasyon']} istasyon, "
          f"{b['frekansa_uygun']} frekansa uygun, {kod} → "
          f"P2={p['2']} P100={p['100']} mm ({f['kabul_edilen_adi']}, "
          f"{f['parametreler']['yil_sayisi']} yıl)")

# --- Hidrolojik zemin grubu havzadan belirlenmeli, varsayılana düşmemeli.
# Bu parametre Q100'ü kat kat değiştiriyor; sessiz bir varsayılan, sonucu
# kimsenin sormadığı bir seçimin belirlemesi demekti.
z = c.post("/api/zemin-grubu", json={"havza_geojson": {
    "type": "Polygon", "coordinates": [[[41.4, 39.8], [42.2, 39.8],
                                        [42.2, 40.3], [41.4, 40.3], [41.4, 39.8]]]}}).json()
if not z.get("var"):
    print("Zemin grubu atlandı: katman yok (python tools/zemin_grubu_uret.py)")
else:
    assert z["grup"] in ("A", "B", "C", "D"), z
    assert abs(sum(z["dagilim"].values()) - 100.0) < 0.5, z["dagilim"]
    assert z["dagilim"][z["grup"]] == z["pay_yuzde"]
    assert z["piksel"] > 0 and z["uyari"], "gerekçe/uyarı boş dönmemeli"
    print(f"Zemin grubu OK: {z['grup']} (%{z['pay_yuzde']}), "
          f"{z['piksel']} piksel, Ksat {z['ksat_araligi_mm_sa']} mm/sa")

print("\nTÜM API DUMAN TESTLERİ GEÇTİ")

# --- Bozuk pik kayıtları NTFA'ya girmemeli.
# D24A029'un 1981 kaydı 9500 m³/s yazıyor (diğer 29 yıl 68-1033 arası) ve
# Q100'ü 1301'den 7314 m³/s'ye çıkarıyordu. Aynı yıl mansaptaki daha büyük
# havzalı istasyon 389 m³/s ölçmüş — su yok olmaz, değer yanlıştır.
if b.get("var"):
    t1 = c.post("/api/tfa", json={"kod": "D24A029"}).json()
    t0 = c.post("/api/tfa", json={"kod": "D24A029", "olanaksizi_at": False}).json()
    if "hata" not in t1:
        el = t1.get("elenen_kayitlar") or []
        assert el and el[0]["yil"] == 1981, f"bozuk 1981 kaydı elenmedi: {el}"
        assert el[0]["sebep"], "eleme sebebi boş dönmemeli"
        q1 = t1["kabul_edilen_q"][t1["tekerrur"].index(100)]
        q0 = t0["kabul_edilen_q"][t0["tekerrur"].index(100)]
        assert q1 < q0 / 3, f"eleme Q100'ü düşürmedi: {q0:.0f} -> {q1:.0f}"
        print(f"Bozuk kayıt elemesi OK: D24A029 Q100 {q0:.0f} -> {q1:.0f} m³/s "
              f"({len(el)} kayıt elendi)")

# --- Grubbs-Beck aykırı testi (Bulletin 17B) + aykırısız karşılaştırma
if b.get("var"):
    ay = c.post("/api/tfa", json={"kod": "D24A029", "aykiri_disla": True}).json()
    if "hata" not in ay:
        a = ay["aykiri"]
        assert a["uygulanabilir"] and a["n"] >= 10
        assert a["alt_sinir"] < a["ust_sinir"], a
        # sınırlar dışındaki her değer listelenmiş olmalı
        icerik = set(a["yuksek"]) | set(a["dusuk"])
        for k in ay["veri"]:
            v = k["x"]
            if v > a["ust_sinir"] or 0 < v < a["alt_sinir"]:
                assert v in icerik, f"{v} sınır dışında ama aykırı listesinde yok"
            else:
                assert v not in icerik, f"{v} sınır içinde ama aykırı sayılmış"
        # aykırısız koşu ya sonuç ya gerekçe döndürmeli, sessiz kalmamalı
        assert ("aykirisiz" in ay) or ("aykirisiz_hata" in ay)
        if "aykirisiz" in ay:
            assert ay["aykirisiz"]["parametreler"]["yil_sayisi"] < a["n"]
            # asıl sonuç DEĞİŞMEMELİ — aykırı atmak varsayılan davranış değil
            assert ay["parametreler"]["yil_sayisi"] == a["n"]
        print(f"Aykırı testi OK: Kn={a['kn']}, yüksek={len(a['yuksek'])}, "
              f"düşük={len(a['dusuk'])}, aykırısız="
              + (f"{ay['aykirisiz']['parametreler']['yil_sayisi']} yıl"
                 if "aykirisiz" in ay else "yetersiz seri"))
