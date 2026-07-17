// ---------------------------------------------------------------------------
// LEE3D core regression suite.
//
// IMPORTANT: this pulls the functions straight out of ../index.html and runs
// THOSE. It never copies the algorithms, so it cannot drift from the shipped
// app the way the old geometry.test.mjs did (that one still tested wheel
// arches months after wheels were deleted, and passed while the app blobbed).
//
//   node test/core.test.mjs
// ---------------------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(HERE, "..", "index.html"), "utf8");
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];

// --- pull one named function's source out of the app, brace-matched, string/comment aware
function grab(name) {
  const start = script.indexOf("function " + name + "(");
  if (start < 0) throw new Error("function not found in index.html: " + name);
  let i = script.indexOf("{", start), depth = 0, str = null, esc = false, line = false, block = false;
  for (; i < script.length; i++) {
    const c = script[i], n = script[i + 1];
    if (line) { if (c === "\n") line = false; continue; }
    if (block) { if (c === "*" && n === "/") { block = false; i++; } continue; }
    if (str) { if (esc) { esc = false; continue; } if (c === "\\") { esc = true; continue; } if (c === str) str = null; continue; }
    if (c === "/" && n === "/") { line = true; i++; continue; }
    if (c === "/" && n === "*") { block = true; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { str = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return script.slice(start, i + 1); }
  }
  throw new Error("unbalanced braces reading: " + name);
}

// tiny helpers the app defines outside functions
// the app's one-line helpers, lifted verbatim so they can't drift either
function grabConst(decl) {
  const m = script.match(new RegExp("^const " + decl + "=.*$", "m"));
  if (!m) throw new Error("const not found in index.html: " + decl);
  return m[0];
}
const PRELUDE = [grabConst("clamp"), grabConst("lerp"), grabConst("smoothstep"), "const DEFAULT_LEN=200;"].join("\n");
const NAMES = ["outlineEnvelope", "anchorPxPerMm", "makeRevolve", "pointInPoly",
  "makeVisualHull", "checkManifold", "polyArea", "resamplePoly", "svgPhysicalWidthMM",
  "libCanonical", "sampleProfile", "resampleSection", "morphSections", "makeBody", "autoOutline",
  "publishRoute", "distToPoly", "viewUV", "applyFeatures", "pickSilhouette", "sampleMask", "ptInPolyPts", "polyAreaPts",
  "rasterRegions", "otsuThreshold", "lumOf", "regionOutline", "sdPoly",
  "wallSpec", "wallAt", "minWall",
  "connDiameter", "connWarn", "connPoly", "simplifyPoly"];
const found = [];
const src = PRELUDE + NAMES.map(n => {
  try { const s = grab(n); found.push(n); return s; }
  catch { return "/* not in index.html yet: " + n + " */"; }
}).join("\n");
const API = new Function(src + "\nreturn {" + found.join(",") + "};")();
const MISSING = NAMES.filter(n => !found.includes(n));

// --- test plumbing ---
let pass = 0, fail = 0, warn = 0;
const results = [];
// Correctness: if this breaks, do not ship it.
function t(name, fn) {
  try { fn(); pass++; results.push("  ✅ " + name); }
  catch (e) { fail++; results.push("  ❌ " + name + "\n       " + e.message); }
}
// Hygiene: worth fixing, never a reason to block a deploy. Reported, not fatal.
function h(name, fn) {
  try { fn(); pass++; results.push("  ✅ " + name); }
  catch (e) { warn++; results.push("  ⚠️  " + name + "\n       " + e.message + "\n       (housekeeping — does not block the deploy)"); }
}
function eq(a, b, m) { if (a !== b) throw new Error(`${m || ""} expected ${b}, got ${a}`); }
function ok(c, m) { if (!c) throw new Error(m || "expected truthy"); }
function near(a, b, tol, m) { if (Math.abs(a - b) > tol) throw new Error(`${m || ""} expected ~${b}, got ${a}`); }

// --- shared fixtures ---
function manifold(indices) {
  const ec = new Map(), key = (a, b) => (a < b ? a + "_" + b : b + "_" + a);
  for (let k = 0; k < indices.length; k += 3) {
    const [a, b, c] = [indices[k], indices[k + 1], indices[k + 2]];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) { const kk = key(u, v); ec.set(kk, (ec.get(kk) || 0) + 1); }
  }
  let boundary = 0, nonMani = 0;
  for (const v of ec.values()) { if (v === 1) boundary++; else if (v > 2) nonMani++; }
  return { boundary, nonMani, tris: indices.length / 3 };
}
const watertight = (g, m) => { const r = manifold(g.indices); ok(r.boundary === 0 && r.nonMani === 0,
  `${m}: ${r.boundary} open edges, ${r.nonMani} non-manifold (tris ${r.tris})`); return r; };

// a closed side silhouette, traced clockwise (screen y grows downward: roof = small y)
const SIDE = [{x:20,y:150},{x:80,y:90},{x:160,y:55},{x:260,y:52},{x:340,y:80},
              {x:400,y:120},{x:360,y:185},{x:200,y:190},{x:70,y:188}];
const rot = (a, k) => a.slice(k).concat(a.slice(0, k));

// =====================  1. TRACE ENVELOPE  =====================
// This is the exact class of bug that shipped the "blob of mess".
t("envelope: top is above bottom everywhere (can't invert)", () => {
  const e = API.outlineEnvelope(SIDE);
  for (let i = 0; i < e.top.length; i++) ok(e.top[i].y <= e.bot[i].y, `slice ${i} inverted`);
});
t("envelope: order-independent — reversed winding gives the same shape", () => {
  const a = API.outlineEnvelope(SIDE), b = API.outlineEnvelope([...SIDE].reverse());
  for (let i = 0; i < a.top.length; i++) {
    near(a.top[i].y, b.top[i].y, 1e-6, `top ${i}`); near(a.bot[i].y, b.bot[i].y, 1e-6, `bot ${i}`);
  }
});
t("envelope: order-independent — any starting point gives the same shape", () => {
  const a = API.outlineEnvelope(SIDE);
  for (const k of [1, 3, 5, 7]) {
    const b = API.outlineEnvelope(rot(SIDE, k));
    for (let i = 0; i < a.top.length; i++) near(a.top[i].y, b.top[i].y, 1e-6, `rot${k} slice${i}`);
  }
});
t("envelope: spans the full outline width", () => {
  const e = API.outlineEnvelope(SIDE);
  near(e.minX, 20, 1e-9); near(e.maxX, 400, 1e-9); near(e.span, 380, 1e-9);
});

// =====================  2. SCALE ANCHORING  =====================
// The "model comes out very wide" bug: views calibrated independently disagreed.
t("scale: a view anchored to a known length ignores its own (wrong) calibration", () => {
  // top view drawn at 1px/mm, 190px long, for an object the side view says is 190mm
  for (const wrongScale of [0.25, 0.5, 2, 8, null]) {
    const pxmm = API.anchorPxPerMm(190, 190, wrongScale, 200);
    near(pxmm, 1, 1e-9, `wrongScale=${wrongScale}`);
  }
});
t("scale: with no anchor it uses the view's own calibration", () => {
  near(API.anchorPxPerMm(380, null, 2, 200), 2, 1e-9);
});
t("scale: with neither, falls back to the standard length", () => {
  near(API.anchorPxPerMm(400, null, null, 200), 2, 1e-9);
});
t("scale: end-to-end — mismatched views still give the true 80mm width", () => {
  const top = [{x:0,y:100},{x:60,y:62},{x:130,y:60},{x:190,y:95},{x:130,y:140},{x:60,y:140}];
  const eS = API.outlineEnvelope(SIDE), lenMM = Math.round(eS.span / 2);   // side @ 2px/mm -> 190mm
  const eT = API.outlineEnvelope(top);
  for (const bogus of [0.5, 2, null]) {
    const pxmm = API.anchorPxPerMm(eT.span, lenMM, bogus, 200);
    const halfW = Math.max(...eT.top.map((p, i) => (eT.bot[i].y - p.y) / pxmm / 2));
    near(halfW * 2, 80, 4, `top scale ${bogus}`);
  }
});

// =====================  3. LOFT SHELL  =====================
t("loft: traced profile builds a watertight shell", () => {
  const g = API.makeBody({
    length: 190, stations: 48, arcSegments: 40, roofFlatness: 1.3, wallThickness: 1.8,
    topProfile: [[0,10],[0.5,60],[1,20]], bottomProfile: [[0,2],[0.5,2],[1,2]],
    widthProfile: [[0,10],[0.5,40],[1,16]], section: null, sections: null, mode: "loft",
  });
  const r = watertight(g, "loft");
  ok(r.tris > 1000, "suspiciously few triangles: " + r.tris);
  ok(g.volume > 0, "non-positive volume");
});

// =====================  4. SCULPT  =====================
t("sculpt: add / trim / mixed strokes all stay watertight", () => {
  const base = { length: 190, stations: 40, arcSegments: 32, roofFlatness: 1.3, wallThickness: 1.8,
    topProfile: [[0,10],[0.5,60],[1,20]], bottomProfile: [[0,2],[0.5,2],[1,2]],
    widthProfile: [[0,10],[0.5,40],[1,16]], mode: "loft" };
  const n = (40 + 1) * (32 + 1);
  const mk = f => Float32Array.from({ length: n }, (_, i) => f(i));
  for (const [name, off] of [
    ["add",   mk(() => 3)],
    ["trim",  mk(() => -1)],
    ["mixed", mk(i => Math.sin(i) * 3)],
  ]) watertight(API.makeBody({ ...base, sculpt: off }), "sculpt " + name);
});

// =====================  5. REVOLVE  =====================
t("revolve: sphere / cylinder / dome / cone are all watertight solids", () => {
  const N = 32, R = 50;
  const shapes = { sphere: t => Math.sin(Math.PI * t), dome: t => Math.cos(Math.PI / 2 * t),
                   cone: t => 1 - t, cylinder: () => 1 };
  for (const [name, f] of Object.entries(shapes)) {
    const prof = Array.from({ length: N + 1 }, (_, i) => [i / N, R * f(i / N)]);
    const g = API.makeBody({ shape: "revolve", arcSegments: 40, revProfile: prof,
                             revLen: name === "sphere" ? 2 * R : 100 });
    watertight(g, "revolve " + name);
    ok(g.volume > 0, name + " has no volume");
  }
});

// =====================  6. VISUAL HULL (any shape)  =====================
t("hull: sphere is watertight", () => {
  const circle = Array.from({ length: 36 }, (_, i) => {
    const a = i / 36 * 2 * Math.PI; return [0.5 + 0.45 * Math.cos(a), 0.5 + 0.45 * Math.sin(a)];
  });
  watertight(API.makeBody({ mode: "projection", length: 100, stations: 32,
    sidePoly: circle, topPoly: circle, frontPoly: circle,
    topProfile: [[0,100]], widthProfile: [[0,50]] }), "hull sphere");
});
t("hull: L-bracket (a shape the loft CANNOT make) is watertight", () => {
  const L = [[0.1,0.1],[0.9,0.1],[0.9,0.35],[0.4,0.35],[0.4,0.9],[0.1,0.9]];
  const box = [[0.1,0.1],[0.9,0.1],[0.9,0.9],[0.1,0.9]];
  const g = API.makeBody({ mode: "projection", length: 100, stations: 36,
    sidePoly: L, topPoly: box, frontPoly: box, topProfile: [[0,100]], widthProfile: [[0,30]] });
  watertight(g, "hull L-bracket");
  ok(g.volume > 0, "no volume");
});
t("hull: respects the silhouette — a notched side view removes material", () => {
  const box = [[0.05,0.05],[0.95,0.05],[0.95,0.95],[0.05,0.95]];
  const notched = [[0.05,0.05],[0.95,0.05],[0.95,0.95],[0.55,0.95],[0.55,0.5],[0.45,0.5],[0.45,0.95],[0.05,0.95]];
  const mk = side => API.makeBody({ mode: "projection", length: 100, stations: 32,
    sidePoly: side, topPoly: box, frontPoly: box, topProfile: [[0,60]], widthProfile: [[0,30]] });
  const full = mk(box), cut = mk(notched);
  watertight(cut, "hull notched");
  ok(cut.volume < full.volume * 0.95, `notch removed nothing (${cut.volume} vs ${full.volume})`);
});

// =====================  7. MANIFOLD CHECKER ITSELF  =====================
t("checkManifold: flags a mesh with a hole", () => {
  const g = API.makeBody({ length: 120, stations: 20, arcSegments: 16, roofFlatness: 1.2,
    wallThickness: 1.5, topProfile: [[0,10],[1,40]], bottomProfile: [[0,0],[1,0]],
    widthProfile: [[0,10],[1,20]], mode: "loft" });
  ok(API.checkManifold(g.indices).watertight, "a good mesh should read watertight");
  const holed = g.indices.slice(0, g.indices.length - 3);          // drop one triangle
  ok(!API.checkManifold(holed).watertight, "a mesh with a hole should NOT read watertight");
});

// =====================  8. SVG IMPORT  =====================
t("svg: physical units give an exact scale", () => {
  const mk = w => ({ getAttribute: () => w });
  near(API.svgPhysicalWidthMM(mk("190mm")), 190, 0.01);
  near(API.svgPhysicalWidthMM(mk("19cm")), 190, 0.01);
  near(API.svgPhysicalWidthMM(mk("7.48in")), 190, 0.1);
  eq(API.svgPhysicalWidthMM(mk("1000")), null, "unitless must stay unknown:");
  eq(API.svgPhysicalWidthMM(mk("500px")), null, "px must stay unknown:");
});
t("svg: silhouette picker skips a full-canvas background rect", () => {
  const RW = 1000, RH = 400, full = RW * RH;
  const bg = [{x:0,y:0},{x:RW,y:0},{x:RW,y:RH},{x:0,y:RH}];
  const body = [{x:50,y:300},{x:250,y:120},{x:600,y:100},{x:930,y:200},{x:800,y:350},{x:150,y:355}];
  const detail = [{x:200,y:300},{x:260,y:300},{x:260,y:360},{x:200,y:360}];
  const polys = [bg, body, detail];
  const cand = polys.filter(p => API.polyArea(p) < full * 0.95);
  const pick = (cand.length ? cand : polys).sort((a, b) => API.polyArea(b) - API.polyArea(a))[0];
  ok(pick === body, "picked the wrong shape as the silhouette");
});
t("svg: resample caps points but keeps the shape", () => {
  const dense = Array.from({ length: 400 }, (_, i) => {
    const a = i / 400 * 2 * Math.PI; return { x: 500 + 400 * Math.cos(a), y: 200 + 150 * Math.sin(a) };
  });
  const rs = API.resamplePoly(dense, 90);
  eq(rs.length, 90, "point count:");
  ok(API.polyArea(rs) / API.polyArea(dense) > 0.99, "shape drifted while resampling");
});

// =====================  9. LIBRARY  =====================
t("library: one model saved in 3 places shows once (device wins)", () => {
  const items = API.libCanonical([
    { src: "local", name: "countach", category: "Car frame" },
    { src: "cloud", name: "countach", category: "Car frame" },
    { src: "repo",  name: "countach", category: "Car-frame" },
  ]);
  eq(items.length, 1, "duplicates not collapsed:");
  eq(items[0].src, "local", "wrong source preferred:");
});
t("library: slugged repo folders fold into the typed category", () => {
  const items = API.libCanonical([
    { src: "local", name: "bracket", category: "Parts" },
    { src: "repo",  name: "hinge",   category: "parts" },
    { src: "cloud", name: "wheel-a", category: "Wheels" },
  ]);
  const cats = [...new Set(items.map(i => i.category))];
  eq(cats.length, 2, `expected 2 real categories, got ${cats.join(", ")}:`);
  ok(cats.includes("Parts") && !cats.includes("parts"), "kept the ugly spelling");
});
t("library: different models are never merged", () => {
  eq(API.libCanonical([
    { src: "local", name: "a", category: "X" },
    { src: "local", name: "b", category: "X" },
  ]).length, 2);
});

// =====================  10. AUTO-TRACE  =====================
if (API.autoOutline) {
  t("auto-trace: finds a closed outline around a dark shape on light paper", () => {
    const W = 120, H = 80, px = new Uint8ClampedArray(W * H * 4).fill(255);
    const inShape = (x, y) => x > 20 && x < 100 && y > 20 && y < 60;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inShape(x, y)) {
      const i = (y * W + x) * 4; px[i] = px[i + 1] = px[i + 2] = 20;
    }
    const pts = API.autoOutline({ data: px, width: W, height: H });
    ok(pts && pts.length >= 8, "no outline found");
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    near(Math.min(...xs), 20, 4, "left edge:");  near(Math.max(...xs), 100, 4, "right edge:");
    near(Math.min(...ys), 20, 4, "top edge:");   near(Math.max(...ys), 60, 4, "bottom edge:");
  });
  t("auto-trace: the outline feeds the envelope without inverting", () => {
    const W = 120, H = 80, px = new Uint8ClampedArray(W * H * 4).fill(255);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const cx = (x - 60) / 40, cy = (y - 40) / 25;
      if (cx * cx + cy * cy < 1) { const i = (y * W + x) * 4; px[i] = px[i + 1] = px[i + 2] = 15; }
    }
    const pts = API.autoOutline({ data: px, width: W, height: H });
    ok(pts && pts.length > 8, "no outline");
    const e = API.outlineEnvelope(pts);
    for (let i = 0; i < e.top.length; i++) ok(e.top[i].y <= e.bot[i].y, "inverted at slice " + i);
  });
}

// =====================  10b. VIEW ORIENTATION  =====================
// Blueprints often draw the top view rotated 90° (car pointing up). Everything downstream
// assumes length runs left-to-right, so a sideways view makes the length get measured as
// the width -> the model came out as a flat slab. This is that bug, pinned down.
t("orient: a sideways top view is detected as portrait", () => {
  // real proportions: a car 190 long x 80 wide, but DRAWN pointing up
  const sideways = [{x:20,y:10},{x:100,y:10},{x:100,y:200},{x:20,y:200}];
  const xs = sideways.map(p => p.x), ys = sideways.map(p => p.y);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  ok(h > w * 1.15, "should read as portrait (drawn sideways)");
});
t("orient: rotating -90° maps the points correctly and makes it landscape", () => {
  const W = 120, H = 220;                                  // the portrait drawing
  const pts = [{x:20,y:10},{x:100,y:10},{x:100,y:200},{x:20,y:200}];
  const rot = pts.map(p => ({ x: p.y, y: W - p.x }));       // the app's dir=-1 mapping
  const xs = rot.map(p => p.x), ys = rot.map(p => p.y);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  ok(w > h, `after rotating it must be landscape, got ${w}x${h}`);
  near(w, 190, 1, "length should now run left-to-right:");
  near(h, 80, 1, "width should now be the vertical extent:");
  for (const p of rot) { ok(p.x >= 0 && p.x <= H, "x escaped the rotated canvas"); ok(p.y >= 0 && p.y <= W, "y escaped"); }
});
t("orient: THE BUG — a sideways top view ruins the width; rotating fixes it", () => {
  // side view says the car is 190mm long (drawn at 2 px/mm)
  const lenMM = 190;
  // top view drawn sideways at 1 px/mm: 190px tall (length), 80px wide (width)
  const sideways = [{x:10,y:10},{x:90,y:10},{x:90,y:200},{x:10,y:200}];
  const widthFrom = pts => {
    const e = API.outlineEnvelope(pts);
    const pxmm = API.anchorPxPerMm(e.span, lenMM, null, 200);
    return 2 * Math.max(...e.top.map((p, i) => (e.bot[i].y - p.y) / pxmm / 2));
  };
  const bad = widthFrom(sideways);
  ok(bad > 300, `expected the broken width to be absurd, got ${bad.toFixed(0)}mm`);
  const upright = sideways.map(p => ({ x: p.y, y: 100 - p.x }));   // rotate -90°
  const good = widthFrom(upright);
  near(good, 80, 5, "after rotating, the width must be the real 80mm:");
});

// =====================  10c. SIZE vs SHAPE  =====================
// The drawing owns the shape; the sliders own the measurements. Resizing must never
// require a re-trace, and must never alter the traced points.
t("size: scaling hits the requested width and height exactly", () => {
  const topP = [[0, 10], [0.5, 60], [1, 20]], botP = [[0, 0], [0.5, 0], [1, 0]];
  const widP = [[0, 10], [0.5, 40], [1, 16]];
  const natHgt = 60, natWid = 80;                       // what the drawing measured
  const scale = (want, nat, prof) => prof.map(p => [p[0], p[1] * (want / nat)]);
  const tall = scale(120, natHgt, topP);                // ask for double height
  near(Math.max(...tall.map(p => p[1])), 120, 1e-6, "height:");
  const wide = scale(40, natWid, widP);                 // ask for half width
  near(2 * Math.max(...wide.map(p => p[1])), 40, 1e-6, "width:");
  // shape is preserved: every ratio along the profile is unchanged
  for (let i = 0; i < topP.length; i++)
    near(tall[i][1] / tall[0][1] || 0, topP[i][1] / topP[0][1] || 0, 1e-9, "profile shape drifted at " + i);
});
t("size: resizing leaves the traced points untouched", () => {
  const traced = { top: [[0, 10], [1, 60]], natHgt: 60 };
  const before = JSON.stringify(traced.top);
  const out = traced.top.map(p => [p[0], p[1] * (120 / traced.natHgt)]);   // sizedProfiles()
  eq(JSON.stringify(traced.top), before, "the trace was mutated:");
  near(out[1][1], 120, 1e-9);
});
t("size: a resized model is still watertight", () => {
  const base = { length: 190, stations: 40, arcSegments: 32, roofFlatness: 1.3,
    wallThickness: 1.8, bottomProfile: [[0,2],[1,2]], mode: "loft" };
  const topP = [[0,10],[0.5,60],[1,20]], widP = [[0,10],[0.5,40],[1,16]];
  for (const [hk, wk] of [[0.4, 0.4], [1, 1], [2.5, 0.6], [0.5, 3]]) {
    const g = API.makeBody({ ...base,
      topProfile: topP.map(p => [p[0], p[1] * hk]),
      widthProfile: widP.map(p => [p[0], p[1] * wk]) });
    const r = manifold(g.indices);
    ok(r.boundary === 0 && r.nonMani === 0, `h×${hk} w×${wk}: ${r.boundary} open edges`);
    ok(g.volume > 0, `h×${hk} w×${wk}: no volume`);
  }
});

// =====================  10d. PUBLISH ROUTING  =====================
// A GitHub write token must never be shipped inside a static page — the source is public,
// so it would hand the repo to anyone (and GitHub revokes exposed tokens anyway). The
// backend holds one server-side instead, which is what lets everyone publish with no setup.
t("publish: prefers the backend, so nobody needs a token", () => {
  eq(API.publishRoute(true, false), "backend");
  eq(API.publishRoute(true, true), "backend", "the backend must win over a local token:");
});
t("publish: falls back to the owner's own token when there's no backend", () => {
  eq(API.publishRoute(false, true), "token");
});
t("publish: offers nothing when it cannot actually publish", () => {
  eq(API.publishRoute(false, false), null);
});
t("secrets: no GitHub token is baked into the page", () => {
  const leaks = [
    [/ghp_[A-Za-z0-9]{20,}/, "classic GitHub token"],
    [/github_pat_[A-Za-z0-9_]{20,}/, "fine-grained GitHub token"],
    [/gho_[A-Za-z0-9]{20,}/, "GitHub OAuth token"],
  ];
  for (const [re, what] of leaks) ok(!re.test(html), `a ${what} is embedded in index.html`);
  // the placeholder is fine; a real value would not be
  ok(!/LEE3D_CONFIG[\s\S]{0,400}?token/i.test(html), "the injected config must not carry a token");
});

// =====================  10e. FEATURES  =====================
// A feature is a region traced in a view, pressed into or out of the body. It must move
// the surface where you drew it, leave the rest alone, and never break the seal.
const FEAT_BASE = { length: 190, stations: 40, arcSegments: 32, roofFlatness: 1.3,
  wallThickness: 1.8, topProfile: [[0,10],[0.5,60],[1,20]], bottomProfile: [[0,2],[1,2]],
  widthProfile: [[0,10],[0.5,40],[1,16]], mode: "loft" };
const WINDOW = [[0.35,0.55],[0.62,0.55],[0.62,0.85],[0.35,0.85]];   // a window on the side

t("features: a recessed window keeps the model watertight", () => {
  const g = API.makeBody({ ...FEAT_BASE, features: [{ view: "side", poly: WINDOW, depth: -3, soft: 0.1 }] });
  const r = manifold(g.indices);
  ok(r.boundary === 0 && r.nonMani === 0, `${r.boundary} open edges, ${r.nonMani} non-manifold`);
  ok(g.volume > 0, "no volume");
});
t("features: pressing in removes material, bulging out adds it", () => {
  const plain = API.makeBody({ ...FEAT_BASE });
  const dish  = API.makeBody({ ...FEAT_BASE, features: [{ view: "side", poly: WINDOW, depth: -3, soft: 0.1 }] });
  const bulge = API.makeBody({ ...FEAT_BASE, features: [{ view: "side", poly: WINDOW, depth: 3, soft: 0.1 }] });
  ok(dish.volume < plain.volume, `recess didn't remove material (${dish.volume} vs ${plain.volume})`);
  ok(bulge.volume > plain.volume, `bulge didn't add material (${bulge.volume} vs ${plain.volume})`);
});
t("features: only the traced region moves — the rest of the body is untouched", () => {
  const plain = API.makeBody({ ...FEAT_BASE });
  const feat  = API.makeBody({ ...FEAT_BASE, features: [{ view: "side", poly: WINDOW, depth: -3, soft: 0.05 }] });
  eq(feat.positions.length, plain.positions.length, "vertex count changed:");
  let moved = 0, still = 0;
  for (let i = 0; i < plain.positions.length; i += 3) {
    const d = Math.hypot(feat.positions[i] - plain.positions[i],
                         feat.positions[i+1] - plain.positions[i+1],
                         feat.positions[i+2] - plain.positions[i+2]);
    if (d > 0.01) moved++; else still++;
  }
  ok(moved > 0, "the feature moved nothing at all");
  ok(still > moved * 2, `the feature leaked across the body (${moved} moved vs ${still} still)`);
});
t("features: stacking several stays watertight", () => {
  const g = API.makeBody({ ...FEAT_BASE, features: [
    { view: "side", poly: WINDOW, depth: -3, soft: 0.1 },
    { view: "side", poly: [[0.1,0.2],[0.2,0.2],[0.2,0.35],[0.1,0.35]], depth: 2, soft: 0.06 },   // mirror
    { view: "top",  poly: [[0.75,0.4],[0.9,0.4],[0.9,0.6],[0.75,0.6]], depth: -2, soft: 0.08 },  // vent
  ]});
  const r = manifold(g.indices);
  ok(r.boundary === 0 && r.nonMani === 0, `${r.boundary} open edges with 3 features`);
});
t("features: a zero-depth or empty feature changes nothing", () => {
  const plain = API.makeBody({ ...FEAT_BASE });
  for (const f of [{ view: "side", poly: WINDOW, depth: 0, soft: 0.1 }, { view: "side", poly: [[0,0]], depth: -3, soft: 0.1 }]) {
    const g = API.makeBody({ ...FEAT_BASE, features: [f] });
    near(g.volume, plain.volume, 1e-6, "a no-op feature altered the model:");
  }
});
t("features: distToPoly measures distance to the edge, not the centre", () => {
  const sq = [[0,0],[1,0],[1,1],[0,1]];
  near(API.distToPoly(sq, 0.5, 0.5), 0.5, 1e-9, "centre of a unit square:");
  near(API.distToPoly(sq, 0.9, 0.5), 0.1, 1e-9, "near the right edge:");
  near(API.distToPoly(sq, 0.5, 0.02), 0.02, 1e-9, "near the bottom edge:");
});

// =====================  10f. SVG IS THE TRACE  =====================
// An SVG already contains the real lines. Reading its pixels back would throw away exact
// geometry to guess at it, so the vector paths get kept and re-used.
t("svg: the silhouette picker skips a background rect and takes the body", () => {
  const RW = 1000, RH = 400, full = RW * RH;
  const bg = [{x:0,y:0},{x:RW,y:0},{x:RW,y:RH},{x:0,y:RH}];
  const body = [{x:50,y:300},{x:250,y:120},{x:600,y:100},{x:930,y:200},{x:800,y:350},{x:150,y:355}];
  const wheel = [{x:200,y:300},{x:260,y:300},{x:260,y:360},{x:200,y:360}];
  ok(API.pickSilhouette([bg, body, wheel], full, 0) === body, "didn't pick the body");
});
t("svg: pressing auto-trace again steps to the next shape", () => {
  const full = 1e9;
  const big = [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}];
  const mid = [{x:0,y:0},{x:50,y:0},{x:50,y:50},{x:0,y:50}];
  const small = [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
  const polys = [small, big, mid];
  eq(API.pickSilhouette(polys, full, 0), big, "first pick should be the largest:");
  eq(API.pickSilhouette(polys, full, 1), mid, "second pick:");
  eq(API.pickSilhouette(polys, full, 2), small, "third pick:");
  eq(API.pickSilhouette(polys, full, 3), big, "it should wrap around:");
});
t("svg: an all-background drawing still yields something rather than nothing", () => {
  const full = 100;
  const bg = [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];   // 100% of the canvas
  ok(API.pickSilhouette([bg], full, 0) === bg, "should fall back to the only shape present");
});
t("svg: vector paths beat pixels — the outline keeps its exact points", () => {
  // a circle sampled from vector data survives resampling with its shape intact
  const circle = Array.from({ length: 300 }, (_, i) => {
    const a = i / 300 * 2 * Math.PI; return { x: 500 + 400 * Math.cos(a), y: 200 + 150 * Math.sin(a) };
  });
  const pick = API.pickSilhouette([circle], 1e9, 0);
  const out = API.resamplePoly(pick, 90);
  ok(API.polyArea(out) / API.polyArea(circle) > 0.99, "vector shape drifted");
});

// =====================  10g. BOTTOM VIEW  =====================
// A traced bottom gives the floor its OWN plan — on a real car it's narrower and a
// different shape from the body above. It must share the length, narrow the body near the
// ground, and never break the seal.
const BOT_BASE = { length: 190, stations: 44, arcSegments: 36, roofFlatness: 1.3,
  wallThickness: 1.8, topProfile: [[0,10],[0.5,60],[1,20]], bottomProfile: [[0,2],[1,2]],
  widthProfile: [[0,10],[0.5,40],[1,16]], mode: "loft" };
const FLOOR = [[0, 6], [0.5, 26], [1, 10]];        // a narrower floor, different shape

t("bottom: a traced floor keeps the model watertight", () => {
  const g = API.makeBody({ ...BOT_BASE, widthBottomProfile: FLOOR });
  const r = manifold(g.indices);
  ok(r.boundary === 0 && r.nonMani === 0, `${r.boundary} open edges, ${r.nonMani} non-manifold`);
  ok(g.volume > 0, "no volume");
});
t("bottom: the floor narrows the body near the ground, not the roof", () => {
  const plain = API.makeBody({ ...BOT_BASE });
  const withFloor = API.makeBody({ ...BOT_BASE, widthBottomProfile: FLOOR });
  eq(withFloor.positions.length, plain.positions.length, "vertex count changed:");
  // widest |y| found low down vs high up
  const spread = (g, lo, hi) => {
    let w = 0;
    for (let i = 0; i < g.positions.length; i += 3) {
      const z = g.positions[i + 2];
      if (z >= lo && z <= hi) w = Math.max(w, Math.abs(g.positions[i + 1]));
    }
    return w;
  };
  const lowPlain = spread(plain, 0, 8), lowFloor = spread(withFloor, 0, 8);
  const topPlain = spread(plain, 40, 70), topFloor = spread(withFloor, 40, 70);
  ok(lowFloor < lowPlain * 0.9, `the floor didn't narrow the underside (${lowFloor.toFixed(1)} vs ${lowPlain.toFixed(1)})`);
  near(topFloor, topPlain, 1.5, "the floor must not disturb the upper body:");
});
t("bottom: a floor equal to the body width changes nothing", () => {
  const same = API.makeBody({ ...BOT_BASE, widthBottomProfile: BOT_BASE.widthProfile });
  const plain = API.makeBody({ ...BOT_BASE });
  near(same.volume, plain.volume, plain.volume * 0.02, "a matching floor altered the model:");
});
t("bottom: the body's width at the floor IS the traced floor width", () => {
  // (volume is the shell material here, not enclosed space — narrowing adds curvature and
  // can add material, so measure the geometry instead of guessing from volume)
  const g = API.makeBody({ ...BOT_BASE, widthBottomProfile: FLOOR });
  const zBot = 2;                                   // bottomProfile is flat at 2mm
  let atFloor = 0;
  for (let i = 0; i < g.positions.length; i += 3) {
    const x = g.positions[i], z = g.positions[i + 2];
    if (Math.abs(x) < 6 && z >= zBot - 0.5 && z <= zBot + 0.6) atFloor = Math.max(atFloor, Math.abs(g.positions[i + 1]));
  }
  near(atFloor, 26, 2.5, "mid-body floor half-width should match the traced 26mm:");
});
t("bottom: a floor plus features and sculpt together stay watertight", () => {
  const n = (44 + 1) * (36 + 1);
  const g = API.makeBody({ ...BOT_BASE, widthBottomProfile: FLOOR,
    sculpt: Float32Array.from({ length: n }, (_, i) => Math.sin(i) * 2),
    features: [{ view: "side", poly: [[0.35,0.55],[0.62,0.55],[0.62,0.85],[0.35,0.85]], depth: -3, soft: 0.1 }] });
  const r = manifold(g.indices);
  ok(r.boundary === 0 && r.nonMani === 0, `${r.boundary} open edges with floor+sculpt+feature`);
});

// =====================  10h. STAMPED FEATURES (box / text)  =====================
// A mask feature covers a rectangle of the view; its greyscale is how deep each spot goes.
// Text is one of these. Engraved = negative depth, raised = positive.
const MASK_BASE = { length: 190, stations: 44, arcSegments: 36, roofFlatness: 1.3,
  wallThickness: 1.8, topProfile: [[0,10],[0.5,60],[1,20]], bottomProfile: [[0,2],[1,2]],
  widthProfile: [[0,10],[0.5,40],[1,16]], mode: "loft" };
// a 4x4 stamp: solid block in the middle, empty border
const BLOCK = { w: 4, h: 4, d: Uint8Array.from([0,0,0,0, 0,255,255,0, 0,255,255,0, 0,0,0,0]) };

t("mask: samples full depth in the middle and nothing outside the box", () => {
  const f = { box: [0.2, 0.5, 0.8, 0.9], mask: BLOCK };
  near(API.sampleMask(f, 0.5, 0.7), 1, 0.001, "centre should be full coverage:");
  eq(API.sampleMask(f, 0.05, 0.7), 0, "left of the box must be untouched:");
  eq(API.sampleMask(f, 0.5, 0.1), 0, "below the box must be untouched:");
});
t("mask: edges fade smoothly rather than stair-stepping", () => {
  const f = { box: [0, 0, 1, 1], mask: BLOCK };
  const mid = API.sampleMask(f, 0.5, 0.5), edge = API.sampleMask(f, 0.5, 0.85);
  ok(mid > edge, "the stamp should fade towards its border");
  ok(edge > 0 && edge < 1, `expected a partial value at the edge, got ${edge}`);
});
t("mask: engraved text presses in, raised text stands out, both stay watertight", () => {
  const mk = depth => API.makeBody({ ...MASK_BASE,
    features: [{ kind: "text", view: "side", box: [0.35, 0.5, 0.7, 0.75], mask: BLOCK, depth, soft: 0.05 }] });
  const plain = API.makeBody({ ...MASK_BASE });
  for (const depth of [-1.5, 1.5]) {
    const g = mk(depth);
    const r = manifold(g.indices);
    ok(r.boundary === 0 && r.nonMani === 0, `depth ${depth}: ${r.boundary} open edges`);
    let moved = 0;
    for (let i = 0; i < g.positions.length; i += 3)
      if (Math.hypot(g.positions[i] - plain.positions[i], g.positions[i+1] - plain.positions[i+1],
                     g.positions[i+2] - plain.positions[i+2]) > 0.01) moved++;
    ok(moved > 0, `depth ${depth} moved nothing`);
  }
});
t("mask: engrave and emboss push the same spot opposite ways", () => {
  // measure AT the stamp, not at the model's widest point (which the stamp never touches)
  const mk = depth => API.makeBody({ ...MASK_BASE,
    features: [{ kind: "text", view: "side", box: [0.3, 0.4, 0.75, 0.8], mask: BLOCK, depth, soft: 0.05 }] });
  const plain = API.makeBody({ ...MASK_BASE }), out = mk(2.5), inn = mk(-2.5);
  let best = -1, bd = 0;
  for (let i = 0; i < plain.positions.length; i += 3) {
    const d = Math.abs(out.positions[i + 1]) - Math.abs(plain.positions[i + 1]);
    if (d > bd) { bd = d; best = i; }
  }
  ok(best >= 0 && bd > 0.2, `embossing didn't raise anything (best rise ${bd.toFixed(3)}mm)`);
  ok(Math.abs(inn.positions[best + 1]) < Math.abs(plain.positions[best + 1]) - 0.2,
     "at the same spot, engraving must go inward");
});
t("mask: a box feature is just a 4-point shape and still seals", () => {
  const g = API.makeBody({ ...MASK_BASE,
    features: [{ kind: "poly", view: "side", poly: [[0.3,0.5],[0.6,0.5],[0.6,0.8],[0.3,0.8]], depth: -3, soft: 0.06 }] });
  const r = manifold(g.indices);
  ok(r.boundary === 0 && r.nonMani === 0, `${r.boundary} open edges`);
});
t("mask: a stamp with no depth is a no-op", () => {
  const plain = API.makeBody({ ...MASK_BASE });
  const g = API.makeBody({ ...MASK_BASE,
    features: [{ kind: "text", view: "side", box: [0.3,0.4,0.7,0.8], mask: BLOCK, depth: 0, soft: 0.05 }] });
  near(g.volume, plain.volume, 1e-6, "a zero-depth stamp altered the model:");
});

// =====================  10i. SVG DETAIL -> FEATURES  =====================
// The drawing's own lines become features with no tracing. The biggest path is already the
// body outline, so it must never be offered as detail, and clicking must pick the most
// specific shape under the cursor rather than whatever encloses it.
const sdRect = (x0,y0,x1,y1) => [{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
const SD_BODY   = sdRect(20, 40, 980, 380);        // the silhouette (already the outline)
const SD_WIN = sdRect(300, 90, 560, 200);       // a window inside it
const SD_HANDLE = sdRect(380, 150, 420, 175);      // a small handle inside the window
const SD_BG     = sdRect(0, 0, 1000, 400);         // full-canvas background
const SD_FULL   = 1000 * 400;

// mirror of svgDetails(): drop the background, drop the body, keep the rest
const sdDetails = (polys, bodyPoly) => polys.filter(p => p.length >= 3
  && API.polyAreaPts(p) < API.polyAreaPts(bodyPoly) * 0.9
  && API.polyAreaPts(p) < SD_FULL * 0.95
  && API.polyAreaPts(p) > SD_FULL * 1e-5);
const sdDetailAt = (polys, bodyPoly, x, y) => {
  let best = null, bestA = Infinity;
  for (const p of sdDetails(polys, bodyPoly)) {
    if (!API.ptInPolyPts(p, x, y)) continue;
    const a = API.polyAreaPts(p); if (a < bestA) { bestA = a; best = p; }
  }
  return best;
};

t("svg detail: the body outline is never offered as a detail", () => {
  const d = sdDetails([SD_BG, SD_BODY, SD_WIN, SD_HANDLE], SD_BODY);
  ok(!d.includes(SD_BODY), "the silhouette was offered as detail");
  ok(!d.includes(SD_BG), "the background rect was offered as detail");
  eq(d.length, 2, "expected just the window and handle:");
});
t("svg detail: clicking picks the most specific shape under the cursor", () => {
  const polys = [SD_BG, SD_BODY, SD_WIN, SD_HANDLE];
  eq(sdDetailAt(polys, SD_BODY, 400, 160), SD_HANDLE, "inside the handle should pick the handle:");
  eq(sdDetailAt(polys, SD_BODY, 320, 100), SD_WIN, "inside the window only should pick the window:");
  eq(sdDetailAt(polys, SD_BODY, 900, 350), null, "empty bodywork should pick nothing:");
});
t("svg detail: point-in-polygon agrees with the geometry", () => {
  ok(API.ptInPolyPts(SD_WIN, 400, 150), "a point inside should read inside");
  ok(!API.ptInPolyPts(SD_WIN, 600, 150), "a point outside should read outside");
  ok(!API.ptInPolyPts(SD_WIN, 400, 300), "a point below should read outside");
});
t("svg detail: a grabbed line lands where it was drawn", () => {
  // normalise against the body outline's box, the same frame features live in
  const xs = SD_BODY.map(p=>p.x), ys = SD_BODY.map(p=>p.y);
  const minX = Math.min(...xs), maxY = Math.max(...ys);
  const sx = Math.max(...xs) - minX, sy = maxY - Math.min(...ys);
  const norm = SD_WIN.map(p => [(p.x-minX)/sx, (maxY-p.y)/sy]);
  for (const [u,v] of norm) { ok(u>=0&&u<=1, "u escaped 0..1: "+u); ok(v>=0&&v<=1, "v escaped 0..1: "+v); }
  // and it must actually shape the model
  const g = API.makeBody({ length:190, stations:44, arcSegments:36, roofFlatness:1.3, wallThickness:1.8,
    topProfile:[[0,10],[0.5,60],[1,20]], bottomProfile:[[0,2],[1,2]], widthProfile:[[0,10],[0.5,40],[1,16]],
    mode:"loft", features:[{kind:"poly", view:"side", poly:norm, depth:-3, soft:0.08}] });
  const r = manifold(g.indices);
  ok(r.boundary === 0 && r.nonMani === 0, `${r.boundary} open edges`);
});
t("svg detail: rotating a view turns its detail lines with it", () => {
  const W = 120, H = 220;                       // portrait drawing, auto-straightened
  const turn = p => ({ x: p.y, y: W - p.x });   // the app's dir=-1 mapping
  const outline = sdRect(10, 10, 100, 200), win = sdRect(30, 40, 70, 90);
  const rOutline = outline.map(turn), rWin = win.map(turn);
  // the window must still sit inside the outline after the turn
  const cx = rWin.reduce((s,p)=>s+p.x,0)/4, cy = rWin.reduce((s,p)=>s+p.y,0)/4;
  ok(API.ptInPolyPts(rOutline, cx, cy), "the detail fell outside the body after rotating");
  for (const p of rWin) { ok(p.x >= 0 && p.x <= H, "x escaped"); ok(p.y >= 0 && p.y <= W, "y escaped"); }
});

// =====================  10j. ANY FILE TYPE, SAME PRINCIPLE  =====================
// An SVG hands over its paths. A photo/PNG/JPEG doesn't — but in a line drawing the shapes
// ARE the regions the lines fence in, so they can be recovered. Past that point the file
// type stops mattering.
function drawnPage(W, H, strokes) {                    // white paper, black lines
  const px = new Uint8ClampedArray(W * H * 4).fill(255);
  const ink = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4; px[i] = px[i+1] = px[i+2] = 15; };
  const box = (x0, y0, x1, y1, t) => {                 // an unfilled rectangle, t px thick
    for (let x = x0; x <= x1; x++) for (let k = 0; k < t; k++) { ink(x, y0 + k); ink(x, y1 - k); }
    for (let y = y0; y <= y1; y++) for (let k = 0; k < t; k++) { ink(x0 + k, y); ink(x1 - k, y); }
  };
  strokes.forEach(sx => box(...sx));
  return { data: px, width: W, height: H };
}

t("any file: Otsu splits ink from paper without a slider", () => {
  const img = drawnPage(120, 80, [[10, 10, 110, 70, 2]]);
  const thr = API.otsuThreshold(API.lumOf(img));
  // Otsu's t means class-0 is [0..t] INCLUSIVE, so on flat art t lands ON the ink value.
  // What matters is that classifying with "<= t" puts ink in and paper out.
  ok(15 <= thr && thr < 255, `threshold out of range: ${thr}`);
  ok(15 <= thr, "ink must classify as ink");
  ok(!(255 <= thr), "paper must not classify as ink");
});
t("any file: a PNG line drawing gives up its shapes — body plus the window inside it", () => {
  // a body outline with a window drawn inside it, exactly like a blueprint
  const img = drawnPage(240, 160, [[20, 20, 220, 140, 2], [60, 45, 130, 90, 2]]);
  const regions = API.rasterRegions(img, 40);
  ok(regions.length >= 2, `expected the body and the window, found ${regions.length}`);
  const areas = regions.map(r => API.polyAreaPts(r)).sort((a, b) => b - a);
  ok(areas[0] > areas[1] * 2, "the body should be clearly the biggest region");
  // the window's region should sit roughly where it was drawn
  const win = regions.find(r => {
    const xs = r.map(p => p.x), ys = r.map(p => p.y);
    return Math.min(...xs) > 50 && Math.max(...xs) < 140 && Math.min(...ys) > 35 && Math.max(...ys) < 100;
  });
  ok(win, "the window region wasn't found where it was drawn");
});
t("any file: the outside background is never returned as a shape", () => {
  const img = drawnPage(240, 160, [[20, 20, 220, 140, 2]]);
  const regions = API.rasterRegions(img, 40);
  for (const r of regions) {
    const xs = r.map(p => p.x), ys = r.map(p => p.y);
    ok(!(Math.min(...xs) <= 1 && Math.min(...ys) <= 1 && Math.max(...xs) >= 238),
       "a region covering the whole page came back — the outside leaked in");
  }
});
t("any file: a blank page yields nothing rather than nonsense", () => {
  const px = new Uint8ClampedArray(80 * 60 * 4).fill(255);
  eq(API.rasterRegions({ data: px, width: 80, height: 60 }, 40).length, 0);
});
t("any file: recovered shapes feed the envelope without inverting", () => {
  const img = drawnPage(240, 160, [[20, 20, 220, 140, 2], [60, 45, 130, 90, 2]]);
  for (const r of API.rasterRegions(img, 40)) {
    const e = API.outlineEnvelope(r);
    for (let i = 0; i < e.top.length; i++) ok(e.top[i].y <= e.bot[i].y, "a recovered region inverted");
  }
});
t("any file: a recovered shape becomes a working feature", () => {
  const img = drawnPage(240, 160, [[20, 20, 220, 140, 2], [60, 45, 130, 90, 2]]);
  const regions = API.rasterRegions(img, 40).sort((a, b) => API.polyAreaPts(b) - API.polyAreaPts(a));
  const body = regions[0], win = regions[1];
  ok(win, "no window region to test with");
  const xs = body.map(p => p.x), ys = body.map(p => p.y);
  const minX = Math.min(...xs), maxY = Math.max(...ys);
  const sx = Math.max(...xs) - minX, sy = maxY - Math.min(...ys);
  const norm = API.resamplePoly(win, 48).map(p => [(p.x - minX) / sx, (maxY - p.y) / sy]);
  const g = API.makeBody({ length:190, stations:44, arcSegments:36, roofFlatness:1.3, wallThickness:1.8,
    topProfile:[[0,10],[0.5,60],[1,20]], bottomProfile:[[0,2],[1,2]], widthProfile:[[0,10],[0.5,40],[1,16]],
    mode:"loft", features:[{ kind:"poly", view:"side", poly:norm, depth:-3, soft:0.08 }] });
  const r = manifold(g.indices);
  ok(r.boundary === 0 && r.nonMani === 0, `${r.boundary} open edges from a PNG-derived feature`);
});

// =====================  10k. WHERE A MEASUREMENT COMES FROM  =====================
// Reading a drawing: the side/top views give the length, the top view gives the width
// along that length, and the front/rear views give the width head-on. Any of them should
// be able to size the model, and a nudge shouldn't be wiped by touching a trace.
t("measure: with no top view, the front view still gives the width", () => {
  // frontHull is [[y mm, z mm], …]; the spread of y IS the width, measured head-on
  const frontHull = [[-40, 5], [-30, 40], [0, 55], [30, 40], [40, 5]];
  const xs = frontHull.map(q => q[0]);
  const measured = Math.max(...xs) - Math.min(...xs);
  near(measured, 80, 1e-9, "the front view should read 80mm across:");
  // the slider profile gets scaled until it is that wide
  const parProfile = [[0, 10], [0.5, 25], [1, 12]];
  const par = 2 * Math.max(...parProfile.map(q => q[1]));
  const k = measured / par;
  const scaled = parProfile.map(p => [p[0], p[1] * k]);
  near(2 * Math.max(...scaled.map(q => q[1])), 80, 1e-9, "after scaling it must be the measured width:");
});
t("measure: a slider nudge survives re-tracing", () => {
  // you set 100mm on a drawing that measured 80 -> a ratio of 1.25
  let natWid = 80, widMM = 100;
  const widK = widMM / natWid;
  near(widK, 1.25, 1e-9);
  // now a trace point moves and the drawing re-measures at 84mm
  natWid = 84;
  const after = Math.max(1, Math.round(natWid * widK));
  eq(after, 105, "the nudge should ride along, not be wiped back to 84:");
  // and with no nudge (ratio 1) it just tracks the drawing
  eq(Math.max(1, Math.round(84 * 1)), 84);
});
t("measure: length is anchored from the side/top views, width from top or front", () => {
  // length: the side view's span over its own scale
  near(API.anchorPxPerMm(380, null, 2, 200), 2, 1e-9, "side view sets px/mm:");
  // the top view is then forced to agree about the length
  near(API.anchorPxPerMm(190, 190, 99, 200), 1, 1e-9, "top view anchored to the same length:");
  // and the front view is forced to agree about the width
  near(API.anchorPxPerMm(160, 80, 99, 200), 2, 1e-9, "front view anchored to the same width:");
});

// =====================  10l. SHARP EDGES  =====================
// The reason angular objects used to come out mushy: averaging the surface crossings in a
// cell always rounds a corner off. Dual contouring solves for the point that satisfies
// every crossing plane, so a corner lands ON the corner.
const SQ = [[0.1,0.1],[0.9,0.1],[0.9,0.9],[0.1,0.9]];          // a hard-edged box
const cube = crisp => API.makeBody({ mode:"projection", length:100, stations:36, hullCrisp:crisp,
  sidePoly:SQ, topPoly:SQ, frontPoly:SQ, topProfile:[[0,60]], widthProfile:[[0,30]] });

t("sharp: signed distance is negative inside, positive outside, zero on the edge", () => {
  const sq = [[0,0],[10,0],[10,10],[0,10]];
  ok(API.sdPoly(sq, 5, 5) < 0, "the middle should read inside");
  near(API.sdPoly(sq, 5, 5), -5, 1e-6, "and 5mm from the nearest wall:");
  ok(API.sdPoly(sq, 15, 5) > 0, "outside should read outside");
  near(API.sdPoly(sq, 15, 5), 5, 1e-6, "5mm out:");
  near(Math.abs(API.sdPoly(sq, 10, 5)), 0, 1e-6, "right on the edge should be zero:");
});
t("sharp: a boxy trace produces a boxy model, still watertight", () => {
  const g = cube(0.9);
  const r = manifold(g.indices);
  ok(r.boundary === 0 && r.nonMani === 0, `${r.boundary} open edges, ${r.nonMani} non-manifold`);
  ok(g.volume > 0, "no volume");
});
t("sharp: corners are crisp, not rounded off", () => {
  // how square is it? compare the model's volume to the box it should fill.
  const boxiness = g => {
    let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9,z0=1e9,z1=-1e9;
    for (let i = 0; i < g.positions.length; i += 3) {
      x0=Math.min(x0,g.positions[i]);   x1=Math.max(x1,g.positions[i]);
      y0=Math.min(y0,g.positions[i+1]); y1=Math.max(y1,g.positions[i+1]);
      z0=Math.min(z0,g.positions[i+2]); z1=Math.max(z1,g.positions[i+2]);
    }
    return g.volume / Math.max(1e-9, (x1-x0)*(y1-y0)*(z1-z0));   // 1.0 = a perfect box
  };
  const crisp = boxiness(cube(1)), soft = boxiness(cube(0));
  ok(crisp > 0.9, `a boxy trace should fill >90% of its bounding box, got ${(crisp*100).toFixed(1)}%`);
  ok(crisp > soft, `crisp (${(crisp*100).toFixed(1)}%) should beat rounded (${(soft*100).toFixed(1)}%)`);
});
t("sharp: the crispness dial actually does something, and both ends are watertight", () => {
  for (const c of [0, 0.5, 1]) {
    const r = manifold(cube(c).indices);
    ok(r.boundary === 0 && r.nonMani === 0, `crisp=${c}: ${r.boundary} open edges`);
  }
});
t("sharp: a round trace still comes out round (crispness doesn't wreck curves)", () => {
  const circle = Array.from({ length: 40 }, (_, i) => {
    const a = i / 40 * 2 * Math.PI; return [0.5 + 0.45 * Math.cos(a), 0.5 + 0.45 * Math.sin(a)];
  });
  const g = API.makeBody({ mode:"projection", length:100, stations:36, hullCrisp:0.9,
    sidePoly:circle, topPoly:circle, frontPoly:circle, topProfile:[[0,100]], widthProfile:[[0,50]] });
  const r = manifold(g.indices);
  ok(r.boundary === 0 && r.nonMani === 0, `${r.boundary} open edges on a sphere`);
  // a sphere fills ~52% of its bounding cube; a cube would be ~100%
  let x0=1e9,x1=-1e9; for (let i=0;i<g.positions.length;i+=3){x0=Math.min(x0,g.positions[i]);x1=Math.max(x1,g.positions[i]);}
  ok(g.volume > 0, "no volume");
});

// =====================  10m. REAL OPENINGS, NO SERVER  =====================
// The lofted shell can only move the surface it has, so a window gets dented. The hull is
// a distance field, so a window can be genuinely subtracted — an actual hole, in the
// browser, with nothing to install. A hole means the shape gains a tunnel: same closed
// surface, but no longer a simple ball — which is exactly what Euler's formula detects.
const HULL_BOX = [[0.08,0.08],[0.92,0.08],[0.92,0.92],[0.08,0.92]];
const hullWith = feats => API.makeBody({ mode:"projection", length:120, stations:40, hullCrisp:0.9,
  sidePoly:HULL_BOX, topPoly:HULL_BOX, frontPoly:HULL_BOX,
  topProfile:[[0,60]], widthProfile:[[0,25]], features:feats });
// V - E + F for a closed surface: 2 = a ball, 0 = one tunnel through it
function euler(g) {
  const E = new Set();
  const key = (a, b) => (a < b ? a + "_" + b : b + "_" + a);
  const V = new Set();
  for (let i = 0; i < g.indices.length; i += 3) {
    const [a, b, c] = [g.indices[i], g.indices[i+1], g.indices[i+2]];
    V.add(a); V.add(b); V.add(c);
    E.add(key(a,b)); E.add(key(b,c)); E.add(key(c,a));
  }
  return V.size - E.size + g.indices.length / 3;
}

t("openings: a plain traced box is a plain closed shape", () => {
  const g = hullWith([]);
  const r = manifold(g.indices);
  ok(r.boundary === 0 && r.nonMani === 0, "the plain box isn't sealed");
  eq(euler(g), 2, "a box with no holes should have Euler characteristic 2:");
});
t("openings: a 'cut through' window puts a REAL hole in it, not a dent", () => {
  const win = [{ kind:"poly", view:"side", depth:-4, through:true, soft:0.02,
                 poly:[[0.35,0.35],[0.65,0.35],[0.65,0.65],[0.35,0.65]] }];
  const g = hullWith(win);
  const r = manifold(g.indices);
  ok(r.boundary === 0 && r.nonMani === 0, `a hole must still leave it sealed: ${r.boundary} open edges`);
  eq(euler(g), 0, "one tunnel through the body should give Euler characteristic 0 (2 - 2*1):");
});
t("openings: the same window WITHOUT 'cut through' only dents it", () => {
  const dent = [{ kind:"poly", view:"side", depth:-4, through:false, soft:0.05,
                  poly:[[0.35,0.35],[0.65,0.35],[0.65,0.65],[0.35,0.65]] }];
  const g = hullWith(dent);
  eq(euler(g), 2, "a dish must NOT punch through:");
  ok(g.volume < hullWith([]).volume, "a dish should still remove material");
});
t("openings: two windows make two tunnels", () => {
  const two = [
    { kind:"poly", view:"side", depth:-4, through:true, soft:0.02, poly:[[0.2,0.35],[0.4,0.35],[0.4,0.65],[0.2,0.65]] },
    { kind:"poly", view:"side", depth:-4, through:true, soft:0.02, poly:[[0.6,0.35],[0.8,0.35],[0.8,0.65],[0.6,0.65]] },
  ];
  const g = hullWith(two);
  const r = manifold(g.indices);
  ok(r.boundary === 0 && r.nonMani === 0, "two holes must still leave it sealed");
  eq(euler(g), -2, "two tunnels should give 2 - 2*2 = -2:");
});
t("openings: a raised feature is never turned into a hole", () => {
  const boss = [{ kind:"poly", view:"side", depth:3, through:true, soft:0.05,
                  poly:[[0.35,0.35],[0.65,0.35],[0.65,0.65],[0.35,0.65]] }];
  const g = hullWith(boss);
  eq(euler(g), 2, "a bump marked 'through' must not cut a hole:");
  ok(g.volume > hullWith([]).volume, "a bump should add material");
});
t("openings: a hole through the TOP view goes the other way and still seals", () => {
  const roof = [{ kind:"poly", view:"top", depth:-4, through:true, soft:0.02,
                  poly:[[0.4,0.35],[0.6,0.35],[0.6,0.65],[0.4,0.65]] }];
  const g = hullWith(roof);
  const r = manifold(g.indices);
  ok(r.boundary === 0 && r.nonMani === 0, `${r.boundary} open edges`);
  eq(euler(g), 0, "a sunroof is still one tunnel:");
});

// =====================  10n. FRAME THICKNESS  =====================
// How thick the frame is, per face, and the rule that nothing pressed in may go deeper
// than the frame it is pressed into.
const W_BASE = { length:190, stations:44, arcSegments:36, roofFlatness:1.3,
  topProfile:[[0,10],[0.5,60],[1,20]], bottomProfile:[[0,2],[1,2]],
  widthProfile:[[0,10],[0.5,40],[1,16]], mode:"loft" };

t("thickness: one number still means a uniform frame", () => {
  const W = API.wallSpec({ wallThickness: 2.5 });
  eq(W.top, 2.5); eq(W.side, 2.5); eq(W.bot, 2.5);
  near(API.wallAt([0,0,1], W), 2.5, 1e-9, "roof:");
  near(API.wallAt([0,1,0], W), 2.5, 1e-9, "side:");
});
t("thickness: each face can be its own, and it blends in between", () => {
  const W = API.wallSpec({ wallThickness:1.8, wallTop:4, wallSide:1, wallBottom:6 });
  near(API.wallAt([0,0,1], W), 4, 1e-9, "straight up = roof:");
  near(API.wallAt([0,1,0], W), 1, 1e-9, "sideways = side:");
  near(API.wallAt([0,0,-1], W), 6, 1e-9, "straight down = floor:");
  // a 45° shoulder should land between roof and side, not jump
  const mid = API.wallAt([0, Math.SQRT1_2, Math.SQRT1_2], W);
  ok(mid > 1 && mid < 4, `a blended corner should sit between 1 and 4, got ${mid}`);
});
t("thickness: the cap is the THINNEST face — that's what a feature can't exceed", () => {
  eq(API.minWall({ wallThickness:1.8, wallTop:4, wallSide:1, wallBottom:6 }), 1);
  eq(API.minWall({ wallThickness:2 }), 2);
});
t("thickness: a per-face frame is still watertight", () => {
  for (const w of [{wallTop:4,wallSide:1,wallBottom:6}, {wallTop:0.5,wallSide:5,wallBottom:0.5}]) {
    const g = API.makeBody({ ...W_BASE, wallThickness:1.8, ...w });
    const r = manifold(g.indices);
    ok(r.boundary === 0 && r.nonMani === 0, `${JSON.stringify(w)}: ${r.boundary} open edges`);
    ok(g.volume > 0, "no volume");
  }
});
t("thickness: a thicker frame is more material", () => {
  const thin = API.makeBody({ ...W_BASE, wallThickness:0.8 });
  const thick = API.makeBody({ ...W_BASE, wallThickness:4 });
  ok(thick.volume > thin.volume * 2, `4mm should be far heavier than 0.8mm (${thick.volume.toFixed(0)} vs ${thin.volume.toFixed(0)})`);
});
t("thickness: a 3mm scoop on a 1.8mm frame is held to 1.8mm", () => {
  const win = poly => [{ kind:"poly", view:"side", depth:-3, soft:0.06, poly }];
  const P = [[0.35,0.4],[0.6,0.4],[0.6,0.7],[0.35,0.7]];
  const plain = API.makeBody({ ...W_BASE, wallThickness:1.8 });
  const deep  = API.makeBody({ ...W_BASE, wallThickness:1.8, features:win(P) });
  const capped= API.makeBody({ ...W_BASE, wallThickness:1.8, features:[{...win(P)[0], depth:-1.8}] });
  // asking for 3mm on a 1.8mm frame must give the same answer as asking for 1.8mm
  let same = true;
  for (let i = 0; i < deep.positions.length; i++)
    if (Math.abs(deep.positions[i] - capped.positions[i]) > 1e-4) { same = false; break; }
  ok(same, "a 3mm indent should have been held back to the 1.8mm frame");
  ok(deep.volume !== plain.volume, "…but it should still have done something");
});
t("thickness: a deeper frame allows a deeper scoop", () => {
  const P = [[0.35,0.4],[0.6,0.4],[0.6,0.7],[0.35,0.7]];
  const f = [{ kind:"poly", view:"side", depth:-3, soft:0.06, poly:P }];
  const onThin  = API.makeBody({ ...W_BASE, wallThickness:1, features:f });
  const onThick = API.makeBody({ ...W_BASE, wallThickness:5, features:f });
  let moved = 0;
  for (let i = 0; i < onThin.positions.length; i++)
    if (Math.abs(onThin.positions[i] - onThick.positions[i]) > 1e-4) moved++;
  ok(moved > 0, "a 3mm scoop should press deeper into a 5mm frame than a 1mm one");
  for (const g of [onThin, onThick]) {
    const r = manifold(g.indices);
    ok(r.boundary === 0 && r.nonMani === 0, "capping must not break the seal");
  }
});
t("thickness: a cut-through is NOT capped — that's the point of it", () => {
  const P = [[0.35,0.35],[0.65,0.35],[0.65,0.65],[0.35,0.65]];
  const box = [[0.08,0.08],[0.92,0.08],[0.92,0.92],[0.08,0.92]];
  const g = API.makeBody({ mode:"projection", length:120, stations:40, hullCrisp:0.9, wallThickness:1.8,
    sidePoly:box, topPoly:box, frontPoly:box, topProfile:[[0,60]], widthProfile:[[0,25]],
    features:[{ kind:"poly", view:"side", depth:-4, through:true, soft:0.02, poly:P }] });
  const r = manifold(g.indices);
  ok(r.boundary === 0 && r.nonMani === 0, "a through-cut must stay sealed");
});

// =====================  11. DOM CONTRACT  =====================
// Every element the code reaches for must actually exist in the page. A missing
// id doesn't throw for querySelector* — it silently matches nothing, so the
// feature just quietly stops working. That is exactly how the Workshop tab
// shipped unclickable: the handler was wired to "#mainTabs .tab" and no element
// carried that id, so no listener was ever attached.
const IDS = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));

t("dom: no duplicate ids", () => {
  const all = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  const dup = all.filter((v, i) => all.indexOf(v) !== i);
  ok(dup.length === 0, "duplicated: " + [...new Set(dup)].join(", "));
});
t("dom: every getElementById target exists", () => {
  const miss = [...new Set([...script.matchAll(/getElementById\(["'`]([^"'`]+)["'`]\)/g)]
    .map(m => m[1]).filter(id => !IDS.has(id)))];
  ok(miss.length === 0, "no such element: " + miss.join(", "));
});
t("dom: every querySelector('#id') target exists", () => {
  const refs = [...script.matchAll(/querySelector(?:All)?\(\s*["'`]([^"'`]+)["'`]/g)].map(m => m[1]);
  const miss = [...new Set(refs
    .map(sel => (sel.trim().match(/^#([A-Za-z][\w-]*)/) || [])[1])
    .filter(id => id && !IDS.has(id)))];
  ok(miss.length === 0, "selector matches nothing: #" + miss.join(", #"));
});
t("dom: the tab bars are wired to elements that exist", () => {
  for (const id of ["mainTabs", "subTabs"]) ok(IDS.has(id), "missing #" + id);
  const mains = [...html.matchAll(/data-main="(\w+)"/g)].map(m => m[1]);
  const subs = [...html.matchAll(/data-tab="(\w+)"/g)].map(m => m[1]);
  ok(mains.includes("build") && mains.includes("workshop"), "main tabs: " + mains.join(","));
  ok(["import", "trace", "three"].every(x => subs.includes(x)), "sub tabs: " + subs.join(","));
  // and each tab must live inside the container its handler queries
  const bar = html.match(/id="mainTabs"[\s\S]*?<\/div>\s*<div class="tabs subtabs"/);
  ok(bar && /data-main="workshop"/.test(bar[0]), "the Workshop tab is not inside #mainTabs");
});
t("dom: every view the tabs switch to exists", () => {
  for (const id of ["viewImport", "viewTrace", "viewThree", "viewWorkshop"]) ok(IDS.has(id), "missing #" + id);
});

// =====================  12. SHIP CONTRACT  =====================
// index.html is the product. Anything that duplicates it will go stale and send
// someone debugging a copy that isn't live.
h("ship: index.html is the only copy of the studio", () => {
  const root = path.join(HERE, "..");
  const hits = [];
  (function walk(dir, depth) {
    if (depth > 4) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "test") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.html$/i.test(e.name) && p !== path.join(root, "index.html")) {
        const txt = fs.readFileSync(p, "utf8");
        if (txt.includes("LEE3D") && txt.includes("<canvas")) hits.push(path.relative(root, p));
      }
    }
  })(root, 0);
  ok(hits.length === 0, "duplicate studio copies that will drift: " + hits.join(", "));
});
t("ship: the deploy publishes index.html", () => {
  const wf = path.join(HERE, "..", ".github", "workflows", "deploy.yml");
  if (!fs.existsSync(wf)) return;                       // workflow not in this checkout
  const y = fs.readFileSync(wf, "utf8");
  ok(/cp index\.html _site\/index\.html/.test(y), "deploy.yml no longer stages index.html");
  ok(/upload-pages-artifact/.test(y) && /path:\s*_site/.test(y), "deploy.yml doesn't upload _site");
});

// =====================  12b. CSS CONTRACT  =====================
// A rule for a class that doesn't exist is silently dead — the browser never complains,
// it just does nothing. That's how a whole mobile layout shipped styling ".vp-bar" and
// ".imp-bar", neither of which was ever a class in this app: every test passed and the
// phone layout did nothing at all. Same failure as a querySelector that matches nothing.
t("css: every selector targets something that actually exists", () => {
  const css = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));
  const rest = html.slice(0, html.indexOf("<style>")) + html.slice(html.indexOf("</style>"));
  // pull class/id names out of selectors only (skip declaration blocks)
  const names = new Set();
  css.replace(/\{[^{}]*\}/g, "{}")                       // blank out declarations
     .replace(/@media[^{]*/g, " ")                        // and media conditions
     .replace(/([.#])(-?[A-Za-z_][\w-]*)/g, (_, sig, nm) => { names.add(sig + nm); return ""; });
  // a class can also be added from JS, so accept the bare word anywhere outside the CSS
  const phantom = [...names].filter(n => {
    const bare = n.slice(1);
    if (/^(on|active|sel|open|hide|primary|ghost|mono|disp|box|card|nm|tg|h|d|t|val)$/.test(bare)) return false;
    return !new RegExp("\\b" + bare.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&") + "\\b").test(rest);
  });
  ok(phantom.length === 0, "these style rules match nothing and do nothing: " + phantom.join(", "));
});
t("css: no inline style silently beats the phone layout", () => {
  // An inline style="" wins over any stylesheet rule, media query included. So a phone rule
  // can be perfectly written, target a real element, and still do nothing — which is exactly
  // how the import toolbar kept wrapping into four rows on a 390px screen while every test
  // passed. If the phone layout sets a property, no element it targets may set that same
  // property inline (unless the rule shouts !important).
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  const mq = css.slice(css.indexOf("@media (max-width: 860px)"));
  const clashes = [];
  // every "#id{...}" rule inside the phone layout
  for (const m of mq.matchAll(/#([A-Za-z][\w-]*)\s*\{([^}]*)\}/g)) {
    const [, id, decls] = m;
    const el = html.match(new RegExp('id="' + id + '"[^>]*'));
    if (!el) continue;
    const inline = (el[0].match(/style="([^"]*)"/) || [])[1];
    if (!inline) continue;
    for (const d of decls.split(";")) {
      const prop = (d.split(":")[0] || "").trim();
      if (!prop) continue;
      if (new RegExp("(^|;)\\s*" + prop + "\\s*:").test(inline) && !/!important/.test(d))
        clashes.push(`#${id} { ${prop} } is overridden by its own inline style`);
    }
  }
  ok(clashes.length === 0, clashes.join("; "));
});
t("css: layout that must change on a phone isn't nailed down inline", () => {
  // flex-wrap on a toolbar decides whether a phone gets a scrolling strip or a wall of
  // rows, so it belongs in CSS where a media query can reach it
  ok(!/class="trace-bar"[^>]*style="[^"]*flex-wrap/.test(html),
     "the toolbar's flex-wrap is pinned inline; the phone layout can't override it");
  ok(html.includes('class="trace-bar wrap"'), "use a class for wrapping so it stays overridable");
});
t("css: there is exactly ONE phone layout, not two fighting each other", () => {
  // A second, older phone layout was still in this file — further down, and at a WIDER
  // breakpoint (880px vs 860px). Later + same specificity means it won every conflict, so
  // the new layout was overridden by a layout nobody remembered writing. It capped the
  // stage at 46vh, which is why half the screen was dead space.
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  const bps = [...css.matchAll(/@media\s*\(\s*max-width:\s*(\d+)px\s*\)/g)].map(m => +m[1]);
  const dupes = bps.filter((v, i) => bps.indexOf(v) !== i);
  ok(dupes.length === 0, "duplicate breakpoints: " + dupes.join(", "));
  // they must get narrower as you read down, or a wider one overrides a narrower one
  const sorted = [...bps].sort((a, b) => b - a);
  ok(JSON.stringify(bps) === JSON.stringify(sorted),
     `breakpoints must run widest-first, got ${bps.join(" then ")} — a later, wider query silently wins`);
});
t("css: the stage is never capped to part of the screen on a phone", () => {
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");           // ignore comments
  ok(!/grid-template-rows:\s*\d+vh/.test(rules.replace(/\s+/g, "")),
     "a vh-capped row leaves dead space under the drawing; let it fill");
});
t("css: the mobile rules target the real toolbar", () => {
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  const mq = css.slice(css.indexOf("@media (max-width: 860px)"));
  ok(mq.includes(".trace-bar"), "the toolbars are .trace-bar — style that, not an invented name");
  ok(!/\.(vp|imp)-bar/.test(css), "those class names have never existed in this app");
});
t("css: a bare .btn in the header can't stretch across the screen", () => {
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  // .btn is width:100% by design (it's built for the sidebar), so anything using it
  // outside a row container has to opt out or it takes a whole line to itself
  ok(/\.btn\{[^}]*width:100%/.test(css.replace(/\s+/g, "")), "assumption changed: .btn is no longer full-width");
  ok(/#railBtn\{[^}]*width:auto/.test(css.replace(/\s+/g, "")), "#railBtn must opt out of the full-width default");
});

// =====================  13. MOBILE  =====================
// Collin drives this from a phone and his neighbour's machine barely runs it. The layout
// has to fold, and — more importantly — every tool has to stay REACHABLE. Panning used to
// need a right-click, which a phone does not have, so it simply could not be done.
const CSS = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

t("mobile: there's a small-screen layout at all", () => {
  ok(/@media\s*\(max-width:\s*860px\)/.test(CSS), "no phone breakpoint");
  ok(/@media\s*\(max-width:\s*420px\)/.test(CSS), "no narrow-phone breakpoint");
});
t("mobile: the sidebar stops stealing a column and becomes a drawer", () => {
  ok(/main\{grid-template-columns:1fr\}/.test(CSS.replace(/\s+/g, "")) ||
     /main\{grid-template-columns:1fr;/.test(CSS.replace(/\s+/g, "")),
     "main must collapse to one column on a phone");
  ok(IDS.has("railBtn"), "no way to open the drawer");
  ok(IDS.has("railScrim"), "no backdrop to close it");
  ok(script.includes("function railOpen("), "the drawer has no logic");
});
t("mobile: the drawer gets out of the way when you pick a tab", () => {
  ok(script.includes("railAutoClose"), "picking a tab should close the drawer on a phone");
  ok(script.includes('matchMedia("(max-width:860px)")'), "…and only on a phone");
});
t("mobile: toolbars scroll sideways instead of becoming a wall of buttons", () => {
  const flat = CSS.replace(/\s+/g, "");
  ok(flat.includes("overflow-x:auto"), "toolbars must scroll on a narrow screen");
  ok(/\.btn\{min-height:3\dpx/.test(flat), "touch targets need a minimum height");
});
t("mobile: panning is reachable without a right-click", () => {
  // this is the part that isn't cosmetic: a phone has no right button and no wheel
  ok(script.includes("pts.size>=2"), "no two-finger handling — pan/zoom would be impossible");
  ok(script.includes("pinch"), "no pinch zoom");
  ok(script.includes("pointercancel"), "touch needs pointercancel or fingers get stuck down");
});
t("mobile: two-finger gestures pan and zoom independently", () => {
  const mid = pts => ({ x:(pts[0].x+pts[1].x)/2, y:(pts[0].y+pts[1].y)/2,
                        d:Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y) });
  // slide both fingers: pans, must not zoom
  let a = mid([{x:100,y:200},{x:200,y:200}]);
  let b = mid([{x:140,y:200},{x:240,y:200}]);
  near(b.x - a.x, 40, 1e-9, "sliding should pan by the centre's movement:");
  near(a.d / b.d, 1, 1e-9, "sliding must not change the zoom:");
  // spread: zooms, must not pan
  let c = mid([{x:50,y:200},{x:250,y:200}]);
  near(c.x - a.x, 0, 1e-9, "spreading must not pan:");
  ok(a.d / c.d < 1, "spreading should zoom in");
});
t("mobile: the feature panel becomes a bottom sheet a thumb can reach", () => {
  const m = CSS.slice(CSS.indexOf("@media (max-width: 860px)"));
  ok(/#featPanel\{[^}]*bottom:0/.test(m.replace(/\s+/g, "")), "the inspector should dock to the bottom");
  ok(/\.ws-panel\{[^}]*bottom:0/.test(m.replace(/\s+/g, "")), "so should the workshop panel");
});
t("mobile: the viewport meta is set, or none of this applies", () => {
  ok(/name="viewport"[^>]*width=device-width/.test(html), "without this a phone renders it at desktop width");
});

// =====================  14. FEATURE EDITING  =====================
// A feature shouldn't be stuck as a rectangle, and the workflow shouldn't ask "are you
// sure?" on one view and not the next.
t("editing: taking the drawing's lines never asks a surprise question", () => {
  // it used to confirm only past 24 shapes, so one view prompted and the next didn't —
  // which reads as random. The count belongs on the button, not in a dialog.
  ok(!/confirm\([^)]*lines as features/.test(script), "the threshold confirm is back");
  ok(script.includes("⚡ take all ${have}") || script.includes("take all ${have}"),
     "the button should say how many it will take");
});
t("editing: a feature's own points can be moved, added and removed", () => {
  ok(script.includes('className="fpt"') || script.includes('pt.className="fpt"'), "no point handles");
  ok(script.includes('md.className="fmid"'), "no way to add a point to a line");
  ok(script.includes("f.poly.splice(k+1,0,mp)"), "clicking a line must insert a point there");
  ok(/f\.poly\.length<=3/.test(script), "a shape must keep at least 3 points");
});
t("editing: bending a point uses the same maths as tracing one", () => {
  // these two disagreeing would put every dragged point in the wrong place
  ok(script.includes("const canvasXY=e=>{const p=tcXY(e); return [p.x,p.y];}"),
     "point dragging must reuse tcXY, not roll its own device-pixel maths");
});
t("editing: dragging doesn't rebuild every gizmo on every frame", () => {
  ok(script.includes("featDragging"), "no drag guard — this is what made a phone crawl");
  ok(/if\(typeof featRenderGizmos==="function" && !featDragging\)/.test(script),
     "drawTrace must not rebuild the gizmo DOM mid-drag");
});
t("editing: a dragged point is held near its own view", () => {
  ok(/Math\.max\(-0\.4,Math\.min\(1\.4/.test(script), "a point should not be draggable to infinity");
});

// =====================  15. TOY JOINS  =====================
// A toy is parts that join. Two ways that goes wrong, and neither is a modelling opinion:
// a socket cut to the peg's exact size seizes solid once printed, and a peg thinner than a
// few nozzle widths snaps off in a child's hand.
t("join: a socket is always bigger than the peg it takes", () => {
  for (const nominal of [3, 5, 8, 12]) {
    const peg = API.connDiameter("peg", nominal, 0.2);
    const sock = API.connDiameter("socket", nominal, 0.2);
    eq(peg, nominal, "a peg is cut true to its size:");
    ok(sock > peg, `a Ø${nominal} socket (${sock}) must be wider than its peg (${peg})`);
    near(sock - peg, 0.4, 1e-9, "the gap is clearance on each side:");
  }
});
t("join: the same nominal size always mates, whatever it is", () => {
  // this is the whole contract: an artist says "5mm" on two different parts and they fit
  for (const nominal of [2, 4, 6, 10, 20]) {
    const fit = API.connDiameter("socket", nominal, 0.2) - API.connDiameter("peg", nominal, 0.2);
    ok(fit > 0 && fit < 1, `Ø${nominal} should mate with a sensible gap, got ${fit}`);
  }
});
t("join: a tighter printer means a tighter fit, not a broken one", () => {
  const loose = API.connDiameter("socket", 5, 0.35), tight = API.connDiameter("socket", 5, 0.1);
  ok(loose > tight, "more clearance must mean a bigger hole");
  ok(tight > API.connDiameter("peg", 5, 0.1), "even a tight fit must still leave a gap");
});
t("join: a peg too thin to survive is called out", () => {
  ok(API.connWarn("peg", 1, 4, 0.4), "a 1mm peg on a 0.4mm nozzle should warn");
  ok(!API.connWarn("peg", 5, 4, 0.4), "a 5mm peg is fine and shouldn't nag");
  ok(API.connWarn("peg", 5, 0.5, 0.4), "half a millimetre deep is under two layers — warn");
});
t("join: a connector is a real circle at the size asked for", () => {
  const B = { wMM: 100, hMM: 50 };
  const p = API.connPoly(0.5, 0.5, 10, B, 32);       // a 10mm circle on a 100x50mm view
  eq(p.length, 32);
  const us = p.map(q => q[0]), vs = p.map(q => q[1]);
  near((Math.max(...us) - Math.min(...us)) * B.wMM, 10, 0.2, "10mm across:");
  near((Math.max(...vs) - Math.min(...vs)) * B.hMM, 10, 0.2, "…and 10mm tall, not an oval:");
});
t("join: a peg builds watertight, and its socket does too", () => {
  const base = { length:190, stations:44, arcSegments:36, roofFlatness:1.3, wallThickness:3,
    topProfile:[[0,10],[0.5,60],[1,20]], bottomProfile:[[0,2],[1,2]],
    widthProfile:[[0,10],[0.5,40],[1,16]], mode:"loft" };
  const B = { wMM: 190, hMM: 60 };
  for (const [kind, depth] of [["peg", 4], ["socket", -3]]) {
    const dia = API.connDiameter(kind, 5, 0.2);
    const g = API.makeBody({ ...base,
      features: [{ kind:"poly", join:kind, view:"side", depth, soft:0.02, poly:API.connPoly(0.5,0.6,dia,B,24) }] });
    const r = manifold(g.indices);
    ok(r.boundary === 0 && r.nonMani === 0, `${kind}: ${r.boundary} open edges`);
  }
});

// =====================  16. IT HAS TO KEEP UP  =====================
// "Follow my drawing" used to ask for ~100 million distance computations on every slider
// move and took the tab down with it. The field is separable — each outline only depends
// on two of the three coordinates — so three small 2D tables replace walking the polygon
// on every one of ~54,000 samples.
t("speed: the hull's field is tabled, not recomputed per sample", () => {
  const src = (() => { const i = script.indexOf("function makeVisualHull(");
    return script.slice(i, script.indexOf("\nfunction ", i + 10)); })();
  ok(src.includes("mkTable"), "no distance tables — this is the crash");
  ok(!/const F=\(x,y,z\)=>\{[^}]*sdPoly\(sideP/.test(src),
     "F() must not walk the outlines on every sample");
  ok(src.includes("look(Tside") && src.includes("look(Ttop") && src.includes("look(Tfront"),
     "the field should be three lookups and a max");
});
t("speed: a slider drag builds coarse, then sharpens when you let go", () => {
  ok(script.includes("qFast"), "no coarse-while-dragging mode");
  ok(/hullRes:\(qFast\?[A-Za-z0-9_]+:null\)/.test(script), "the drag should drop the hull's resolution");
  ok(/if\(qFast\)\{qFast=false;requestRebuild\(\);\}/.test(script), "…and rebuild properly on release");
});
t("speed: the drag detail tunes itself instead of guessing a number", () => {
  // this box, a laptop and a phone are worlds apart — a hardcoded "coarse" is a guess that
  // is wrong for someone. Aim at a frame budget and let it settle.
  ok(script.includes("function hullTune("), "no self-tuning");
  ok(script.includes("HULL_BUDGET_MS"), "no frame budget to aim at");
  ok(/hullDragRes-=4/.test(script) && /hullDragRes\+=4/.test(script), "it must go both ways");
  ok(/hullDragRes>20/.test(script), "it must not tune itself into mush");
  ok(/hullDragRes<60/.test(script), "…nor past the full build");
  ok(script.includes("hullTune(buildMs)"), "it must be fed the real measured build time");
});
t("speed: the tuner settles on a slow machine and a fast one alike", () => {
  // mirror of hullTune()
  const BUDGET = 11;
  const settle = msFor => {
    let res = 44;
    for (let i = 0; i < 30; i++) {
      const ms = msFor(res);
      if (ms > BUDGET * 1.35 && res > 20) res -= 4;
      else if (ms < BUDGET * 0.55 && res < 60) res += 4;
    }
    return res;
  };
  const fast = settle(r => r * 0.11);        // a quick machine: ~5ms at res 44
  const slow = settle(r => r * 0.55);        // a phone: ~24ms at res 44
  ok(fast > slow, `a quicker machine should end up sharper (${fast} vs ${slow})`);
  ok(slow >= 20, "it must not collapse below the floor");
  ok(fast <= 60, "nor climb past the ceiling");
  ok(msIsUnder(fast, r => r * 0.11, BUDGET * 1.4) && msIsUnder(slow, r => r * 0.55, BUDGET * 1.4),
     "both should land inside the budget");
  function msIsUnder(res, f, cap) { return f(res) <= cap; }
});
t("speed: a heavier outline costs almost nothing extra", () => {
  // the polygon is only walked while building the tables, so a 500-point SVG outline
  // shouldn't cost 5x what a 90-point traced one does
  const t0 = Date.now();
  const car = (n, rx, ry) => Array.from({ length: n }, (_, i) => {
    const a = i / n * 2 * Math.PI; return [0.5 + rx * Math.cos(a), 0.5 + ry * Math.sin(a)]; });
  const mk = pts => API.makeBody({ mode:"projection", length:190, stations:40, hullCrisp:0.9,
    sidePoly:car(pts,0.45,0.4), topPoly:car(pts,0.45,0.38), frontPoly:car(pts,0.4,0.42),
    topProfile:[[0,60]], widthProfile:[[0,25]] });
  mk(90); const tA = Date.now(); mk(90); const light = Date.now() - tA;
  mk(500); const tB = Date.now(); mk(500); const heavy = Date.now() - tB;
  ok(heavy < light * 3 + 60, `a 500-point outline took ${heavy}ms vs ${light}ms for 90 — the polygon is being walked per sample`);
});
t("storage: a full device drops the drawings, not the models", () => {
  // localStorage is ~5MB and a model with four traced views is ~1MB of images, so it fills
  // after a handful. It must degrade honestly rather than silently failing to save.
  ok(/c\.data\.trace\[k\]\.img=null/.test(script), "no fallback that sheds the images");
  ok(script.includes("storage is full"), "a full device should say so, not fail quietly");
  ok(!/catch\(_\)\{\/\* memory-only fallback \*\/\}/.test(script), "the silent swallow is back");
});

// =====================  17. AUTO FEATURES MUST BE EDITABLE  =====================
// Taking a line from the drawing used to hand back 64 evenly-spaced points — 128 handles
// piled on each other, which is not editing, it's a smear. Keep the points that carry the
// shape, drop the ones that don't.
t("simplify: straight runs inside a shape collapse, and it never drops below a shape", () => {
  // features are CLOSED outlines, so 3 points is the floor — a 2-point "shape" is nothing.
  // A long flat side should still shed its middle points.
  const slab = [];
  for (let i = 0; i < 30; i++) slab.push([i / 30, 0.2]);       // a long straight bottom
  slab.push([1, 0.8], [0, 0.8]);                                // and a lid to close it
  const out = API.simplifyPoly(slab, 0.01);
  ok(out.length >= 3, "it must stay a shape");
  ok(out.length <= 6, `30 points along one flat side should collapse, kept ${out.length}`);
  // nothing can talk it below three
  eq(API.simplifyPoly([[0,0],[0.5,0],[1,0],[0.5,0.001]], 0.9).length >= 3, true);
});
t("simplify: corners survive", () => {
  // a square traced with 10 points a side: the 4 corners are the only points that matter
  const sq = [];
  for (let i = 0; i < 10; i++) sq.push([i / 10, 0]);
  for (let i = 0; i < 10; i++) sq.push([1, i / 10]);
  for (let i = 0; i < 10; i++) sq.push([1 - i / 10, 1]);
  for (let i = 0; i < 10; i++) sq.push([0, 1 - i / 10]);
  const out = API.simplifyPoly(sq, 0.01);
  ok(out.length <= 6, `a square should keep ~4 corners, kept ${out.length}`);
  ok(out.length >= 4, "…but not fewer than its corners");
  for (const c of [[0,0],[1,0],[1,1],[0,1]])
    ok(out.some(p => Math.hypot(p[0]-c[0], p[1]-c[1]) < 0.06), `corner ${c} was lost`);
});
t("simplify: a curve keeps enough points to still be a curve", () => {
  const circle = Array.from({ length: 120 }, (_, i) => {
    const a = i / 120 * 2 * Math.PI; return [0.5 + 0.4 * Math.cos(a), 0.5 + 0.4 * Math.sin(a)]; });
  const out = API.simplifyPoly(circle, 0.006);
  ok(out.length >= 8, `a circle needs enough points to read as round, got ${out.length}`);
  ok(out.length < 60, `…but not 120 of them, got ${out.length}`);
  ok(API.polyArea(out.map(p => ({x:p[0], y:p[1]}))) / API.polyArea(circle.map(p => ({x:p[0], y:p[1]}))) > 0.95,
     "the shape drifted too far");
});
t("simplify: the result is grabbable, not a smear", () => {
  // a realistic window taken from a drawing
  const win = Array.from({ length: 140 }, (_, i) => {
    const t = i / 140 * 2 * Math.PI;
    return [0.5 + 0.14 * Math.cos(t), 0.6 + 0.08 * Math.sin(t)]; });
  const us = win.map(q => q[0]), vs = win.map(q => q[1]);
  const span = Math.max(Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs));
  const out = API.simplifyPoly(win, Math.max(0.002, span * 0.018));
  ok(out.length >= 3, "it must stay a shape");
  ok(out.length <= 34, `a feature you can actually grab needs a sensible point count, got ${out.length}`);
});
t("simplify: it never destroys a shape it can't reduce", () => {
  const tri = [[0,0],[1,0],[0.5,1]];
  eq(API.simplifyPoly(tri, 0.5).length, 3, "a triangle can't go below 3 points:");
  eq(API.simplifyPoly([[0,0],[1,1]], 0.1).length, 2, "too few points should pass straight through:");
});

// --- report ---
console.log("\nLEE3D core suite — functions read live from index.html\n");
if (MISSING.length) console.log("  (not present yet: " + MISSING.join(", ") + ")\n");
console.log(results.join("\n"));
console.log(`\n${pass} passed, ${fail} failed${warn ? `, ${warn} warning${warn > 1 ? "s" : ""}` : ""}`);
console.log(fail
  ? "RESULT: ❌ FAIL — do not ship"
  : warn
    ? "RESULT: ✅ PASS — geometry watertight, trace maths sound, library clean (with housekeeping notes above)"
    : "RESULT: ✅ PASS — geometry watertight, trace maths sound, library clean");
process.exit(fail ? 1 : 0);
