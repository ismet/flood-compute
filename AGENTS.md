# Memory

## Project Overview
Taşkın Hesap — Sentetik Yöntemler Web Uygulaması. A FastAPI web application that replicates
the Excel-based flood hydrology workbook `11.Tayakadın Deresi SENTETİK YÖNTEMLER TABLOLU.xlsm`
with machine-precision accuracy (≈1e-16 verified in `backend/tests/test_golden.py`).

**Stack:** Python 3 (FastAPI + uvicorn), vanilla HTML/CSS/JS frontend (Leaflet map).
No npm/pnpm — this is a Python project. Dependencies are in `requirements.txt`.

**Entry point:** `python run.py` → http://127.0.0.1:8737

## Project Structure

```
backend/
  main.py              — FastAPI app, all API endpoints, request models
  core/                — Computation engine (no framework dependency)
    engine.py          — DSİ Sentetik, Mockus methods, hydrograph computation
    gis.py             — GIS: multi-delineate, DEM/Copernicus GLO-30
    rational.py        — Rasyonel method
    snyder.py          — Snyder synthetic unit hydrograph
    reservoir.py       — Storage-Indication / Modified Puls routing
    routing.py         — Multi-basin hydrograph routing
    corine.py          — CORINE land cover → CN lookup
    corine_online.py   — EEA CLC2018 WMS downloader
    thiessen.py        — Thiessen polygon weights
    snowmelt.py        — Degree-day snowmelt model
    report.py          — Word (.docx) report generator
    tables.py          — Table loader (JSON files from data/tables/)
    yzd_region.py      — YZD regional classification (A/B/C)
    _delineate_subprocess.py       — Single basin delineation subprocess
    _multi_delineate_subprocess.py — Multi-basin delineation subprocess
  tests/
    test_golden.py          — DSİ/Mockus golden tests (49 peaks + BH)
    test_snyder_golden.py   — Snyder golden tests
    test_reservoir_golden.py — Reservoir routing golden tests
    test_api_smoke.py       — API end-to-end smoke test
frontend/
  index.html           — Single-page app (6-step wizard + multi-basin + reservoir)
  app.js               — All client-side logic, Leaflet map, API calls
  style.css            — All styles
data/
  dem/                 — Optional local DEM GeoTIFFs; auto-downloads Copernicus GLO-30
  corine/              — Optional local CORINE; auto-downloads from EEA CLC2018
  tables/              — Extracted Excel tables (JSON): BH2, YZD, ABAK2, DPLV, CN, etc.
  stations/            — Default station set (DMİ.kmz, 684 stations)
  regions/             — YZD regional polygons (YZD_ALANLAR.kmz, A/B/C)
  projects/            — Saved projects (JSON)
tools/
  extract_tables.py    — Extract tables from Excel workbooks
  extract_mgm_plv.py   — Extract MGM 2020 PLV data from Excel
```

## Architecture Notes
- **GIS operations run in subprocesses** (`_delineate_subprocess.py`) with a global lock
  (`_delineate_lock`) to prevent concurrent pyflwdir+numba memory issues. Output is
  JSON on stdout; the parent process parses the last line.
- **Lazy imports**: heavy GIS modules (pyflwdir, rasterio, numba) are imported inside
  endpoints, not at module level — keeps startup memory low (~30MB, GIS adds ~150MB).
- **CN lookups** auto-download CORINE from EEA CLC2018 WMS if local raster missing.
  RGB pixels classified by nearest-legend-color Manhattan distance with a 36-channel tolerance.
- **DEM** auto-downloads Copernicus GLO-30 tiles (S3) if local GeoTIFFs missing.
  Cached in `data/dem/cache/`.
- **All computation is stateless** — the client sends full state, server computes, returns results.
- **Project persistence** is JSON files in `data/projects/`.
- **Data pipeline**: Excel workbooks → `tools/extract_tables.py` (openpyxl) → `data/tables/*.json`.
  All tables loaded via `tables.load()` with `@lru_cache` — no database.
- **Module foundation**: `tables.py` is the data layer consumed by all other modules.
  Provides 6 interpolation helpers: `yad_abak2`, `plv_ratio`, `yzd`, `cn2_to_cn3`,
  `yzdo`, `yad_at_datagir_durations`.

### Core Computation Formulas (engine.py)

- **Harmonic slope**: `S = (10 / Σ(1/√(ℓ/Δh)))²` where ℓ = L/10
- **Kirpich Tc** (metric): `Tc = 0.0003245 × L^0.77 / S^0.385` hours
- **DSİ synthetic Qp**: `qp = 414 × A^(-0.225) × (L·Lc/√S)^(-0.16)` L/s/km²/mm
- **SCS runoff**: `Q = (P - 0.2S)²/(P + 0.8S)` where S = (1000/CN - 10) × 25.4
- **Superposition**: 2-hour blocks of BH2 dimensionless UH shifted and summed (DSİ);
  tr-hour blocks with YZDO distribution (Snyder)
- **Extrapolation**: Q500/1000/10000 derived linearly from Q10–Q100 delta
- **Return period inverse**: `T = 10^((x+0.98)/0.99)` where x = (Q-Q10)/(Q100-Q10)

### Reservoir Routing (reservoir.py)

- **Storage-Indication**: `(2S/Δt+O)₁ = (I₀+I₁) + (2S/Δt-O)₀` → O from φ⁻¹ lookup
- **Spillway geometry**: `Q = C·L_e·He^1.5` with effective length `L_e = L + 2·He·tan(θ)`
- **C coefficient** from USBR P/He curve (8 breakpoints, P/He 0→3.0, C 1.70→2.225)
- **Gated (controlled)**: `Q = (2/3)√(2g)·C·n·Lef·(H1^1.5 - H2^1.5)` + peak-shaving
  optimization via binary search for minimum outlet cap respecting H ≤ H_max

### Frontend Architecture (~1750 lines app.js)

- **Single global state** object `S` tracks outlet, basin geojson, elevations, stations,
  Thiessen weights, rainfall, computation results, multi-basin state, reservoir state.
- **6-step wizard**: Havza → Parametre → CN → Thiessen → Yağış → Hesap
  Steps auto-activate next when data is ready (e.g., CN auto-fills from delineation).
- **Multi-basin mode**: Mansap + N Memba clicks → auto-delineate → auto-compute all
  sub-basins (CN + Thiessen + hydrograph per sub-basin) → route with lag = ara Tc.
- **Charts**: Chart.js for all hydrograph plots. Three full-screen panels:
  hydrograph viewer (DSİ/Snyder per duration), method comparison (bar + overlaid),
  multi-basin component breakdown.
- **Editable grids**: `makePasteGrid()` factory creates tab-separated paste-supported
  tables (rainfall data, reservoir volume/rating). Used throughout the UI.
- **Word report**: Checkbox-based method selection + selected method + section number.
  Downloads .docx directly from `/api/report`.

## Code Style Guidelines
- Python code in Turkish: variable names, comments, error messages, API field names
- Frontend in Turkish: UI labels, messages; JS variable names mixed Turkish/English
- Follow existing patterns — `_err(e)` helper for all endpoint error handling
- Lazy imports for heavy modules inside endpoint functions
- Use `from backend.core import X` imports inside endpoints, not at module top
- Extract complex conditions into meaningful boolean variables
- Use descriptive variable names

## Common Commands

```bash
# Run the app (development)
python run.py

# Run tests
python backend/tests/test_golden.py
python backend/tests/test_snyder_golden.py
python backend/tests/test_reservoir_golden.py
python backend/tests/test_api_smoke.py

# Docker build
docker build -t taskin-hesap .

# Extract tables from Excel (if Excel files updated)
python tools/extract_tables.py
python tools/extract_mgm_plv.py
```

## Key API Endpoints
- `POST /api/delineate` — Single basin delineation from outlet click
- `POST /api/multi-delineate` — Multi-basin (ara havza) delineation
- `POST /api/compute` — Run all flood computation methods (DSİ, Mockus, Rasyonel, Snyder)
- `POST /api/cn` — CORINE Curve Number calculation
- `POST /api/thiessen` — Thiessen polygon weights
- `POST /api/route` — Hydrograph routing for multi-basin
- `POST /api/reservoir-route` — Reservoir flood routing (Storage-Indication)
- `POST /api/reservoir-controlled` — Controlled spillway optimization
- `POST /api/report` — Generate Word (.docx) report
- `POST /api/yil-ara` — Return period interpolation from Q/Q10/Q100
- `POST /api/rainfall/parse` — Parse pasted rainfall tabular data
- `POST /api/project/save`, `GET /api/project/list`, `GET /api/project/load/{ad}` — Project persistence
- `GET /api/mgm-stations` — MGM 2020 PLV station data (236 stations, 14 PLV ratios each)
- `GET /api/dplv` — DPLV station list (rainfall distribution curves)
- `GET /api/geocode` — OSM Nominatim address search proxy (Turkey)
- `GET /api/stations/default` — Load default station set (data/stations/ DMİ.kmz)
- `POST /api/stations` — Upload custom station KMZ/KML
- `GET /api/snyder-ctcp` — Snyder Ct-Cp abacus table (log-log interpolation)
- `GET /api/abak2` — ABAK2 areal reduction table
- `GET /api/reservoir-defaults` — Söylemez reservoir defaults (volume-area, rating)
- `GET /api/reservoir-controlled-defaults` — Gated spillway defaults

## Tests
- Golden tests verify outputs match Excel down to machine precision (≈1e-16)
- `test_golden.py`: DSİ/Mockus — 49 peak values + BH ordinates + pre-computation
- `test_snyder_golden.py`: Snyder — parameters + Q2–Q100 peaks
- `test_reservoir_golden.py`: Reservoir routing — outflow peak, max water level, attenuation
- `test_api_smoke.py`: End-to-end API smoke test (DPLV, rainfall parse, Thiessen, compute,
  return period, snowmelt, rational, project save/load — no DEM download needed)
