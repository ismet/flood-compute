# Taşkın Hesap — Sentetik Yöntemler Web Uygulaması

**Stack:** Python 3 (FastAPI + uvicorn) + vanilla HTML/CSS/JS (Leaflet + Chart.js).  
**No JS toolchain** — this is a pure Python project. `pip install -r requirements.txt`.

**Entry point:** `python run.py` → opens http://127.0.0.1:8737. Port = 8737, not 8000.

## Commands

```bash
python run.py                                         # dev server (auto-opens browser)
python backend/tests/test_golden.py                   # DSİ/Mockus golden (49 peaks)
python backend/tests/test_snyder_golden.py            # Snyder golden
python backend/tests/test_reservoir_golden.py         # reservoir routing golden
python backend/tests/test_api_smoke.py                # API smoke (FastAPI TestClient)
python backend/tests/test_kmz_export.py               # KMZ writer round-trip (via vektor.oku)
python backend/tests/test_raster.py                   # raster basemap XYZ tiles + CRS override
python backend/tests/test_corine_c.py                 # CORINE -> rational C derivation
python backend/tests/test_akarsu.py                   # DSİ river layer (skips if data absent)
python tools/mdb_akarsu_cikar.py <Kaynak_Akarsu.mdb>  # one-off: MDB -> data/akarsu/akarsu.sqlite
python tools/extract_tables.py                        # regenerate JSON tables from Excel
python tools/extract_mgm_plv.py                       # extract MGM PLV data
docker build -t taskin-hesap .                        # build Docker image
```

Tests run as **scripts directly** (not via pytest): `python backend/tests/test_*.py`.  
All golden tests verify outputs match Excel (tol=1e-6).

## Critical conventions

- **Turkish naming everywhere**: variables, comments, error messages, API field names, UI labels. Names carry domain meaning.
- **Heavy GIS modules** (pyflwdir, rasterio, numba, shapely) imported **inside endpoint functions**, not at module top. For new endpoints, do the same.
- **Tests use `sys.path.insert(0, ...)`** before importing backend modules (not relative imports). Copy pattern from existing tests.
- **All computation is stateless**: client sends full state, server returns results.
- **No database**: `data/tables/*.json` loaded via `backend.core.tables.load()` with `@lru_cache`.
- **Error handling**: use `_err(e)` helper from `backend.main` — returns `JSONResponse(status_code=400, content={"hata": str(e)})`.

## Architecture notes

- **GIS delineation runs in subprocess** (`python -m backend.core._delineate_subprocess`) with a **global lock** (`_delineate_lock`). Prevents concurrent pyflwdir+numba memory corruption. Acquire with `blocking=False` and return 503 if locked.
- **`.gitignore` excludes** `data/dem/cache/`, `data/projects/`, `data/corine/cache/` — these are runtime caches, not checked in.
- **DEM auto-downloads** Copernicus GLO-30 tiles from S3 (~50-100 MB) on first delineation. Cached in `data/dem/cache/`.
- **CORINE land cover auto-downloads** from EEA CLC2018 WMS. Cached in `data/corine/cache/`.
- **Singleton global state** in frontend: `S` object (`app.js:4`) tracks all app state. No React/Vue — vanilla JS.
- **Frontend served at `/static/`**: FastAPI mounts `frontend/` at `/static/*`; `index.html` served at `"/"` via FileResponse with `Cache-Control: no-cache`. Leaflet + Chart.js loaded from CDNs (unpkg, cdn.jsdelivr).
- **Docker**: `python:3.12-slim`; GDAL/PROJ bundled in manylinux wheels. Sets `--timeout-keep-alive 300` for slow DEM downloads. Use `APP_PASSWORD` env var for HTTP Basic auth in public deploys.

## Project structure (key files)

```
backend/main.py       — FastAPI app, 37 endpoints, Pydantic models, HTTP Basic auth
backend/core/         — Computation engine (no framework dependency)
  engine.py           — DSİ Sentetik + Mockus + Kirpich Tc + SCS runoff
  snyder.py           — Snyder synthetic UH
  rational.py         — Rasyonel (A ≤ 1 km²)
  reservoir.py        — Storage-Indication routing + controlled gates
  routing.py          — Multi-basin (ara havza) hydrograph routing
  gis.py              — Basin delineation, DEM handling (~907 lines)
  tables.py           — JSON table loader + interpolation helpers (data layer)
  corine.py           — CORINE → CN lookup + rational C derivation (same pass)
  corine_online.py    — EEA CLC2018 WMS downloader
  thiessen.py         — Voronoi/Thiessen weights from KMZ
  snowmelt.py         — Degree-day snowmelt (KAR1)
  yzd_region.py       — YZD region (A/B/C) from basin polygon
  report.py           — Word (.docx) flood report
  dilekce.py          — MGM petition (.docx/.pdf)
  _delineate_subprocess.py   — subprocess entry point: python -m
  _multi_delineate_subprocess.py
  _import_basin_subprocess.py — subprocess entry point: python -m
  vektor.py             — KML/KMZ/GeoJSON parser for basin import
  kmz_export.py         — KMZ *writer* (basin + streams + return-period peaks)
  raster.py             — Georeferenced raster basemaps → XYZ tile service
  akarsu.py             — DSİ river network context layer (SQLite R*Tree, bbox query)
frontend/             — 3 files: index.html, app.js (all logic), style.css
data/tables/          — 14 JSON tables (Excel-extracted; corine_c.json is a
                        CORINE class → rational C range matrix)
data/regions/         — YZD_ALANLAR.kmz (A/B/C polygons)
data/raster/          — uploaded raster basemaps + .json sidecars (gitignored)
data/akarsu/          — akarsu.sqlite, DSİ river network at 1/100k–1/500k
                        (~405k lines, 110 MB; gitignored, built by the tool above)
```

---

## Key API endpoints

All return JSON with `"hata"` key on error. Use `from backend.core import X` inside each endpoint (lazy import pattern).

| Endpoint | What it does |
|---|---|
| `POST /api/delineate` | Basin delineation from outlet click (subprocess, locked) |
| `POST /api/multi-delineate` | Multi-basin (ara havza) delineation |
| `POST /api/import-basin` | Upload basin polygon from KML/KMZ/GeoJSON |
| `POST /api/basin-from-geometry` | Same as import-basin but input is GeoJSON, not a file — used after on-map editing |
| `POST /api/kmz-export` | Basin + streams + selected method's Q2–Q10000 → .kmz |
| `POST /api/raster-add` | Upload georeferenced raster basemap (`?crs=EPSG:…` if the file has none) |
| `POST /api/raster-delete` | Remove a raster basemap |
| `GET /api/raster-layers` | List raster basemaps |
| `GET /api/akarsu` | DSİ river network for a bbox (`bati/guney/dogu/kuzey`, `olcek` 100/250/500) — context only, not used in computation |
| `GET /api/akarsu-bilgi` | Whether the river layer is installed and how many lines per scale |
| `GET /api/raster/{ad}/{z}/{x}/{y}.png` | XYZ tile service (reprojects to EPSG:3857; 204 when out of coverage) |
| `POST /api/compute` | All flood methods (DSİ, Mockus, +optional rational/snyder/snowmelt) |
| `POST /api/cn` | CORINE CN from basin polygon + soil group |
| `POST /api/thiessen` | Thiessen weights from basin + stations |
| `POST /api/stations` | Upload custom station KMZ/KML |
| `POST /api/route` | Multi-basin hydrograph routing |
| `POST /api/reservoir-route` | Storage-Indication routing |
| `POST /api/reservoir-controlled` | Gated spillway optimization (peak-shaving) |
| `POST /api/report` | Generate .docx flood report |
| `POST /api/dilekce` | Generate MGM petition (.docx/.pdf) |
| `POST /api/yil-ara` | Return period from Q/Q10/Q100 (analytical inverse) |
| `POST /api/rainfall/parse` | Parse pasted rainfall table |
| `POST /api/yzd-region` | YZD region (A/B/C) from basin |
| `GET /api/stations/default` | Default station KMZ |
| `GET /api/mgm-stations` | MGM 2020 PLV (236 stations) |
| `GET /api/dplv` | DPLV station list |
| `GET /api/geocode` | OSM Nominatim (Turkey) |
| `GET /api/snyder-ctcp` | Snyder Ct-Cp abacus |
| `GET /api/abak2` | ABAK2 areal reduction table |
| `GET /api/reservoir-defaults` | Söylemez reservoir defaults |
| `GET /api/reservoir-controlled-defaults` | Gated spillway defaults |
| `GET /api/dilekce-defaults` | Petition default contact/signature info |
| `GET /api/dilekce-imza` | Default signature/stamp image preview |
| `POST /api/project/save` / `list` / `load/{ad}` / `DELETE` | Project CRUD |

## Core computation formulas

- **Harmonic slope**: S = (10 / Σ(1/√(ℓ/Δh)))², ℓ = L/10
- **Kirpich Tc** (metric): Tc = 0.0003245 × L⁰·⁷⁷ / S⁰·³⁸⁵ (hours)
- **DSİ Qp**: qp = 414 × A⁻⁰·²²⁵ × (L·Lc/√S)⁻⁰·¹⁶ (L/s/km²/mm)
- **SCS runoff**: Q = (P − 0.2S)²/(P + 0.8S), S = (1000/CN − 10) × 25.4
- **Extrapolation**: Q500/1000/10000 = Q10 + k·(Q100−Q10), k=[1.692, 1.99, 2.98]
- **Return period inverse**: T = 10^((x+0.98)/0.99), x = (Q−Q10)/(Q100−Q10)
- **Reservoir**: Storage-Indication (2S/Δt+O)₁ = (I₀+I₁) + (2S/Δt−O)₀
- **Multi-basin**: Q_mansap(t) = Q_ara(t) + Σ Q_memba_i(t − Tc_ara)
