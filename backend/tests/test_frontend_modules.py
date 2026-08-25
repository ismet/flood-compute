# -*- coding: utf-8 -*-
"""Frontend ESM module-graph guard — stage 7.

Resolves every relative/static import from frontend/app.js transitively,
checks:
  - missing files
  - rank violations (dir-prefix map: map/wizard/modes → ui → core)
  - static cycles (dynamic edges counted for reachability, exempt from cycle check)
  - unreachable orphans (all js/**/*.js must be reachable via static+dynamic)

Stdlib-only, runnable as: python backend/tests/test_frontend_modules.py
"""
import re
import sys
from pathlib import Path
from collections import defaultdict, deque

# ------------------------------------------------------------------ paths
THIS = Path(__file__).resolve()
# expected: <repo>/backend/tests/test_frontend_modules.py -> parents[2] == <repo>
CANDIDATES = [THIS.parents[2], THIS.parents[1].parent, Path.cwd()]
ROOT = None
for cand in CANDIDATES:
    if (cand / "frontend" / "app.js").exists():
        ROOT = cand
        break
if ROOT is None:
    # walk upward from THIS
    for p in THIS.parents:
        if (p / "frontend" / "app.js").exists():
            ROOT = p
            break
if ROOT is None:
    print("FAIL: repo root not found (frontend/app.js missing)", file=sys.stderr)
    sys.exit(1)

FRONTEND = ROOT / "frontend"
APP_JS = FRONTEND / "app.js"
JS_DIR = FRONTEND / "js"

if not APP_JS.exists():
    print(f"FAIL: frontend/app.js not found at {APP_JS}", file=sys.stderr)
    sys.exit(1)
if not JS_DIR.exists():
    print(f"FAIL: frontend/js dir not found at {JS_DIR}", file=sys.stderr)
    sys.exit(1)

# ------------------------------------------------------------------ regexes
STATIC_RE = re.compile(r'import\s+(?:[^;]*?\s+from\s+)?["\']([^"\']+)["\']')
DYNAMIC_RE = re.compile(r'import\s*\(\s*["\']([^"\']+)["\']\s*\)')
EXPORT_RE = re.compile(r'export\s+(?:[^;]*?from\s+)["\']([^"\']+)["\']')

def strip_block_comments(text: str) -> str:
    return re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)

def parse_imports(file_path: Path):
    try:
        text = file_path.read_text(encoding="utf-8")
    except Exception as e:
        return [], [], f"read error: {e}"
    clean = strip_block_comments(text)
    # static: import ... from "..."  + side-effect import "..."  + export ... from "..."
    static = STATIC_RE.findall(clean)
    # export-from may have been double-counted if it also matches STATIC_RE's from pattern;
    # add EXPORT_RE separately but dedupe later — simple: add export finds
    ex = EXPORT_RE.findall(clean)
    for e in ex:
        if e not in static:
            static.append(e)
    dynamic = DYNAMIC_RE.findall(clean)
    # STATIC_RE also matches export-from? That's ok, but ensure dynamic not in static
    # Remove dynamic strings from static if they were captured via static's from pattern?
    # Dynamic form is import("...") with parens, static requires whitespace after import, so no overlap.
    return static, dynamic, None

def is_relative(spec: str) -> bool:
    return spec.startswith(".")

def resolve_relative(src: Path, spec: str):
    # strip query/hash
    clean = spec.split("?")[0].split("#")[0]
    target = (src.parent / clean).resolve()
    # if no suffix, try .js
    if not target.suffix and not target.exists():
        cand = target.with_suffix(".js")
        if cand.exists():
            target = cand
    return target

def rel_posix(p: Path) -> str:
    try:
        return p.relative_to(ROOT).as_posix()
    except Exception:
        return p.as_posix()

def rank_of(rel: str):
    """Rank map: core 0 < ui 1 < feature(map/wizard/modes) 2 < app 3. None = ignore."""
    if rel == "frontend/app.js":
        return 3
    if rel.startswith("frontend/js/core/"):
        return 0
    if rel.startswith("frontend/js/ui/"):
        return 1
    if rel.startswith("frontend/js/map/") or rel.startswith("frontend/js/wizard/") or rel.startswith("frontend/js/modes/"):
        return 2
    # legacy and vendor etc. → no rank
    return None

def is_legacy_empty(p: Path) -> bool:
    try:
        t = p.read_text(encoding="utf-8")
    except Exception:
        return False
    if "legacy empty" in t.lower():
        return True
    # block-comment stripped check
    clean = strip_block_comments(t)
    # remove line comments
    clean = re.sub(r'//.*', '', clean)
    stripped = clean.strip()
    if not stripped:
        return True
    # if no import/export and very small, treat as empty
    if "import" not in t and "export" not in t and len(stripped) < 200:
        # ensure no non-comment code like const/function
        if not re.search(r'\b(const|let|function|class|export|import)\b', stripped):
            return True
    return False

# ------------------------------------------------------------------ collect
all_js = list(JS_DIR.rglob("*.js"))
# include app.js as node but not part of orphan discovered set
all_nodes = {rel_posix(p): p for p in all_js}
all_nodes[rel_posix(APP_JS)] = APP_JS

# Build graphs
static_graph = defaultdict(list)   # src rel -> [dst rel]
dynamic_graph = defaultdict(list)
combined_graph = defaultdict(list)
missing = []          # (src, spec, resolved)
rank_violations = []  # (src, dst, spec, rs, rd, kind)
all_edges = []        # (src,dst,spec,kind)

for rel, src_path in all_nodes.items():
    stat, dyn, err = parse_imports(src_path)
    if err:
        missing.append((rel, "<read>", err))
        continue
    # static
    for spec in stat:
        if not is_relative(spec):
            continue  # bare / external → ignore
        target = resolve_relative(src_path, spec)
        if not target.exists():
            missing.append((rel, spec, rel_posix(target)))
            continue
        # only consider targets inside frontend
        try:
            dst_rel = target.relative_to(ROOT).as_posix()
        except Exception:
            continue
        # only track if target is a js module inside repo (exists)
        # but also allow targets outside js dir (e.g., vendor?) — still track for missing check, but not for graph if outside js/app?
        # We only add to graph if dst is inside frontend and ends with .js
        if not dst_rel.startswith("frontend/"):
            continue
        static_graph[rel].append(dst_rel)
        combined_graph[rel].append(dst_rel)
        all_edges.append((rel, dst_rel, spec, "static"))
        # rank check
        rs = rank_of(rel)
        rd = rank_of(dst_rel)
        if rs is not None and rd is not None and rs < rd:
            rank_violations.append((rel, dst_rel, spec, rs, rd, "static"))
    # dynamic
    for spec in dyn:
        if not is_relative(spec):
            continue
        target = resolve_relative(src_path, spec)
        if not target.exists():
            missing.append((rel, spec, rel_posix(target)))
            continue
        try:
            dst_rel = target.relative_to(ROOT).as_posix()
        except Exception:
            continue
        if not dst_rel.startswith("frontend/"):
            continue
        dynamic_graph[rel].append(dst_rel)
        combined_graph[rel].append(dst_rel)
        all_edges.append((rel, dst_rel, spec, "dynamic"))
        rs = rank_of(rel)
        rd = rank_of(dst_rel)
        if rs is not None and rd is not None and rs < rd:
            rank_violations.append((rel, dst_rel, spec, rs, rd, "dynamic"))

# Ensure all nodes present in graphs even if no edges
for rel in all_nodes:
    static_graph.setdefault(rel, [])
    combined_graph.setdefault(rel, [])

# ------------------------------------------------------------------ cycle check (static only)
color = {}  # 0 unvisited, 1 visiting, 2 done
parent = {}
cycles = []

def dfs(u, stack):
    color[u] = 1
    stack.append(u)
    for v in static_graph.get(u, []):
        # only consider v that is a known node (exists as file) — otherwise ignore
        # but all v should be known because we resolved to existing file
        cv = color.get(v, 0)
        if cv == 0:
            parent[v] = u
            if dfs(v, stack):
                return True
        elif cv == 1:
            # cycle found
            try:
                idx = stack.index(v)
                cyc = stack[idx:] + [v]
            except ValueError:
                cyc = [v, u, v]
            cycles.append(cyc)
            return True
    stack.pop()
    color[u] = 2
    return False

for node in list(static_graph.keys()):
    if color.get(node, 0) == 0:
        # ensure we start dfs for each disconnected component
        if dfs(node, []):
            break
# Also need to dfs for nodes not in static_graph keys but isolated? No cycles there.

# ------------------------------------------------------------------ reachability (static+dynamic)
start = rel_posix(APP_JS)
visited = set()
q = deque([start])
while q:
    u = q.popleft()
    if u in visited:
        continue
    visited.add(u)
    for v in combined_graph.get(u, []):
        if v not in visited:
            q.append(v)

# Discovered for orphan = all js/**/*.js (excluding legacy if empty, and co-located vitest *.test.js)
discovered = set(rel_posix(p) for p in JS_DIR.rglob("*.js") if not p.name.endswith(".test.js"))
# legacy special case
legacy_rel = "frontend/js/legacy.js"
if legacy_rel in discovered:
    lp = ROOT / legacy_rel
    if lp.exists() and is_legacy_empty(lp):
        discovered.discard(legacy_rel)

orphans = sorted(discovered - visited)

# ------------------------------------------------------------------ report
failures = []

if missing:
    failures.append("missing")
if rank_violations:
    failures.append("rank")
if cycles:
    failures.append("cycle")
if orphans:
    failures.append("orphan")

print("=" * 72)
print("Frontend ESM module-graph check")
print(f"ROOT: {ROOT}")
print(f"APP: {rel_posix(APP_JS)}")
print(f"Discovered js files: {len(discovered)} (all js/**/*.js, legacy empty excluded)")
print(f"Nodes (incl. app.js): {len(all_nodes)}")
print(f"Static edges: {sum(len(v) for v in static_graph.values())}  Dynamic edges: {sum(len(v) for v in dynamic_graph.values())}")
print("-" * 72)

if missing:
    print(f"FAIL missing imports ({len(missing)}):")
    for src, spec, dst in missing:
        print(f"  {src}  --[{spec}]-->  {dst}  (file not found)")
else:
    print("OK missing imports: none")

if rank_violations:
    print(f"FAIL rank violations ({len(rank_violations)}): dir-prefix map map/wizard/modes → ui → core")
    for src, dst, spec, rs, rd, kind in rank_violations:
        print(f"  [{kind}] {src} (rank {rs}) --[{spec}]--> {dst} (rank {rd})")
else:
    print("OK rank violations: none (map/wizard/modes → ui → core, no upward)")

if cycles:
    print(f"FAIL static cycles ({len(cycles)}):")
    for cyc in cycles:
        print("  cycle: " + " -> ".join(cyc))
else:
    print("OK static cycles: none (dynamic exempt)")

if orphans:
    print(f"FAIL orphans ({len(orphans)}): not reachable from {start} via static+dynamic")
    for o in orphans:
        print(f"  orphan: {o}")
else:
    print(f"OK orphans: none — all {len(discovered)} modules reachable from {start}")

print("-" * 72)
if failures:
    print(f"FAIL: {', '.join(failures)}")
    # also list edges for debugging on failure
    if missing or rank_violations or cycles or orphans:
        print(f"\nAll edges ({len(all_edges)}):")
        for src, dst, spec, kind in sorted(all_edges):
            print(f"  [{kind:7s}] {src} --[{spec}]--> {dst}")
    sys.exit(1)
else:
    print("PASS: all checks green (missing/rank/cycle/orphan)")
    sys.exit(0)
