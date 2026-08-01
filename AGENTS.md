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
python backend/tests/test_tfa_golden.py               # NTFA golden (ornek.xlsm, 6 distributions)
python backend/tests/test_btfa_golden.py              # BTFA golden (Karamandere index-flood)
python backend/tests/test_mmy_golden.py               # MMY golden (Hershfield PMP, 2 workbooks)
python tools/mdb_akarsu_cikar.py <Kaynak_Akarsu.mdb>  # one-off: MDB -> data/akarsu/akarsu.sqlite
python tools/akarsu_sikistir.py                       # one-off: recode an old float32 akarsu.sqlite
python tools/agi_veritabani_olustur.py <pik.csv>      # one-off: peaks CSV -> data/agi/agi.sqlite
python tools/su_veritabani_olustur.py <Data.db>       # one-off: daily flows -> data/su/su.sqlite
python tools/mgm_veritabani_olustur.py                # one-off: DMI-tümü/*.xls -> data/mgm/mgm.sqlite
python tools/awc_soilgrids.py                         # one-off: SoilGrids -> data/yagis/awc*_tr.tif (run FIRST)
python tools/yagis_haritasi_indir.py                  # one-off: CHELSA -> data/yagis/{yagis,pet,net}_tr.tif
python tools/net_yagis_dogrulama.py                   # validate net layer vs AGİ gauges (slow: DEM delineation)
python tools/net_yagis_dogrulama.py --yeniden-oku     # re-score saved basins against the current layer (fast)
python tools/net_kalibrasyon.py [--uygula]            # fit budget params to gauges; --uygula writes su_butcesi.py
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
  yagis.py              — Climate layers (CHELSA v2.1, ~1 km): precipitation, PET
                          and net precipitation (≈ runoff depth). Colour-ramped
                          XYZ tiles, point query, basin areal means. Net is NOT
                          P−PET: PET exceeds P over most of Turkey, so that
                          difference is a climatic deficit, not runoff. Net comes
                          from a MONTHLY Thornthwaite-Mather balance with a
                          degree-day snow model (tools/su_butcesi.py — shared by
                          the map generator AND the calibrator, deliberately:
                          two copies could drift and then the calibrated model
                          would not be the shipped one). Annual totals hide
                          Turkey's wet-winter/dry-summer contrast.
                          CALIBRATED against 41 natural stream gauges: raw
                          NSE +0.42 / -35% bias, calibrated +0.72 / +1%,
                          5-fold cross-validated +0.58. Weak in Ege/Marmara
                          (NSE 0.01) and +44% in the Aras basin — known, open.
                          nodata is 65535, NOT 0: zero runoff is a legitimate
                          value over closed basins (Konya: P=389, AET=389, net=0).
                          Any masking here must compare against src.nodata.
  tfa.py                — NTFA: at-site flood frequency analysis (6 distributions + K-S)
  btfa.py               — BTFA: regional index-flood + Dalrymple homogeneity test
  mmy.py                — MMY: Hershfield probable maximum precipitation (PMP)
  su.py                 — Water potential: basin → nearby gauges → record gaps →
                          regression gap-filling → area-ratio transfer to the outlet
  agi.py                — AGİ annual-peak database (SQLite R*Tree, bbox/polygon query)
  mgm.py                — MGM weather-station database (1290 stations, every
                          observation sheet). Supplies P2…P100 for step 5 by
                          running tfa.py on each station's annual maximum daily
                          rainfall — same six distributions, same K-S choice,
                          rainfall in mm instead of discharge.
                          data/tables/mgm_plv_2020.json IS NO LONGER A P24
                          SOURCE; /api/mgm-stations deliberately strips its P24
                          field and serves only pluviograph (PLV) ratios. Two
                          parallel rainfall sources made it unknowable which one
                          a project actually used.
                          The step-4 Thiessen set IS this database, so step-5
                          matching is by `kod` — identity, not search. Coordinate
                          matching survives only for uploaded KMZs and
                          hand-placed points; there it prefers a ≥25-year record
                          inside the radius over a nearer short one (Lüleburgaz
                          has a 10-year gauge at 5.7 km, a 74-year one at 6.3).
frontend/             — 3 files: index.html, app.js (all logic), style.css
data/tables/          — 14 JSON tables (Excel-extracted; corine_c.json is a
                        CORINE class → rational C range matrix)
data/regions/         — YZD_ALANLAR.kmz (A/B/C polygons)
data/raster/          — uploaded raster basemaps + .json sidecars (gitignored)
data/akarsu/          — akarsu.sqlite, DSİ river network at 1/100k–1/500k
                        (405k lines, 68 MB, committed). Geometry is delta+varint
                        +zlib (see `akarsu.kodla`): raw float32 pairs made the
                        file 105 MB, over GitHub's 100 MB limit, so the layer
                        never reached the deployed instance. Old float32 files
                        still decode — `meta.geometri` selects the format.
data/agi/             — agi.sqlite, DSİ+EİE annual peak flows 1935–2020
                        (2732 stations / 36.5k station-years, 3.8 MB)
data/su/              — su.sqlite, daily flows 1934–2015 (2909 stations,
                        8.9M days). Built from the 1.68 GB Data.db; each
                        station's series is one zlib'd float32 blob (NaN =
                        missing day), which is why it fits in 11.5 MB and why
                        a whole station reads in one row.
```
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
data/stations/bir_cikti.kml  — legacy 2315-station network, NO LONGER auto-loaded.
                               It carries no station number, so it cannot be
                               joined to the measurement DB by identity and its
                               cells borrowed rainfall from a neighbour. Kept on
                               disk; still uploadable through /api/stations.
data/mgm/mgm.sqlite          — MGM observation sheets, 1290 stations (13 MB).
                               1184 of them (≥10 yr) ARE the step-4 Thiessen set.
data/akarsu/akarsu.sqlite    — DSİ river network (405k lines, 68 MB, committed)
data/agi/agi.sqlite          — DSİ+EİE annual peak flows (2732 stations, 3.8 MB)
data/su/su.sqlite            — daily flows 1934–2015 (2909 stations, 11.5 MB)
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
| `GET /api/yagis-bilgi` | Installed climate layers + colour-ramp legends |
| `GET /api/yagis/{katman}/{z}/{x}/{y}.png` | XYZ tiles per layer (`yagis`/`pet`/`net`; 204 out of coverage) |
| `GET /api/yagis-nokta` | P, PET, AET and net precipitation at a point (mm/yr) |
| `POST /api/yagis-havza` | Areal means over a basin + derived AET and runoff coefficient |
| `GET /api/mgm-bilgi` | Whether the MGM weather database is installed; how many stations are long enough for frequency analysis |
| `GET /api/mgm` | MGM stations in a bbox (`bati/guney/dogu/kuzey`, `en_az_yil`) |
| `GET /api/mgm-seri` | A station's annual-maximum series, or any observation type (`tur`) |
| `POST /api/mgm-frekans` | Rainfall frequency analysis for one station → P2…P100 (`P24`) |
| `POST /api/mgm-eslestir` | Match Thiessen stations to MGM stations and compute their P2…P100 |
| `GET /api/agi-bilgi` | Whether the AGİ peak-flow database is installed; station/record counts |
| `GET /api/agi` | AGİ stations in a bbox (`bati/guney/dogu/kuzey`, `en_az_yil`, `kurum`) |
| `POST /api/agi-havza` | AGİ stations inside/around a basin polygon (`tampon_derece`) |
| `GET /api/agi-seri` | One station's annual peak series (`kod`, year range, confidence filter) |
| `POST /api/tfa` | NTFA — at-site frequency analysis from a station code or a raw series |
| `POST /api/btfa` | BTFA — regional index-flood from several station codes + basin area |
| `GET /api/mmy-bolgeler` | Regions that have a Km envelope curve (for MMY) |
| `POST /api/mmy` | MMY — Hershfield PMP from an annual max daily rainfall series |
| `GET /api/su-bilgi` | Whether the daily-flow (water potential) database is installed |
| `GET /api/su-istasyon` | Daily-flow stations in a bbox (`en_az_yil` filters short records) |
| `POST /api/su` | Water potential: Qort, monthly split, annual volume, FDC, supply reliability |
| `POST /api/su-havza` | Daily-flow stations inside/around a basin polygon (`tampon_derece`) |
| `POST /api/su-periyot` | Station × water-year record status (tam/eksik/yok) + pairwise regressions |
| `POST /api/su-tamamla` | Fill a station's missing years by regression, then transfer to the outlet |
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
| `GET /api/stations/default` | Default Thiessen set: MGM stations with ≥`en_az_yil` of rainfall record |
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
- **NTFA** (`tfa.py`): moment fits for Normal / Log-Normal 2P & 3P / Pearson-3 /
  Log-Pearson-3 / Gumbel; plotting position m/(N+1); the distribution with the
  smallest Smirnov-Kolmogorov Dmax is the accepted one. Golden-matched to
  `ornek.xlsm`, so three template quirks are reproduced deliberately: the normal
  tail uses √(44/7) instead of √(2π), its 3rd polynomial coefficient is
  1.78147937 (literature: 1.781477937), and the Normal Dmax carries a +0.01
  penalty (`SONUÇLAR!AD27`). Changing any of these can flip which distribution
  is accepted — see `NORMAL_DMAX_DUZELTME` and `_CDF_B`.
- **BTFA** (`btfa.py`): index-flood. Each station's accepted at-site fit gives
  Q2…Q100; the dimensionless ratios QT/Q2 are averaged into a regional growth
  curve; the basin's index flood comes from Q2 = a·A^b and Q_T = Q2·(QT/Q2).
  Q500+ reuse the app-wide extrapolation. Golden-matched to
  `Karamandere NTFA-BTFA.xlsx` (T7.2BTFA). **The exponent in that workbook
  (0.8968) is not reproducible from its own 15 stations** — least squares gives
  0.0827·A^1.3146 — so it was entered by hand. The fit is therefore computed and
  reported, but `us`/`katsayi` let the caller pin the report's number.
  Homogeneity is Dalrymple (1960): each station's own Q10/Q2 is read back onto
  the regional curve as an equivalent T, compared against the Gumbel-reduced-
  variate 95% band `y10 ± 1.96·sqrt(1+1.1396K+1.1K²)/√n`. The band is also
  returned as an envelope over record length (`homojenlik.zarf`) for plotting.
  `aykiri_disla=True` reruns the whole analysis without the failing stations and
  attaches it as `aykirisiz`, so both sets of discharges can be compared.
- **MMY** (`mmy.py`): Hershfield PMP,
  `MMY = Port·M1·M2 + Km·S·M1·M2`, Km read from a regional envelope
  (`data/tables/mmy_km.json`, 9 regions extracted from the source workbook's
  X-KM sheet) using **Excel LOOKUP step semantics against the ADJUSTED mean** —
  interpolating instead would not reproduce the workbook. The M1/M2 chart
  factors are inputs (default 1.0): the source workbooks hold them as
  macro-written literals, the charts themselves are not in the files, and
  inventing a curve would silently shift the result. The output feeds the
  existing `P24_OET` input, which already yields QOET (the PMF).
