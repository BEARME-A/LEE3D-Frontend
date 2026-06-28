// The studio is a self-contained, validated app. We mount it full-bleed.
// (Port to native React Three Fiber later — see README; the geometry core is
// already framework-free.)
export default function Home() {
  return (
    <iframe
      src="studio.html"
      title="LEE3D Car Body Studio"
      style={{ width: "100%", height: "100%", border: "none", display: "block" }}
    />
  );
}
