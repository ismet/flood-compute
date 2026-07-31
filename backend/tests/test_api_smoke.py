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

print("\nTÜM API DUMAN TESTLERİ GEÇTİ")
