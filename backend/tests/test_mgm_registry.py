# -*- coding: utf-8 -*-
"""MGM kanonik istasyon kayıt defteri davranış testi."""
import hashlib
import json
import os
import sys
from copy import deepcopy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from backend.core import mgm  # noqa: E402
from tools import mgm_veritabani_olustur as dogrulayici  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
KANONIK = os.path.join(ROOT, "data", "mgm", "mgm-istasyonlari.json")
ARSIV = os.path.join(ROOT, "data", "mgm", "archive", "mgm-legacy-2026-08-31.sqlite")


def sha256(yol):
    with open(yol, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


assert sha256(KANONIK) == "b2292f030e4b085a8c8a1912397b6295c5fe2cc308006bd4e8fac37270130525"
assert sha256(ARSIV) == "47c2dbd6d97d139e5c8b9d3b7ed533632fe35360ecc7a203df3a1377e02589c5"
assert mgm.var_mi()

with open(KANONIK, encoding="utf-8") as f:
    ham = json.load(f)
rapor, hatalar = dogrulayici.dogrula(ham)
assert not hatalar and rapor["tekrar_gruplari"] == {
    "ad": 2, "normalize_ad": 18, "koordinat": 7}
assert rapor["yagisli_tekrar_gruplari"] == {
    "ad": 0, "normalize_ad": 0, "koordinat": 0}
bozuk = deepcopy(ham)
bozuk["Adana"][0].pop("istAd")
bozuk["Adana"][1]["istNo"] = bozuk["Adana"][2]["istNo"]
bozuk["Adana"][3]["YagisSensor"] = 2
_, hatalar = dogrulayici.dogrula(bozuk)
assert any("alanlar uyuşmuyor" in h for h in hatalar)
assert any("Tekrarlanan istNo" in h for h in hatalar)
assert any("YagisSensor" in h for h in hatalar)
bozuk = deepcopy(ham)
bozuk["Adana"][0].pop("YagisSensor")
_, hatalar = dogrulayici.dogrula(bozuk)
assert any("beklenen dört kayıtla uyuşmuyor" in h for h in hatalar)

bilgi = mgm.bilgi()
assert bilgi["dosya"] == "mgm-istasyonlari.json"
assert bilgi["tur"] == "json-kayit-defteri" and bilgi["bayt"] == 960649
assert bilgi["istasyon"] == 1913 and bilgi["il"] == 81
assert bilgi["yagis_sensorlu"] == 370
assert bilgi["null"]["indikator"] == 1470
assert bilgi["null"]["yagis_sensor"] == bilgi["null"]["kar_sensor"] == 4
assert bilgi["plv"]["toplam"] == 236
assert bilgi["plv"]["eslesen"] == 215
assert bilgi["plv"]["belirsiz"] == 17
assert bilgi["plv"]["cozulemeyen"] == 4

hepsi = mgm.pencere((25, 35, 46, 43))
assert len(hepsi) == 1913
assert len(hepsi[0]) == 24  # 19 Türkçe alan + kod/ad/lat/lon/kot
assert all(isinstance(s["kod"], str) for s in hepsi)
assert any(s["indikator"] is None for s in hepsi), "null değerler korunmalı"
assert mgm.istasyon(str(hepsi[0]["kod"])) == hepsi[0]

varsayilan = mgm.thiessen_kumesi()
assert len(varsayilan) == 370
assert all(s["yagis_sensor"] == 1 and s["name"] == s["ad"] for s in varsayilan)

plv = mgm.plv_en_yakin(lat=39.9, lon=32.8)
assert plv["kod"] in {s["kod"] for s in hepsi}
assert len(plv["plv"]) == 14 and plv["mesafe_km"] >= 0

print("MGM kayıt defteri OK: 1913 istasyon, 370 yağış sensörlü")
print("PLV eşleştirme OK: 215 eşleşen, 17 belirsiz, 4 çözülemeyen")