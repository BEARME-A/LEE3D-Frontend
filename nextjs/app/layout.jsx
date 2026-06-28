export const metadata = {
  title: "LEE3D — Car Body Studio",
  description: "Turn 2D drawings into 3D-printable car bodies. Free.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0, height: "100vh", display: "flex", flexDirection: "column",
        background: "#0B0F14", color: "#C9D6E5",
        fontFamily: "Inter, system-ui, sans-serif",
      }}>
        <nav style={{
          height: 46, flex: "0 0 auto", display: "flex", alignItems: "center", gap: 18,
          padding: "0 16px", borderBottom: "1px solid rgba(120,160,200,.14)",
          background: "linear-gradient(180deg,#0E151E,#0B1018)",
        }}>
          <span style={{ fontWeight: 700, letterSpacing: ".02em" }}>
            LEE3D <span style={{ color: "#FF7A2F" }}>/</span> Studio
          </span>
          <a href="./" style={navLink}>Studio</a>
          <a href="gallery/" style={navLink}>Library</a>
          <span style={{ flex: 1 }} />
          <a href="https://github.com/BEARME-A/LEE3D-Lib" style={navLink}>LEE3D-Lib ↗</a>
        </nav>
        <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
      </body>
    </html>
  );
}

const navLink = {
  color: "#71839A", textDecoration: "none", fontSize: 13,
  padding: "4px 8px", borderRadius: 6,
};
