# Taşkın Hesap — Sentetik Yöntemler Web Uygulaması

**Stack:** Python 3 (FastAPI + uvicorn) + vanilla HTML/CSS/JS (Leaflet + Chart.js). No JS build tooling. Port **8737**, not 8000.

**Entry:** `python run.py` → opens http://127.0.0.1:8737

**Virtual environment:** `.venv/` at project root. Activate before running commands. System python3 lacks pyflwdir/rasterio/shapely.

## Commands

```bash
python run.py                                         # dev server (auto-opens browser)
python backend/tests/test_golden.py                   # DSİ/Mockus golden (49 peaks)
python backend/tests/test_snyder_golden.py            # Snyder golden
python backend/tests/test_reservoir_golden.py         # reservoir routing golden
python backend/tests/test_api_smoke.py                # API smoke (FastAPI TestClient)
python backend/tests/test_kmz_export.py               # KMZ writer round-trip
python backend/tests/test_raster.py                   # raster basemap XYZ tiles + CRS
python backend/tests/test_corine_c.py                 # CORINE -> rational C derivation
python backend/tests/test_akarsu.py                   # DSİ river layer (skips if data absent)
python tools/mdb_akarsu_cikar.py <Kaynak_Akarsu.mdb>  # one-off: MDB -> data/akarsu/akarsu.sqlite
python tools/extract_tables.py                        # regenerate JSON tables from Excel
python tools/extract_mgm_plv.py                       # extract MGM PLV data (needs Excel at repo root)
docker build -t taskin-hesap .                        # build Docker image
```

## Conventions

- **Turkish naming everywhere** (variables, comments, API fields, UI labels)
- **Lazy GIS imports** — import pyflwdir, rasterio, numba, shapely **inside endpoint functions**, never at module top
- **Tests run as `python` scripts** (not pytest). All use `sys.path.insert(0, ...)` before importing backend modules. Copy this pattern.
- **Stateless computation** — client sends full state, server returns results. No session.
- **No database** — `data/tables/*.json` loaded via `backend.core.tables.load()` with `@lru_cache`
- **Error responses** always return `{"hata": str(e)}` — use `_err(e)` from `backend.main` (returns `JSONResponse(status_code=400)`)
- **POST endpoints** accept Pydantic model JSON bodies, except `POST /api/stations` and `POST /api/raster-add` (multipart form).

## GIS delineation

Runs in a **subprocess** behind a global `threading.Lock`. Acquire with `blocking=False`; return **503** if locked. Same pattern for multi-delineate and import-basin. Prevents pyflwdir+numba memory corruption.

Env vars: `DELINEATE_MAX_CELLS` (default 8_000_000, `gis.py:41`), `HOST`, `PORT`, `APP_PASSWORD`.

## Frontend

- **`S` singleton** (`frontend/app.js:4`) tracks all app state — no React/Vue
- Mounted at `/static/`; `index.html` served at `/` via `FileResponse` with `Cache-Control: no-cache`
- Leaflet + Chart.js from CDNs (unpkg, cdn.jsdelivr)

## External data

| Data | Source | Trigger |
|---|---|---|
| DEM (Copernicus GLO-30) | `copernicus-dem-30m.s3.amazonaws.com` → `data/dem/cache/` | First delineation (~50-100 MB) |
| CORINE (CLC2018) | EEA WMS → `data/corine/cache/` | First CN computation |

## Key data files

```
data/tables/*.json          — 14 Excel-extracted lookup tables (do not edit by hand)
data/regions/YZD_ALANLAR.kmz — A/B/C flood region polygons
data/stations/bir_cikti.kml  — default 2315-station set (auto-loaded)
data/akarsu/akarsu.sqlite    — DSİ river network (~405k lines, 110 MB; gitignored)
```

## API endpoints (38 total)

| Endpoint | Notes |
|---|---|
| `POST /api/delineate` | Basin delineation from outlet click (subprocess, locked) |
| `POST /api/multi-delineate` | Multi-basin (ara havza) delineation |
| `POST /api/import-basin` | Upload basin polygon from KML/KMZ/GeoJSON |
| `POST /api/basin-from-geometry` | Same as import-basin but input is GeoJSON, not a file — used after on-map editing |
| `POST /api/kmz-export` | Basin + streams + selected method's Q2–Q10000 → .kmz |
| `POST /api/raster-add` | Upload georeferenced raster basemap (`?crs=EPSG:…` if the file has none) |
| `POST /api/raster-delete` | Remove a raster basemap |
| `POST /api/bilgi-katmani` | Non-computation map layer import (any vector format) |
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
