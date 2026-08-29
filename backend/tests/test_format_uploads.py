# -*- coding: utf-8 -*-
"""Bilgi/raster upload sınırları."""
import io
import os
import sys

import numpy as np
import rasterio
from fastapi.testclient import TestClient
from rasterio.transform import from_origin

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from backend.main import app  # noqa: E402
from backend.core import raster  # noqa: E402


client = TestClient(app)


def tif_bytes(crs="EPSG:4326"):
    out = io.BytesIO()
    with rasterio.open(out, "w", driver="GTiff", width=4, height=4, count=1,
                       dtype="uint8", crs=crs, transform=from_origin(28, 42, 0.1, 0.1)) as ds:
        ds.write(np.ones((1, 4, 4), dtype="uint8"))
    return out.getvalue()


def main():
    names = set()
    try:
        response = client.post(
            "/api/raster-add",
            files=[("files", ("format_test.geotiff", tif_bytes(), "image/tiff"))],
        )
        assert response.status_code == 200, response.text
        meta = response.json()
        names.add(meta["ad"])
        assert meta["etkin_crs"] == "EPSG:4326"
        print("GeoTIFF extension OK")

        response = client.post(
            "/api/raster-add",
            files=[
                ("files", ("sidecar.tif", tif_bytes(None), "image/tiff")),
                ("files", ("wrong.tfw", b"1\n0\n0\n-1\n0\n0\n", "text/plain")),
            ],
            params={"crs": "EPSG:4326"},
        )
        assert response.status_code == 400 and "eşleşmiyor" in response.json()["hata"], response.text
        print("Sidecar basename validation OK")

        response = client.post(
            "/api/raster-add",
            files=[
                ("files", ("sidecar.tif", tif_bytes(None), "image/tiff")),
                ("files", ("sidecar.ovr", b"", "application/octet-stream")),
            ],
            params={"crs": "EPSG:4326"},
        )
        assert response.status_code == 400 and ".ovr" in response.json()["hata"], response.text
        print("OVR rejection OK")

        response = client.post(
            "/api/raster-add",
            files=[("files", ("sidecar.tif.EXE", b"MZ", "application/octet-stream"))],
        )
        assert response.status_code == 400, response.text
        print("Executable rejection OK")

        response = client.post(
            "/api/raster-add",
            files=[("files", ("conflict.tif", tif_bytes("EPSG:4326"), "image/tiff"))],
            params={"crs": "EPSG:23037"},
        )
        assert response.status_code == 400 and "farklı" in response.json()["hata"], response.text
        print("CRS conflict rejection OK")
    finally:
        for name in names:
            try:
                raster.sil(name)
            except Exception:
                pass


if __name__ == "__main__":
    main()
