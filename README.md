# LEE3D-Frontend — Car Body Studio

Turn a 2D side-view drawing into a **3D-printable car body**, in the browser, for
free. Import a drawing (PDF page screenshot, photo, or export), set scale, trace
the roofline and sill, dial in the stance and the wheels you already own, and
export a watertight STL for your slicer.

Live app: enable Pages on this repo (below) →
`https://bearme-a.github.io/LEE3D-Frontend/`

![pipeline](https://img.shields.io/badge/pipeline-2D%20drawing%20%E2%86%92%203D%20shell%20%E2%86%92%20STL-FF7A2F)

## What's in here

| File | What it is |
|---|---|
| `index.html` | **The whole app, in one file, no build step.** Three.js loft, live STL export, drawing tracing, manifold sign-off. This is what deploys to Pages. |
| `nextjs/` | Optional: the Next.js + React Three Fiber project you specified, with a library gallery. Embeds the studio today; a clean place to grow. |

## Run it

**Right now, locally:** open `index.html` in any modern browser. That's it.

**Deploy free on GitHub Pages (no build, recommended):**
1. Push `index.html` to this repo.
2. Settings → Pages → Build and deployment → Source: **Deploy from a branch** →
   Branch: `main` / `(root)` → Save.
3. Visit `https://bearme-a.github.io/LEE3D-Frontend/`.

## How to use it

### Import a multi-view blueprint (the fast path)
Got one image with several views on it — like a side/front/rear/top blueprint?
Use the **Import Sheet** tab:

1. **Load the sheet** (button or drag-and-drop). One file, all the views.
2. **Auto-detect views** — each view is cut out as an editable box. The tool
   guesses which is the *side* and which is the *top*; the title strip is
   excluded automatically.
3. **Fix the boxes** if needed — drag to move, drag a corner to resize, use the
   dropdown to set each box's role (side / top / front / rear / ignore), or
   add/delete boxes. Getting the cut-outs right is what makes the result good.
4. **Pick units and set scale** — choose mm / cm / in / px, click **Set scale**,
   click two points a known distance apart, and type the real distance. (In px
   mode, 1 px = 1 unit and no calibration is needed.)
5. **Build model from sheet** — the side view becomes the roofline + sill, the
   top view becomes the real width, and you jump to the 3D preview. Re-edit the
   boxes and rebuild any time.

*Validated on a real Lamborghini Countach blueprint: 5 views segmented, model
came out watertight.* Front/rear views are detected and labelable now; using
them to shape the cross-section is the next step. PDF? Screenshot a page (or use
the backend's `/import/pdf`) and load that image.

### Or build it by hand (full control)

1. **Pick a preset** (Hot rod / Coupe / Sedan / SUV) — you get a real body
   immediately, before any drawing.
2. **Load a drawing** (section 02, or drag it onto the *Reference & Trace* tab).
3. **Set scale**: click two points a known distance apart, type the real length
   (mm). Every dimension is now true to size.
4. **Trace the side view** — top edge and lower edge. Those drive the silhouette.
5. **Trace a top view (optional, for real width)** — flip the view switch to
   *Top view*, set its scale, and trace the left and right edges of the plan
   outline. The width curve is derived from the actual drawing instead of
   sliders. This matches how your friend works: each view drawn separately.
6. **Set the wheels** to the chassis your friend already has — wheelbase, track,
   radius, ride height. The arches are cut to clear them.
7. **Export STL** for the slicer, or **Profile JSON** to send to the backend.

### Connect the backend (optional)
In *Export & library*, set the **Backend URL** (default `http://localhost:8000`)
once `LEE3D-Backend-A` is running. Then **Save profile to library** commits this
profile into `LEE3D-Lib`, and **Build on server** runs the CadQuery pipeline
(true wheel openings + shelling) and downloads a **STEP**. No backend? Both fall
back to a local download. (Serve the studio from `localhost:3000` or add your
origin to the backend's `LEE3D_CORS_ORIGINS`.)

The header shows a live **PRINT-READY** stamp. It isn't decoration — it runs a
real manifold check (every edge shared by exactly two triangles) on the mesh
before you export. Watertight in, watertight out.

## What the studio does vs. what the backend adds

The browser builds an **open-bottom thin shell** by lofting cross-sections and
offsetting them to a wall thickness — genuinely printable and verified
watertight. The Python backend (`LEE3D-Backend-A`) does the heavier B-rep work:
**true boolean-cut wheel openings**, OpenCascade shelling, **STEP** export (so
the body stays editable in any CAD tool), and committing drawings + STLs into
`LEE3D-Lib`. Same `profile.json` feeds both.

## Growing into the Next.js + React Three Fiber stack

The `nextjs/` folder is a working Next.js (App Router) project that:
- serves the studio at `/` (via `public/studio.html`), and
- adds a **/gallery** page that reads a project manifest from `LEE3D-Lib`.

```bash
cd nextjs
npm install
npm run dev          # http://localhost:3000
npm run build        # static export to ./out  (output: 'export')
```

To port the modeler to **native R3F**, the seam is clean: the geometry core in
`index.html` (`makeBody(profile)` → `{positions, indices}`) is framework-free.
Drop it into a `<Canvas>` and feed `positions`/`indices` to a
`<bufferGeometry>`; the UI sliders become React state. Nothing about the math
changes — it's already validated.

> Tip: keep `index.html` and `nextjs/public/studio.html` in sync (same file), or
> symlink one to the other in your checkout.
