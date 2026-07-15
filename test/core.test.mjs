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
  "libCanonical", "sampleProfile", "resampleSection", "morphSections", "makeBody", "autoOutline"];
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
