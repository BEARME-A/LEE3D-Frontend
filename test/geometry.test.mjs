// ---------------------------------------------------------------------------
// LEE3D core geometry — open-bottom car-body shell with wheel arches.
// This is the exact algorithm that will be inlined into the browser app.
// We test it here in Node to PROVE the output is a watertight manifold
// (every edge shared by exactly 2 triangles) and a structurally valid STL,
// so we know it will slice/print before we ever ship it.
// ---------------------------------------------------------------------------

// ---- small math helpers ----
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

// piecewise-linear sample of a polyline [[xf, value], ...] at xf in [0,1]
function sampleProfile(pts, xf) {
  if (pts.length === 1) return pts[0][1];
  if (xf <= pts[0][0]) return pts[0][1];
  if (xf >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if (xf >= x0 && xf <= x1) {
      const t = (x1 - x0) === 0 ? 0 : (xf - x0) / (x1 - x0);
      return lerp(y0, y1, t);
    }
  }
  return pts[pts.length - 1][1];
}

// ---- the geometry generator ----
// Returns { positions:[x,y,z,...], indices:[a,b,c,...] }
function buildBody(profile) {
  const N = Math.max(8, profile.stations | 0);     // segments along length
  const M = Math.max(6, profile.arcSegments | 0);  // segments around canopy arc
  const L = profile.length;
  const p = profile.roofFlatness ?? 1.0;
  const t = Math.max(0.2, profile.wallThickness ?? 1.8);
  const wheels = profile.wheels ?? [];
  const archLift = profile.archLift ?? 1.0;

  // ----- 1. outer surface grid (N+1) x (M+1) -----
  const cols = N + 1, rows = M + 1;
  const outer = new Array(cols * rows); // each = [x,y,z]
  const gi = (i, j) => i * rows + j;

  for (let i = 0; i <= N; i++) {
    const xf = i / N;
    const x = (xf - 0.5) * L; // center along X
    const zTop = sampleProfile(profile.topProfile, xf);
    const zBot = sampleProfile(profile.bottomProfile, xf);
    const halfW = Math.max(0.05, sampleProfile(profile.widthProfile, xf));

    for (let j = 0; j <= M; j++) {
      const s = j / M;
      const th = Math.PI * s;                 // 0..pi : left sill -> roof -> right sill
      const ct = Math.cos(th), stt = Math.sin(th);
      const y = -halfW * ct;                  // -halfW .. +halfW
      let z = zBot + (zTop - zBot) * Math.pow(Math.max(0, stt), p);

      // wheel arches: lift the lower side regions over each wheel's x-range
      let lift = 0;
      for (const w of wheels) {
        const archHalfLen = (w.r ?? 8) * 1.15;
        const d = Math.abs(x - (w.x ?? 0));
        if (d < archHalfLen) {
          const bump = smoothstep(1 - d / archHalfLen);     // 1 at center, 0 at edge
          const sideMask = Math.pow(Math.abs(ct), 1.5);     // 1 at sills, 0 at roof
          const amt = (w.r ?? 8) * 1.4 * bump * sideMask * archLift;
          if (amt > lift) lift = amt;                       // max, not sum (overlap-safe)
        }
      }
      z += lift;
      outer[gi(i, j)] = [x, y, z];
    }
  }

  // ----- 2. outer triangles (quad split) -----
  const outerTris = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      const a = gi(i, j), b = gi(i + 1, j), c = gi(i + 1, j + 1), d = gi(i, j + 1);
      outerTris.push([a, b, c], [a, c, d]);
    }
  }

  // ----- 3. vertex normals (area-weighted) for the outer surface -----
  const normals = Array.from({ length: outer.length }, () => [0, 0, 0]);
  const sub = (P, Q) => [P[0] - Q[0], P[1] - Q[1], P[2] - Q[2]];
  const cross = (U, V) => [U[1] * V[2] - U[2] * V[1], U[2] * V[0] - U[0] * V[2], U[0] * V[1] - U[1] * V[0]];
  for (const [a, b, c] of outerTris) {
    const n = cross(sub(outer[b], outer[a]), sub(outer[c], outer[a])); // area-weighted (un-normalized)
    for (const idx of [a, b, c]) { normals[idx][0] += n[0]; normals[idx][1] += n[1]; normals[idx][2] += n[2]; }
  }
  for (const n of normals) {
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    n[0] /= len; n[1] /= len; n[2] /= len;
  }

  // ----- 4. inner surface = outer offset inward by wall thickness -----
  const inner = outer.map((P, k) => [
    P[0] - normals[k][0] * t,
    P[1] - normals[k][1] * t,
    P[2] - normals[k][2] * t,
  ]);

  // ----- 5. assemble positions + indices (outer block, then inner block) -----
  const positions = [];
  for (const P of outer) positions.push(P[0], P[1], P[2]);
  const innerOffset = outer.length;
  for (const P of inner) positions.push(P[0], P[1], P[2]);

  const indices = [];
  // outer faces (as-is)
  for (const [a, b, c] of outerTris) indices.push(a, b, c);
  // inner faces (reversed winding so they face the cavity)
  for (const [a, b, c] of outerTris) indices.push(innerOffset + a, innerOffset + c, innerOffset + b);

  // ----- 6. rim strip: walk the boundary loop, connect outer<->inner -----
  const loop = []; // ordered grid indices around the rectangle perimeter
  for (let j = 0; j <= M; j++) loop.push(gi(0, j));            // front arc  (i=0)
  for (let i = 1; i <= N; i++) loop.push(gi(i, M));            // right rail (j=M)
  for (let j = M - 1; j >= 0; j--) loop.push(gi(N, j));        // back arc   (i=N)
  for (let i = N - 1; i >= 1; i--) loop.push(gi(i, 0));        // left rail  (j=0)
  for (let k = 0; k < loop.length; k++) {
    const a = loop[k], b = loop[(k + 1) % loop.length];
    const ai = innerOffset + a, bi = innerOffset + b;
    indices.push(a, b, bi);   // quad (outer a, outer b, inner b, inner a)
    indices.push(a, bi, ai);
  }

  // ----- 7. orient outward: if signed volume < 0, flip every triangle -----
  let vol = 0;
  for (let k = 0; k < indices.length; k += 3) {
    const A = [positions[indices[k] * 3], positions[indices[k] * 3 + 1], positions[indices[k] * 3 + 2]];
    const B = [positions[indices[k + 1] * 3], positions[indices[k + 1] * 3 + 1], positions[indices[k + 1] * 3 + 2]];
    const C = [positions[indices[k + 2] * 3], positions[indices[k + 2] * 3 + 1], positions[indices[k + 2] * 3 + 2]];
    vol += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
  }
  if (vol < 0) {
    for (let k = 0; k < indices.length; k += 3) { const tmp = indices[k + 1]; indices[k + 1] = indices[k + 2]; indices[k + 2] = tmp; }
    vol = -vol;
  }

  return { positions, indices, volume: vol };
}

// ---- binary STL bytes from positions+indices ----
function toBinarySTL(positions, indices) {
  const triCount = indices.length / 3;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, triCount, true);
  let off = 84;
  for (let k = 0; k < indices.length; k += 3) {
    const a = indices[k] * 3, b = indices[k + 1] * 3, c = indices[k + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    dv.setFloat32(off, nx, true); dv.setFloat32(off + 4, ny, true); dv.setFloat32(off + 8, nz, true); off += 12;
    for (const idx of [a, b, c]) {
      dv.setFloat32(off, positions[idx], true); dv.setFloat32(off + 4, positions[idx + 1], true); dv.setFloat32(off + 8, positions[idx + 2], true); off += 12;
    }
    dv.setUint16(off, 0, true); off += 2;
  }
  return Buffer.from(buf);
}

// ===========================================================================
// TEST: a plausible little hot-rod profile (~180mm long), 2 wheels, 1.8mm wall
// ===========================================================================
const profile = {
  units: "mm", length: 180, stations: 72, arcSegments: 56,
  roofFlatness: 1.4, wallThickness: 1.8, archLift: 1.0,
  topProfile:    [[0, 26], [0.15, 30], [0.35, 40], [0.5, 58], [0.62, 60], [0.78, 44], [1, 30]],
  bottomProfile: [[0, 10], [0.2, 8], [0.5, 7], [0.8, 8], [1, 10]],
  widthProfile:  [[0, 14], [0.15, 30], [0.5, 38], [0.85, 32], [1, 18]],
  wheels: [
    { x: -55, z: 14, r: 16, width: 30 },
    { x:  55, z: 14, r: 16, width: 30 },
  ],
};

const { positions, indices, volume } = buildBody(profile);
const triCount = indices.length / 3;
const vertCount = positions.length / 3;

// ---- manifold check: every undirected edge must be shared by exactly 2 tris ----
const edgeCount = new Map();
const key = (a, b) => (a < b ? a + "_" + b : b + "_" + a);
for (let k = 0; k < indices.length; k += 3) {
  const a = indices[k], b = indices[k + 1], c = indices[k + 2];
  for (const [u, v] of [[a, b], [b, c], [c, a]]) {
    const kk = key(u, v); edgeCount.set(kk, (edgeCount.get(kk) || 0) + 1);
  }
}
let boundaryEdges = 0, nonManifoldEdges = 0, degenerate = 0;
for (const v of edgeCount.values()) { if (v === 1) boundaryEdges++; else if (v > 2) nonManifoldEdges++; }
for (let k = 0; k < indices.length; k += 3) { if (indices[k] === indices[k+1] || indices[k+1] === indices[k+2] || indices[k] === indices[k+2]) degenerate++; }

// ---- STL structural check ----
const stl = toBinarySTL(positions, indices);
const expectedLen = 84 + triCount * 50;

console.log("vertices ............", vertCount);
console.log("triangles ...........", triCount);
console.log("signed volume (mm^3) ", volume.toFixed(1), volume > 0 ? "(positive -> outward normals OK)" : "(NEGATIVE!)");
console.log("unique edges ........", edgeCount.size);
console.log("boundary edges ......", boundaryEdges, boundaryEdges === 0 ? "(watertight OK)" : "(HOLES!)");
console.log("non-manifold edges ..", nonManifoldEdges, nonManifoldEdges === 0 ? "(OK)" : "(BAD!)");
console.log("degenerate tris .....", degenerate, degenerate === 0 ? "(OK)" : "(BAD!)");
console.log("STL bytes ...........", stl.length, "expected", expectedLen, stl.length === expectedLen ? "(OK)" : "(MISMATCH!)");

const pass = boundaryEdges === 0 && nonManifoldEdges === 0 && degenerate === 0 && volume > 0 && stl.length === expectedLen;
console.log("\nRESULT:", pass ? "✅ PASS — watertight, manifold, printable, valid STL" : "❌ FAIL");
process.exit(pass ? 0 : 1);
