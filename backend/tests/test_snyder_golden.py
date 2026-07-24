# -*- coding: utf-8 -*-
"""Snyder golden testi — SNYDER V7.xlsm (DENEME BARAJI) ile karşılaştırma.

Parametreler ve Q2..Q100 pik debileri Excel ile birebir; QOET Excel'de 6 saatlik
bloklarla hesaplandığından (bu uygulamada tek tr=3 saat) ~%0.2 sapar.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from backend.core import snyder  # noqa: E402

GIRDI = dict(
    A_km2=4057, L_km=101.72, Lc_km=40.72, Ct=1.55, Cp=0.6, W50=29, W75=17,
    region="B", CN2=82, CN3=92, Qbaz=38.77, YALD=0.905,
    P24={2: 27.279461002932216, 5: 36.77145789073035, 10: 43.5156478960757,
         25: 52.53413696084039, 50: 59.61723303224146, 100: 67.02898245783072},
    P24_OET=184.0,
)
PAR_GOLD = {"tp": 18.858013157731406, "tr": 3, "qp": 87.81412899381043,
            "Qp": 35.62619213278889, "Tp": 20, "Tb": 129}
PEAK_GOLD = {"2": 157.58212469382846, "5": 296.0243929869544, "10": 412.4224573830089,
             "25": 584.9794222391441, "50": 730.9741492232351, "100": 892.6804724602657}
BLOCK2_GOLD = [0.0, 0.2126, 0.5354, 0.5957, 0.6494, 0.642, 0.6255, 0.6073]

fails = []


def check(name, got, want, tol):
    err = abs(got - want) / max(abs(want), 1e-12)
    st = "OK " if err <= tol else "FAIL"
    if err > tol:
        fails.append(name)
    print(f"{st} {name:16s} hesap={got:13.5f} excel={want:13.5f} hata={err:.2e}")


# --- parametreler (birebir)
par = snyder.parameters(GIRDI["A_km2"], GIRDI["L_km"], GIRDI["Lc_km"], GIRDI["Ct"], GIRDI["Cp"])
for k, v in PAR_GOLD.items():
    check("par." + k, float(par[k]), float(v), 1e-6)

# --- 2 yıllık artım akış blokları (birebir, 4 hane)
blk = snyder.incremental_blocks(GIRDI["P24"][2], GIRDI["CN2"], GIRDI["region"], 3, GIRDI["YALD"])
for i, (g, w) in enumerate(zip(blk, BLOCK2_GOLD)):
    check(f"blok2[{i}]", round(g, 4), w, 1e-3 if w else 1.0) if w else \
        (print(f"OK  blok2[{i}]      hesap={g:.4f} excel=0"))

# --- tam hesap: UH hacmi ve pikler
res = snyder.compute(GIRDI)
check("UH.hacim_mm", res["parametreler"]["hacim_mm"], 1.0, 1e-3)
check("UH.pik(Qp)", max(res["birim_hidrograf"]), PAR_GOLD["Qp"], 1e-3)
for k, v in PEAK_GOLD.items():
    check(f"pik.Q{k}", res["pikler"][k], v, 5e-4)
# OET: 6 saatlik blok farkından ötürü daha gevşek tolerans
check("pik.QOET", res["pikler"]["OET"], 4747.657003425287, 5e-3)

print()
if fails:
    print("BAŞARISIZ:", fails)
    sys.exit(1)
print("TÜM SNYDER GOLDEN KONTROLLER GEÇTİ")
