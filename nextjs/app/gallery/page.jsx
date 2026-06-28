"use client";
import { useEffect, useState } from "react";

// Reads a project manifest straight from the LEE3D-Lib repo. Swap in any project
// slug; this is the seam where the frontend reads the version-controlled library.
const OWNER = "BEARME-A";
const REPO = "LEE3D-Lib";
const PROJECT = "example-charger";
const RAW = `https://raw.githubusercontent.com/${OWNER}/${REPO}/main`;
const MANIFEST_URL = `${RAW}/projects/${PROJECT}/manifest.json`;

const KIND_COLOR = {
  drawing: "#46B7D9", photo: "#46B7D9", json: "#E5B45B",
  generated: "#5BD6A0", export: "#FF7A2F", version: "#71839A",
};

export default function Gallery() {
  const [manifest, setManifest] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(MANIFEST_URL)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setManifest)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <main style={{ padding: 24, height: "100%", overflow: "auto", boxSizing: "border-box" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Model Library</h1>
      <p style={{ color: "#71839A", marginTop: 0, fontSize: 13 }}>
        Live from <code>{OWNER}/{REPO}</code> — project <b>{PROJECT}</b>.
      </p>

      {error && (
        <div style={card}>
          Couldn&apos;t load the manifest ({error}). That&apos;s expected until you
          push <code>LEE3D-Lib</code> with the example project. The wiring is here
          and ready.
        </div>
      )}

      {!manifest && !error && <div style={{ color: "#71839A" }}>Loading…</div>}

      {manifest && (
        <>
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{manifest.title || manifest.project}</div>
            {manifest.chassis && (
              <div style={{ color: "#71839A", fontSize: 12.5, marginTop: 6 }}>
                Chassis: {manifest.chassis.name} · scale {manifest.chassis.scale} ·
                wheelbase {manifest.chassis.wheelbase_mm}mm · track {manifest.chassis.track_mm}mm
              </div>
            )}
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            {(manifest.artifacts || []).map((a, i) => (
              <a key={i} href={`${RAW}/${a.path}`} style={{ ...card, textDecoration: "none", color: "inherit", display: "block" }}>
                <span style={{
                  fontFamily: "monospace", fontSize: 10, padding: "2px 7px", borderRadius: 4,
                  color: KIND_COLOR[a.kind] || "#71839A",
                  border: `1px solid ${KIND_COLOR[a.kind] || "#71839A"}33`,
                }}>{a.kind}</span>
                <span style={{ marginLeft: 10, fontFamily: "monospace", fontSize: 13 }}>{a.path}</span>
                {a.note && <div style={{ color: "#71839A", fontSize: 12, marginTop: 6 }}>{a.note}</div>}
              </a>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

const card = {
  background: "#111824", border: "1px solid rgba(120,160,200,.14)",
  borderRadius: 10, padding: "14px 16px",
};
