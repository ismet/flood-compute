# -*- coding: utf-8 -*-
"""CORINE'den rasyonel akış katsayısı C türetme sınaması.

Çalıştırma:  python backend/tests/test_corine_c.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from backend.core import corine, tables  # noqa: E402

# Kaynak tablo: kod -> (c_min, c_max, önerilen ortalama)
MATRIS = {
    111: (0.70, 0.90, 0.85), 112: (0.40, 0.65, 0.50), 121: (0.60, 0.90, 0.75),
    122: (0.70, 0.90, 0.80), 123: (0.60, 0.85, 0.75), 124: (0.50, 0.80, 0.65),
    131: (0.50, 0.70, 0.60), 132: (0.40, 0.65, 0.50), 133: (0.50, 0.70, 0.60),
    141: (0.10, 0.25, 0.15), 142: (0.20, 0.40, 0.30), 211: (0.20, 0.45, 0.30),
    212: (0.25, 0.50, 0.35), 213: (0.60, 0.80, 0.70), 221: (0.20, 0.40, 0.30),
    222: (0.15, 0.35, 0.25), 223: (0.20, 0.40, 0.30), 231: (0.15, 0.35, 0.20),
    241: (0.20, 0.45, 0.30), 242: (0.20, 0.40, 0.30), 243: (0.15, 0.35, 0.25),
    244: (0.15, 0.30, 0.22), 311: (0.05, 0.20, 0.10), 312: (0.05, 0.20, 0.10),
    313: (0.05, 0.20, 0.10), 321: (0.15, 0.35, 0.20), 322: (0.20, 0.40, 0.30),
    323: (0.15, 0.30, 0.20), 324: (0.10, 0.25, 0.15), 331: (0.10, 0.25, 0.15),
    332: (0.70, 0.90, 0.80), 333: (0.30, 0.55, 0.40), 334: (0.50, 0.70, 0.60),
    335: (0.70, 0.90, 0.80), 411: (0.05, 0.15, 0.10), 412: (0.10, 0.20, 0.15),
    421: (0.10, 0.20, 0.15), 422: (0.80, 0.95, 0.90), 423: (0.20, 0.40, 0.30),
    511: (1.00, 1.00, 1.00), 512: (1.00, 1.00, 1.00), 521: (1.00, 1.00, 1.00),
    522: (1.00, 1.00, 1.00),
}
# Önerilen ortalamanın aralığın ORTA NOKTASI OLMADIĞI sınıflar — C_orta'nın
# (c_min+c_max)/2 ile hesaplanmadığını kanıtlayan örnekler.
ORTA_NOKTA_DEGIL = {231: 0.25, 321: 0.25, 244: 0.225, 111: 0.80, 112: 0.525}


def main():
    tab = tables.load("corine_c")["siniflar"]

    # --- 1) tablo bütünlüğü: CORINE'in 44 sınıfının hepsi karşılanmalı
    eksik = [k for k in corine.GRID_TO_CODE if str(k) not in tab]
    assert not eksik, f"C tablosunda eksik CORINE kodu: {eksik}"
    for kod, b in tab.items():
        assert 0.0 < b["c_min"] <= b["c_ort"] <= b["c_max"] <= 1.0, (kod, b)
        assert b["ad"] and b["yuzey"] and b["s1"] and b["s2"], kod
        assert isinstance(b.get("renk"), str) and b["renk"].startswith("#"), kod
    print("OK  tablo bütünlüğü      44 sınıf, 0 < c_min ≤ c_ort ≤ c_max ≤ 1, "
          "hiyerarşi ve renk alanları dolu")

    # --- 2) kaynak tablodan birebir aktarım
    for kod, (mn, mx, ort) in MATRIS.items():
        b = tab[str(kod)]
        assert (b["c_min"], b["c_max"], b["c_ort"]) == (mn, mx, ort), (kod, b)
        assert b["tablo"] is True, f"{kod} kaynak tabloda var ama tablo=false"
    turetilen = sorted(int(k) for k, v in tab.items() if not v["tablo"])
    assert turetilen == [523], f"türetilmiş sınıflar beklenenden farklı: {turetilen}"
    print(f"OK  kaynak aktarımı      {len(MATRIS)} sınıf birebir; "
          f"yalnız 523 türetilmiş (kaynak tabloda yok)")

    # --- 3) önerilen ortalama, aralığın orta noktası DEĞİL
    for kod, orta_nokta in ORTA_NOKTA_DEGIL.items():
        b = tab[str(kod)]
        assert abs((b["c_min"] + b["c_max"]) / 2 - orta_nokta) < 1e-9, kod
        assert abs(b["c_ort"] - orta_nokta) > 1e-9, \
            f"{kod}: c_ort orta noktaya eşit, kaynak tablo öyle demiyor"
    print(f"OK  önerilen ≠ ortanokta {len(ORTA_NOKTA_DEGIL)} sınıfta doğrulandı "
          "(ör. 231 → aralık ortası 0.25, önerilen 0.20)")

    # --- 4) alansal ağırlıklandırma: C_orta c_ort'lardan gelmeli
    dokum = [{"kod": 311, "hucre": 5000}, {"kod": 231, "hucre": 3000},
             {"kod": 112, "hucre": 1500}, {"kod": 511, "hucre": 500}]
    c = corine._c_agirlikli(dokum)
    n = 10000.0
    alt = (0.05 * 5000 + 0.15 * 3000 + 0.40 * 1500 + 1.00 * 500) / n
    ust = (0.20 * 5000 + 0.35 * 3000 + 0.65 * 1500 + 1.00 * 500) / n
    ort = (0.10 * 5000 + 0.20 * 3000 + 0.50 * 1500 + 1.00 * 500) / n
    for ad, hesap, beklenen in (("C_min", c["C_min"], alt),
                                ("C_max", c["C_max"], ust),
                                ("C_orta", c["C_orta"], ort)):
        assert abs(hesap - beklenen) <= 1e-3, (ad, hesap, beklenen)
    # orta nokta ile hesaplansaydı farklı çıkardı — bunu da kanıtla
    orta_nokta_ile = (alt + ust) / 2
    assert abs(ort - orta_nokta_ile) > 1e-3, "örnek ayırt edici değil"
    print(f"OK  ağırlıklandırma      C_min={c['C_min']} C_orta={c['C_orta']} "
          f"C_max={c['C_max']}  (orta noktayla {orta_nokta_ile:.3f} olurdu)")

    # --- 5) döküm satırları zenginleştirildi mi
    assert dokum[0]["c_ort"] == 0.10 and dokum[0]["c_tablo"] is True
    assert dokum[0]["c_renk"] == "#80FF00", dokum[0].get("c_renk")
    print("OK  döküm zenginleştirme  satırlara c_min/c_max/c_ort/c_tablo/c_renk eklendi")

    # --- 6) türetilmiş pay doğru bildiriliyor mu (523 = deniz)
    c2 = corine._c_agirlikli([{"kod": 311, "hucre": 5000},
                              {"kod": 523, "hucre": 5000}])
    assert abs(c2["tablo_orani"] - 0.5) < 1e-9, c2
    assert abs(c2["turetilmis_orani"] - 0.5) < 1e-9, c2
    print("OK  türetilmiş payı      tablo %50 / türetilmiş %50 doğru bildirildi")

    # --- 7) eşleşmeyen / boş girdi
    assert corine._c_agirlikli([{"kod": 999, "hucre": 100}]) is None
    assert corine._c_agirlikli([]) is None
    print("OK  eşleşmeyen/boş       None döndürüyor, çökmüyor")

    # --- 8) tam su yüzeyi C = 1.00
    c3 = corine._c_agirlikli([{"kod": 512, "hucre": 100}])
    assert c3["C_min"] == c3["C_orta"] == c3["C_max"] == 1.0, c3
    print("OK  tam su yüzeyi        C = 1.000 (doğrudan akış)")

    # --- 9) sınıflandırma renk tablosuna dokunulmadı mı (CN buna bağlı)
    resmi = tables.load("clc_colors")["renkler"]
    assert len(resmi) >= 44 and resmi["111"] == [230, 0, 77], len(resmi)
    print("OK  clc_colors korundu   resmî lejand renkleri değişmemiş "
          "(EEA görüntü sınıflandırması buna bağlı)")

    print("\nTÜM CORINE-C SINAMALARI GEÇTİ")


if __name__ == "__main__":
    main()
