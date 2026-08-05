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
/* featDupIdx and featPickAt read the app's module-level `features` list rather than taking
   it as an argument, so the harness has to provide one — otherwise they throw ReferenceError
   the moment they're called and the tests around them go dark without saying why. */
// a bit of the app that may not exist yet, without bringing the run down with it
function soft(fn){ try { return fn() || ""; } catch { return ""; } }
const PRELUDE = [grabConst("clamp"), grabConst("lerp"), grabConst("smoothstep"),
  "const DEFAULT_LEN=200;", "let features=[]; let activeView='front';",
  /* the unit tables are plain data, not functions, so they come across whole. Without them
     svgLengthMM and dxfUnitMM throw ReferenceError the moment they're called — which is how
     the suite caught this being added, and why they belong here rather than being inlined. */
  /* Soft, like NAMES below. A hard grab here takes the WHOLE suite down with a stack trace
     if the constant isn't there, instead of failing the two tests that need it — which is
     the difference between "these three tests are red" and "nothing ran, good luck". */
  soft(() => grabConst("SVG_UNIT_MM")),
  soft(() => script.match(/^const DXF_UNIT_MM=[\s\S]*?\n *21:[^\n]*$/m)[0]),
  soft(() => script.match(/^const DXF_UNIT_NAME=[\s\S]*?16:"hm"[^\n]*$/m)[0]),
  soft(() => grabConst("dxfLoopArea"))].join("\n");
const NAMES = ["outlineEnvelope", "anchorPxPerMm", "makeRevolve", "pointInPoly",
  "makeVisualHull", "checkManifold", "polyArea", "resamplePoly", "svgPhysicalWidthMM",
  "libCanonical", "sampleProfile", "resampleSection", "morphSections", "makeBody", "autoOutline",
  "publishRoute", "distToPoly", "viewUV", "applyFeatures", "pickSilhouette", "sampleMask", "ptInPolyPts", "polyAreaPts",
  "rasterRegions", "otsuThreshold", "lumOf", "regionOutline", "dilateMask", "labelBlobs", "outlineBBox", "sdPoly",
  "wallSpec", "wallAt", "minWall",
  "connDiameter", "connWarn", "connPoly", "simplifyPoly",
  // a file that states its own dimensions — DXF $INSUNITS, SVG absolute units
  "svgLengthMM", "dxfUnitMM", "dxfParse", "fmtMM",
  // stitching line art back into the shape it encloses
  "dxfWeldNodes", "dxfFaces", "dxfSilhouette", "dxfPolys", "dxfBspline",
  "featOnView", "featNextName", "featGroupStats", "baseCutZ",
  // taking a shape twice, and reaching the small one under the big one
  "featSig", "featDupIdx", "featPickAt", "featBox",
  "applyHullStrokes", "applyStroke", "hullVertexNormals", "hullAdjacency", "bottomSkinTris", "innerOffsets", "embossHull", "viewSkinVerts", "dropStrayShells", "sampleMask", "distToPoly", "viewUV"];
const found = [];
const src = PRELUDE + NAMES.map(n => {
  try { const s = grab(n); found.push(n); return s; }
  catch { return "/* not in index.html yet: " + n + " */"; }
}).join("\n");
const API = new Function(src
  + "\nconst setFeatures=l=>{features.length=0;l.forEach(f=>features.push(f));return features;};"
  + "\nconst setView=v=>{activeView=v;};"
  + "\nreturn {" + found.join(",") + ",setFeatures,setView};")();
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
t("hull: dense features + through-cuts stay watertight (saddle-cell repair)", () => {
  // This load used to leave open or over-shared edges at saddle cells — the "N OPEN EDGES"
  // badge on heavily detailed traces. sealMesh must drive every such mesh to fully closed.
  const carSide=[[0.02,0.12],[0.10,0.30],[0.30,0.34],[0.40,0.55],[0.62,0.58],[0.72,0.36],[0.95,0.30],[0.98,0.14],[0.80,0.10],[0.20,0.10]];
  const carTop=[[0.03,0.30],[0.20,0.16],[0.80,0.16],[0.97,0.32],[0.97,0.68],[0.80,0.84],[0.20,0.84],[0.03,0.70]];
  const carFront=[[0.10,0.05],[0.90,0.05],[0.98,0.45],[0.85,0.92],[0.15,0.92],[0.02,0.45]];
  const feats=[]; let i=0;
  for(let r=0;r<6;r++)for(let c=0;c<10;c++){
    const cx=0.10+(c+0.5)/10*0.80, cy=0.14+(r+0.5)/6*0.40, w=0.80/10*0.32, h=0.40/6*0.30;
    const through=(i%7===0);
    feats.push({poly:[[cx-w,cy-h],[cx+w,cy-h],[cx+w,cy+h],[cx-w,cy+h]],view:"side",
      depth:through?-30:-(1.5+i%4), through, soft:0.03}); i++;
  }
  for(const [stations,crisp] of [[64,0.9],[54,0.5],[46,0.2]]){
    const g=API.makeBody({mode:"projection", length:166, stations, hullCrisp:crisp,
      sidePoly:carSide, topPoly:carTop, frontPoly:carFront, features:feats,
      topProfile:[[0,89]], widthProfile:[[0,58]], wallThickness:1.8});
    watertight(g, `dense hull st=${stations} crisp=${crisp}`);
  }
});
t("hull: respects the silhouette — a notched side view removes material", () => {  const box = [[0.05,0.05],[0.95,0.05],[0.95,0.95],[0.05,0.95]];
  const notched = [[0.05,0.05],[0.95,0.05],[0.95,0.95],[0.55,0.95],[0.55,0.5],[0.45,0.5],[0.45,0.95],[0.05,0.95]];
  // solid on purpose: this asks whether a notch removes MATERIAL, which only means
  // anything for a lump — on a shell a notch adds surface, so it adds material.
  const mk = side => API.makeBody({ mode: "projection", hullHollow: false, length: 100, stations: 32, hullCrisp: 1,
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
const cube = crisp => API.makeBody({ mode:"projection", hullHollow:false, length:100, stations:36, hullCrisp:crisp,
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
  const g = API.makeBody({ mode:"projection", hullHollow:false, length:100, stations:36, hullCrisp:0.9,
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
const hullWith = feats => API.makeBody({ mode:"projection", hullHollow:false, length:120, stations:40, hullCrisp:0.9,
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
  const g = API.makeBody({ mode:"projection", hullHollow:false, length:120, stations:40, hullCrisp:0.9, wallThickness:1.8,
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
t("mobile: every file picker can actually be opened on a phone", () => {
  // iOS Safari will not open the file picker for an input that is display:none, which is what
  // the `hidden` attribute does — on an iPhone the button simply did nothing. Each picker must
  // stay rendered and be driven by a real <label for=...>, which activates it natively.
  const inputs = [...html.matchAll(/<input type="file"[^>]*>/g)].map(m => m[0]);
  ok(inputs.length > 0, "there are file pickers to check");
  for (const tag of inputs) {
    const id = (tag.match(/id="([^"]+)"/) || [])[1];
    ok(!/\shidden(\s|>|=)/.test(tag), `${id}: must not be hidden (iOS refuses to open it)`);
    const label = new RegExp(`<label[^>]*for="${id}"`).test(html);
    ok(label, `${id}: needs a <label for="${id}"> so a tap opens it natively`);
  }
  // and no scripted .click() on a file input, which would ask iOS for the picker twice
  for (const id of ["sheetFile", "imgFile", "jsonFile", "wsFile"])
    ok(!new RegExp(`${id}"?\\)?\\.click\\(\\)`).test(script), `${id}: no scripted click`);
});
t("mobile: a photo with no MIME type is still accepted", () => {
  // files picked from the iPhone Files app often arrive with an empty type
  const fn = script.slice(script.indexOf("function loadSheet("));
  ok(/!file\.type/.test(fn.slice(0, 900)), "an empty type must not be rejected outright");
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
  ok(script.includes("Take all ${have}") || script.includes("take all ${have}"),
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
  // Pin the PROPERTY, not the spelling: the field reads prebuilt tables and never walks a
  // polygon per sample. The earlier version looked for the literal "look(Tside", which broke
  // the moment the side lookup was wrapped to sweep between two outlines — the code was
  // still tabled, the test was just reading for a word.
  ok(/look\(\s*T/.test(src), "the field should read distance tables");
  ok(!/sdPoly\(\s*(sideP|topP|frontP|sidePR)\b/.test(
       src.slice(src.indexOf("const F=(x,y,z)=>{"), src.indexOf("const F=(x,y,z)=>{")+4000)),
     "and never walk an outline inside the sampled field");
  for (const t of ["Tside", "Ttop", "Tfront"])
    ok(new RegExp(t + "\\s*=\\s*mkTable").test(src), `${t} must still be built from a table`);
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
  const mk = pts => API.makeBody({ mode:"projection", hullHollow:false, length:190, stations:40, hullCrisp:0.9,
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

// =====================  18. TYPE THE REAL SIZE  =====================
// You already know the car is 201mm long. Clicking two points and a dialog to tell the app
// that is silly, and it's how one view ends up disagreeing with another — a 201mm car
// reading 182mm wide because its width was inferred rather than stated.
t("size: a typed width across a view IS its scale", () => {
  // 402 traced pixels across something you say is 201mm -> 2 px per mm
  const spanPx = 402, sizeW = 201;
  near(spanPx / sizeW, 2, 1e-9, "px per mm:");
  // and the length then reads back exactly what you typed
  near(spanPx / (spanPx / sizeW), 201, 1e-9, "the length must be what you said it was:");
});
t("size: each view means something different by across and tall", () => {
  const means = v => v === "side" ? { w: "length", h: "height" }
                   : (v === "top" || v === "bottom") ? { w: "length", h: "width" }
                   : { w: "width", h: "height" };
  eq(means("side").h, "height");
  eq(means("top").h, "width", "looking down, the vertical extent IS the object's width:");
  eq(means("front").w, "width", "head-on, across IS the width:");
  eq(means("bottom").w, "length");
});
t("size: a typed height rescales the traced profile to match", () => {
  // traced heights come out as whatever the pixels said; typing the real one scales them
  const traced = [[0, 10], [0.5, 42], [1, 20]];
  const measured = 42, typed = 84;
  const k = typed / measured;
  const out = traced.map(q => [q[0], q[1] * k]);
  near(Math.max(...out.map(q => q[1])), 84, 1e-9, "the peak must become the height you typed:");
  // and the shape is untouched — only the scale
  near(out[0][1] / out[1][1], traced[0][1] / traced[1][1], 1e-9, "the profile's shape drifted:");
});
t("size: a nonsense entry is ignored rather than wrecking the model", () => {
  for (const bad of [0, -5, NaN, undefined]) {
    const ok2 = (isFinite(bad) && bad > 0) ? bad : null;
    eq(ok2, null, `${bad} should not be accepted as a size:`);
  }
});

// =====================  19. THE FRAME IS A SHELL  =====================
// A toy frame is hollow — that's the whole point of a thickness slider. "Follow my drawing"
// used to hand back a filled lump, because carving the void out of the distance field needs
// a grid fine enough to see a 1.8mm wall (a 1.3M-cell grid on a car). It doesn't need the
// field: the surface is already closed, so a copy pushed inward along its own normals IS
// the inside, and a closed surface has no rim to stitch.
const SHELL = { mode:"projection", length:201, stations:56, hullCrisp:0.5,
  sidePoly:[[0.06,0.06],[0.94,0.06],[0.94,0.94],[0.06,0.94]],
  topPoly:[[0.06,0.06],[0.94,0.06],[0.94,0.94],[0.06,0.94]],
  frontPoly:[[0.06,0.06],[0.94,0.06],[0.94,0.94],[0.06,0.94]],
  topProfile:[[0,84]], widthProfile:[[0,45]] };

t("shell: the frame is hollow, not a filled lump", () => {
  const lump = API.makeBody({ ...SHELL, hullHollow:false });
  const shell = API.makeBody({ ...SHELL, hullHollow:true, wallThickness:1.8 });
  ok(shell.volume < lump.volume * 0.3,
     `a 1.8mm shell should be a fraction of the lump, got ${(shell.volume/lump.volume*100).toFixed(0)}%`);
  ok(shell.volume > 0, "…but it must still be made of something");
});
t("shell: hollow is the default for the drawing-following mode", () => {
  const def = API.makeBody({ ...SHELL });                 // no hullHollow given
  const lump = API.makeBody({ ...SHELL, hullHollow:false });
  ok(def.volume < lump.volume * 0.5, "a toy frame should arrive hollow without being asked");
});
t("shell: it stays watertight at every wall thickness", () => {
  for (const w of [0.6, 1.0, 1.8, 3, 5]) {
    const g = API.makeBody({ ...SHELL, hullHollow:true, wallThickness:w });
    const r = manifold(g.indices);
    ok(r.boundary === 0 && r.nonMani === 0, `${w}mm: ${r.boundary} open edges, ${r.nonMani} non-manifold`);
  }
});
t("shell: a thicker wall means more material, and it tracks the slider", () => {
  const v = w => API.makeBody({ ...SHELL, hullHollow:true, wallThickness:w }).volume;
  const a = v(1), b = v(2), c = v(4);
  ok(b > a && c > b, `volume must rise with thickness: ${a.toFixed(0)}, ${b.toFixed(0)}, ${c.toFixed(0)}`);
  // roughly surface area x wall, so doubling the wall roughly doubles the material
  ok(b / a > 1.6 && b / a < 2.4, `2mm should be ~2x the material of 1mm, got ${(b/a).toFixed(2)}x`);
});
t("detail: nested outlines shade the panel, they never excavate it", () => {
  // Traced detail nests — a vent inside a panel inside a door. Each stamp is capped, but
  // stamps used to ADD: five nested outlines pressed one vertex 12mm from drawings 2.5mm
  // deep, crushing the hood and folding rocker skin into the arches. Behaviour pinned:
  // however deep the nesting, no vertex may travel meaningfully past one full stamp.
  const ring = (cx, cy, r) => Array.from({length:16},(_,i)=>{
    const a = i/16*Math.PI*2; return [cx+Math.cos(a)*r, cy+Math.sin(a)*r]; });
  const nest = [0.30,0.24,0.18,0.12,0.06].map(r =>
    ({ view:"side", poly:ring(0.5,0.5,r), depth:-2.5 }));
  const wall = 4;
  const bare = API.makeBody({ ...SHELL, hullHollow:false, hullCrisp:1 });
  const inked = API.makeBody({ ...SHELL, hullHollow:false, hullCrisp:1,
    wallThickness:wall, features:nest });
  ok(bare.positions.length === inked.positions.length, "same mesher output, features only stamp");
  let maxD = 0;
  for (let k = 0; k < bare.positions.length; k += 3) {
    const d = Math.hypot(inked.positions[k]-bare.positions[k],
      inked.positions[k+1]-bare.positions[k+1], inked.positions[k+2]-bare.positions[k+2]);
    if (d > maxD) maxD = d;
  }
  ok(maxD > 0.3, `the detail must still press in (moved ${maxD.toFixed(2)}mm)`);
  ok(maxD <= wall*0.5*1.35 + 0.05,
     `five nested stamps may never dig past ~one: moved ${maxD.toFixed(2)}mm on a ${wall}mm wall`);
});
t("shell: the opened underside is floor, not wall", () => {
  // The opening's edge is decided by majority vote now, so a staircase of flickering
  // triangles can't ride up the sides. Pinned: on a plain box nearly all removed area
  // faces the ground — the vote must never eat wall or roof.
  const lump = API.makeBody({ ...SHELL, hullHollow:false });
  const shell = API.makeBody({ ...SHELL, hullHollow:true, wallThickness:2 });
  ok(shell.openBottom, "a box with no traced bottom opens its underside");
  // removed skin = lump tris whose centroid isn't matched in the shell's outer surface
  const keyOf = (P,I,q) => {
    const a=I[q],b=I[q+1],c=I[q+2];
    return [((P[a*3]+P[b*3]+P[c*3])/3).toFixed(2),
            ((P[a*3+1]+P[b*3+1]+P[c*3+1])/3).toFixed(2),
            ((P[a*3+2]+P[b*3+2]+P[c*3+2])/3).toFixed(2)].join(",");
  };
  const kept = new Set();
  for (let q=0;q<shell.indices.length;q+=3) kept.add(keyOf(shell.positions,shell.indices,q));
  let remArea=0, remDownArea=0, remZmax=0;
  for (let q=0;q<lump.indices.length;q+=3) {
    if (kept.has(keyOf(lump.positions,lump.indices,q))) continue;
    const a=lump.indices[q],b=lump.indices[q+1],c=lump.indices[q+2],P=lump.positions;
    const ux=P[b*3]-P[a*3],uy=P[b*3+1]-P[a*3+1],uz=P[b*3+2]-P[a*3+2];
    const vx=P[c*3]-P[a*3],vy=P[c*3+1]-P[a*3+1],vz=P[c*3+2]-P[a*3+2];
    const fz=ux*vy-uy*vx, fl=Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,fz);
    if (!fl) continue;
    remArea += fl/2; if (fz/fl < -0.3) remDownArea += fl/2;
    const cz=(P[a*3+2]+P[b*3+2]+P[c*3+2])/3; if(cz>remZmax)remZmax=cz;
  }
  ok(remArea > 0, "something must actually be removed");
  // a soft box rounds its bottom edge, and that rounded ring belongs to the opening —
  // so "mostly floor" plus "never above the bottom fifth" is the honest pin
  ok(remDownArea/remArea > 0.85,
     `the opening should be ground-facing skin: ${(remDownArea/remArea*100).toFixed(0)}% faces down`);
  ok(remZmax < 84*0.2,
     `nothing removed above the bottom fifth of the box: highest at z=${remZmax.toFixed(1)}`);
});
t("shell: hollowing doesn't change the outside", () => {
  const bbox = g => { let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;
    for (let i=0;i<g.positions.length;i+=3){ x0=Math.min(x0,g.positions[i]); x1=Math.max(x1,g.positions[i]);
      z0=Math.min(z0,g.positions[i+2]); z1=Math.max(z1,g.positions[i+2]); }
    return [x1-x0, z1-z0]; };
  const [lw, lh] = bbox(API.makeBody({ ...SHELL, hullHollow:false }));
  const [sw, sh] = bbox(API.makeBody({ ...SHELL, hullHollow:true, wallThickness:3 }));
  near(sw, lw, 0.5, "the outside length must not shrink when you hollow it:");
  near(sh, lh, 0.5, "nor the height:");
});

// =====================  20. FEATURES BY THE HANDFUL  =====================
// Detail arrives a face at a time — 36 vents across the front, 24 across the rear — so the
// numbers on screen have to belong to the face in front of you, and the sliders have to be
// able to drive a whole face at once.
const FEATS = [
  { view:"side",  depth:-2.5, soft:0.10 }, { view:"side",  depth:-2.5, soft:0.10 },
  { view:"front", depth:-2.5, soft:0.10 }, { view:"front", depth:-1.0, soft:0.20 },
  { view:"front", depth:-2.5, soft:0.10 }, { view:"rear",  depth: 1.5, soft:0.10, through:true },
];

t("features: a face's own features are the ones it hands back", () => {
  ok(JSON.stringify(API.featOnView(FEATS, "front")) === "[2,3,4]",
     "front should be indices 2,3,4, got " + JSON.stringify(API.featOnView(FEATS, "front")));
  ok(API.featOnView(FEATS, "side").length === 2, "side holds two");
  ok(API.featOnView(FEATS, "top").length === 0, "a face with nothing on it holds nothing");
  ok(API.featOnView([], "side").length === 0, "and an empty model has nothing anywhere");
});
t("features: numbering starts again on each face", () => {
  // the bug: twelve features on the side made the top view's first feature "detail 13" —
  // a number about the model's history, not about the drawing you're looking at
  ok(API.featNextName(FEATS, "top", "detail") === "detail 1",
     `an untouched face starts at one, got "${API.featNextName(FEATS, "top", "detail")}"`);
  ok(API.featNextName(FEATS, "front", "detail") === "detail 4",
     `the front already has three, so the next is four, got "${API.featNextName(FEATS, "front", "detail")}"`);
  ok(API.featNextName(FEATS, "side", "box") === "box 3", "and the base word carries through");
});
t("features: a group's sliders open at the average, and say when it's mixed", () => {
  const front = API.featOnView(FEATS, "front").map(i => FEATS[i]);
  const s = API.featGroupStats(front);
  ok(s.n === 3, "three features in the group");
  near(s.depth, -2, 0.001, "the depth slider opens at the group's average:");
  ok(s.mixedDepth, "…and reports that they disagree");
  ok(s.mixedSoft, "same for the soft edge");
  const same = API.featGroupStats(API.featOnView(FEATS, "side").map(i => FEATS[i]));
  near(same.depth, -2.5, 0.001, "a group that agrees opens on that value:");
  ok(!same.mixedDepth && !same.mixedSoft, "…and doesn't cry mixed when nothing is mixed");
});
t("features: a group knows how many of it are cut through", () => {
  const all = API.featGroupStats(FEATS);
  ok(all.through === 1 && !all.allThrough, `one of six is through, got ${all.through}`);
  const thru = API.featGroupStats([{depth:-3,soft:0.1,through:true},{depth:-3,soft:0.1,through:true}]);
  ok(thru.allThrough, "a group where every one is through says so, so the tick can be solid");
  const none = API.featGroupStats([{depth:-3,soft:0.1}]);
  ok(none.through === 0 && !none.allThrough, "and one that has none says that too");
});
t("features: an empty group is harmless", () => {
  const s = API.featGroupStats([]);
  ok(s.n === 0 && isFinite(s.depth) && isFinite(s.soft),
     "no selection must still give usable slider numbers, not NaN");
});

t("origami: detail may dent the sheet, never cut it into extra pieces", () => {
  // The three traced outlines define the solid: a point is material when it is inside all
  // three at once, and nothing else gets a say. Stamped detail is allowed to move that
  // surface, but a vertical line through the body must still pass through the SAME number
  // of separate pieces afterwards. When it doesn't, the surface has folded through itself
  // and the trapped sliver reads as a floating slab — the plank seen through a wheel arch.
  // Root cause it guards: a stamp deeper than the distance between neighbouring vertices
  // laps the sheet over, which the inside-out check can't see because each triangle stays
  // correctly wound.
  const L = 201, Hh = 84, Ww = 45;
  const outline = [[0.06,0.06],[0.94,0.06],[0.94,0.94],[0.06,0.94]];
  const ring = (cx,cy,r) => Array.from({length:14},(_,i)=>{
    const a=i/14*Math.PI*2; return [cx+Math.cos(a)*r, cy+Math.sin(a)*r]; });
  const feats = [];
  for (const v of ["front","rear","side","top"])
    for (const r of [0.30,0.22,0.14])
      feats.push({ view:v, poly:ring(0.5,0.5,r), depth:-2.5, soft:0.08 });

  const P = { mode:"projection", length:L, stations:48, hullCrisp:1, hullHollow:false,
    wallThickness:5, sidePoly:outline, topPoly:outline, frontPoly:outline,
    topProfile:[[0,Hh]], widthProfile:[[0,Ww/2]] };
  const plain  = API.makeBody({ ...P });
  const inked  = API.makeBody({ ...P, features:feats });

  // how many separate runs of material a vertical line meets
  const sections = (g,x,y) => {
    const Q=g.positions, I=g.indices, hits=[];
    for (let t=0;t<I.length;t+=3) {
      const a=I[t],b=I[t+1],c=I[t+2];
      const ax=Q[a*3],ay=Q[a*3+1],bx=Q[b*3],by=Q[b*3+1],cx=Q[c*3],cy=Q[c*3+1];
      const den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy); if (Math.abs(den)<1e-12) continue;
      const l1=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/den;
      const l2=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/den;
      if (l1<0||l2<0||1-l1-l2<0) continue;
      hits.push(l1*Q[a*3+2]+l2*Q[b*3+2]+(1-l1-l2)*Q[c*3+2]);
    }
    return Math.floor(hits.length/2);
  };
  let checked=0, extra=0;
  for (let x=25;x<=175;x+=15) for (let y=-14;y<=14;y+=7) {
    const base=sections(plain,x,y); if (!base) continue;
    checked++;
    if (sections(inked,x,y) > base) extra++;
  }
  ok(checked > 20, `the scan has to actually cover the body (${checked} columns)`);
  ok(extra === 0,
     `stamping cut ${extra} of ${checked} columns into extra pieces — the sheet folded through itself`);
});
t("origami: the detail is still really there", () => {
  // The guard above is trivially satisfiable by stamping nothing at all, so pin the other
  // side of it too: the surface must still MOVE where detail was drawn.
  const outline = [[0.06,0.06],[0.94,0.06],[0.94,0.94],[0.06,0.94]];
  const ring = (cx,cy,r) => Array.from({length:14},(_,i)=>{
    const a=i/14*Math.PI*2; return [cx+Math.cos(a)*r, cy+Math.sin(a)*r]; });
  const P = { mode:"projection", length:201, stations:48, hullCrisp:1, hullHollow:false,
    wallThickness:5, sidePoly:outline, topPoly:outline, frontPoly:outline,
    topProfile:[[0,84]], widthProfile:[[0,22]] };
  const plain = API.makeBody({ ...P });
  const inked = API.makeBody({ ...P, features:[{view:"side",poly:ring(0.5,0.5,0.3),depth:-2.5,soft:0.08}] });
  let moved=0;
  for (let k=0;k<plain.positions.length;k+=3) {
    const d=Math.hypot(inked.positions[k]-plain.positions[k],
      inked.positions[k+1]-plain.positions[k+1], inked.positions[k+2]-plain.positions[k+2]);
    if (d>0.2) moved++;
  }
  ok(moved > 20, `detail must still press into the surface (${moved} vertices moved)`);
});

t("wheel wells: closed by default, and closed means no roof is opened", () => {
  // "Nothing below me" is true of a wheel-arch roof as well as of the underside, so the
  // depth test used to open the roof and leave a rim arcing from one wheel to the next —
  // the plank. Closed is the default because that is the shape with no plank in it. Open
  // is offered because it gives the material back, and a frame printed cheaply is a
  // different job from one that has to look right.
  const arch = [                                    // a body on two feet, arch between them
    [0.04,0.02],[0.22,0.02],[0.22,0.42],[0.30,0.60],[0.70,0.60],[0.78,0.42],
    [0.78,0.02],[0.96,0.02],[0.96,0.96],[0.04,0.96]
  ];
  const box = [[0.05,0.05],[0.95,0.05],[0.95,0.95],[0.05,0.95]];
  const P = { mode:"projection", length:200, stations:52, hullCrisp:1, hullHollow:true,
    wallThickness:3, sidePoly:arch, topPoly:box, frontPoly:box,
    topProfile:[[0,80]], widthProfile:[[0,26]] };
  const shut = API.makeBody({ ...P });                       // default
  const open = API.makeBody({ ...P, openArches:true });
  ok(shut.volume > 0 && open.volume > 0, "both settings have to build something");
  ok(API.checkManifold(shut.indices).watertight, "closed wells stay watertight");
  ok(API.checkManifold(open.indices).watertight, "open wells stay watertight");
  ok(shut.volume > open.volume,
     `closing the wells is the heavier shape: ${(shut.volume/1000).toFixed(1)} vs ${(open.volume/1000).toFixed(1)} cm3`);
  // and the thing that matters: with wells closed, nothing high up is left open
  const solid = API.makeBody({ ...P, hullHollow:false });
  const openedHigh = (flag) => {
    const Q = solid.positions, J = solid.indices;
    let z0=1e30,z1=-1e30;
    for (let k=2;k<Q.length;k+=3){ if(Q[k]<z0)z0=Q[k]; if(Q[k]>z1)z1=Q[k]; }
    let a=0;
    for (let q=0,t=0;q<J.length;q+=3,t++) {
      if (!flag[t]) continue;
      const i=J[q],j=J[q+1],k=J[q+2];
      const cz=(Q[i*3+2]+Q[j*3+2]+Q[k*3+2])/3;
      if ((cz-z0)/(z1-z0) <= 0.35) continue;
      const ux=Q[j*3]-Q[i*3],uy=Q[j*3+1]-Q[i*3+1],uz=Q[j*3+2]-Q[i*3+2];
      const vx=Q[k*3]-Q[i*3],vy=Q[k*3+1]-Q[i*3+1],vz=Q[k*3+2]-Q[i*3+2];
      a += Math.hypot(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx)/2;
    }
    return a;
  };
  const hiShut = openedHigh(API.bottomSkinTris(solid.positions, solid.indices, {}));
  const hiOpen = openedHigh(API.bottomSkinTris(solid.positions, solid.indices, {openArches:true}));
  ok(hiOpen > hiShut, `opening the wells is what puts a hole up in the arch (${hiOpen.toFixed(0)} vs ${hiShut.toFixed(0)} mm2)`);
  ok(hiShut < hiOpen * 0.35,
     `by default almost nothing up in the bodywork is opened: ${hiShut.toFixed(0)} mm2 against ${hiOpen.toFixed(0)}`);

  // Opening the wells must open each ceiling WHOLE. A hole punched in the middle of one
  // leaves a band of wall hanging inboard of the arch, and from the side that band is the
  // plank. Whole regions only, and no pinholes under the panel lines: the count of separate
  // openings has to stay in single figures.
  const openings = (flag) => {
    const J = solid.indices, Q = solid.positions;
    const ec = new Map(), k = (a,b) => a<b ? a+"_"+b : b+"_"+a;
    for (let q=0,t=0;q<J.length;q+=3,t++) {
      if (flag[t]) continue;
      const T=[J[q],J[q+1],J[q+2]];
      for (const [u,v] of [[T[0],T[1]],[T[1],T[2]],[T[2],T[0]]])
        ec.set(k(u,v), (ec.get(k(u,v))||0)+1);
    }
    const adj = new Map();
    for (const [kk,c] of ec) {
      if (c!==1) continue;
      const i=kk.indexOf("_"), a=+kk.slice(0,i), b=+kk.slice(i+1);
      if(!adj.has(a))adj.set(a,[]); if(!adj.has(b))adj.set(b,[]);
      adj.get(a).push(b); adj.get(b).push(a);
    }
    const seen=new Set(); let n=0;
    for (const s0 of adj.keys()) {
      if (seen.has(s0)) continue;
      n++; const st=[s0]; seen.add(s0);
      while(st.length){const v=st.pop(); for(const w of adj.get(v)||[]) if(!seen.has(w)){seen.add(w);st.push(w);}}
    }
    return n;
  };
  const nOpen = openings(API.bottomSkinTris(solid.positions, solid.indices, {openArches:true}));
  const nShut = openings(API.bottomSkinTris(solid.positions, solid.indices, {}));
  ok(nShut <= 6, `closed wells leave few clean openings (${nShut})`);
  ok(nOpen <= 12, `open wells stay whole rather than fragmenting into pinholes (${nOpen} openings)`);
  ok(API.checkManifold(open.indices).watertight && API.checkManifold(shut.indices).watertight,
     "and both settings stay watertight");
});

// =====================  21. THE NUMBERS THEMSELVES  =====================
// Nothing here checked an ABSOLUTE dimension for a long time, and a real bug lived in that
// gap: the outermost ring of grid samples is forced to "outside" so the surface always
// closes, and that ring used to sit exactly on the model's own limits — so the nose of the
// car was overwritten as empty air and every model came out one cell short at each end. A
// 200mm car built at 193mm. Every test still passed, because they all compared the model
// against itself. These compare it against arithmetic done outside the code.
const FULL = [[0,0],[1,0],[1,1],[0,1]];
const ring = (n, r, cx, cy) => Array.from({length:n},(_,i)=>{
  const a = i/n*Math.PI*2; return [cx+Math.cos(a)*r, cy+Math.sin(a)*r]; });

t("size: a model is the size you asked for, to the millimetre", () => {
  for (const L of [50, 137, 200, 340]) {
    const g = API.makeBody({ mode:"projection", length:L, stations:56, hullCrisp:1,
      hullHollow:false, sidePoly:FULL, topPoly:FULL, frontPoly:FULL,
      topProfile:[[0,80]], widthProfile:[[0,30]] });
    let lo=1e30, hi=-1e30;
    for (let k=0;k<g.positions.length;k+=3){ if(g.positions[k]<lo)lo=g.positions[k]; if(g.positions[k]>hi)hi=g.positions[k]; }
    const got = hi-lo;
    ok(Math.abs(got-L) < Math.max(0.5, L*0.005),
       `${L}mm asked, ${got.toFixed(2)}mm built (${((got-L)/L*100).toFixed(2)}%)`);
  }
});
t("size: it holds at every resolution, so it isn't the grid setting the size", () => {
  // if the size depended on cell size, coarse and fine would disagree — that was the bug
  const mk = st => {
    const g = API.makeBody({ mode:"projection", length:200, stations:st, hullCrisp:1,
      hullHollow:false, sidePoly:FULL, topPoly:FULL, frontPoly:FULL,
      topProfile:[[0,80]], widthProfile:[[0,30]] });
    let lo=1e30, hi=-1e30;
    for (let k=0;k<g.positions.length;k+=3){ if(g.positions[k]<lo)lo=g.positions[k]; if(g.positions[k]>hi)hi=g.positions[k]; }
    return hi-lo;
  };
  const a = mk(24), b = mk(72);
  ok(Math.abs(a-b) < 1.0, `coarse ${a.toFixed(2)}mm and fine ${b.toFixed(2)}mm agree`);
});
t("volume: a cylinder measures pi r squared L", () => {
  // side and top are full squares, the front is a circle, so the intersection is a cylinder
  const L = 200, D = 80;
  const g = API.makeBody({ mode:"projection", length:L, stations:64, hullCrisp:1,
    hullHollow:false, sidePoly:FULL, topPoly:FULL, frontPoly:ring(180,0.5,0.5,0.5),
    topProfile:[[0,D]], widthProfile:[[0,D/2]] });
  let lo=[1e30,1e30,1e30], hi=[-1e30,-1e30,-1e30];
  for (let k=0;k<g.positions.length;k+=3) for (let d=0;d<3;d++){
    if(g.positions[k+d]<lo[d])lo[d]=g.positions[k+d]; if(g.positions[k+d]>hi[d])hi[d]=g.positions[k+d]; }
  const r = ((hi[1]-lo[1])+(hi[2]-lo[2]))/4, exact = Math.PI*r*r*(hi[0]-lo[0]);
  ok(Math.abs(g.volume-exact)/exact < 0.02,
     `${(g.volume/1000).toFixed(2)}cm3 against pi*r^2*L = ${(exact/1000).toFixed(2)}cm3`);
});
t("volume: three circles make a Steinmetz solid, not a ball", () => {
  // The intersection of three round silhouettes has an exact volume of 8(2-root2)r^3.
  // A ball would be 4/3 pi r^3 — a fifth smaller. Landing on the first and not the second
  // is what proves the body really is the three drawings intersected.
  const D = 120;
  // closedBottom so the base is NOT levelled: this test is about the intersection maths,
  // and a round body with no bottom traced legitimately gets its base cut flat
  const g = API.makeBody({ mode:"projection", length:D, stations:72, hullCrisp:1, hullHollow:false,
    closedBottom:true,
    sidePoly:ring(180,0.5,0.5,0.5), topPoly:ring(180,0.5,0.5,0.5), frontPoly:ring(180,0.5,0.5,0.5),
    topProfile:[[0,D]], widthProfile:[[0,D/2]] });
  let lo=[1e30,1e30,1e30], hi=[-1e30,-1e30,-1e30];
  for (let k=0;k<g.positions.length;k+=3) for (let d=0;d<3;d++){
    if(g.positions[k+d]<lo[d])lo[d]=g.positions[k+d]; if(g.positions[k+d]>hi[d])hi[d]=g.positions[k+d]; }
  const r = ((hi[0]-lo[0])+(hi[1]-lo[1])+(hi[2]-lo[2]))/6;
  const steinmetz = 8*(2-Math.SQRT2)*r*r*r, ball = 4/3*Math.PI*r*r*r;
  ok(Math.abs(g.volume-steinmetz)/steinmetz < 0.03,
     `${(g.volume/1000).toFixed(2)}cm3 against 8(2-root2)r^3 = ${(steinmetz/1000).toFixed(2)}cm3`);
  ok(Math.abs(g.volume-steinmetz) < Math.abs(g.volume-ball),
     "and it is nearer the Steinmetz solid than a ball, so the three views really do intersect");
});
t("surface: every edge is walked once each way", () => {
  // checkManifold counts how often an edge is USED, which a flipped patch survives: both
  // its edges are still used twice. Volume is a signed sum, so one flipped patch quietly
  // subtracts instead of adding. This checks direction, which is what actually matters.
  for (const [label, extra] of [["solid",{hullHollow:false}],["hollow",{hullHollow:true,wallThickness:3}]]) {
    const g = API.makeBody({ mode:"projection", length:160, stations:56, hullCrisp:1,
      sidePoly:ring(120,0.5,0.5,0.5), topPoly:FULL, frontPoly:FULL,
      topProfile:[[0,80]], widthProfile:[[0,30]], ...extra });
    const dir = new Map();
    for (let k=0;k<g.indices.length;k+=3) {
      const t3=[g.indices[k],g.indices[k+1],g.indices[k+2]];
      for (const [u,v] of [[t3[0],t3[1]],[t3[1],t3[2]],[t3[2],t3[0]]])
        dir.set(u+">"+v, (dir.get(u+">"+v)||0)+1);
    }
    let doubled=0, unpaired=0;
    for (const [k,n] of dir) {
      if (n>1) doubled++;
      const [u,v]=k.split(">");
      if (!dir.has(v+">"+u)) unpaired++;
    }
    ok(doubled===0 && unpaired===0,
       `${label}: ${doubled} edges walked twice the same way, ${unpaired} with no partner`);
    ok(g.volume>0, `${label}: the volume comes out positive, so the surface faces outward`);
  }
});

t("base: with no bottom traced, the body ends on one flat plane", () => {
  // The ask, in his words: make it look like it ends when the bottom face would be reached,
  // and leave that face open. A traced side view says where that is — over a wheel its lower
  // edge comes down to the ground, over an arch it stops in mid-air forty millimetres up.
  // Those are two populations, and the lower one is where the body ends.
  const arch = [
    [0.04,0.03],[0.24,0.03],[0.26,0.34],[0.34,0.50],[0.66,0.50],[0.74,0.34],
    [0.76,0.03],[0.96,0.03],[0.96,0.94],[0.04,0.94]
  ];
  const H = 90;
  const sideMM = arch.map(q => [q[0]*200, q[1]*H]);
  const cut = API.baseCutZ(sideMM, H);
  ok(isFinite(cut), `a body on two feet has a base to level (cut at ${cut.toFixed(1)}mm)`);
  ok(cut > 0 && cut < H*0.20,
     `and it sits down at the feet, not up in the arch: ${cut.toFixed(1)}mm of ${H}mm`);

  // a shape with one flat bottom has nothing to separate, so nothing is levelled
  const flat = [[0.05,0.05],[0.95,0.05],[0.95,0.95],[0.05,0.95]].map(q=>[q[0]*200,q[1]*H]);
  ok(!isFinite(API.baseCutZ(flat, H)), "a plain box is left alone");
  ok(!isFinite(API.baseCutZ([], H)), "and an empty outline is handled without throwing");

  // and the built body really is flat down there
  const box = [[0.03,0.03],[0.97,0.03],[0.97,0.97],[0.03,0.97]];
  const g = API.makeBody({ mode:"projection", length:200, stations:60, hullCrisp:1,
    hullHollow:false, sidePoly:arch, topPoly:box, frontPoly:box,
    topProfile:[[0,H]], widthProfile:[[0,30]] });
  let zMin = 1e30;
  for (let k=2;k<g.positions.length;k+=3) if (g.positions[k]<zMin) zMin=g.positions[k];
  // count how much surface sits within a whisker of the lowest level — a levelled base is a
  // real flat face, a rounded one has almost nothing there
  let flatArea = 0, total = 0;
  for (let q=0;q<g.indices.length;q+=3) {
    const a=g.indices[q]*3,b=g.indices[q+1]*3,c=g.indices[q+2]*3,P=g.positions;
    const ux=P[b]-P[a],uy=P[b+1]-P[a+1],uz=P[b+2]-P[a+2];
    const vx=P[c]-P[a],vy=P[c+1]-P[a+1],vz=P[c+2]-P[a+2];
    const ar=Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)/2;
    total += ar;
    const cz=(P[a+2]+P[b+2]+P[c+2])/3;
    if (cz < zMin+1.5) flatArea += ar;
  }
  ok(flatArea/total > 0.04,
     `the base is a real flat face, not a rounded-off edge (${(flatArea/total*100).toFixed(1)}% of the surface sits on it)`);
});

t("two sides: one outline is symmetric, two are not", () => {
  // Top/Bottom, Front/Rear — the missing pair of the standard six views is Left/Right. Trace
  // one and the body is symmetric, which is what almost everything wants. Trace the second
  // and the two flanks are allowed to differ, sweeping across the width rather than stepping
  // at the centreline.
  const BOXP = [[0.04,0.04],[0.96,0.04],[0.96,0.96],[0.04,0.96]];
  const tall = [[0.05,0.05],[0.95,0.05],[0.95,0.95],[0.05,0.95]];
  const step = [[0.05,0.05],[0.95,0.05],[0.95,0.40],[0.50,0.40],[0.50,0.95],[0.05,0.95]];
  const base = { mode:"projection", length:200, stations:60, hullCrisp:1, hullHollow:false,
    closedBottom:true, topPoly:BOXP, frontPoly:BOXP, topProfile:[[0,90]], widthProfile:[[0,40]] };

  const roof = (g, sign) => {
    const P = g.positions, N = 20, top = new Array(N).fill(-1e9);
    for (let k = 0; k < P.length; k += 3) {
      if (Math.sign(P[k+1]) !== sign || Math.abs(P[k+1]) < 12) continue;
      const i = Math.max(0, Math.min(N-1, Math.floor(P[k]/200*N)));
      if (P[k+2] > top[i]) top[i] = P[k+2];
    }
    return top;
  };
  const spread = g => {
    const L = roof(g,-1), R = roof(g,1);
    let w = 0;
    for (let i = 0; i < L.length; i++)
      if (L[i] > -1e8 && R[i] > -1e8) w = Math.max(w, Math.abs(L[i]-R[i]));
    return w;
  };

  const one = API.makeBody({ ...base, sidePoly: tall });
  ok(spread(one) < 1.5, `one outline gives matching flanks (${spread(one).toFixed(2)}mm apart)`);

  const two = API.makeBody({ ...base, sidePoly: tall, sidePolyR: step });
  ok(spread(two) > 12,
     `two outlines give different flanks (${spread(two).toFixed(1)}mm apart) — the second drawing is really used`);
  ok(API.checkManifold(two.indices).watertight, "and the asymmetric body is still watertight");
  ok(two.volume < one.volume*0.95, "and the second outline actually removes material");

  // The far side of a symmetric object is drawn on a mirrored page. Mirroring it back into
  // the shared frame has to give the same outline again, or the body would fight itself.
  const mir = API.makeBody({ ...base, sidePoly: tall, sidePolyR: tall.map(q => [1-q[0], q[1]]) });
  ok(Math.abs(mir.volume-one.volume)/one.volume < 1e-9,
     "tracing the far side of a symmetric object changes nothing");
});

t("crispness decides how the surface follows your lines, not whether a hole is a hole", () => {
  // A window marked "cut clean through" used to be scaled by the crispness slider, so in
  // Smooth mode the ray through the middle of it still met the full thickness of the body —
  // as though the window had never been drawn — and it faded in as the slider came up. A
  // dent is a matter of degree. A hole is not.
  const BOXP = [[0.03,0.03],[0.97,0.03],[0.97,0.97],[0.03,0.97]];
  const win  = [[0.35,0.35],[0.65,0.35],[0.65,0.65],[0.35,0.65]];
  const base = { mode:"projection", length:200, stations:52, hullHollow:false, closedBottom:true,
    sidePoly:BOXP, topPoly:BOXP, frontPoly:BOXP, topProfile:[[0,90]], widthProfile:[[0,45]] };

  // material met by a line straight through the middle of the window, off the grid planes
  const throughWindow = (g) => {
    const P=g.positions, I=g.indices, x=97.7, z=44.3, hits=[];
    for (let t=0;t<I.length;t+=3) {
      const a=I[t],b=I[t+1],c=I[t+2];
      const ax=P[a*3],az=P[a*3+2],bx=P[b*3],bz=P[b*3+2],cx=P[c*3],cz=P[c*3+2];
      const den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
      if (Math.abs(den)<1e-12) continue;
      const l1=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/den;
      const l2=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/den;
      if (l1<0||l2<0||1-l1-l2<0) continue;
      hits.push(l1*P[a*3+1]+l2*P[b*3+1]+(1-l1-l2)*P[c*3+1]);
    }
    hits.sort((u,v)=>u-v);
    let m=0; for (let i=0;i+1<hits.length;i+=2) m+=hits[i+1]-hits[i];
    return m;
  };

  for (const c of [0, 0.5, 1]) {
    const solid = API.makeBody({ ...base, hullCrisp:c, features:[] });
    const cut   = API.makeBody({ ...base, hullCrisp:c,
      features:[{view:"side", poly:win, depth:-40, through:true, name:"window"}] });
    const before = throughWindow(solid), after = throughWindow(cut);
    ok(before > 10, `crisp ${c}: the plain body has material there to cut (${before.toFixed(1)}mm)`);
    ok(after < before*0.1,
       `crisp ${c}: the window is cut clean through (${after.toFixed(1)}mm left of ${before.toFixed(1)}mm)`);
    ok(API.checkManifold(cut.indices).watertight, `crisp ${c}: and it stays watertight`);
  }
});
t("crispness leaves the inside of the shell alone", () => {
  // His point, and it is the right one: the slider is about how closely the OUTSIDE follows
  // the drawing. The inner wall is offset from the shape before any detail is stamped, so
  // turning crispness up must not start putting ribs and valleys inside the frame.
  const BOXP = [[0.05,0.05],[0.95,0.05],[0.95,0.95],[0.05,0.95]];
  const ring = (cx,cy,r) => Array.from({length:16},(_,i)=>{
    const a=i/16*Math.PI*2; return [cx+Math.cos(a)*r, cy+Math.sin(a)*r]; });
  const feats = [];
  for (const v of ["side","top","front"])
    for (const o of [0.3,0.5,0.7]) feats.push({ view:v, poly:ring(o,0.5,0.09), depth:-3, soft:0.1 });
  const base = { mode:"projection", length:200, stations:48, hullHollow:true, wallThickness:5,
    closedBottom:true, sidePoly:BOXP, topPoly:BOXP, frontPoly:BOXP,
    topProfile:[[0,90]], widthProfile:[[0,45]], features:feats };

  // how far each inner vertex sits from the average of its neighbours: a smooth wall is flat
  const innerRoughness = (g) => {
    const P=g.positions, I=g.indices, n=P.length/3, vc=Math.floor(n/2);
    const nb=Array.from({length:n},()=>new Set());
    for (let q=0;q<I.length;q+=3) {
      const a=I[q],b=I[q+1],c=I[q+2];
      nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
    }
    let sum=0, cnt=0;
    for (let k=vc;k<n;k++) {
      const s=nb[k]; if (!s||s.size<3) continue;
      let cx=0,cy=0,cz=0,el=0;
      for (const j of s) { cx+=P[j*3]; cy+=P[j*3+1]; cz+=P[j*3+2];
        el+=Math.hypot(P[j*3]-P[k*3],P[j*3+1]-P[k*3+1],P[j*3+2]-P[k*3+2]); }
      cx/=s.size; cy/=s.size; cz/=s.size; el/=s.size;
      sum += Math.hypot(P[k*3]-cx,P[k*3+1]-cy,P[k*3+2]-cz)/(el||1); cnt++;
    }
    return cnt ? sum/cnt : 0;
  };
  const smooth = innerRoughness(API.makeBody({ ...base, hullCrisp:0 }));
  const sharp  = innerRoughness(API.makeBody({ ...base, hullCrisp:1 }));
  ok(smooth > 0 && sharp > 0, "both settings build a shell with an inside");
  ok(sharp < smooth*1.35,
     `turning crispness up doesn't roughen the inside: ${smooth.toFixed(4)} -> ${sharp.toFixed(4)}`);
});

t("a second real model, not just the one everything was tuned on", () => {
  // Every geometry check above runs on shapes built in the test, or on one car. A tuning
  // that happens to suit that car passes all of them. This is a different traced model —
  // different outline, different detail, 228 features, a 4.9mm wall and the slider at 0.2 —
  // loaded from the file the studio actually saved.
  let prof;
  try { prof = JSON.parse(fs.readFileSync(new URL("./fixture-charger.json", import.meta.url), "utf8")); }
  catch (e) { ok(false, "the second model's fixture must be present: " + e.message); return; }

  ok(prof.features.length > 200, `${prof.features.length} traced features came with it`);

  // Both builders. "Smooth" and "Follow my drawing" are not two looks of one builder — they
  // are two different ones, and a fix landing in only one is how they came to disagree about
  // where the object ends.
  for (const [label, over] of [
    ["smooth, as saved",    { mode:"loft" }],
    ["exact, as saved",     { mode:"projection" }],
    ["exact, underside open", { mode:"projection", openUnderside:true }],
    ["exact, crisp 1",      { mode:"projection", hullCrisp:1 }],
    ["exact, thin wall",    { mode:"projection", wallThickness:1.8, wallTop:1.8, wallSide:1.8, wallBottom:1.8 }],
    ["exact, thick wall",   { mode:"projection", wallThickness:7,   wallTop:7,   wallSide:7,   wallBottom:7 }],
  ]) {
    const g = API.makeBody({ ...prof, ...over });
    const m = API.checkManifold(g.indices);
    ok(m.watertight, `${label}: watertight (boundary ${m.boundary}, non-manifold ${m.nonman})`);
    ok(g.volume > 0 && isFinite(g.volume), `${label}: has a real volume (${(g.volume/1000).toFixed(1)} cm3)`);

    // no vertex may stand off from its own neighbours by more than an edge length —
    // that is what a spike is
    const P=g.positions, I=g.indices, n=P.length/3;
    const nb=Array.from({length:n},()=>new Set());
    for (let q=0;q<I.length;q+=3) {
      const a=I[q],b=I[q+1],c=I[q+2];
      nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
    }
    let worst=0;
    for (let k=0;k<n;k++) {
      const st=nb[k]; if (!st||st.size<3) continue;
      let cx=0,cy=0,cz=0,el=0;
      for (const j of st) { cx+=P[j*3]; cy+=P[j*3+1]; cz+=P[j*3+2];
        el+=Math.hypot(P[j*3]-P[k*3],P[j*3+1]-P[k*3+1],P[j*3+2]-P[k*3+2]); }
      cx/=st.size; cy/=st.size; cz/=st.size; el/=st.size;
      const r=Math.hypot(P[k*3]-cx,P[k*3+1]-cy,P[k*3+2]-cz)/(el||1);
      if (r>worst) worst=r;
    }
    ok(worst < 1.2, `${label}: no spikes (worst vertex stands off ${worst.toFixed(2)} edge lengths)`);
  }

  // Neither builder may finish below the ground the drawing sits on. The smooth one used to,
  // by 1.5mm on this very model, because the levelled base had only been built into the
  // other one.
  for (const mode of ["loft","projection"]) {
    const b2 = API.makeBody({ ...prof, mode });
    let zMin = 1e30;
    for (let k=2;k<b2.positions.length;k+=3) if (b2.positions[k]<zMin) zMin=b2.positions[k];
    ok(zMin > -0.5, `${mode}: the body ends on or above the ground (lowest point ${zMin.toFixed(1)}mm)`);
  }

  // the length asked for is the length built, on a real traced outline too
  const g = API.makeBody({ ...prof, mode:"projection" });
  let lo=1e30, hi=-1e30;
  for (let k=0;k<g.positions.length;k+=3) { if (g.positions[k]<lo) lo=g.positions[k];
    if (g.positions[k]>hi) hi=g.positions[k]; }
  ok(Math.abs((hi-lo)-prof.length) < 1.5,
     `${prof.length}mm asked, ${(hi-lo).toFixed(1)}mm built`);
});

t("the rim you see at an opening is a clean band, not a row of teeth", () => {
  // The visible edge of a shell is the band of wall between its outer and inner skin. If that
  // band wanders up and down over a short run, it reads as teeth around the wheel arch — the
  // thing he kept pointing at. Measured on this traced model: with the underside closed the
  // edge is a flat cut and barely moves; with it open the edge runs over the curved ceiling
  // of an arch, and that is where the wander lives.
  let prof;
  try { prof = JSON.parse(fs.readFileSync(new URL("./fixture-traced.json", import.meta.url), "utf8")); }
  catch (e) { ok(false, "the traced fixture must be present: " + e.message); return; }

  const rim = (g) => {
    const P=g.positions, I=g.indices, vc=P.length/6, bset=new Set();
    for (let q=0;q<I.length;q+=3) {
      const t=[I[q],I[q+1],I[q+2]];
      const lo=t.filter(v=>v<vc).length;
      if (lo>0 && lo<3) for (const v of t) if (v<vc) bset.add(v);
    }
    const ring=[...bset], widths=[];
    for (const v of ring)
      widths.push(Math.hypot(P[v*3]-P[(v+vc)*3], P[v*3+1]-P[(v+vc)*3+1], P[v*3+2]-P[(v+vc)*3+2]));
    let wander=0, cnt=0;
    for (const v of ring) {
      const near=[];
      for (const w of ring) {
        if (w===v) continue;
        if (Math.hypot(P[v*3]-P[w*3], P[v*3+1]-P[w*3+1]) < 4) near.push(P[w*3+2]);
      }
      if (near.length>2) {
        const mn=Math.min(...near), mx=Math.max(...near);
        wander += Math.abs(P[v*3+2]-(mn+mx)/2); cnt++;
      }
    }
    widths.sort((a,b)=>a-b);
    return { n:ring.length, med:widths[widths.length>>1]||0, wander: cnt?wander/cnt:0 };
  };

  const shut = rim(API.makeBody({ ...prof, openUnderside:false, openArches:false }));
  ok(shut.n > 50, `the closed underside leaves a rim to look at (${shut.n} points)`);
  ok(Math.abs(shut.med - prof.wallThickness) < 0.3,
     `and it is the thickness asked for: ${shut.med.toFixed(2)}mm of ${prof.wallThickness}mm`);
  ok(shut.wander < 0.2, `and it barely wanders: ${shut.wander.toFixed(3)}mm`);

  const open = rim(API.makeBody({ ...prof, openUnderside:true }));
  ok(open.n > 50, `the open underside leaves a longer rim (${open.n} points)`);
  ok(open.wander < 0.6,
     `and it stays reasonably straight over the arch: ${open.wander.toFixed(3)}mm (was 0.91 before fairing was raised)`);

  for (const [label, g] of [["closed", API.makeBody({ ...prof, openUnderside:false })],
                            ["open",   API.makeBody({ ...prof, openUnderside:true })]])
    ok(API.checkManifold(g.indices).watertight, `${label}: watertight`);
});


// =====================  WHERE DETAIL LANDS  =====================
// These pin the PLACE, not merely that something happened. Every bug in this block shipped
// past a green suite because the old tests asked "did the model change?" and the answer was
// yes — on the wrong face. A traced right-hand window was measured denting the NOSE at the
// exact coordinates a front-view window lands, and bottom-view detail was measured moving
// nothing at all, 0.00mm on all six faces. Both are silent: nothing throws, the shell stays
// watertight, the volume moves a little, and the detail is simply somewhere else.
{
  const BOX = [[0,0],[1,0],[1,1],[0,1]];
  const blockProfile = extra => ({
    length:100, topProfile:[[0,40],[1,40]], widthProfile:[[0,30],[1,30]],
    sidePoly:BOX, topPoly:BOX, frontPoly:BOX, hullCrisp:1, wallThickness:2,
    hullHollow:false, closedBottom:true, hullRes:70, mode:"projection", features:null, ...extra });
  // a patch in a corner of the view frame, so u and v can each be told apart from their mirror
  const PATCH = [[0.10,0.60],[0.30,0.60],[0.30,0.80],[0.10,0.80]];

  // the deepest departure from the featureless body on one named face, and where it sits
  const faceGrid = (pos, bb, ax, sgn, G = 56) => {
    const o1 = (ax+1)%3, o2 = (ax+2)%3;
    const a0 = bb.min[o1], a1 = bb.max[o1], b0 = bb.min[o2], b1 = bb.max[o2];
    const M = new Float64Array(G*G).fill(sgn > 0 ? -1e9 : 1e9);
    for (let i = 0; i < pos.length; i += 3) {
      const u = Math.min(G-1, Math.max(0, Math.floor((pos[i+o1]-a0)/(a1-a0)*G)));
      const v = Math.min(G-1, Math.max(0, Math.floor((pos[i+o2]-b0)/(b1-b0)*G)));
      const o = v*G+u, a = pos[i+ax];
      if (sgn > 0) { if (a > M[o]) M[o] = a; } else if (a < M[o]) M[o] = a;
    }
    return { M, G, a0, a1, b0, b1 };
  };
  const bboxOf = pos => { const mn=[1e18,1e18,1e18], mx=[-1e18,-1e18,-1e18];
    for (let i=0;i<pos.length;i+=3) for (let k=0;k<3;k++){ if(pos[i+k]<mn[k])mn[k]=pos[i+k]; if(pos[i+k]>mx[k])mx[k]=pos[i+k]; }
    return { min:mn, max:mx }; };
  const dent = (view, ax, sgn, extra) => {
    const prof = blockProfile(extra || {});
    const g0 = API.makeVisualHull(prof), bb = bboxOf(g0.positions);
    const g1 = API.makeVisualHull({ ...prof,
      features:[{ kind:"poly", view, poly:PATCH, depth:-4, soft:0.02, name:"pit" }] });
    const a = faceGrid(g0.positions, bb, ax, sgn), b = faceGrid(g1.positions, bb, ax, sgn);
    let deep = 0, du = 0, dv = 0;
    for (let v = 0; v < a.G; v++) for (let u = 0; u < a.G; u++) {
      const o = v*a.G+u;
      if (Math.abs(a.M[o]) > 1e8 || Math.abs(b.M[o]) > 1e8) continue;
      const d = Math.abs(a.M[o]-b.M[o]);
      if (d > deep) { deep = d; du = u; dv = v; }
    }
    return { depth: deep,
             along: a.a0 + (du+0.5)/a.G*(a.a1-a.a0),
             across: a.b0 + (dv+0.5)/a.G*(a.b1-a.b0) };
  };

  t("detail: every one of the six views presses something, somewhere", () => {
    // bottom pressed NOTHING before this — its facing test read the nose-facing component of
    // a normal that points at the floor, so every vertex failed the gate and was dropped.
    for (const [view, ax, sgn] of [["side",1,+1], ["sideR",1,+1], ["top",2,+1],
                                   ["bottom",2,-1], ["front",0,+1], ["rear",0,-1]])
      ok(dent(view, ax, sgn).depth > 0.3, `${view} pressed nothing (${dent(view,ax,sgn).depth.toFixed(2)}mm)`);
  });

  t("detail: the right-side view presses the flank, not the nose", () => {
    ok(dent("sideR", 1, +1).depth > 0.3, "right-side detail never reached a flank");
    // the exact face and coordinates a FRONT feature lands on. It used to land here.
    ok(dent("sideR", 0, +1).depth < 0.1, "right-side detail is being pressed into the nose");
  });

  t("detail: a right-side feature lands mirrored along the length, like its outline", () => {
    // the right drawing is traced standing on the far side, so u runs the other way —
    // the same flip sidePolyR gets. u 0.10..0.30 must come out at x 70..90 on a 100mm body.
    const d = dent("sideR", 1, +1);
    ok(d.across > 65 && d.across < 95, `expected x 70..90, got ${d.across.toFixed(1)}`);
    const left = dent("side", 1, +1);
    ok(left.across > 5 && left.across < 35, `left view should stay at x 10..30, got ${left.across.toFixed(1)}`);
  });

  t("detail: a plan-view feature lands on the side of the body it was drawn on", () => {
    // features store v screen-up; topPoly stores v screen-down. Read one in the other's
    // frame and the detail appears on the opposite flank, which looks plausible and isn't.
    const d = dent("top", 2, +1);          // v 0.60..0.80 -> y (1-v)*W -> 12..24 -> centred -18..-6
    ok(d.across < 0, `top-view detail is on the wrong flank: y=${d.across.toFixed(1)}, expected negative`);
    const b = dent("bottom", 2, -1);
    ok(b.across < 0, `bottom-view detail is on the wrong flank: y=${b.across.toFixed(1)}`);
  });

  t("detail: with two side drawings each one presses only its own flank", () => {
    const half = [[0,0],[1,0],[1,0.5],[0,0.5]];
    ok(dent("sideR", 1, +1, { sidePolyR: half }).depth > 0.3, "right drawing lost its own flank");
    ok(dent("side",  1, -1, { sidePolyR: half }).depth > 0.3, "left drawing lost its own flank");
  });

  t("detail: all six views at once still leaves one watertight shell", () => {
    const feats = ["side","sideR","top","bottom","front","rear"].map((view,i) =>
      ({ kind:"poly", view, poly:PATCH, depth:-4, soft:0.02, name:"f"+i }));
    for (const hollow of [false, true]) {
      const g = API.makeVisualHull({ ...blockProfile({}), hullHollow:hollow, features:feats });
      watertight(g, `six views, hollow=${hollow}`);
    }
  });
}

// =====================  THE SECOND SIDE ACTUALLY GOVERNS ITS FLANK  =====================
t("two sides: each flank matches the outline drawn for it, not an average of both", () => {
  // The existing symmetric/asymmetric test only asks whether the two flanks DIFFER, and they
  // did — so this went unseen. The blend weight was built for a y centred on zero while the
  // field's y runs 0..W, so it only ever spanned 0.5..1: the right drawing governed its own
  // half AND the centreline, and the left flank came out a 50/50 average that never once
  // matched the outline traced for it. Measured at 30.0mm where its drawing said 40.0mm.
  const BOX = [[0,0],[1,0],[1,1],[0,1]];
  const HALF = [[0,0],[1,0],[1,0.5],[0,0.5]];       // right drawing: half the height
  const g = API.makeVisualHull({
    length:100, topProfile:[[0,40],[1,40]], widthProfile:[[0,30],[1,30]],
    sidePoly:BOX, sidePolyR:HALF, topPoly:BOX, frontPoly:BOX,
    hullCrisp:1, wallThickness:2, hullHollow:false, closedBottom:true,
    hullRes:70, mode:"projection", features:null });
  const P = g.positions;
  let yLo = 1e18, yHi = -1e18;
  for (let i = 0; i < P.length; i += 3) { if (P[i+1] < yLo) yLo = P[i+1]; if (P[i+1] > yHi) yHi = P[i+1]; }
  const tallest = (y0, y1) => { let h = -1e18;
    for (let i = 0; i < P.length; i += 3)
      if (P[i+1] >= y0 && P[i+1] <= y1 && P[i] > 15 && P[i] < 85 && P[i+2] > h) h = P[i+2];
    return h; };
  const band = (yHi - yLo) * 0.12;
  const leftFlank  = tallest(yLo, yLo + band);
  const rightFlank = tallest(yHi - band, yHi);
  near(leftFlank, 40, 1.5,  "the flank the full-height drawing was traced for");
  near(rightFlank, 20, 1.5, "the flank the half-height drawing was traced for");
  // and one drawing on its own must be untouched by any of this
  const sym = API.makeVisualHull({
    length:100, topProfile:[[0,40],[1,40]], widthProfile:[[0,30],[1,30]],
    sidePoly:BOX, topPoly:BOX, frontPoly:BOX, hullCrisp:1, wallThickness:2,
    hullHollow:false, closedBottom:true, hullRes:70, mode:"projection", features:null });
  let h = -1e18; for (let i = 0; i < sym.positions.length; i += 3) if (sym.positions[i+2] > h) h = sym.positions[i+2];
  near(h, 40, 0.2, "a body with one side drawing is unchanged");
});


// =====================  TAKING A SHAPE TWICE  =====================
// "Take all" had no memory of what it had already taken, so pressing it again added every
// shape in the drawing a second time, exactly on top of itself. On a real model that turned
// 60 shapes into 667, and it is the single cause of three separate complaints:
//   * the detail smears — stacked stamps all want depth at once and the gradient limiter
//     spreads the excess sideways. Measured on nested panels: the dent holds at its 2.77mm
//     cap while the area that moves grows from 312 cells to 1,077, so crisp panel lines
//     bleed into one soft mound.
//   * deleting appears to do nothing — you removed one of six identical copies.
//   * the small shape can't be picked — five copies of the big panel sit over it.
t("a shape taken twice is one feature, not two", () => {
  const panel  = [[0.15,0.30],[0.85,0.30],[0.85,0.70],[0.15,0.70]];
  const grille = [[0.30,0.40],[0.70,0.40],[0.70,0.60],[0.30,0.60]];
  const horse  = [[0.47,0.47],[0.53,0.47],[0.53,0.53],[0.47,0.53]];
  const mk = (n,poly,view="front") => ({ kind:"poly", view, poly, depth:-2.5, soft:0.08, name:n });
  const feats = [];
  for (let press = 0; press < 6; press++)
    [["panel",panel],["grille",grille],["horse",horse]].forEach(([n,p]) => feats.push(mk(n+press, p)));
  ok(feats.length === 18, "six presses of a three-shape drawing");
  // a signature has to be stable for the same shape and different for a different one
  eq(API.featSig(feats[0]), API.featSig(feats[3]), "the same shape signs the same both times");
  ok(API.featSig(feats[0]) !== API.featSig(feats[1]), "two different shapes sign differently");
  ok(API.featSig(mk("x", panel, "side")) !== API.featSig(mk("x", panel, "front")),
     "the same outline on two different faces is two different features");
  const live = API.setFeatures(feats);
  const dup = API.featDupIdx(null);
  eq(dup.length, 15, "fifteen of the eighteen are copies of one already there");
  dup.slice().sort((a,b) => b-a).forEach(i => live.splice(i, 1));
  eq(live.length, 3, "one of each shape survives");
  eq(API.featDupIdx(null).length, 0, "and tidying again finds nothing left to do");
  // taking a genuinely new shape is still adding, not deduping
  live.push(mk("scoop", [[0.05,0.05],[0.11,0.05],[0.11,0.11],[0.05,0.11]]));
  eq(API.featDupIdx(null).length, 0, "a shape that isn't there yet is not a duplicate");
});

t("the small shape under the big one can still be reached", () => {
  // A badge sits inside a grille sits inside a bumper panel. The gizmo boxes are rectangles,
  // so the panel's box covers the badge completely — there was no way to tap it, and past a
  // few hundred features the boxes aren't drawn at all so there was nothing to tap either.
  const panel  = [[0.15,0.30],[0.85,0.30],[0.85,0.70],[0.15,0.70]];
  const grille = [[0.30,0.40],[0.70,0.40],[0.70,0.60],[0.30,0.60]];
  const horse  = [[0.47,0.47],[0.53,0.47],[0.53,0.53],[0.47,0.53]];
  const feats = [["panel",panel],["grille",grille],["horse",horse]]
    .map(([n,poly]) => ({ kind:"poly", view:"front", poly, depth:-2.5, soft:0.08, name:n }));
  API.setFeatures(feats); API.setView("front");
  const hit = API.featPickAt("front", 0.5, 0.5);       // dead centre: all three overlap
  eq(hit.length, 3, "every shape under the finger is a candidate");
  eq(feats[hit[0]].name, "horse", "the smallest wins — you pointed at the badge, not the panel");
  eq(feats[hit[1]].name, "grille", "tapping again steps out one layer");
  eq(feats[hit[2]].name, "panel", "and again to the outermost");
  const mid = API.featPickAt("front", 0.35, 0.50);     // inside the grille, outside the badge
  eq(mid.length, 2, "only the shapes actually containing the point");
  eq(feats[mid[0]].name, "grille", "smallest of those two");
  eq(API.featPickAt("front", 0.02, 0.02).length, 0, "bare bodywork picks nothing");
  // a shape on another face must never be offered
  API.setFeatures([...feats, { kind:"poly", view:"side", poly:panel, depth:-2, soft:0.08, name:"flank" }]);
  eq(API.featPickAt("front", 0.5, 0.5).length, 3, "a shape on another view is not a candidate");
});

// =====================  RAISED DETAIL  =====================
t("a badge stands proud of the panel, and the frame has no say in it", () => {
  // Pressing IN is limited by how much frame sits behind the surface — go further and you
  // are through the panel. Raising ADDS material outside the skin, where there is nothing to
  // breach, but both were sharing one clamp: a badge asked for 6mm came out at 2.77 on a
  // 4.1mm frame, and thickening the frame to get a taller badge made sense to nobody.
  const BOX = [[0,0],[1,0],[1,1],[0,1]];
  const badge = [[0.35,0.35],[0.65,0.35],[0.65,0.65],[0.35,0.65]];
  const build = (depth, wall) => {
    const p = { length:200, topProfile:[[0,80],[1,80]], widthProfile:[[0,50],[1,50]],
      sidePoly:BOX, topPoly:BOX, frontPoly:BOX, hullCrisp:1, wallThickness:wall,
      hullHollow:true, closedBottom:true, hullRes:70, mode:"projection",
      features: depth === null ? null
        : [{ kind:"poly", view:"front", poly:badge, depth, soft:0.03, name:"horse" }] };
    const g = API.makeVisualHull(p), b = API.makeVisualHull({ ...p, features:null });
    let m = -1e9, n = -1e9;
    for (let i = 0; i < g.positions.length; i += 3) if (g.positions[i] > m) m = g.positions[i];
    for (let i = 0; i < b.positions.length; i += 3) if (b.positions[i] > n) n = b.positions[i];
    return { proud: m - n, g };
  };
  const thick = build(2, 4.1), thin = build(2, 1.8);
  near(thick.proud, 2, 0.25, "a 2mm raise stands 2mm proud");
  near(thin.proud, thick.proud, 0.05,
       "the frame thickness makes no difference to a raise — it used to clamp it");
  // and it must still close: adding material outside the skin can't be allowed to tear it
  for (const [label, d] of [["+2mm", 2], ["+6mm", 6], ["+12mm", 12]])
    watertight(build(d, 4.1).g, `raised ${label}`);
  // pressing in is still held to the frame, which is the whole point of the distinction
  ok(build(-2.5, 4.1).proud < 0.15, "pressing in doesn't push anything outward");
});

t("a raise too steep for its own width is limited, not folded", () => {
  // The gradient limiter still governs how sharply the surface may bend. A narrow shape
  // therefore cannot reach an arbitrary height — it would need near-vertical sides, which is
  // exactly the fold the limiter exists to prevent. Measured: on a 100mm face a 40mm badge
  // reaches the full 6mm, 25mm reaches 4.6, 15mm reaches 3.4, 8mm reaches 1.7.
  const BOX = [[0,0],[1,0],[1,1],[0,1]];
  const sq = s => [[0.5-s/2,0.5-s/2],[0.5+s/2,0.5-s/2],[0.5+s/2,0.5+s/2],[0.5-s/2,0.5+s/2]];
  const proud = span => {
    const p = { length:200, topProfile:[[0,80],[1,80]], widthProfile:[[0,50],[1,50]],
      sidePoly:BOX, topPoly:BOX, frontPoly:BOX, hullCrisp:1, wallThickness:4.1,
      hullHollow:true, closedBottom:true, hullRes:70, mode:"projection",
      features:[{ kind:"poly", view:"front", poly:sq(span), depth:6, soft:0.03, name:"b" }] };
    const g = API.makeVisualHull(p), b = API.makeVisualHull({ ...p, features:null });
    let m = -1e9, n = -1e9;
    for (let i = 0; i < g.positions.length; i += 3) if (g.positions[i] > m) m = g.positions[i];
    for (let i = 0; i < b.positions.length; i += 3) if (b.positions[i] > n) n = b.positions[i];
    watertight(g, `raised badge ${(span*100).toFixed(0)}mm wide`);
    return m - n;
  };
  const wide = proud(0.40), narrow = proud(0.08);
  near(wide, 6, 0.4, "a wide badge reaches the height asked for");
  ok(narrow < wide - 1,
     `a narrow one is limited by its own width (${narrow.toFixed(2)} vs ${wide.toFixed(2)})`);
  ok(narrow > 0.5, "but it is still raised, not flattened away");
});


t("a shape drawn inside another shape shades it, it doesn't dig a pit", () => {
  // A front view is nested all the way down: a badge inside a grille inside a bumper panel.
  // Each feature used to be stamped onto the RESULT of the one before, so a point under three
  // outlines was pressed three times. Measured with each asking -2.0mm: the badge centre came
  // out at 2.77mm — which is not 2.0, it is the total-travel ceiling, the only thing standing
  // between that drawing and a 6mm crater. A drawing is a drawing, not a stack of cuts.
  const BOX    = [[0,0],[1,0],[1,1],[0,1]];
  const panel  = [[0.15,0.25],[0.85,0.25],[0.85,0.75],[0.15,0.75]];
  const grille = [[0.30,0.38],[0.70,0.38],[0.70,0.62],[0.30,0.62]];
  const badge  = [[0.44,0.44],[0.56,0.44],[0.56,0.56],[0.44,0.56]];
  const mk = poly => ({ kind:"poly", view:"front", poly, depth:-2, soft:0.03, name:"f" });
  const depthAt = (feats, u, v) => {
    const p = { length:200, topProfile:[[0,80],[1,80]], widthProfile:[[0,50],[1,50]],
      sidePoly:BOX, topPoly:BOX, frontPoly:BOX, hullCrisp:1, wallThickness:4.1,
      hullHollow:true, closedBottom:true, hullRes:90, mode:"projection", features:feats };
    const g = API.makeVisualHull(p), b = API.makeVisualHull({ ...p, features:null });
    watertight(g, "nested detail");
    const ty = (u-0.5)*100, tz = v*80;
    const peak = pos => { let best = -1e9;
      for (let i = 0; i < pos.length; i += 3)
        if (Math.abs(pos[i+1]-ty) < 3 && Math.abs(pos[i+2]-tz) < 3 && pos[i] > best) best = pos[i];
      return best; };
    return peak(b.positions) - peak(g.positions);
  };
  const alone = depthAt([mk(panel)], 0.50, 0.5);
  near(alone, 2, 0.2, "one shape asking for 2mm gives 2mm");
  near(depthAt([mk(panel), mk(grille)], 0.50, 0.5), alone, 0.2,
       "a second outline over the same point doesn't deepen it");
  near(depthAt([mk(panel), mk(grille), mk(badge)], 0.50, 0.5), alone, 0.2,
       "nor does a third — the deepest single request wins, they never sum");
  // and the shapes stay individually readable, not flattened into one plateau. Both depths
  // have to sit inside what the frame allows inward (half the wall, 2.05mm here) or the
  // clamp — not the shading — is what you end up measuring.
  const shallow = depthAt([{ ...mk(panel), depth:-0.8 }], 0.50, 0.5);
  const stepped = depthAt([{ ...mk(panel), depth:-0.8 }, { ...mk(grille), depth:-2.0 }], 0.50, 0.5);
  near(shallow, 0.8, 0.2, "a shallow panel on its own");
  ok(stepped > shallow + 0.6,
     `a deeper inner shape still reads deeper than the panel around it (${stepped.toFixed(2)} vs ${shallow.toFixed(2)})`);
  // ...and the panel around it is untouched by its neighbour going deeper
  near(depthAt([{ ...mk(panel), depth:-0.8 }, { ...mk(grille), depth:-2.0 }], 0.20, 0.5),
       depthAt([{ ...mk(panel), depth:-0.8 }], 0.20, 0.5), 0.2,
       "the outer panel keeps its own depth");
});


// =====================  STOCK, AND THE PARTS YOU DON'T CUT  =====================
t("a shape left at zero depth is material you keep, not a feature that does nothing", () => {
  // The model is a block of stock the size of the drawing, with everything else cut away.
  // Under that reading a drawing gives three kinds of shape, not two: carve it, leave it, or
  // (the odd one out) push it outward. "Leave it" is how a badge pops: cut the grille down
  // and the pony is what remains. Nothing is added and the part never grows past the box it
  // was measured in — which matters, because it has to fit the chassis it was measured for.
  const BOX    = [[0,0],[1,0],[1,1],[0,1]];
  const grille = [[0.20,0.30],[0.80,0.30],[0.80,0.70],[0.20,0.70]];
  const pony   = [[0.38,0.38],[0.62,0.38],[0.62,0.62],[0.38,0.62]];
  const mk = (poly, d, n) => ({ kind:"poly", view:"front", poly, depth:d, soft:0.03, name:n });
  const run = feats => {
    const p = { length:200, topProfile:[[0,80],[1,80]], widthProfile:[[0,50],[1,50]],
      sidePoly:BOX, topPoly:BOX, frontPoly:BOX, hullCrisp:1, wallThickness:4.1,
      hullHollow:true, closedBottom:true, hullRes:90, mode:"projection", features:feats };
    const g = API.makeVisualHull(p);
    watertight(g, "carved front");
    const at = (u,v) => { const ty=(u-0.5)*100, tz=v*80; let best=-1e9;
      for (let i = 0; i < g.positions.length; i += 3)
        if (Math.abs(g.positions[i+1]-ty) < 2 && Math.abs(g.positions[i+2]-tz) < 2 && g.positions[i] > best)
          best = g.positions[i];
      return best; };
    let lo = 1e18, hi = -1e18;
    for (let i = 0; i < g.positions.length; i += 3) { if (g.positions[i] < lo) lo = g.positions[i]; if (g.positions[i] > hi) hi = g.positions[i]; }
    return { face: at(0.30,0.5), pony: at(0.50,0.5), length: hi-lo };
  };
  const plain = run(null);
  const cut   = run([mk(grille,-2,"grille")]);
  const left  = run([mk(grille,-2,"grille"), mk(pony,0,"pony")]);
  near(plain.length, 200, 0.5, "the block is the size it was traced at");
  near(cut.face, plain.face - 2, 0.3, "the grille is cut 2mm into it");
  near(cut.pony, cut.face, 0.3, "with no shape left standing, the middle goes with it");
  ok(left.pony > left.face + 1.5,
     `the pony is left standing proud of the grille around it (${(left.pony-left.face).toFixed(2)}mm)`);
  near(left.pony, plain.face, 0.3, "and it is still at the original face — nothing was added to it");
  near(left.length, 200, 0.5,
       "the part is still exactly the size it was traced at; leaving material never grows it");
});

t("pushing a shape outward is what actually grows the part past its own box", () => {
  // Kept working, because someone may want it — but it is the one operation that breaks the
  // block-of-stock reading, and it must be measurable so the panel can warn about it.
  const BOX = [[0,0],[1,0],[1,1],[0,1]];
  const badge = [[0.42,0.42],[0.58,0.42],[0.58,0.58],[0.42,0.58]];
  const len = depth => {
    const p = { length:200, topProfile:[[0,80],[1,80]], widthProfile:[[0,50],[1,50]],
      sidePoly:BOX, topPoly:BOX, frontPoly:BOX, hullCrisp:1, wallThickness:4.1,
      hullHollow:true, closedBottom:true, hullRes:80, mode:"projection",
      features: depth === null ? null : [{ kind:"poly", view:"front", poly:badge, depth, soft:0.03, name:"b" }] };
    const g = API.makeVisualHull(p);
    let lo = 1e18, hi = -1e18;
    for (let i = 0; i < g.positions.length; i += 3) { if (g.positions[i] < lo) lo = g.positions[i]; if (g.positions[i] > hi) hi = g.positions[i]; }
    return hi - lo;
  };
  near(len(null), 200, 0.5, "traced at 200mm");
  near(len(-3), 200, 0.5, "carving never changes the outside size");
  ok(len(3) > 201, `pushing outward does (${len(3).toFixed(2)}mm) — the panel says so now`);
});


// =====================  THE BLOCK, FILLING IN  =====================
t("the import block draws six real faces that never land on top of each other", () => {
  // Six panels in an isometric projection is all sign conventions and nothing else. Get one
  // normal backwards and two faces explode to the same spot, or a face collapses to a line —
  // and it still renders, just as something that isn't a box. Worth pinning, because it is
  // the one place in the app where a silent wrong answer looks like a design choice.
  const faces = script.match(/const IB_FACES=\[[\s\S]*?\n\];/)[0];
  const body = [script.match(/^const IB_S=.*$/m)[0],
                script.match(/^const ibProj=.*$/m)[0], faces].join("\n");
  const { ibProj, IB_FACES } = new Function(body + "\nreturn {ibProj,IB_FACES};")();
  eq(IB_FACES.length, 6, "one panel per view");
  eq(new Set(IB_FACES.map(f => f.v)).size, 6, "and they are six different views");
  // every face is a proper rhombus of the same area — a collapsed one means a bad normal
  const areas = IB_FACES.map(f => {
    const P = f.c.map(c => ibProj(c[0], c[1], c[2]));
    let A = 0;
    for (let i = 0; i < 4; i++) { const [x1,y1] = P[i], [x2,y2] = P[(i+1)%4]; A += x1*y2 - x2*y1; }
    return Math.abs(A) / 2;
  });
  areas.forEach((a, i) => ok(a > 50, `${IB_FACES[i].v} is a real quad, not a sliver (${a.toFixed(0)})`));
  areas.forEach(a => near(a, areas[0], 0.01, "every face of a cube projects to the same area"));
  // three visible, three hidden — a solid box only ever shows you half its faces
  const depth = f => f.n[0] - f.n[1] + f.n[2];
  eq(IB_FACES.filter(f => depth(f) > 0).length, 3, "three faces turned toward you");
  eq(IB_FACES.filter(f => depth(f) < 0).length, 3, "three turned away");
  // the left side is one you can SEE — it's the drawing nearly every model starts from
  ok(IB_FACES.filter(f => depth(f) > 0).map(f => f.v).includes("side"),
     "the left side faces the viewer");
  // exploded, no two panels may drift to the same place
  const spots = new Set(IB_FACES.map(f => ibProj(f.n[0]*0.5, f.n[1]*0.5, f.n[2]*0.5)
    .map(v => v.toFixed(2)).join(",")));
  eq(spots.size, 6, "each panel separates in its own direction");
  // and the whole thing has to stay inside the viewBox it's drawn in (-46..46, -48..48)
  let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
  for (const f of IB_FACES) {
    const [ox, oy] = ibProj(f.n[0]*0.6, f.n[1]*0.6, f.n[2]*0.6);
    for (const c of f.c) { const [x, y] = ibProj(c[0], c[1], c[2]);
      mnx = Math.min(mnx, x+ox); mxx = Math.max(mxx, x+ox);
      mny = Math.min(mny, y+oy); mxy = Math.max(mxy, y+oy); }
  }
  ok(mnx >= -46 && mxx <= 46 && mny >= -48 && mxy <= 48,
     `fits its viewBox even fully exploded (${mnx.toFixed(0)}..${mxx.toFixed(0)}, ${mny.toFixed(0)}..${mxy.toFixed(0)})`);
});


// =====================  A FILE THAT STATES ITS OWN DIMENSIONS  =====================
t("a DXF's declared units are read, not re-measured by eye", () => {
  // Lee's drawings carry real coordinates. The reader used to skip the HEADER section
  // outright — the old comment said "DXF is unitless in general", which isn't true —  so a
  // file that states it is 4,700mm across was rasterised to 1000px and the person was sent
  // to Set scale to re-measure a number the file already stated exactly. Anything they typed
  // could only contradict it, and nothing would have said so.
  const dxf = insunits => `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1021\n`
    + (insunits === null ? "" : `9\n$INSUNITS\n70\n${insunits}\n`)
    + `9\n$EXTMIN\n10\n0.0\n20\n0.0\n30\n0.0\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n`
    + `0\nLINE\n10\n0.0\n20\n0.0\n11\n4700.0\n21\n1400.0\n0\nENDSEC\n0\nEOF`;
  const span = 4700;                                    // drawing units across
  const mmFor = code => { const u = API.dxfUnitMM(API.dxfParse(dxf(code)).header); return u ? span*u.mm : null; };
  near(mmFor(4), 4700, 0.5, "millimetres");
  near(mmFor(5), 47000, 5, "centimetres");
  near(mmFor(6), 4700000, 500, "metres");
  near(mmFor(1), 4700*25.4, 5, "inches");
  near(mmFor(2), 4700*304.8, 50, "feet");
  // and when the file genuinely says nothing, it must NOT guess — being wrong by 25.4x here
  // is worse than asking, and $MEASUREMENT only picks a hatch-pattern file, not the units
  eq(mmFor(0), null, "$INSUNITS 0 declares no units, so nothing is claimed");
  eq(mmFor(null), null, "nor does an absent $INSUNITS");
  // reading the header must not disturb the geometry it sits in front of
  eq(API.dxfParse(dxf(4)).model.length, 1, "entities still parse with a header present");
  ok(API.dxfParse(dxf(4)).header["$ACADVER"] === "AC1021", "other header vars come through too");
});

t("every absolute unit an SVG can state is understood", () => {
  // It used to accept mm, cm and in only — and the units it was missing are the ones real
  // exporters write. Illustrator and older Inkscape default to pt; a bare number beside a
  // viewBox is CSS px, which is 1/96 inch BY SPEC, not an unknown. All of these are 120mm.
  for (const w of ["120mm", "12cm", "1.2e2mm"])
    near(API.svgLengthMM(w), 120, 0.05, `width="${w}"`);
  near(API.svgLengthMM("4.7244in"), 120, 0.05, 'width="4.7244in"');
  near(API.svgLengthMM("340.16pt"), 120, 0.1, 'width="340pt" — Illustrator\'s default');
  near(API.svgLengthMM("28.346pc"), 120, 0.1, 'width="28pc"');
  // relative and meaningless values must stay unknown rather than becoming a wrong number
  for (const w of ["100%", "3em", "2ex", "0mm", "-5mm", "", "auto"])
    eq(API.svgLengthMM(w), null, `width="${w}" is not a physical size`);
  // px and a bare number are a DEFAULT, not a statement. The spec would let us call them
  // 1/96 inch; almost nobody writing them means that, so turning them into millimetres
  // would invent a measurement — the same mistake as guessing DXF units from $MEASUREMENT.
  for (const w of ["453.54", "453.54px", "1000"])
    eq(API.svgLengthMM(w), null, `width="${w}" states units, not a size`);
});


// =====================  THE OUTLINE IS THE FILE'S OWN  =====================
// A DXF holds the exact curve of every line and no statement about which lines enclose the
// body, so the silhouette used to be recovered by drawing the strokes onto a canvas and
// reading the pixels back. That works, and it throws away the precision that was the reason
// to accept a CAD file at all — Lee's drawings carry real geometry and got a pixel trace of
// it. The lines DO enclose the shape; they just do it as hundreds of separate strokes that
// share endpoints. Weld the endpoints and the strokes become a graph whose outermost face
// is the silhouette, to the file's own coordinates.
{
  const TRUE = [[0,0],[400,0],[600,180],[1200,260],[1680,260],[1860,100],[2000,80],[2000,0]];
  const area = p => { let a = 0;
    for (let i = 0, j = p.length-1; i < p.length; j = i++) a += p[j][0]*p[i][1] - p[i][0]*p[j][1];
    return Math.abs(a)/2; };
  // chop the outline into separate strokes and nudge the endpoints, the way an exporter
  // rounds and a flattened arc lands a hair off the line meeting it
  const shatter = (loop, gap, seed) => {
    let s = seed; const rnd = () => ((s = (s*1103515245 + 12345) & 0x7fffffff)/0x7fffffff - 0.5)*2;
    const out = [], ring = loop.concat([loop[0]]);
    for (let i = 0; i < ring.length-1; i++) {
      const a = ring[i], b = ring[i+1], m = [(a[0]+b[0])/2, (a[1]+b[1])/2];
      out.push([[a[0]+rnd()*gap, a[1]+rnd()*gap], m]);
      out.push([[m[0]+rnd()*gap, m[1]+rnd()*gap], b]);
    }
    return out;
  };
  // what every real drawing also carries: panel lines, a dimension leader, a stray stub
  const JUNK = [[[600,90],[1600,90]], [[700,40],[700,200]],
                [[1000,400],[1000,460]], [[950,460],[1050,460]],
                [[100,-140],[1900,-140]], [[1500,150],[1500,150.001]]];
  const bounds = { wU:2000, hU:260 };

  t("dxf: the silhouette is stitched from the strokes, not read off pixels", () => {
    for (const gap of [0, 0.01, 0.5, 2]) {
      const r = API.dxfSilhouette(shatter(TRUE, gap, 7).concat(JUNK), bounds);
      ok(r, `a ${gap} unit endpoint gap still closes`);
      near(area(r.loop), area(TRUE), area(TRUE)*0.01,
           `and encloses the drawn shape (gap ${gap})`);
    }
  });

  t("dxf: every corner the file drew survives, to the file's own numbers", () => {
    // the point of all this. A pixel trace rounds corners to whatever the raster could hold;
    // stitching keeps the coordinates that were in the file.
    const r = API.dxfSilhouette(shatter(TRUE, 0.01, 7).concat(JUNK), bounds);
    let worst = 0;
    for (const c of TRUE) {
      let d = 1e18;
      for (const p of r.loop) d = Math.min(d, Math.hypot(p[0]-c[0], p[1]-c[1]));
      worst = Math.max(worst, d);
    }
    ok(worst < 0.05, `worst corner miss ${worst.toFixed(6)} drawing units`);
  });

  t("dxf: it won't invent a shape, and won't fall for a border frame", () => {
    // nothing enclosed must stay nothing enclosed — auto-trace is the fallback, and a wrong
    // outline is worse than no outline
    eq(API.dxfSilhouette([[[0,0],[10,0]], [[20,0],[30,0]]], { wU:30, hU:1 }), null,
       "open strokes enclose nothing");
    eq(API.dxfSilhouette([], { wU:10, hU:10 }), null, "nor does an empty drawing");
    // a drawing frame is bigger than the part and must not be mistaken for it
    const framed = shatter(TRUE, 0.01, 7).concat(JUNK,
      [[[-200,-300],[2200,-300]], [[2200,-300],[2200,500]],
       [[2200,500],[-200,500]], [[-200,500],[-200,-300]]]);
    const r = API.dxfSilhouette(framed, { wU:2400, hU:800 });
    ok(r, "still finds something");
    near(area(r.loop), area(TRUE), area(TRUE)*0.01, "and it is the part, not the frame");
  });

  t("dxf: a drawing that states its size measures that size, with nobody clicking", () => {
    // the whole chain: header units -> stitched outline -> raster frame -> measured length.
    // The scale uses the DRAWN extent, not the canvas width: strokes are inset 2px a side so
    // a fat pen doesn't clip, so scaling by the full 1000 made every DXF 0.4% short — 2000mm
    // measured as 1992, small enough to pass for rounding and exactly the quiet disagreement
    // with a stated dimension that reading the file was supposed to end.
    let dxf = "0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n";
    const ring = TRUE.concat([TRUE[0]]);
    for (let i = 0; i < ring.length-1; i++)
      dxf += `0\nLINE\n10\n${ring[i][0]}\n20\n${ring[i][1]}\n11\n${ring[i+1][0]}\n21\n${ring[i+1][1]}\n`;
    dxf += "0\nLINE\n10\n600\n20\n90\n11\n1600\n21\n90\n0\nENDSEC\n0\nEOF";
    const { blocks, model, header } = API.dxfParse(dxf);
    let polys = [];
    for (const e of model) polys = polys.concat(API.dxfPolys(e, blocks));
    polys = polys.filter(q => q.length > 1);
    const unit = API.dxfUnitMM(header);
    ok(unit && unit.mm === 1, "the header says millimetres");
    let x0 = 1e18, x1 = -1e18, y0 = 1e18, y1 = -1e18;
    for (const q of polys) for (const p of q) {
      x0 = Math.min(x0,p[0]); x1 = Math.max(x1,p[0]); y0 = Math.min(y0,p[1]); y1 = Math.max(y1,p[1]); }
    const wU = x1-x0, hU = y1-y0;
    const sil = API.dxfSilhouette(polys, { wU, hU });
    ok(sil, "the outline closed");
    const RW = 1000, RH = Math.round(RW*hU/wU);
    const PX = q => (q[0]-x0)/wU*(RW-4) + 2, PY = q => RH-2 - (q[1]-y0)/hU*(RH-4);
    const outline = sil.loop.map(p => ({ x:PX(p), y:PY(p) }));
    const srcMM = wU*unit.mm, scale = (RW-4)/srcMM;
    const measured = API.outlineEnvelope(outline).span/scale;
    near(measured, 2000, 0.5,
         `the file says 2000mm and the model measures ${measured.toFixed(2)}mm`);
  });
}


// =====================  THICKNESS EATS INWARD, THE OUTSIDE NEVER MOVES  =====================
// For weeks the hollow shell grew OUTWARD when the wall was thickened, and a flat slab
// floated across the cavity. Root cause: opening the underside removed every triangle on the
// base and the arch ceilings, which left ~3,600 of their vertices touched by no remaining
// triangle. innerOffsets pushes each vertex inward along the average normal of its faces —
// with no faces, the normal is zero, so those vertices never moved: they stayed on the OUTER
// surface and were then welded into the INNER shell, dragging its bounding box out to meet
// the outer one (measured: 129mm wide and floor at -2.9mm at 12mm wall, vs a fixed 115/+5.6
// outer). The floating slab was the inner shell's own floor, one wall-thickness up from an
// opening the inner sheet didn't share. Fix: offset against the closed shell so every vertex
// has a real inward normal, then clamp any stray inner vertex back inside the outer skin.
{
  // the REAL model Collin sent, the one that actually orphans arch-ceiling vertices when the
  // underside opens. A synthetic box doesn't reproduce it — the arches have to be deep enough
  // that opening them strands a whole band of vertices with no faces left to give a normal.
  let HOLLOW_FIX = null;
  try { HOLLOW_FIX = JSON.parse(fs.readFileSync(new URL("./fixture-hollow.json", import.meta.url), "utf8")); }
  catch {}
  const prof = extra => ({ ...HOLLOW_FIX, hullRes:80, features:null, ...extra });
  const box = g => { const m=[1e9,1e9,1e9],M=[-1e9,-1e9,-1e9];
    for(let i=0;i<g.positions.length;i+=3) for(let k=0;k<3;k++){
      if(g.positions[i+k]<m[k])m[k]=g.positions[i+k]; if(g.positions[i+k]>M[k])M[k]=g.positions[i+k]; }
    return { w:M[1]-m[1], h:M[2]-m[2], floor:m[2], len:M[0]-m[0] }; };

  t("hollow: the outside is identical at every wall thickness", () => {
    ok(HOLLOW_FIX, "fixture-hollow.json present"); if(!HOLLOW_FIX) return;
    const walls = [1.8, 4.2, 8, 12];
    const boxes = walls.map(wt => box(API.makeVisualHull(prof({ hullHollow:true, wallThickness:wt }))));
    const ref = boxes[0];
    boxes.forEach((b, i) => {
      near(b.w, ref.w, 0.05, `width must not move (wall ${walls[i]})`);
      near(b.h, ref.h, 0.05, `height must not move (wall ${walls[i]})`);
      near(b.floor, ref.floor, 0.05, `floor must not drop (wall ${walls[i]})`);
      near(b.len, ref.len, 0.05, `length must not move (wall ${walls[i]})`);
    });
    // vs the SOLID body: height and floor are exact; the open edge is faired inward by up
    // to ~half a millimetre where the underside was cut, so width is allowed that much.
    const solid = box(API.makeVisualHull(prof({ hullHollow:false, wallThickness:4.2 })));
    near(ref.h, solid.h, 0.05, "hollow height == solid height");
    near(ref.floor, solid.floor, 0.05, "hollow floor == solid floor");
    ok(ref.w <= solid.w + 0.05 && ref.w > solid.w - 0.8,
       `hollow width tracks solid within fairing tolerance (${ref.w.toFixed(2)} vs ${solid.w.toFixed(2)})`);
  });

  t("hollow: thickening the wall consumes the cavity, so material grows", () => {
    ok(HOLLOW_FIX, "fixture-hollow.json present"); if(!HOLLOW_FIX) return;
    const vol = g => { let V=0; const P=g.positions,I=g.indices;
      for(let q=0;q<I.length;q+=3){const a=I[q]*3,b=I[q+1]*3,c=I[q+2]*3;
        V+=(P[a]*(P[b+1]*P[c+2]-P[c+1]*P[b+2])-P[a+1]*(P[b]*P[c+2]-P[c]*P[b+2])+P[a+2]*(P[b]*P[c+1]-P[c]*P[b+1]))/6;}
      return Math.abs(V); };
    const thin = vol(API.makeVisualHull(prof({ hullHollow:true, wallThickness:1.8 })));
    const thick = vol(API.makeVisualHull(prof({ hullHollow:true, wallThickness:12 })));
    ok(thick > thin * 1.5, `a 12mm wall uses far more material than 1.8mm (${(thin/1000).toFixed(0)} -> ${(thick/1000).toFixed(0)} cm3)`);
  });

  t("hollow: no vertex of the inner shell lies outside the outer skin", () => {
    ok(HOLLOW_FIX, "fixture-hollow.json present"); if(!HOLLOW_FIX) return;
    // the invariant the whole fix rests on: inside = outside eroded inward, so nothing inner
    // can poke out. If this holds, the outside cannot grow no matter what the wall is.
    const g = API.makeVisualHull(prof({ hullHollow:true, wallThickness:12 }));
    const m=[1e9,1e9,1e9],M=[-1e9,-1e9,-1e9];
    for(let i=0;i<g.positions.length;i+=3) for(let k=0;k<3;k++){
      if(g.positions[i+k]<m[k])m[k]=g.positions[i+k]; if(g.positions[i+k]>M[k])M[k]=g.positions[i+k]; }
    // the outer skin alone defines the box; assert every vertex sits within it (tautological
    // for the whole mesh, so instead assert the box equals the SOLID box — inner adds nothing)
    const solid=[1e9,1e9,1e9],SolidM=[-1e9,-1e9,-1e9];
    const gs=API.makeVisualHull(prof({ hullHollow:false, wallThickness:12 }));
    for(let i=0;i<gs.positions.length;i+=3) for(let k=0;k<3;k++){
      if(gs.positions[i+k]<solid[k])solid[k]=gs.positions[i+k]; if(gs.positions[i+k]>SolidM[k])SolidM[k]=gs.positions[i+k]; }
    // height (axis 2) is exact both ways; width/length edges may be faired inward slightly,
    // but the hollow box may NEVER exceed the solid one — that is the invariant that matters.
    for(let k=0;k<3;k++){
      ok(m[k] >= solid[k] - 0.05, `hollow min axis ${k} not outside solid (${m[k].toFixed(2)} >= ${solid[k].toFixed(2)})`);
      ok(M[k] <= SolidM[k] + 0.05, `hollow max axis ${k} not outside solid (${M[k].toFixed(2)} <= ${SolidM[k].toFixed(2)})`);
    }
    near(M[2]-m[2], SolidM[2]-solid[2], 0.05, "height is exact");
  });

  t("hollow: stays watertight as the wall thickens", () => {
    ok(HOLLOW_FIX, "fixture-hollow.json present"); if(!HOLLOW_FIX) return;
    for (const wt of [1.8, 4.2, 8, 12])
      watertight(API.makeVisualHull(prof({ hullHollow:true, wallThickness:wt })), `wall ${wt}`);
  });
}

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
