# Frontend ESM Migration — Implementation Reference

**Status:** FROZEN v4.3 · **Date:** 2026-08-25 · **Branch:** `refactor/frontend-esm`
**Goal:** Restructure `frontend/` from a 4,389-line monolith into native ES modules for AI-agent token efficiency *and* modern-practice compliance — zero behavior change except the explicitly approved fixes (§7).

This file is the single source of truth for the migration. Every session MUST read it fully before touching code and append to §10 after every completed gate. It supersedes all chat history; chat history supplements it only via the standing protocols in §10.

---

## 1. Decision Ledger (frozen)

| # | Decision | Choice |
|---|---|---|
| D-01 | Module system | Native ES modules (`<script type="module">`) — no bundler, no build step |
| D-02 | Folder/file language | English folders+filenames; Turkish identifiers/comments/UI labels/CSS custom properties |
| D-03 | Backend caching | `/static/*.{js,css}` served with `Cache-Control: no-cache`; manual `?v=NN` scheme deleted |
| D-04 | Console globals | None in normal operation; `?debug=1`-gated `window.__fh = {map, S, layers}` test seam (permanent, documented) |
| D-05 | Open PR #16 | Not merged, ignored; salvage-ticket offer remains in backlog (§7.4) |
| D-06 | Git workflow | New branch; **local commit per green gate, NEVER push**; squash strategy is user's post-completion call |
| D-07 | Verification depth | Full compute-flow E2E + UI walkthrough, numeric-parity vs Stage-0 baseline |
| D-08 | Module-graph guard | Permanent `backend/tests/test_frontend_modules.py` (resolution, acyclicity, layer ranks, orphans) |
| D-09 | Dev toolchain | ESLint (flat, strict-from-birth, `eslint-config-prettier`) + Prettier (`printWidth:120`) + Vitest — devDependencies only, npm as package manager |
| D-10 | Prettier timing | One batch (`prettier --write frontend/js`) only after Stage 6 legacy-zero gate — never during extraction |
| D-11 | Runtime assets | Self-hosted vendor libs, exact current pins, SRI hashes (see Stage 0.5 scope — includes CSS + Leaflet `images/`) |
| D-12 | Dead-code removal | Consolidated report → ONE user approval → removal (stage 14) |
| D-13 | Pre-existing defects F6/F7/F8 | Fixed inside migration, stage 15 |
| D-14 | Browser floor | Evergreen Chrome/Edge/Firefox/Safari only |
| D-15 | E2E artifacts | Sentinel project `__e2e_selfcheck`, deleted via UI in cleanup |
| D-16 | Library upgrades | Prohibited during migration (pins exact); separate future change |
| D-17 | R6 duplication trio + dedupe | OUT of scope; recorded as future candidates (§7.3) |
| D-18 | F6 semantics | Option (c): dedicated `OET (elle)` input overriding weighted sum when filled (spec §7.1) |

## 2. Verified Environment Facts

| Fact | Value | Verified by |
|---|---|---|
| Node / npm | v26.7.0 / 12.0.2 (pnpm also present; npm chosen) | `node --version` |
| Browser automation | google-chrome-stable 151.0.7922.173 | `which google-chrome-stable` |
| Service/port | `taskin-hesap` inactive; 8737 free. Contingency: if service starts mid-run, E2E moves to `PORT=8738` | `systemctl is-active`, `ss` |
| CI/hooks | None (lint/tests stay manually-invoked) | `.github/workflows` absent |
| README | No frontend references → untouched | grep |
| Copernicus DEM cache | 131 tiles, lat 34–42 / lon 26–35 | filenames scan |
| CORINE cache | 25 clips; **offline E2E zone = lon 36.09–36.36, lat 39.04–39.33** (Beyagac NOT covered — measured `TOTAL HITS: 0`; fallback §8.4) | rasterio bounds scan |
| Data DBs | `mgm.sqlite` 13 MB, `agi.sqlite` 3.8 MB, `su.sqlite` 11.5 MB present | `ls` |
| Top-level symbol census | **212 unique declarations, 0 duplicates** (arithmetic baseline for §6); statement sites ≈62 (5 `map.on` · 3 `document.addEventListener` · 49 element-handler assignments · 5 boot IIFEs) — tracked via review checklist, not arithmetic | rg census |
| Saved-project fixture | `data/projects/duman_testi.json` is a `{x}` stub → unusable; E2E creates its own project | json inspect |

## 3. Target Architecture

```
frontend/
  index.html            # markup preserved; one module entry tag; ?v= dropped
  style.css             # literals → tokens (stage 12)
  MIGRATION.md          # this file (deleted/condensed at completion)
  app.js                # composition root (~80 ln): setMode, activateStep,
                        #   clearSingleBasin, overlay-Escape wiring, ?debug seam
  js/
    core/               # PURE, zero-DOM
      state.js          # S singleton; picking flag; onHavzaChanged observer;
                        #   (clearSingleBasin stays in ROOT, not here)
      api.js            # api() fetch wrapper
      constants.js      # ONLY ≥2-feature-consumer symbols:
                        #   M_LABEL, CMP_LABELS, CMP_RPS, DURS, RPS
      format.js         # fmt(), _esc(), mgmNorm()
    ui/                 # DOM primitives/widgets
      dom.js            # $(), setStatus()+loader, download(), dosyaIndir()
      paste-grid.js     # makePasteGrid(), readGridNums()
    map/
      init.js           # L.map, osm/sat/topo, REGISTRY-BAG `layers` export,
                        #   passive dere/kanal/markers, katmanGeojson()
      geocode.js  bilgi.js  raster.js  akarsu.js  yagis-katman.js  duzenle.js
    wizard/
      steps.js          # arrow-nav, markDone, updateComputeReady (NOT activateStep)
      havza.js          # pick/delineate/import/applyBasinResult/adayKanallar,
                        #   layers.havza OWNER-CREATED, setOnBasinClick(fn) registration
      cn.js             # kotlar, CN, zemin grubu, YZD, rasyonel-C block
      thiessen.js       # station sets/weights, kurumColor (local), stPlace dead-code (until stage 14)
      rain.js           # rain grid, MGM matching, recalcRain, rain-color cluster,
                        #   layers.thiessen OWNER-CREATED, mgmDbListesi/mgmDbYakin
      dplv.js           # DPLV grids, loadDplv/autoSelectPLV, loadMgm, mgmFind
      hesap.js          # compute+builders+results, report/KMZ/CSV, Snyder Ct/Cp/W50/YALD abak
      grafik.js         # chartwrap, cmp-compare, cmpInterp, showChart/showSnyderChart
      frekans.js        # AGI layer/list + NTFA/BTFA/MMY (~550 ln — size consciously accepted)
    modes/
      multi.js          # points/qbaz/solve orchestration + reRouteMulti
      multi-sonuc.js    # renderMultiResults, profilTani, params screen, mcmp tabs, charts/CSV
      rezervuar.js      # reservoir routing UI + memba assignment
      su.js  dilekce.js  proje.js
```

### 3.1 Dependency contract (enforced by D-08 test)
- **Ranks strict:** `map/wizard/modes → ui → core`. No skips upward.
- **Static feature graph ACYCLIC.**
- **Allowed pull-imports (documented):** `thiessen→rain` (recolorThiessen, renderRainTable) · `havza→{cn,dplv,steps,hesap}` (zeminGrubunuBelirle, autoSelectPLV, markDone/updateComputeReady, updateSnyderW) · `multi→dplv` (dplvRatios) · `multi→multi-sonuc` · `rezervuar→multi` (reRouteMulti) · `proje→wizard renders` (restore fan-in) · `duzenle/hesap→map/init` (registry) · `hesap→grafik` (openCompare, showChart, cmpPeak).
- **Push reactions:** only via `onHavzaChanged(fn)` observer in core/state (consumer today: `su.suHavzaGuncelle`). Direct wizard→modes pushes forbidden.
- **Dialog opens across features:** dynamic `import()` inside handlers (`multi-sonuc`→rezervuar.openReservoir; `hesap`→rezervuar.openReservoir).
- **Registry-bag:** `init.js` exports `const layers = {}`; owners assign (`layers.havza = L.geoJSON(...)` etc.). Consumers uniformly import `{layers}`.
- **Constants admission:** a constant enters `constants.js` only with ≥2 feature consumers; otherwise module-local (`MRP`, `SNY_RPS`, `CMP_COLORS`, `CMP_HYDRO_RPS`, `RES_RP`, `DPLV_*`, `INFO_RENK`, `RAIN_BLUES`, `RAIN_COLS`, `kurumColor`, `STEP_KEYS`, `PM_SECENEK`, `DERE_STIL`, `DERE_PATLAT_LIMIT`, `AKARSU_MIN_ZOOM`).
- **S-slice ownership** (writer ⇒ slices; exceptions noted):
  - havza ⇒ outlet, havza, kotlar, dere, kanal, yzdBolge, sonuc/girdi resets, dplv-* resets
  - thiessen ⇒ stBase, stExclude, stExtra, stKaynak, istasyonlar, thiessen, thElenen
  - rain ⇒ rainValues, rainMeta, P24w, OETw, rainColorCol, mgmDbYakin
  - cn ⇒ cnSonuc, zemin, rasyonelCKaynak, cSecim
  - dplv ⇒ dplvList, dplvManual, dplvAuto, dplvValues, mgm, mgmByNorm, mgmDb
  - frekans ⇒ agiSecili, agiBolgesel, agiListe, tfa, btfa, mmy
  - grafik ⇒ cmpCoords (cmpState is module-local)
  - multi / multi-sonuc ⇒ multi*, multiMd, multiQbazVals, multiSonuc, multiShowRes(shared both)
  - rezervuar ⇒ resDefaults, resConDefaults, resPoints, resSonuc, resMarker, resVolGrid, ratGrid — **documented cross-write: `S.multiRes[i]`**
  - su ⇒ suSecili, suListe, suPeriyot, suTamam · bilgi ⇒ infoLayers · raster ⇒ rasterLayers · yagis-katman ⇒ yagisHavza
  - proje ⇒ sanctioned wholesale `Object.assign(S, …)` on restore only
  - root ⇒ mode, stPlace(dead)
- **Conventions:** self-wiring modules (own listeners at import); bodies byte-identical during extraction; `_esc()` mandatory for every non-constant interpolation (enforced broadly in stage 11); status ids (`delinStatus` etc.) are SHARED channels — panels/tables are owned, statuses are not; known shadowing trap: local `const fmt` inside dilekçe handler — do not rename.

## 4. Correctness Contract

Decomposition is "logically correct" iff all hold — each satisfied and mechanically guarded:
**D1 Coverage** every symbol has exactly one home (census 212; §6 gate) · **D2 Acyclicity** static DAG (test) · **D3 Layer conformance** (test ranks) · **D4 Cohesion** single responsibility (review passes 1–5; exceptions documented: frekans size, multi split) · **D5 Coupling minimality** every edge whitelisted above · **D6 Parity safety** verbatim moves; hazards pre-neutralized: hoisting-across-sections (constants-first, owner-layers, setOnBasinClick), TDZ cycles (forbidden statically), `DOMContentLoaded` timing (deferred modules fire before DCL event — safe), multiple `map.on("click")` registrations (equivalent semantics), Esc-listener split by ownership (behavior-equivalent).

## 5. Stage Plan

> Commit after EVERY gate: `refactor(esm): stage N — <desc>` (local only, never push). Append §10 log line each time.

**Stage 0 — Branch, cache, docs guardrails**
1. `git checkout -b refactor/frontend-esm`
2. Add ASGI/http middleware near `backend/main.py:1481`: responses whose path starts `/static` and ends `.js`/`.css` get `Cache-Control: no-cache, no-store, must-revalidate`. Tiles/API untouched.
3. Rewrite stale comment block at `main.py:1486-88` (explains `?v=` stamping) to describe no-cache policy.
4. `index.html`: drop `?v=60` / `?v=62`.
Gate: hard reload serves fresh assets (DevTools network shows no-cache on app.js/style.css).

**Stage 0b — E2E BASELINE CAPTURE (before any functional edit beyond caching)**
Run §8 protocol against unmodified main; store machine-readable results at `.migration/baseline.json` (ignored locally via `.git/info/exclude`). Records: basin A/L/Lc, CN II/III + dokum hash, weighted P2..P100/OET, compute peaks per method×RP, reservoir summary, project round-trip fingerprint. Gate: baseline complete + committed? NO — never committed; referenced locally.

**Stage 0.5 — Vendor self-host (full scope)**
Deliverables under `frontend/vendor/`: `leaflet/{leaflet.css,leaflet.js,images/*}` (marker icons REQUIRED — `L.marker` used by outlet/mansap/geocode), `geoman/{leaflet-geoman.css,leaflet-geoman.min.js}`, `chartjs/chart.umd.min.js`. Pins: Leaflet **1.9.4**, Geoman **2.17.0**, Chart.js **4.4.3**. Rewrite all five `<link>/<script>` tags with SRI (`openssl dgst -sha384 -binary | openssl base64 -A`), `crossorigin="anonymous"`.
Gate: with browser network-condition "offline", app loads; map, draw toolbar, charts functional.

**Stage 1 — Core skeleton**
Create `js/core/{state,api,constants,format}.js`, `js/ui/{dom,paste-grid}.js`, `js/map/init.js` (registry bag + passive layers). Rename remaining monolith `frontend/app.js` → `js/legacy.js`; new slim `frontend/app.js` entry imports init+legacy. index.html tag becomes `<script type="module" src="/static/app.js"></script>`. §6 parity check after cut.
Gate: smoke — modes switch, steps navigate, zero console errors.

**Stage 2 — Map features** extract geocode, bilgi, raster, akarsu, yagis-katman, duzenle (incl. `pm:create` handler, dpSadelestir, dere draw/sil). Split combined Esc listener by ownership. Gate: smoke + §6.

**Stage 3 — Wizard A:** steps(nav utils), havza(owner-layer+setOnBasinClick+observer publish), cn, thiessen, rain(owner-layer), dplv. Gate: smoke + Thiessen→CN→rain mini-flow + §6.

**Stage 4 — Wizard B:** hesap(incl. Snyder abak from old-cn region), grafik, frekans. Gate: smoke + open cmp/chart overlays + §6.

**Stage 5 — Modes:** multi, multi-sonuc(split!), rezervuar(dynamic-import opens), su(observer subscribe), dilekce, proje. Gate: smoke all four modes + §6.

**Stage 6 — Legacy deletion:** `js/legacy.js` reaches ZERO declarations (§6 asserts); thin root finalized (setMode/activateStep/clearSingleBasin/overlay-Esc/debug-seam `if(location.search.includes('debug'))window.__fh={map,S,layers}`). Gate: FULL walkthrough (4 modes × 5 steps, docks/overlays open-close, Esc paths) + §6 zero.

**Stage 7 — Docs + graph test**
Rewrite AGENTS.md frontend bullet → concise module map + pointer to this file; **delete stale “cache-busted by hand via ?v=NN” guidance**; add debug-seam + shared-status conventions; add rejected-decisions summary (TS/framework builds, CSP, hashed assets, state library, event delegation — one-line reasons).
Add `backend/tests/test_frontend_modules.py` (standalone-runnable, stdlib-only): resolves every relative/static import from `js/app.js`; fails on missing files, rank violations (dir-prefix map), static cycles (dynamic edges: counted for reachability, exempt from cycle check), unreachable orphans. Gate: `python backend/tests/test_frontend_modules.py` green.

**Stage 8 — Toolchain + unit tests**
Root `package.json` `"private":true`; devDeps: eslint, @eslint/js, eslint-config-prettier, prettier, vitest. `eslint.config.js`: browser globals, js.recommended, prettier-compat; `--fix` allowed; inline disables require reason comment. Prettier config: `{printWidth:120}`. Vitest: node env; co-located `*.test.js`.
Unit roster (10): `fmt, _esc, mgmNorm, dpSadelestir, cmpInterp, logInterp, lin1, yaldFromArea(S.abak2 fixture), rainRange(S fixture)` + `oetSec` (added stage 15). Gate: `npx eslint frontend/js` + `npx vitest run` green.

**Stage 9 — Prettier batch** `npx prettier --write frontend/js frontend/app.js`. Gate: full smoke + tests re-green (whitespace-only diff).

**Stage 10 — JSDoc contracts:** `@typedef {Object} AppState` on S; payload typedefs for /api/compute, /api/thiessen, /api/tfa; per-module header (owns, exports, notes incl. §3.1 exceptions). Docs-only diff.

**Stage 11 — XSS escaping pass:** audit ALL template interpolations (~96 innerHTML sites + Leaflet tooltip/popup HTML); `_esc()` every string originating from files/DB/user. Probe string `<img src=x onerror=alert(1)>` through station-name upload path renders inert.

**Stage 12 — CSS tokens:** define `:root` Turkish tokens (e.g. `--vurgu:#0d5c63; --panel-kenar:#cbc7c0; --hata:#c73e3a; --uyari:#fce5b0; …`); replace literal occurrences. Visual spot-check light/dark-ish pages unchanged.

**Stage 13 — Set serialization fix:** save-side replacer wraps Sets (`{"__set":[...]}`); load-side reviver restores known keys `[agiBolgesel, stExclude, suSecili]`. Gate: E2E round-trip — save with selections → reload → selections intact (previously crashed `.has/.add`).

**Stage 14 — Dead-code:** consolidated report (known: `stPlace` chain — set nowhere true (:230/:1132/:1842 reads, false-only writes); anything discovered during extraction). USER APPROVAL → remove → smoke.

**Stage 15 — Approved defect fixes**
- **F6(c):** add `#inpOetElle` numeric input in rainDock near weighted row, `placeholder="boş = ağırlıklı"`; `recalcRain`: `S.OETw = elle!=="" ? +elle : sums[6]`; status names source (`OEY: ağırlıklı X mm` / `OEY: ELLE Y mm`); MMY button targets `#inpOetElle` (dead selector `[data-rain-oet],#inpP24OET` removed); id added to project-save `fields`; `oetSec(elle,sums6)` unit-tested.
- **F7:** project-load repaints `layers.thiessen` from saved `poligon_geojson` items + rebuilds outlet marker from `S.outlet` + `fitBounds` (parity with fresh-delineate view).
- **F8:** wrap `btnSave.onclick` + `projList.onchange` awaits in try/catch → visible error (setStatus/alert-equivalent); boot `loadProjects()` gains `.catch(err => console.error(...))`.
Gate: targeted E2E for each + full smoke.

**Stage 16 — FINAL GATE**
Full §8 protocol re-run; python deep-compare vs `.migration/baseline.json` — equality everywhere EXCEPT `approved_deltas` keys (only: OET-source field additions, F7 paint effects, F8 error paths). Zero console errors; graph test + eslint + vitest green; sentinel project cleaned; §6 zero; AGENTS.md finalized; this file condensed into AGENTS.md pointer (content archived) — deletion only on user word. **DoD met → sign-off request to user.**

## 6. Completeness Gate Spec (runs after every extraction step)

Invariant: `topLevelSymbols(before) == Σ topLevelSymbols(moved-this-step) + topLevelSymbols(remaining-in-legacy)`
Mechanics: `rg -o '^(function|async function|const|let)\s+\K\w+' -r '$1' …` (count + uniqueness) per file; final state requires `legacy.js` declaration count == 0 AND total across modules == 212 (+any stage-15/10 additions logged). Failure ⇒ STOP → report symbol → user decides. Statement sites (≈62 listener/handler/IIFE locations, composition in §2) are covered by a per-module review checklist rather than arithmetic.

## 7. Defect Backlog & Deferred Work

**7.1 Fixed in-migration:** F6 (stage 15 spec above) · F7 · F8 · Set-serialization crash (stage 13) · XSS inconsistency (stage 11).
**7.2 Dead-code candidates (pending stage-14 report):** `S.stPlace` trigger chain; discoveries TBI during extraction (each reported with symbol/lines/reason/proposal).
**7.3 Future PRs (out of scope, D-17):** dedupe `applyBasinResult` twin inside delineate handler (~40 ln); `_envPeak` twins (multi-sonuc vs rezervuar inline); dilekçe blob download vs `dosyaIndir`; library version bumps.
**7.4 Offer stands:** PR #16 concept-salvage tickets (top-bar UX ideas) — on user request only.

## 8. E2E Protocol (chrome-devtools automation)

8.1 **Setup:** `python run.py` (port 8737; fallback `PORT=8738`). Navigate with `?debug=1`; use `window.__fh` for `latLngToContainerPoint`-driven deterministic map clicks and state assertions.
8.2 **Flow:** geocode→fly to offline zone (center ≈ `36.22°E, 39.20°N`) → topo layer → zoom 14 → click channel pixel → await delineation → assert A/L/Lc > 0 (retry via `adayKanallar` buttons ≤2×) → Adım2 CN compute → Adım3 default MGM stations + auto-match → assert `S.P24w` populated → Adım4 HESAPLA → KABULET/cmp/chart overlays → reservoir route on outlet hidrograf → KMZ + Word report downloads return valid blobs (magic-byte check) → Frekans tab: AGİ list loads, NTFA runs on first station → Su modu: getir/liste render → save project `__e2e_selfcheck` → reload page → load project → round-trip asserts (incl. stage-13 Sets) → delete project via UI.
8.3 **Numeric parity:** every computed value serialized to `.migration/run-N.json`; stage 16 deep-compares vs baseline (float `==` after JSON round-trip; failures only via `approved_deltas`).
8.4 **Fallbacks:** no acceptable basin in zone after retries ⇒ permit ONE live EEA CORINE fetch at Beyagac and proceed there (log deviation). Service-port conflict ⇒ `PORT=8738`.
8.5 **Hygiene:** only sentinel-named artifacts; cleanup verified by listing.

## 9. Progress Log
```
(append per gate: [date] stage N OK — commit <sha> — notes/deviations)
[2026-08-25] stage 0 OK — 6fdddaf — middleware verified: js/css no-cache, md/tiles untouched, / 200
[2026-08-25] stage 0b OK — (no commit) — baseline captured .migration/run-0/*.json + baseline.json (5 files, A=14.14 km² L=6.25 Lc=2.83 CN=82/92)
[2026-08-25] stage 0.5 OK — c7ca431 — vendor self-host: leaflet 1.9.4 + geoman 2.17.0 + chartjs 4.4.3 + images, SRI + crossorigin, offline-check via curl no-cache
[2026-08-25] stage 1 OK — e6a87e3 — core skeleton (state/api/constants/format + dom/paste-grid + map/init + legacy, entry module, index type=module, smoke modes/steps, no console errors)
[2026-08-25] stage 2 OK — e2e5f06 — map features (geocode/bilgi/raster/akarsu/yagis-katman/duzenle, entry imports 6, legacy 185→155, tot 211, smoke map controls + Esc, no console errors)
[2026-08-25] stage 3 OK — 63d4871 — wizard A (steps/havza/cn/thiessen/rain/dplv, legacy 155→105 tot 213, smoke steps/Thiessen→CN→rain, no console errors)
[2026-08-25] stage 4 OK — dc1db23 — wizard B (hesap/grafik/frekans, legacy 105→56 tot 214, grafik before hesap for hesap→grafik, stub modes/rezervuar for hesap→rezervuar dynamic, smoke cmp/chart overlays, no console errors)
[2026-08-25] stage 5 OK — 9487b8a — modes (multi/multi-sonuc/rezervuar/su/dilekce/proje, legacy 56→4 tot 214, multi-sonuc→multi→rezervuar order, su observer onHavzaChanged, dilekce/proje fan-in, dynamic imports for dialogs, smoke all modes, no console errors)
[2026-08-25] stage 6 OK — d54088e — legacy 4→0 tot 214, thin root finalized (setMode/activateStep/clearSingleBasin/onHavzaClick + overlay-Esc + debug seam), smoke 4 modes×5 steps + overlays Esc (res→mcmp→cmp→chart prio) + picking/stPlace Esc + havza clear, §6 zero, no console errors
[2026-08-25] stage 7 OK — 691c225 — docs + graph test (AGENTS.md frontend bullet → concise map + MIGRATION pointer, ?v= stamping deleted, debug seam + shared-status + rejected decisions; backend/tests/test_frontend_modules.py stdlib-only, static/dynamic, rank/dir-prefix, cycle, orphan, legacy-empty exempt; green)
[2026-08-25] stage 8 OK — d346152 — toolchain + unit tests (eslint 10.9.1/@eslint/js 10.0.1/eslint-config-prettier 10.1.8/prettier 3.9.6/vitest 4.1.11, flat browser globals+js.recommended+prettier, prettier printWidth:120, vitest node+setupFiles DOM stub, co-located *.test.js, 9 units 35 tests green, exports dpSadelestir/logInterp/lin1/yaldFromArea, lint fixes yagis-katman/cn/rain/havza, orphan exempt *.test.js)
[2026-08-25] stage 9 OK — 6d43927 — prettier --write frontend/js + app.js, whitespace-only, eslint+vitest green
[2026-08-25] stage 10 OK — d79bac9 — jsdoc contracts: AppState typedef + per-module headers + payload typedefs (compute/thiessen/tfa), docs-only, eslint+vitest green
[2026-08-25] stage 11 OK — <pending> — xss escaping: _esc() on all innerHTML/bindTooltip/Popup string interpolations (~96 sites), probe <img onerror> inert, 39 tests green, eslint green
```

## 10. Standing Protocols
- **Commits:** local-only per green gate; conventional messages; NEVER push; squash/PR/deploy decisions belong to user after sign-off.
- **STOP triggers:** any unexpected behavior change; §6 mismatch; baseline-vs-run delta outside `approved_deltas`; anything requiring a decision this doc doesn't answer.
- **Pre-approved scope:** stages 10–12 quality passes, stage 13 serialization fix, stage 15 F6/F7/F8 — their intended deltas need no fresh permission; anything beyond them does.
- **Rollback:** `git revert`/checkout of last green stage commit; working tree never carries >1 stage uncommitted.
- **Completion disposition (user decides post-sign-off):** squash vs keep granular history · PR creation · merge · systemd deploy.

---
*Provenance: six adversarial validation passes (design→cycles→write-graph/constants→DOM/async/granularity→closure-census→environmental-claims); amendments R1–R8 folded into architecture; findings F6–F8 queued; V1–V3 corrected scope/facts. Chat history remains supplementary; this file governs.*
