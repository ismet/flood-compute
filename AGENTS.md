# Taşkın Hesap - Sentetik Yöntemler Web Uygulaması

**Stack:** Python 3 (FastAPI + uvicorn) + vanilla HTML/CSS/JS (Leaflet + Chart.js).
No JS build tooling.
Port **8737**, not 8000 - see `run.py:13-14`, `Dockerfile`, `taskin-hesap.service`.

**Entry:** `python run.py` → opens http://127.0.0.1:8737 (auto-opens browser only on localhost)

**Virtual environment:** `.venv/` at project root, built for the system python3 (3.14 as of 2026-08; check `python3 --version`; 3.13 no longer on host).
Activate before running commands.
System `python3` lacks `pyflwdir`/`rasterio`/`shapely`.
If `import uvicorn` fails while `site-packages/` shows it, the venv was built for a different interpreter - rebuild with `python3 -m venv --clear .venv && .venv/bin/pip install -r requirements.txt` (needs `python3.X-venv` matching `python3 --version`).

## Commands

```bash
python run.py                                         # dev server (port 8737)
# tests
python backend/tests/test_golden.py                   # DSİ/Mockus golden (49-peak KABULET matrix)
python backend/tests/test_snyder_golden.py           # Snyder golden
python backend/tests/test_reservoir_golden.py        # reservoir routing golden
python backend/tests/test_api_smoke.py               # API smoke (FastAPI TestClient)
python backend/tests/test_kmz_export.py              # KMZ writer round-trip
python backend/tests/test_raster.py                  # raster basemap XYZ tiles + CRS
python backend/tests/test_corine_c.py                # CORINE → rational C derivation
python backend/tests/test_akarsu.py                  # DSİ river layer (skips if data absent)
python backend/tests/test_kenetleme.py               # outlet snap jump warning (no DEM needed)
python backend/tests/test_tfa_golden.py              # NTFA golden (ornek.xlsm, 6 distributions)
python backend/tests/test_btfa_golden.py             # BTFA golden (Karamandere index-flood)
python backend/tests/test_mmy_golden.py              # MMY golden (Hershfield PMP, 2 workbooks)
python backend/tests/test_frontend_modules.py        # frontend ESM module-graph guard (missing/rank/cycle/orphan)
# one-off data builders
python tools/mdb_akarsu_cikar.py <Kaynak_Akarsu.mdb> # one-off: MDB -> data/akarsu/akarsu.sqlite
python tools/akarsu_sikistir.py                      # one-off: recode an old float32 akarsu.sqlite
python tools/agi_veritabani_olustur.py <pik.csv>     # one-off: peaks CSV -> data/agi/agi.sqlite
python tools/su_veritabani_olustur.py <Data.db>      # one-off: daily flows -> data/su/su.sqlite
python tools/mgm_veritabani_olustur.py                # one-off: DMI-tümü/*.xls -> data/mgm/mgm.sqlite
python tools/awc_soilgrids.py                        # one-off: SoilGrids -> data/yagis/awc*_tr.tif (run FIRST)
python tools/zemin_grubu_uret.py                     # one-off: SoilGrids -> data/zemin/hsg_tr.tif
python tools/yagis_haritasi_indir.py                 # one-off: CHELSA -> data/yagis/{yagis,pet,net}_tr.tif
python tools/dem10_kes.py --havza <kmz>|--bbox b g d k  # one-off: 10 m DEM clip -> data/dem10/
python tools/agi_alan_tamamla.py [--kmz <DMI-kmz>] [--yaz]  # fill missing AGİ catchment areas
tools/mrsid_eklentisi_kur.sh <DSDK.tar.gz>          # build MrSID GDAL plugin (bare-metal Debian)
python tools/net_yagis_dogrulama.py                  # validate net layer vs AGİ gauges (slow: DEM delineation)
python tools/net_yagis_dogrulama.py --yeniden-oku     # re-score saved basins against current layer (fast)
python tools/net_kalibrasyon.py [--uygula]           # fit budget params; --uygula writes su_butcesi.py
python tools/extract_tables.py                       # regenerate JSON tables from Excel
python tools/extract_mgm_plv.py                      # extract MGM PLV data (needs Excel at repo root)
# deploy
systemctl {status|stop|start|restart} taskin-hesap   # systemd service (unit in repo root; uvicorn
                                                     # direct, NOT run.py - it opens a browser)
docker build -t taskin-hesap .                       # build Docker image
```

## Conventions

- **Turkish naming everywhere** (variables, comments, API fields, UI labels)
- **Lazy GIS imports** - import pyflwdir, rasterio, numba, shapely **inside endpoint functions**, never at module top
- **Tests run as `python` scripts** (not pytest).
  All use `sys.path.insert(0, ...)` before importing backend modules.
  Copy this pattern.
- **Stateless computation** - client sends full state, server returns results.
  No session (except project save/load under `data/projects/`).
- **No database** - `data/tables/*.json` (16 files) loaded via `backend.core.tables.load()` with `@lru_cache`
- **Error responses** always `{"hata": str(e)}` - use `_err(e)` from `backend.main` (returns `JSONResponse(status_code=400)`)
- **POST endpoints** accept Pydantic model JSON bodies; the four file-upload endpoints (`/api/stations`, `/api/raster-add`, `/api/import-basin`, `/api/bilgi-katmani`) take multipart `UploadFile`.
- **Golden tests need no Excel files** - expected values are hardcoded constants (docstrings cite the source workbook for provenance only); they read fixtures from `data/tables/*.json`.
- **Domain vocabulary lives in `CONTEXT.md`** (repo root) - canonical terms (Adım, Parametre, CN, Akış katsayısı C/C100, Thiessen kümesi) with `_Avoid_` synonyms; keep UI/docs wording consistent with it and add new resolved terms there.

## GIS delineation

Runs in a **subprocess** behind a global `threading.Lock` (delineate, multi-delineate, import-basin).
Acquire with `blocking=False`, return **503** if locked.
Prevents pyflwdir+numba scanline memory corruption.

**numba 0.66+ breaks pyflwdir's @njit calls on plain tuple* subclasses:** pyflwdir 0.5.12's njit `stream_distance`/`path` receive an `affine.Affine` and die with "Cannot determine Numba type of <affine.Affine>".
Wrapped by `_flw_gecici_transform` (gis.py) - hands the jit calls a plain float64 6-tuple, restores the Affine afterwards (other code needs `transform * (x,y)` / `~transform`).
Wrap ANY new pyflwdir njit call that passes a transform.

**Outlet snapping** uses "highest accumulation within snap_m" (ArcHydro/QGIS convention), which assumes the click is ON the channel and snap_m is a cell or two.
Default 500 m = ±18 cells on a 28 m DEM; widening walks to ever-larger rivers and the area never converges (Beyagac: 1000 m → 25 km², 2000 m → 215 km² - a *different* river sits 2 km away) - see `backend/core/gis.py:618,732`.
`_kenetleme_uyar` warns when the snap saturates the radius AND the result exceeds 1.5× the largest channel under the click - both conditions, because sliding downstream along the SAME channel also saturates but is harmless.

**National 10 m DEM (`DEM_10M`, default `<repo>/10M/tr10clip.img` - override via env; ~23.5 GB, gitignored - see `backend/core/gis.py:84`) is used TWO-STAGE via `delineate_iki_asamali`: 30 m finds the basin → boundary buffered → 10 m window clipped and reprojected to WGS84 → characteristics recomputed.
Stage two targets stage one's area.
Area agrees ~1%, but L/Lc come out 18%/43% LONGER at 10 m (channel length is scale-dependent and DSİ's Ct is calibrated to map-measured lengths), which inflates tp ~17% and depresses the peak; results warn to take area/elevations from 10 m, L/Lc from 30 m.
Clips travel in `data/dem10/` (`tools/dem10_kes.py`) so the 10 m option works without the 23.5 GB source; `_kesit_bul` prefers a covering clip.
Clips carry a **+300 m margin** - the app recomputes its window from its own stage-1 basin and a hand-rounded box misses by metres.
They live OUTSIDE `data/dem/`: that pool is a merge and merge imposes the first file's resolution.
10 m only pays below ~5000 km²: MAX_CELLS coarsens above (800 → 10 m, 2000 → 15.8, 7500 → 30.6 m) - see `backend/core/gis.py:59`.
Source WKT has no TOWGS84; PROJ picks "ED50 to WGS 84 (1)", declared accuracy 10 m - the gain is resolution, not absolute position.

Env vars: `DELINEATE_MAX_CELLS` (default 8_000_000, `backend/core/gis.py:59`), `SNAP_MAKS_ARAMA_M` (default 2000, `backend/core/gis.py:65`), `HOST`, `PORT`, `DEM_10M` (`backend/core/gis.py:84`), `APP_PASSWORD` (`backend/main.py:30`) - see `run.py:13-14`, `Dockerfile`, `taskin-hesap.service`.
Auth is **conditional**: set it and every request needs HTTP Basic (any username, password must match); unset, no auth at all.

## Architecture

```
backend/main.py    - FastAPI app, 66 routes (31 GET, 34 POST, 1 DELETE), Pydantic models, optional HTTP Basic auth (see env vars below)
backend/core/      - Computation engine (no framework dependency)
  engine.py        - DSİ Sentetik + Mockus + Kirpich Tc + SCS runoff (BH2 UH, 7×7 KABULET matrix)
  snyder.py        - Snyder synthetic UH (Ct·(L·Lc)^0.30; volume-balanced hydrograph)
  rational.py      - Rasyonel (A ≤ 1 km²)
  reservoir.py     - Storage-Indication / Modified Puls + controlled gate peak-shaving
  routing.py       - Multi-basin (ara havza) routing: Q_mansap(t) = Q_ara(t) + Σ Q_memba(t − Tc_ara)
  gis.py           - Delineation, DEM, 10 m two-stage, snapping, kenetleme (~1400 lines)
  tables.py        - data layer: `load()` JSON loader (lru_cache) + interpolators
  corine.py        - CORINE → CN mapping + rational C derivation (same pass)
  corine_online.py - EEA CLC2018 WMS downloader
  thiessen.py      - Voronoi/Thiessen weights from points
  snowmelt.py      - Degree-day snowmelt (KAR1)
  zemin.py         - Soil group A/B/C/D (see "most consequential input", formulas)
  yzd_region.py    - YZD region (A/B/C) from basin polygon
  report.py        - Word (.docx) flood report
  dilekce.py       - MGM petition (.docx/.pdf)
  _delineate_subprocess.py / _multi_delineate_subprocess.py / _import_basin_subprocess.py
                    - subprocess entry points (python -m backend.core…)
  vektor.py        - KML/KMZ/GeoJSON parser for basin import
  kmz_export.py    - KMZ *writer* (basin + streams + return-period peaks)
  raster.py        - Georeferenced rasters → XYZ tiles (reprojects to EPSG:3857)
  akarsu.py        - DSİ river layer (SQLite R*Tree). Geometry is delta+varint
                      +zlib (`kodla`): raw float32 pairs were 105 MB > GitHub's
                      100 MB cap. Old formats still decode - `meta.geometri` selects.
  yagis.py         - Climate layers (CHELSA v2.1): P, PET, net. Net is a MONTHLY
                     Thornthwaite-Matter + snowfall degree-day budget (budget code
                     SHARED with the calibrator: tools/su_butcesi.py), NOT P−PET - see `backend/core/yagis.py:17,152`.
                     Calibrated vs 41 natural gauges (NSE +0.72, 5-fold cv +0.58;
                     weak in Aegean/Marmara, +44% Aras - known, open). Nodata is
                     65535, NOT 0: zero runoff is legit (closed Konya basin). Any
                     masking MUST compare against src.nodata.
  tfa.py          - NTFA: 6 distributions, K-S accept, Grubbs-Beck (outliers
                     reported, never auto-applied). Also the engine for step-3
                     (Yağış - birleşik) rainfall P2…P100 per station. See golden quirks below.
  btfa.py         - BTFA regional index-flood + Dalrymple homogeneity (formulas)
  mmy.py          - MMY Hershfield PMP, regional Km envelope (formulas)
  su.py           - Water potential: gauge → regression gap-fill → area-ratio transfer
  agi.py          - AGİ peak DB (SQLite R*Tree). SCREENS OUT CORRUPT PEAKS BY
                     DEFAULT (seri_denetimli): the 1979–1986 yearbook extraction
                     glued a leading digit onto 118 records (D24A029 reads
                     9500 m³/s for 1981 vs 68–1033 in every other year, which
                     moved Q100 from 1301 to 7314). Two tests, either sufficient:
                     Creager C=100 envelope (skipped when catchment area is the
                     1.0 placeholder; those rows are springs/canals anyway) and
                     outlier-flagged AND >5× second-largest. Excluded rows are
                     RETURNED, never dropped (elenen_kayitlar).
  mgm.py          - MGM weather DB: supplies step-3 (Yağış - birleşik) P2…P100 by running tfa.py
                     + DPLV nearest PLV (`plv_en_yakin`, `_plv_haritasi`) for auto-selection
                     on each station's annual maximum daily rainfall - same six
                     distributions. data/tables/mgm_plv_2020.json is NOT a P24
                     source anymore; /api/mgm-stations deliberately strips its
                     P24 field (two parallel sources made it unknowable which one
                     a project used). Thiessen set IS this DB (Adım 3 üst kısım), so matching inside
                     same step is by `kod` identity; only uploaded KMZs/hand
                     points match by coordinate (prefer ≥25-yr record inside the
                     radius over a nearer short one - Lüleburgaz has 10-yr at
                     5.7 km, 74-yr at 6.3).
frontend/           - ESM native (no build): `app.js` (composition root — `setMode`/`activateStep`/`clearSingleBasin`/`overlay-Esc`/`?debug` seam) + `js/{core,ui,map,wizard,modes}`, `vendor/` self-hosted (Leaflet 1.9.4/Geoman 2.17.0/Chart.js 4.4.3 SRI); full map & layer contract (`map/wizard/modes → ui → core`, static DAG) in `frontend/MIGRATION.md` §3 — Dilekçe/Su sekmeleri CSS ile gizli (`frontend/style.css:175`, `display:none`; `frontend/js/modes/{su,dilekce}.js` ve backend korunur)
```

- **`S` singleton** (`frontend/js/core/state.js`) — global app state, no framework; slices owned per `frontend/MIGRATION.md` §3.1 (e.g. havza→outlet/havza/kotlar/dere/kanal, thiessen→istasyonlar/thiessen, rain→P24w/OETw, cn→CN, dplv→dplvManual/dplvAuto/dplvValues (MGM PLV + manuel), hesap→sonuc/girdi; `Object.assign(S,…)` only on project restore). Hazır istasyon (`dplvList`/TEKİRDAĞ/ÇORLU/KARTAL, `GET /api/dplv`) kaldırıldı — tek kaynak MGM PLV (236, `POST /api/plv-en-yakin` centroid) + manuel 14 oran. Self-wiring modules (listeners at import); `_esc()` mandatory for interpolations; status ids (`delinStatus` etc.) are **SHARED** channels — panels/tables owned, statuses not. Debug seam `?debug=1` gates `window.__fh={map,S,layers}` (no globals otherwise). `index.html` `/` + `/static/*.{js,css}` served `no-cache` (`backend/main.py:1484,1496`); vendor same. No `?v=` stamping.
- **Rejected decisions:** TS/framework builds (no build D-01) · CSP (deferred) · hashed assets (no-cache D-03) · state library (S singleton sufficient) · event delegation (self-wiring §3.1).
- Frontend table/UH data lives in `data/` JSON: `data/tables/*.json` (15 Excel-extracted lookup tables; do NOT edit by hand, regenerate with `tools/extract_tables.py` — DPLV hazır `dplv_stations.json` kaldırıldı, süre ekseni `backend/core/tables.py:DURATIONS_MIN` sabit)

## Data

Operator detail lives in README.md "Veri hazırlığı" (AGENTS keeps agent pointers + sizes from `ls -lh`, not prose copies).

```
data/regions/YZD_ALANLAR.kmz  YZD A/B/C polygons
data/corine/                 local CORINE 2018 (else EEA WMS → data/corine/cache/)
data/dem/ + data/dem/cache/  local 30 m DEMs & Copernicus GLO-30 tiles (merged pool)
data/dem10/                  repo-carried 10 m clips (tool: tools/dem10_kes.py)
data/dilekce/                petition assets: fonts + imza_kase_default.png
                                (referenced by core/dilekce.py; deleting breaks /api/dilekce)
data/yagis/                  - yagis/pet/net GeoTIFFs (CHELSA v2.1, ~1 km), plus awc*_tr.tif from SoilGrids
data/zemin/                  - hsg_tr.tif (soil group A/B/C/D, ~1 km)
data/akarsu/akarsu.sqlite    - DSİ river network (405k lines, 68 MB, committed)
data/agi/agi.sqlite          - DSİ+EİE annual peaks 1935–2020 (2732 stations / 36.5k st-yrs, 3.8 MB)
data/su/su.sqlite            - daily flows 1934–2015 (2909 stations, 11.5 MB; per-station
                                zlib'd float32 blob, NaN = missing day)
data/mgm/mgm.sqlite          - 1290 stations, 45k station-years (13 MB); 1184 (≥10 yr) = the Thiessen set
data/stations/bir_cikti.kml  - legacy 2315-station layer, NO LONGER auto-loaded (no station
                                numbers → can't join measurement DBs; cells borrowed rain
                                from neighbours). Uploadable manually.
data/raster/ (uploaded rasters, gitignored), data/projects/ (saved projects, gitignored)
```

**Git trap:** `.gitignore:27` `data/dem/aster30m/` is lowercase and does not match `data/dem/aster30M/` (capital M) on Linux.
`/aster30M/` at `.gitignore:32` only covers the repo root.
A bare `git add -A` would stage `data/dem/aster30M/` (~2.6 GB).
Stage paths explicitly - see `.gitignore:25-32`.

## External data

| Data | Source | Trigger |
|---|---|---|
| DEM (Copernicus GLO-30) | `copernicus-dem-30m.s3.amazonaws.com` → `data/dem/cache/` | First delineation (cache grows to GBs with use) |
| CORINE (CLC2018) | EEA WMS → `data/corine/cache/` | First CN computation |

## API endpoints (65 API total; main.py has 66 routes incl. the `/` index — `GET /api/dplv` 404 stub deprecated)

| Endpoint | Notes |
|---|---|
| `POST /api/delineate` | Basin delineation from a single outlet (subprocess, locked) |
| `POST /api/multi-delineate` | Multi-basin (ara havza) one-pass delineation |
| `POST /api/import-basin` | Basin polygon from KML/KMZ/GeoJSON file |
| `POST /api/basin-from-geometry` | Same, GeoJSON body - used after on-map editing |
| `POST /api/kmz-export` | kmz writer: basin + streams + selected Q2–Q10000 |
| `POST /api/raster-add` | Add a georeferenced raster basemap (`?crs=` if missing) |
| `GET /api/raster-converter` | MrSID→GeoTIFF converter installed? (UI warns for .sid) |
| `POST /api/raster-delete` / `GET /api/raster-layers` | Manage uploads |
| `POST /api/bilgi-katmani` | Non-computation map layer import |
| `GET /api/akarsu` (`bati/guney/dogu/kuzey`, `olcek`) / `GET /api/akarsu-bilgi` | DSİ river layer (bbox, 100/250/500 k) - context only |
| `GET /api/yagis-bilgi` / `GET /api/yagis/{katman}/{z}/{x}/{y}.png` | climate tiles (`yagis`/`pet`/`net`, 204 outside coverage) |
| `GET /api/yagis-nokta` / `POST /api/yagis-havza` | point / areal-mean climate queries |
| `GET /api/mgm-bilgi` / `GET /api/mgm` / `GET /api/mgm-seri` | MGM weather stations; series by `tur` |
| `POST /api/mgm-frekans` / `POST /api/mgm-eslestir` | P2–P100 per station / Thiessen-set match |
| `POST /api/plv-en-yakin` / `GET /api/plv-en-yakin` | DPLV için en yakın MGM PLV (havza centroid, küresel) |
| `GET /api/agi-bilgi` / `GET /api/agi` / `POST /api/agi-havza` / `GET /api/agi-seri` | AG peak-flow stations (bbox/polygon, seri filtering) |
| `POST /api/tfa` | NTFA - at-site frequency from station code or raw series |
| `POST /api/btfa` | BTFA - regional index-flood (station codes + area) |
| `GET /api/mmy-bolgeler` / `POST /api/mmy` | MMY regions + Hershfield PMP |
| `GET /api/su-bilgi` / `GET /api/su-istasyon` | Water-potential DB installed? / stations in bbox (`en_az_yil`) — UI CSS ile gizli, API aktif |
| `POST /api/su` / `POST /api/su-havza` | single-station metrics (Qort, monthly split, FDC, reliability) / stations near basin (`tampon_derece`) — UI gizli |
| `POST /api/su-periyot` / `POST /api/su-tamamla` | station×water-year record matrix + regressions / gap-fill + transfer to outlet — UI gizli |
| `GET /api/raster/{ad}/{z}/{x}/{y}.png` | XYZ tile service for uploaded basemaps (204 out of coverage) |
| `POST /api/compute` | All flood methods (DSİ, Mockus, optional rational/snyder/snowmelt) |
| `POST /api/cn` | CORINE → CN + rational C |
| `POST /api/thiessen` | Voronoi weights from basin + stations set |
| `POST /api/route` / `POST /api/reservoir-route` / `POST /api/reservoir-controlled` | routing (formulas § below) |
| `POST /api/report` / `POST /api/dilekce` | .docx report / MGM petition — Dilekçe UI CSS ile gizli, API aktif |
| `POST /api/yil-ara` | Return period given Q, Q10, Q100 (inverse) |
| `POST /api/rainfall/parse` | parse pasted rainfall tables |
| `POST /api/zemin-grubu` / `POST /api/yzd-region` | soil group / region, with reasoning |
| `POST /api/stations` | Station KMZ/KML upload (multipart) - custom Thiessen set |
| `GET /api/stations/default` / `GET /api/mgm-stations` | default Thiessen set / PLV stations |
| `GET /api/dplv` | **deprecated** 404 — Hazır kaldırıldı, `GET /api/mgm-stations` / `POST /api/plv-en-yakin` kullan |
| `GET /api/geocode` / `GET /api/snyder-ctcp` / `GET /api/abak2` | static data |
| `GET /api/reservoir-defaults` / `GET /api/reservoir-controlled-defaults` | Söylemez/ gated defaults |
| `GET /api/dilekce-defaults` / `GET /api/dilekce-imza` | petition defaults — UI CSS ile gizli, API aktif |
| `POST /api/project/save` · `GET /api/project/list` · `GET /api/project/load/{ad}` · `DELETE /api/project/{ad}` | project CRUD (JSON in `data/projects/`) |

## Core computation formulas

- **Harmonic slope**: S = (10 / Σ(1/√(ℓ/Δh)))², ℓ = L/10
- **Kirpich Tc (metric)**: Tc = 0.0003245 × L⁰·⁷⁷ / S⁰·³⁸⁵ (hours)
- **DSİ peak runoff coefficient**: qp = 414 · A⁻⁰·²²⁵ · (L·Lc/√S)⁻⁰·¹⁶ (L/s/km²/mm) - BH2 dimensionless unit hydrograph sampled at 0.5 h; storms 2/4/6/8/12/18/24 h sliced into 2 h blocks with the YZD curve and superposed through SCS incremental runoff → KABULET 7×7 matrix (= the 49 golden checks)
- **Mockus**: D = 2√Tc, K1/K2/K3 triangular UH - NOT superposed (only DSİ/Snyder superpose)
- **SCS runoff**: Q = (P − 0.2S)²/(P + 0.8S), S = (1000/CN − 10) × 25.4
- **Inverse/return extrapolation**: Q5…Q10K = Q10 + k·(Q100 − Q10), k = [1.692, 1.99, 2.98]; T = 10^((x+0.98)/0.99) where x = (Q−Q10)/(Q100−Q10)
- **NTFA** (`tfa.py` - see `backend/core/tfa.py:32,159-162`): moment estimates for Normal / LN-2P/3P / Pearson-3 / LP-3 / Gumbel; plotting position m/(N+1); smallest Smirnov-Kolmogorov Dmax accepted; golden-matched to `ornek.xlsm` (test_tfa_golden), **three template quirks reproduced deliberately**: normal tail √(44/7) instead of √(2π), 3rd poly coefficient 1.78147937 (lit. 1.781477937 - template dropped a digit), +0.01 penalty on Normal Dmax.
  Accept-distribution flips if you "fix" them - see `NORMAL_DMAX_DUZELTME` / `_CDF_B`.
  Grubbs-Beck/Bulletin-17B outliers: reported, never dropped - removing high outliers biases the design flood LOW (D24A029: filtering one LOW outlier raises Q100 1301→1481).
- **BTFA** (`btfa.py` - see `backend/core/btfa.py:16-18`): index-flood.
  Q2 = a·A^b from region stations; growth curve = mean (QT/Q2) of each station's at-site accepted one; Q5+ reuse app extrapolation.
  Excel exponent 0.8968 (Karamandere golden) is **not reproducible by least squares** (auto fit gives 0.0827·A^1.3146); the fit is computed and reported, and `kat say`/`ust` inputs can pin the report's number.
  Dalrymple homogeneity band `y10 ± 1.96·√(1+1.1396κ+1.1κ²)/√n` returned as `homojenlik.zarf`.
- **MMY** (`mmy.py`): `MMY = P_ort·M1·M2 + Km·S·M1·M2`.
  Km from 9-region envelope `data/tables/mmy_km.json` with **Excel LOOKUP semantics against the ADJUSTED mean** (interpolating ≠ workbook).
  M1/M2 are inputs (default 1.0): the workbooks hold macro-written literals, the charts aren't in the file, inventing a curve silently shifts results.
  Output feeds `P24_OET` → QOET (PMF).
- **Reservoir/routing**: Söylemez T28 Storage-Indication `(2S/Δt+O)ₜ₊₁ = (Iₜ+Iₜ₊₁) + (2S/Δt−O)ₜ`; multi-basin lag = ara havza Tc per method; golden-matched (test_reservoir_golden).
- **Soil group is the most consequential input** (`zemin.py` - see `backend/core/zemin.py:5,12`): Karakurt Q2 spans almost 10× between A and D; drifting from B (6-fold) to C (296→771 m³/s) is just one step.
  Derived from SoilGrids hill texture via Saxton & Rawls Ksat against NRCS NEH-630 7-1 bands, governed by **least-transmissive layer**; only a lower bound (no depth-to-bedrock).
  Replaces a hardcoded default of B which fitted only 1.6% of Turkey (92.3% is C).
  Reasoning is returned with `/api/zemin-grubu`; override is allowed.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
