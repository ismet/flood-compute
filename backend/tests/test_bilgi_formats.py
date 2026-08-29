# -*- coding: utf-8 -*-
"""Bilgi katmanı DXF/NCZ ve upload sözleşmesi sınaması."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

from fastapi.testclient import TestClient  # noqa: E402

from backend.core import katman  # noqa: E402
from backend.main import app  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
DXF = os.path.join(ROOT, "sample_file_formats", "f20a2.dxf")
NCZ = os.path.join(ROOT, "sample_file_formats", "5000_1000_REVIZYON_SINIRI_itrf_3d.NCZ")
client = TestClient(app)


def main():
    if not os.path.exists(DXF):
        print(f"SKIP: DXF fixture yok — {DXF} (sample_file_formats/ yerel, depoya girmez)")
        return
    dxf = open(DXF, "rb").read()
    fc, warnings = katman.oku(dxf, "f20a2.dxf", "EPSG:23037")
    assert len(fc["features"]) > 1000
    assert {f["geometry"]["type"] for f in fc["features"]} >= {"LineString", "Point"}
    assert all("layer" in f["properties"] for f in fc["features"])
    assert warnings.get("TEXT", 0) > 0
    print(f"DXF parser OK: {len(fc['features'])} geometri")

    r = client.post("/api/bilgi-katmani", files={"file": ("f20a2.dxf", dxf, "application/dxf")}, data={"crs": "EPSG:23037"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sayi"] == len(body["geojson"]["features"])
    assert body["turler"]["LineString"] > 0
    print("DXF API OK")

    r = client.post("/api/bilgi-katmani", files={"file": ("f20a2.dxf", dxf, "application/dxf")})
    assert r.status_code == 400 and "CRS" in r.json()["hata"], r.text
    print("DXF CRS zorunluluğu OK")

    if not os.path.exists(NCZ):
        print(f"SKIP: NCZ fixture yok — {NCZ}")
        return
    ncz = open(NCZ, "rb").read()
    r = client.post("/api/bilgi-katmani", files={"file": ("sample.ncz", ncz, "application/octet-stream")})
    assert r.status_code == 400 and "Netcad" in r.json()["hata"] and "GeoJSON" in r.json()["hata"], r.text
    print("NCZ conversion message OK")


if __name__ == "__main__":
    main()
