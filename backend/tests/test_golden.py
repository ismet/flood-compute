# -*- coding: utf-8 -*-
"""Tayakadın Deresi golden testi — motor çıktıları Excel ile karşılaştırılır."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from backend.core import engine, tables  # noqa: E402

G = json.load(open(os.path.join(tables.TABLES, "golden_tayakadin.json"), encoding="utf-8"))

# ÇORLU DPLV istasyonu (Excel O21=2)
dplv = next(s for s in tables.load("dplv_stations")["stations"] if s["name"] == "ÇORLU")

gi = G["girdi"]
p24 = gi["P24_agirlikli"]
inp = {
    "ad": gi["ad"],
    "A_km2": gi["A_km2"], "L_km": gi["L_km"], "Lc_km": gi["Lc_km"],
    "CN2": gi["CN2"], "CN3": gi["CN3"], "region": gi["bolge"],
    "elevations": gi["kotlar"], "Qbaz": gi["Qbaz"],
    "P24": {2: p24[0], 5: p24[1], 10: p24[2], 25: p24[3], 50: p24[4], 100: p24[5]},
    "P24_OET": p24[6],
    "dplv_ratios": dplv["ratios"],
}

res = engine.compute(inp)
exp = G["beklenen"]
fails = []


def check(name, got, want, tol=1e-6):
    if want is None:
        return
    err = abs(got - want) / max(abs(want), 1e-12)
    status = "OK " if err <= tol else "FAIL"
    if err > tol:
        fails.append(name)
    print(f"{status} {name:38s} hesap={got:14.6f} excel={want:14.6f} hata={err:.2e}")


# --- DSİ önhesap
d = exp["dsi"]
check("S_harmonik", res["girdi_ozeti"]["S_harmonik"], d["S_harmonik"])
check("dsi.qp", res["dsi_onhesap"]["qp"], d["qp_l_s_km2_mm"])
check("dsi.Qp", res["dsi_onhesap"]["Qp"], d["Qp_m3_s_mm"])
check("dsi.T_saat", res["dsi_onhesap"]["T_saat"], d["T_saat"])
check("dsi.Tp", res["dsi_onhesap"]["Tp"], d["Tp_saat"])

# --- Mockus
m = exp["mockus"]
check("mockus.Tc", res["mockus"]["Tc"], m["Tc"])
check("mockus.D", res["mockus"]["D"], m["D"])
check("mockus.Tp", res["mockus"]["Tp"], m["Tp"])
check("mockus.K3", res["mockus"]["sonuclar"]["K3"]["K"], m["K3"])
check("mockus.qp_K1", res["mockus"]["sonuclar"]["K1"]["qp"], m["qp_K1"])
check("mockus.qp_K2", res["mockus"]["sonuclar"]["K2"]["qp"], m["qp_K2"])
check("mockus.qp_K3", res["mockus"]["sonuclar"]["K3"]["qp"], m["qp_K3"])

# --- DSİ birim hidrograf (ilk 20 nokta)
uh = exp["dsi_birim_hidrograf"]
for i in range(min(20, len(uh["t"]), len(res["dsi"]["uh_q"]))):
    if uh["q"][i] is not None:
        check(f"BH t={uh['t'][i]}", res["dsi"]["uh_q"][i], uh["q"][i])

# --- KABULET pik matrisi
kb = exp["kabulet_pik"]
rp_map = {"Q2": "2", "Q5": "5", "Q10": "10", "Q25": "25", "Q50": "50", "Q100": "100", "QOET": "OET"}
for rp, key in rp_map.items():
    for j, D in enumerate(kb["sureler_saat"]):
        want = kb["matris"][rp][j]
        got = res["kabulet"][str(D)][key]
        check(f"kabulet {rp} D={D}sa", got, want)

print()
if fails:
    print(f"BAŞARISIZ: {len(fails)} kontrol:", fails[:10])
    sys.exit(1)
print("TÜM GOLDEN KONTROLLER GEÇTİ")
