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
  /* A new top-level CONST is the same trap as a new top-level function. makeVisualHull
     reads these two, and without them it throws ReferenceError — which shows up as a pile
     of unrelated geometry failures rather than "you forgot to list it". Hard, not soft: if
     they go missing the suite should say so immediately. */
  grabConst("HOLLOW_WALL_CELLS"), grabConst("HOLLOW_THIN_CELLS"),
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
const NAMES = ["outlineEnvelope", "anchorPxPerMm", "makeRevolve", "makeLathe", "revProfileFromElevation", "pointInPoly",
  "makeVisualHull", "checkManifold", "traceExtentFrac", "profileScaleFromTrace", "impPdfListItems", "impPdfSummary", "drawnSpanToReal", "profileScaleFromDetail", "outlineCircularity", "polyArea", "resamplePoly", "svgPhysicalWidthMM",
  "htmlSafe", "boxPtsToPage", "viewRealSize", "drawingStated",
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
  "applyHullStrokes", "applyStroke", "hullVertexNormals", "hullAdjacency", "bottomSkinTris", "innerOffsets", "embossHull", "viewSkinVerts", "dropStrayShells", "sampleMask", "distToPoly", "viewUV",
  /* EVERY new top-level function belongs on this list. One that is missing is not
     extracted, so every test touching it throws, gets swallowed, and the suite goes quiet
     about a whole feature while still printing PASS. dropTinyShells and the point-cloud
     pair have both been through exactly that. */
  "dropTinyShells", "shellWallStats",
  "dedupeVerts", "samplePointCloud", "toPLY", "toXYZ", "toPCD",
  "parsePLY", "parseXYZ", "parsePCD", "parsePointCloud"];
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

// ---------------------------------------------------------------------------
// CROSS-END DUMP. Not a test — it prints what the STUDIO builds, as JSON, so the
// backend's `tests/test_both_ends.py` can build the same profiles with the exact kernel and
// compare. Two ends disagreeing about the part is the one fault this project treats as
// unacceptable, and until now nothing checked it by EXECUTION: the schema checker greps, and
// the contract tests run one end.
//
// Run ad hoc on 2026-09-21 this comparison found two live divergences in an afternoon — the
// underside taper (14.2% of material) and a pocket cutting a hole through a wall the preview
// kept. Both were invisible to every existing test on either side.
//
//   node test/bothends.mjs            -> JSON on stdout
//
// THE PRELUDE ABOVE IS core.test.mjs's OWN, copied verbatim to the `const MISSING` line. That
// is deliberate: the extractor is the fiddly part (brace matching, string and comment aware),
// and a second hand-written copy would drift from the suite's and start testing something the
// app does not do. If it ever fails to extract, this prints nothing and the Python side fails
// loudly rather than comparing against a phantom.
// ---------------------------------------------------------------------------
const BOX = [[0,0],[1,0],[1,1],[0,1]];

// The block is `tests/test_hull.py::_block_with([])` — 100 long, 40 tall, 60 wide — written the
// way the STUDIO needs it. widthProfile is a HALF-width: 30 here is a 60mm body, and getting
// that wrong made an earlier run of this comparison report a 42% divergence that was simply two
// different bodies. COMPARE THE SOLIDS BEFORE ANYTHING CARVED OUT OF THEM.
const BLOCK = {
  length:100, height:40, width:60,
  topProfile:[[0,40],[0.5,40],[1,40]], bottomProfile:[[0,0],[0.5,0],[1,0]],
  widthProfile:[[0,30],[0.5,30],[1,30]],
  sidePoly:BOX, topPoly:BOX, frontPoly:BOX, features:null,
  hullQuality:"normal", closedBottom:true, hullHollow:false
};

// A pocket over the middle of the top face: 40 x 24mm on a 100 x 60 body.
const POCKET = (depth) => [{name:"roof panel", view:"top", depth,
                            poly:[[0.3,0.3],[0.7,0.3],[0.7,0.7],[0.3,0.7]]}];

// THE REAL TRACED CAR, LOADED FROM LEE3D-Lib BY BOTH ENDS.
//
// **Not from this repo's own test/fixture-hollow.json.** There are two copies of that fixture,
// one here and one in the library, and as of 2026-09-25 they have DRIFTED — c058374f against
// 68f75b4a. Loading whichever is nearest would have each end building a different car, which is
// the exact fixture fault that made an earlier run of this comparison report 42%. One file,
// read by both, and the Python side reads the same path.
function loadCar() {
  for (const base of ["LEE3D-Lib", "LEE3D-Lib-main"]) {
    const f = path.join(HERE, "..", "..", base, "schema", "fixture-hollow.json");
    try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (_) { /* try the next */ }
  }
  return null;                       // the Python side skips the car rows and says why
}
const CAR = loadCar();

// `body` groups cases for CALIBRATION. A dual contour's edge rounding is a property of the
// SHAPE, not a constant: a box loses ~3.1% to twelve sharp edges and a traced car ~0.5%,
// because a car is mostly curve. One global deficit would under-correct the block or
// over-correct the car, so each body carries its own solid and is compared against that.
const CASES = {
  "block solid":             {body:"block", p:{}},
  "block hollow w5":         {body:"block", p:{hullHollow:true, wallThickness:5}},
  "block hollow w5 floor15": {body:"block", p:{hullHollow:true, wallThickness:5, wallTop:5, wallSide:5, wallBottom:15}},
  "block hollow w5 roof15":  {body:"block", p:{hullHollow:true, wallThickness:5, wallTop:15, wallSide:5, wallBottom:5}},
  "block hollow w5 side12":  {body:"block", p:{hullHollow:true, wallThickness:5, wallTop:5, wallSide:12, wallBottom:5}},
  "block hollow w5 open":    {body:"block", p:{hullHollow:true, wallThickness:5, closedBottom:false, openUnderside:true}},
  "block hollow w14 open":   {body:"block", p:{hullHollow:true, wallThickness:14, closedBottom:false, openUnderside:true}},
  // A pocket SHALLOWER than the wall is the control: it cannot break through at either end, so
  // a gap here would be something else entirely and not the divergence being watched.
  // CARVING A SOLID IS THE CONTROL, and it is the only pocket case the two ends agree on.
  // Both simply remove the prism: the studio measured 4.60 cm3 against the kernel's 4.80, a 4%
  // grid difference. Every HOLLOW pocket case diverges, including a shallow one, because this
  // end pushes the cavity down to keep the wall and the kernel does not — so without a solid
  // pair the feature-delta check would report every row and prove nothing.
  "block solid pocket5":     {body:"block", p:{hullHollow:false, features:POCKET(-5)}},
  "block hollow w5 pocket2": {body:"block", p:{hullHollow:true, wallThickness:5, features:POCKET(-2)}},
  // And one AS DEEP as the wall. This end pushes the cavity down and keeps the wall; the kernel
  // cuts into the cavity and leaves a hole. Measured: a ray up the pocket centre finds the roof
  // 35.0-40.0 in the kernel without it, and NOTHING with it.
  "block hollow w5 pocket5": {body:"block", p:{hullHollow:true, wallThickness:5, features:POCKET(-5)}},

  // THE REAL CAR: 200mm, 153 pockets at 2.5mm, open underside, as saved at a 4.2mm wall.
  "car solid":               {body:"car", car:true, p:{hullHollow:false, features:null}},
  "car hollow w4.2":         {body:"car", car:true, p:{hullHollow:true}},
  // Collin's own configuration. The wall drops BELOW the pocket depth, which is the regime no
  // library fixture reaches as saved and the one his working model is actually in.
  "car hollow w2.1":         {body:"car", car:true,
                              p:{hullHollow:true, wallThickness:2.1, wallTop:2.1, wallSide:2.1, wallBottom:2.1}},
  "car hollow w2.1 nofeat":  {body:"car", car:true,
                              p:{hullHollow:true, wallThickness:2.1, wallTop:2.1, wallSide:2.1, wallBottom:2.1,
                                 features:null}},
};

const out = {};
for (const [name, c] of Object.entries(CASES)) {
  if (c.car && !CAR) { out[name] = {body: c.body, skipped: "LEE3D-Lib is not checked out beside this repo"}; continue; }
  try {
    const base = c.car ? { ...CAR, hullQuality:"normal" } : BLOCK;
    const g = API.makeVisualHull({ ...base, ...c.p });
    const P = g.positions;
    let lo = [1e9,1e9,1e9], hi = [-1e9,-1e9,-1e9];
    for (let i = 0; i < P.length; i += 3)
      for (let k = 0; k < 3; k++) { if (P[i+k] < lo[k]) lo[k] = P[i+k]; if (P[i+k] > hi[k]) hi[k] = P[i+k]; }
    out[name] = { body: c.body, cm3: +(g.volume/1000).toFixed(3), res: g.hullRes,
                  bbox: [0,1,2].map(k => +(hi[k]-lo[k]).toFixed(3)) };
  } catch (e) {
    out[name] = { body: c.body, error: String(e && e.message || e) };
  }
}
console.log(JSON.stringify({ missing: MISSING, cases: out }, null, 2));
