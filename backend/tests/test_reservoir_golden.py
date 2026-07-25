# -*- coding: utf-8 -*-
"""Hazne ötelemesi golden testi — Söylemez T28 (Excel) ile karşılaştırma."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from backend.core import reservoir, tables  # noqa: E402

D = json.load(open(os.path.join(tables.TABLES, "soylemez_reservoir.json"), encoding="utf-8"))

# Söylemez giriş hidrografı (T28 B15:B147) — pik 790 @ t=22
INFLOW = [0, 10, 20, 40, 60, 100, 140, 190, 240, 300, 360, 415, 470, 520, 570, 615,
          660, 690, 720, 745, 770, 780, 790, 787.5, 785, 770, 755, 732.5, 710, 680,
          650, 617.5, 585, 552.5, 520, 495, 470, 445, 420, 399, 378, 359, 340, 322.5,
          305, 291.5, 278, 265, 252, 240, 228, 218, 208, 199, 190, 181, 172, 165, 158,
          151.5, 145, 139, 133, 127.5, 122, 116, 110, 105, 100, 95, 90, 85, 80, 76, 72,
          68.5, 65, 61.5, 58, 55, 52, 50, 48, 46, 44, 42, 40, 38, 36, 34, 32, 30.5, 29,
          27.5, 26, 25, 24, 22.5, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12.5, 12, 11, 10,
          9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6, 5.5, 5, 4.5, 4, 3.8, 3.5, 3.2, 3, 2.8, 2.5,
          2.2, 2, 1.8, 1.5]

res = reservoir.route(INFLOW, 1.0, D["kret_kotu"], D["hacim_satih"]["veri"],
                      D["dolusavak_rating"]["veri"])
o = res["ozet"]
fails = []


def chk(name, got, want, tol):
    if got is None:
        fails.append(name); print(f"FAIL {name}: None"); return
    err = abs(got - want) / max(abs(want), 1e-9)
    st = "OK " if err <= tol else "FAIL"
    if err > tol:
        fails.append(name)
    print(f"{st} {name:22s} hesap={got:12.4f} excel={want:12.4f} hata={err:.2e}")


chk("cikis_pik", o["cikis_pik"], 168.5096, 2e-3)
chk("maks_su_kotu", o["maks_su_kotu"], 1834.4001, 1e-5)
chk("pik_sonumleme", o["pik_sonumleme"], 0.786697, 2e-3)
chk("cikis_pik_saat", o["cikis_pik_saat"], 56, 0.02)
chk("maks_He", o["maks_He"], 1.40010, 2e-3)

# geometri rating fonksiyonu çalışıyor mu
rg = reservoir.rating_from_geometry(1833, 0.0, 40.0, C=2.1, he_max=2.0)
assert len(rg) > 5 and rg[0] == [0.0, 0.0], "rating_from_geometry bozuk"
print(f"OK  rating_from_geometry     {len(rg)} nokta (He=1 → Q={rg[10][1]})")

print()
if fails:
    print("BAŞARISIZ:", fails); sys.exit(1)
print("TÜM HAZNE ÖTELEME GOLDEN KONTROLLER GEÇTİ")
