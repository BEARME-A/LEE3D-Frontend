# LEE3D — Architecture &amp; the honest case

A free, end-to-end pipeline for turning hand-drawn 2D car side-views into
3D-printable bodies that drop onto a chassis you already own. Three repos, one
data format, zero software cost.

```
                         profile.json (one shared schema)
                    ┌──────────────────────────────────────┐
                    ▼                                        ▼
┌──────────────────────────┐   STL/STEP   ┌──────────────────────────┐
│  LEE3D-Frontend          │ ───────────▶ │  LEE3D-Backend-A         │
│  Next.js · Three.js · R3F│              │  FastAPI · CadQuery      │
│  • import PDF/CSV/JSON/img│ ◀─────────── │  • OpenCascade · OpenCV  │
│  • trace + parametrize    │  outline/    │  • boolean wheel cuts    │
│  • live 3D + STL export   │  pages       │  • STEP + shelling       │
└─────────────┬────────────┘              └─────────────┬────────────┘
              │  drawings, profiles, bodies             │
              └──────────────────┬──────────────────────┘
                                 ▼
                   ┌──────────────────────────┐
                   │  LEE3D-Lib (a git repo)  │
                   │  drawings/ photos/ json/ │
                   │  generated/ exports/     │
                   │  versions/ + schema/     │
                   └──────────────────────────┘
```

Repos:
`BEARME-A/LEE3D-Frontend` · `BEARME-A/LEE3D-Backend-A` · `BEARME-A/LEE3D-Lib`

## The pipeline

Your friend draws each side first, then builds up a 3D model. This mirrors that
exact workflow:

1. **Side view in.** Drop a drawing/scan/photo into the studio. Set scale with
   two clicks and one known dimension — now everything is true to size.
2. **Trace into a profile.** The roofline becomes the upper silhouette, the
   rocker becomes the lower silhouette, and a width curve gives the body its
   plan shape. That's saved as `profile.json` — the one format every part of the
   system reads.
3. **Loft into a body.** Cross-sections are swept along the length into an
   **open-bottom shell** with a real wall thickness, and wheel arches are cut to
   clear the wheels on your chassis. The browser does this live and exports a
   **watertight STL**.
4. **Production pass (optional).** Send the same `profile.json` to the backend
   for **true boolean-cut wheel openings**, OpenCascade shelling, and **STEP**
   output so the body stays editable in any CAD tool — then commit drawings and
   bodies into `LEE3D-Lib`.

A car body is well-suited to this: it's mostly a smooth lofted surface with
arches, which is exactly what cross-section lofting is good at.

## Why this is genuinely free

| Piece | Cost | How |
|---|---|---|
| The studio (frontend) | **$0** | One static `index.html` on GitHub Pages. No server. |
| The library | **$0** | A normal GitHub repo. Free history, diffs, rollback. |
| The CAD backend | **$0 local** | `docker build` + `docker run` on your own machine — always on, no limits. |
| The CAD backend (cloud, optional) | **$0 / mo free tier** | `render.yaml` deploys it; the free instance sleeps when idle. |
| The software | **$0, forever** | Three.js, FastAPI, CadQuery, OpenCascade, OpenCV — all open source, all yours. |

The only thing money buys here is an *always-on cloud server*, and even that has
a free tier — and you don't need it, because the heavy CAD work runs free on
your own computer via Docker. The browser studio needs no server at all.

## The honest case to make to your friend

This isn't "free tools beat paid CAD at everything." They don't, and pretending
otherwise would set him up to be disappointed. The fair, true argument is
narrower and stronger:

- **For this specific, repeatable job** — bodies for chassis he already has —
  a purpose-built pipeline produces printable parts at **zero software cost**.
- **He owns it.** No license, no subscription, no vendor lock. The body is also
  exported as **STEP**, so it opens in literally any CAD package later.
- **It's reproducible.** Every drawing, profile, and STL is version-controlled
  in `LEE3D-Lib`. He can diff two versions of a roofline or roll back a fender.
- **It scales to many cars cheaply.** Once the pipeline exists, the marginal
  cost of the next body is the filament — the tooling cost stays $0.

Paid CAD earns its price when you need full freeform surfacing, parametric
history with constraints, fillet/draft/blend operations, assemblies, drawings,
and simulation. If he wants those, he should pay for them — that's a real value.
But "I must use a paid system to model a car body for printing" isn't true, and
this repo is the proof you can hand him and run in front of him.

## What's solid vs. what's hard (no spin)

**Solid and verified:**
- The browser geometry produces a **watertight, manifold** mesh — checked
  programmatically (every edge shared by exactly two triangles; positive signed
  volume; valid binary STL). The shipped example body is 21,056 triangles, zero
  open edges.
- **The blueprint importer is validated on a real multi-view sheet.** Fed an
  actual Lamborghini Countach LP5000&nbsp;S blueprint (side, front, rear, top,
  and a second side on one image), it auto-segments **all five car views**,
  excludes the title strip, and the per-column edge extraction pulls the
  roofline, sill, and top-view width. The whole chain — import → cut-out →
  extract → build — yields a **watertight, printable model** end to end (verified
  in Node on the real file, using the exact algorithms the browser runs).
- The backend API is tested end-to-end (routes, schema validation, storage,
  graceful degradation when the CAD kernel is absent).

**Genuinely hard — and handled honestly rather than overpromised:**
- **Cutting the views out is automatic, but you can fix every box.** Detection is
  connected-components on a coarse ink grid — robust on clean blueprints, but a
  noisy scan or overlapping views can mis-cut. So the boxes are **fully editable**
  (drag, resize, re-label side/top/front/rear, add, delete) before you build.
  This is the "keep a human in the loop now, automate later" path you asked for.
- **Reading dimensions off a drawing automatically is not reliable.** OCR-ing
  hand-drawn dimension lines into a parametric model is a research problem. So
  you **set scale yourself** with two clicks and pick the unit (mm / cm / in /
  px). A wrong auto-scale wastes filament.
- **A side view is a silhouette; a top view gives real width.** The importer
  feeds both into the model automatically: side → roofline + sill, top → width
  curve. **Front/rear are detected and labelable but not yet used** to shape the
  cross-section — that's the next math step (front view → section roundness).
- **Edge extraction picks the outermost ink per column.** That means the side
  "sill" follows the ground line if it's inside the crop (a flat underside —
  fine for an open-bottom shell, trim the box to exclude it), and the roofline
  includes the wing. Good enough to build from; refine the crop or hand-trace to
  taste. The model stays watertight regardless of the exact curve.
- **The browser body is an approximation, not a B-rep kernel.** It's a lofted
  shell — great for printing, not for fillets/drafts/boolean trees. The backend
  (OpenCascade) is where real solid modeling happens; that's the division of
  labor on purpose.
- **PDF isn't parsed in the browser yet.** Screenshot a page (or use the
  backend's `/import/pdf`, which rasterizes pages to PNG) and load that image.
- **CAD kernels are finicky.** Some shell/boolean operations need parameter
  tweaks on extreme shapes; the backend catches failures and falls back rather
  than crashing, and tells you what happened.

## Quickstart

**Frontend (studio):**
```bash
# zero build — just open it
open LEE3D-Frontend/index.html
# or deploy: push, then Settings → Pages → Deploy from branch → main /(root)
```

**Backend (CAD + storage):**
```bash
cd LEE3D-Backend-A
conda env create -f environment.yml && conda activate lee3d   # gets OpenCascade
uvicorn app.main:app --reload --port 8000                      # http://localhost:8000/docs
# or: docker build -t lee3d . && docker run -p 8000:8000 -v $PWD/data:/data lee3d
```

**Generate a body from a profile:**
```bash
curl -X POST "http://localhost:8000/generate?fmt=step" \
     -H "Content-Type: application/json" \
     --data @LEE3D-Lib/projects/example-charger/example-charger.profile.json \
     -o charger.step
```

**Library:** push `LEE3D-Lib` as-is; the folders and the worked example are
ready. Set `LEE3D_GITHUB_TOKEN` (a fine-grained PAT, Contents read+write on
`LEE3D-Lib`) to let the backend commit drawings and bodies for you.

## The shared contract

Everything hinges on one format: `profile.json`, defined in
`LEE3D-Lib/schema/profile.schema.json` and mirrored by the Pydantic model in the
backend and the export in the frontend. Same file in, same body out — across all
three repos. That's what makes this a system rather than three scripts.
