# -*- coding: utf-8 -*-
"""CORINE'den rasyonel akış katsayısı C türetme sınaması.

Çalıştırma:  python backend/tests/test_corine_c.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from backend.core import corine, tables  # noqa: E402

# Kullanıcının eşleştirme matrisi — tablodan BİREBİR olması gereken değerler
MATRIS = {
    111: (0.85, 0.90), 112: (0.50, 0.65), 121: (0.70, 0.80), 122: (0.80, 0.90),
    124: (0.75, 0.85), 131: (0.30, 0.50), 132: (0.30, 0.50), 141: (0.15, 0.25),
    142: (0.15, 0.25), 211: (0.30, 0.45), 212: (0.30, 0.45), 221: (0.25, 0.35),
    222: (0.25, 0.35), 231: (0.15, 0.25), 311: (0.10, 0.15), 312: (0.10, 0.15),
    313: (0.10, 0.15), 321: (0.15, 0.30), 322: (0.15, 0.30), 331: (0.50, 0.70),
    332: (0.50, 0.70), 511: (1.00, 1.00), 512: (1.00, 1.00),
}


def main():
    tab = tables.load("corine_c")["siniflar"]

    # --- 1) tablo bütünlüğü: CORINE'in 44 sınıfının hepsi karşılanmalı
    eksik = [k for k in corine.GRID_TO_CODE if str(k) not in tab]
    assert not eksik, f"C tablosunda eksik CORINE kodu: {eksik}"
    for kod, b in tab.items():
        assert 0.0 < b["c_min"] <= b["c_max"] <= 1.0, (kod, b)
        assert b["ad"] and b["yuzey"], kod
    print(f"OK  tablo bütünlüğü      44 CORINE sınıfının tamamı karşılanıyor, "
          f"0 < c_min ≤ c_max ≤ 1")

    # --- 2) matris değerleri birebir aktarılmış mı
    for kod, (mn, mx) in MATRIS.items():
        b = tab[str(kod)]
        assert b["c_min"] == mn and b["c_max"] == mx, (kod, b, (mn, mx))
        assert b["tablo"] is True, f"{kod} matriste var ama tablo=false"
    turetilen = [k for k, v in tab.items() if not v["tablo"]]
    assert len(MATRIS) + len(turetilen) == len(tab)
    print(f"OK  matris aktarımı      {len(MATRIS)} sınıf birebir, "
          f"{len(turetilen)} sınıf türetilmiş olarak işaretli")

    # --- 3) alansal ağırlıklandırma elle hesapla birebir
    dokum = [{"kod": 311, "hucre": 5000}, {"kod": 231, "hucre": 3000},
             {"kod": 112, "hucre": 1500}, {"kod": 511, "hucre": 500}]
    c = corine._c_agirlikli(dokum)
    n = 10000.0
    alt = (0.10 * 5000 + 0.15 * 3000 + 0.50 * 1500 + 1.00 * 500) / n
    ust = (0.15 * 5000 + 0.25 * 3000 + 0.65 * 1500 + 1.00 * 500) / n
    for ad, hesap, beklenen in (("C_min", c["C_min"], alt),
                                ("C_max", c["C_max"], ust),
                                ("C_orta", c["C_orta"], (alt + ust) / 2)):
        assert abs(hesap - beklenen) <= 1e-3, (ad, hesap, beklenen)
    assert c["tablo_orani"] == 1.0 and c["turetilmis_orani"] == 0.0
    print(f"OK  ağırlıklandırma      C_min={c['C_min']} C_orta={c['C_orta']} "
          f"C_max={c['C_max']} (elle hesapla birebir)")

    # --- 4) döküm satırlarına C aralığı işlenmiş mi
    assert dokum[0]["c_min"] == 0.10 and dokum[0]["c_tablo"] is True
    print("OK  döküm zenginleştirme  her satıra c_min/c_max/c_tablo eklendi")

    # --- 5) türetilmiş sınıf payı doğru raporlanıyor mu
    c2 = corine._c_agirlikli([{"kod": 311, "hucre": 5000},
                              {"kod": 242, "hucre": 5000}])   # 242 matriste yok
    assert abs(c2["tablo_orani"] - 0.5) < 1e-9, c2
    assert abs(c2["turetilmis_orani"] - 0.5) < 1e-9, c2
    print(f"OK  türetilmiş payı      tablo %50 / türetilmiş %50 doğru bildirildi")

    # --- 6) hiç eşleşmeyen kod: çökmemeli, None dönmeli
    assert corine._c_agirlikli([{"kod": 999, "hucre": 100}]) is None
    assert corine._c_agirlikli([]) is None
    print("OK  eşleşmeyen/boş       None döndürüyor, çökmüyor")

    # --- 7) su yüzeyi tamamen kaplarsa C = 1.00
    c3 = corine._c_agirlikli([{"kod": 512, "hucre": 100}])
    assert c3["C_min"] == c3["C_orta"] == c3["C_max"] == 1.0, c3
    print("OK  tam su yüzeyi        C = 1.000 (doğrudan akış)")

    print("\nTÜM CORINE-C SINAMALARI GEÇTİ")


if __name__ == "__main__":
    main()
