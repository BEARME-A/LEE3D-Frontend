# LEE3D-Frontend (Next.js shell)

Optional React stack for the studio. Today it serves the working studio at `/`
(from `public/studio.html`) and adds a **/gallery** page that reads a project
manifest from `LEE3D-Lib`.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # static export -> ./out
```

## Deploy to GitHub Pages
Copy `github-pages.yml` into `.github/workflows/` at the repo root, push, then
Settings → Pages → Source: **GitHub Actions**. (Use *either* this OR the
zero-build root `index.html` deploy — not both.)

## Porting the modeler to native R3F
`makeBody(profile)` in `public/studio.html` returns `{ positions, indices }` and
has zero framework dependencies. In an R3F `<Canvas>`:
```jsx
const geom = useMemo(() => {
  const { positions, indices } = makeBody(profile);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices); g.computeVertexNormals();
  return g;
}, [profile]);
return <mesh geometry={geom}><meshStandardMaterial/></mesh>;
```
The sliders become React state; the math is already validated.
