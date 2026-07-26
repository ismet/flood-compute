# Taşkın Hesap — Sentetik Yöntemler Web Uygulaması

A FastAPI web application that replicates the Excel-based flood hydrology workbook
`11.Tayakadın Deresi SENTETİK YÖNTEMLER TABLOLU.xlsm` with machine-precision accuracy
(≈1e-16 verified in `backend/tests/test_golden.py`).

**Stack:** Python 3 (FastAPI + uvicorn), vanilla HTML/CSS/JS frontend (Leaflet + Chart.js).
No npm/pnpm — this is a Python project. Dependencies are in `requirements.txt`.

**Entry point:** `python run.py` → http://127.0.0.1:8737

## Project Structure

```
backend/
  main.py              — FastAPI app, all API endpoints, request models, HTTP Basic auth
  core/                — Computation engine (no framework dependency)
    engine.py          — DSİ Sentetik, Mockus methods, hydrograph computation
    gis.py             — Basin delineation, multi-delineate, DEM/Copernicus GLO-30
    rational.py        — Rasyonel method (A ≤ 1 km² basins)
    snyder.py          — Snyder synthetic unit hydrograph
    reservoir.py       — Storage-Indication / Modified Puls routing + controlled gates
    routing.py         — Multi-basin hydrograph routing (ara havza)
    corine.py          — CORINE land cover → CN lookup (local + online)
    corine_online.py   — EEA CLC2018 WMS downloader + RGB→class classifier
    thiessen.py        — Thiessen polygon weights from KMZ station files
    snowmelt.py        — Degree-day snowmelt model (KAR1)
    report.py          — Word (.docx) flood report generator (Bölüm 4.7.x formatı)
    tables.py          — Table loader (JSON from data/tables/), interpolation helpers
    yzd_region.py      — YZD regional classification (A/B/C) from basin overlap
    dilekce.py         — MGM data request petition generator (.docx / .pdf)
    _delineate_subprocess.py       — Single basin delineation subprocess
    _multi_delineate_subprocess.py — Multi-basin delineation subprocess
  tests/
    test_golden.py          — DSİ/Mockus golden tests (49 peaks + BH + önhesap)
    test_snyder_golden.py   — Snyder golden tests (parameters + Q2–Q100 peaks)
    test_reservoir_golden.py — Reservoir routing golden tests
    test_api_smoke.py       — API end-to-end smoke test
frontend/
  index.html           — Single-page app (6-step wizard + multi-basin + reservoir + dilekçe)
  app.js               — All client-side logic (~1900 lines), Leaflet map, API calls, Chart.js
  style.css            — All styles
data/
  dem/                 — Optional local DEM GeoTIFFs (EPSG:4326); auto-downloads Copernicus GLO-30
  corine/              — Optional local CORINE; auto-downloads from EEA CLC2018
  tables/              — Extracted Excel tables (JSON): BH2, YZD, ABAK2, DPLV, CN, etc.
  stations/            — Default station set (bir_cikti.kml, MGM istasyon ağı)
  regions/             — YZD regional polygons (YZD_ALANLAR.kmz, A/B/C)
  projects/            — Saved projects (JSON)
  dilekce/             — Petition assets (default signature/stamp, fonts)
tools/
  extract_tables.py    — Extract tables from Excel workbooks
  extract_mgm_plv.py   — Extract MGM 2020 PLV data from Excel
```

## Architecture Notes

- **GIS operations run in subprocesses** with a global lock (`_delineate_lock`) to prevent
  concurrent pyflwdir+numba memory issues. Output is JSON on stdout; parent parses last line.
- **Lazy imports**: heavy GIS modules (pyflwdir, rasterio, numba, shapely) are imported
  inside endpoints, not at module level — keeps startup memory low.
- **CN lookups**: auto-download CORINE from EEA CLC2018 WMS if local raster missing.
  RGB pixels classified by nearest-legend-color Manhattan distance with 36-channel tolerance.
  Cached in `data/corine/cache/`.
- **DEM**: auto-downloads Copernicus GLO-30 tiles (S3) if local GeoTIFFs missing.
  Cached in `data/dem/cache/`. Downsampled to ~110m resolution by default.
- **All computation is stateless** — the client sends full state, server computes, returns results.
- **Project persistence**: JSON files in `data/projects/`.
- **Data pipeline**: Excel workbooks → `tools/extract_tables.py` (openpyxl) → `data/tables/*.json`.
  All tables loaded via `tables.load()` with `@lru_cache` — no database.
- **Module foundation**: `tables.py` is the data layer consumed by all other modules.
  Provides interpolation helpers: `yad_abak2`, `plv_ratio`, `yzd`, `cn2_to_cn3`,
  `yzdo`, `yad_at_datagir_durations`.

### Core Computation Formulas (engine.py)

- **Harmonic slope**: `S = (10 / Σ(1/√(ℓ/Δh)))²` where ℓ = L/10
- **Kirpich Tc** (metric): `Tc = 0.0003245 × L⁰·⁷⁷ / S⁰·³⁸⁵` hours
- **DSİ synthetic Qp**: `qp = 414 × A⁻⁰·²²⁵ × (L·Lc/√S)⁻⁰·¹⁶` L/s/km²/mm
- **SCS runoff**: `Q = (P - 0.2S)²/(P + 0.8S)` where S = (1000/CN - 10) × 25.4
- **Superposition**: 2-hour blocks of BH2 dimensionless UH shifted and summed (DSİ);
  tr-hour blocks with YZDO distribution (Snyder)
- **Extrapolation**: Q500/1000/10000 = Q10 + k·(Q100−Q10) where k=[1.692, 1.99, 2.98]
- **Return period inverse**: `T = 10^((x+0.98)/0.99)` where x = (Q−Q10)/(Q100−Q10)

### Reservoir Routing (reservoir.py)

- **Storage-Indication**: `(2S/Δt+O)₁ = (I₀+I₁) + (2S/Δt−O)₀` → O from φ⁻¹ lookup
- **Uncontrolled spillway**: `Q = C·L_e·He¹·⁵` with `L_e = L + 2·He·tan(θ)`
- **C coefficient** from USBR P/He curve (8 breakpoints, P/He 0→3.0, C 1.70→2.225)
- **Controlled (gated)**: `Q = (2/3)√(2g)·C·n·Lef·(H1¹·⁵−H2¹·⁵) + W1`
  Binary search optimization for minimum outlet cap respecting H ≤ H_max (peak-shaving)

### Multi-Basin Routing (routing.py)

- **Ara havza = mansap − ∪memba** (area-conserving)
- Memba hydrographs lagged by ara havza Tc, then superposed onto ara havza hydrograph
- DSİ and Snyder use real superposition; Mockus and Rasyonel use triangular approximation
- Each method routed independently; results provide method × return-period peak matrix

### Frontend Architecture (~1900 lines app.js)

- **Single global state** object `S` tracks all application state
- **6-step wizard**: Havza → Parametre → CN → Thiessen → Yağış → Hesap
- **Multi-basin mode**: Mansap + N Memba clicks → auto-delineate → auto-compute → route
- **Chart.js** for all hydrograph plots (individual, comparison, multi-basin components)
- **Editable grids**: `makePasteGrid()` factory for spreadsheet-like tables with Ctrl+V paste
- **Method comparison** panel: peak discharge bar chart + overlay hydrographs for selected return period
- **Reservoir routing** panel: input hydrograph selection, volume-area tables, rating curves,
  uncontrolled/controlled spillway modes, output charts + tables + CSV export
- **Dilekçe (petition) mode**: station grid from Thiessen or manual, data types, contact info,
  signature/stamp image upload, Word/PDF output

## Code Style

- Python code in Turkish: variable names, comments, error messages, API field names
- Frontend in Turkish: UI labels, messages; JS variable names mixed Turkish/English
- Follow existing patterns — `_err(e)` helper for all endpoint error handling
- Lazy imports for heavy modules inside endpoint functions
- Use `from backend.core import X` imports inside endpoints, not at module top
- GIS subprocess modules are entry points (`if __name__ == "__main__"`) for `python -m`

## Key API Endpoints

| Endpoint | Description |
|---|---|
| `POST /api/delineate` | Single basin delineation from outlet click |
| `POST /api/multi-delineate` | Multi-basin (ara havza) delineation |
| `POST /api/compute` | Run all flood computation methods |
| `POST /api/cn` | CORINE Curve Number calculation |
| `POST /api/thiessen` | Thiessen polygon weights |
| `POST /api/route` | Hydrograph routing for multi-basin |
| `POST /api/reservoir-route` | Reservoir flood routing (Storage-Indication) |
| `POST /api/reservoir-controlled` | Controlled spillway optimization |
| `POST /api/report` | Generate Word (.docx) flood report |
| `POST /api/dilekce` | Generate MGM data request petition (.docx/.pdf) |
| `GET /api/dilekce-defaults` | Petition default contact/signature info |
| `GET /api/dilekce-imza` | Default signature/stamp image preview |
| `POST /api/yil-ara` | Return period from Q/Q10/Q100 (analytical inverse) |
| `POST /api/rainfall/parse` | Parse pasted rainfall tabular data |
| `POST /api/stations` | Upload custom station KMZ/KML |
| `GET /api/stations/default` | Load default station set |
| `GET /api/mgm-stations` | MGM 2020 PLV station data (236 stations) |
| `GET /api/dplv` | DPLV station list |
| `GET /api/geocode` | OSM Nominatim address search (Turkey) |
| `GET /api/snyder-ctcp` | Snyder Ct-Cp abacus table |
| `GET /api/abak2` | ABAK2 areal reduction table |
| `GET /api/reservoir-defaults` | Söylemez reservoir defaults |
| `GET /api/reservoir-controlled-defaults` | Gated spillway defaults |
| `POST /api/yzd-region` | YZD region classification from basin polygon |
| `POST /api/project/save` | Save project to JSON |
| `GET /api/project/list` | List saved projects |
| `GET /api/project/load/{ad}` | Load saved project |
| `DELETE /api/project/{ad}` | Delete saved project |

## Tests

- Golden tests verify outputs match Excel down to machine precision (≈1e-16)
- `test_golden.py`: DSİ/Mockus — 49 peak values + BH ordinates + pre-computation
- `test_snyder_golden.py`: Snyder — parameters + Q2–Q100 peaks
- `test_reservoir_golden.py`: Reservoir routing — outflow peak, max water level, attenuation
- `test_api_smoke.py`: End-to-end API smoke test

## Common Commands

```bash
python run.py                                    # Run the app
python backend/tests/test_golden.py              # DSİ/Mockus golden tests
python backend/tests/test_snyder_golden.py       # Snyder golden tests
python backend/tests/test_reservoir_golden.py    # Reservoir golden tests
python backend/tests/test_api_smoke.py           # API smoke test
python tools/extract_tables.py                   # Extract tables from Excel
python tools/extract_mgm_plv.py                  # Extract MGM PLV data

docker build -t taskin-hesap .                   # Docker build
docker run -d -p 8737:8737 -e APP_PASSWORD=... \
  -v taskin_data:/app/data taskin-hesap          # Docker run
```
