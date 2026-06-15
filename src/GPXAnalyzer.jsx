// GPXAnalyzer.jsx — Drop-in replacement for AITab in App.jsx
// Integrates with existing T theme, Card, Badge, Pill, Btn, NInput components

import { useState, useRef, useEffect } from "react";

// ─── Haversine distance ───────────────────────────────────────────────────────
function haversine(p1, p2) {
  const R = 6371000;
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLon = ((p2.lon - p1.lon) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((p1.lat * Math.PI) / 180) *
      Math.cos((p2.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Parse GPX file ───────────────────────────────────────────────────────────
function parseGPX(text, fileName) {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  const trkpts = Array.from(doc.querySelectorAll("trkpt"));
  if (!trkpts.length) return null;

  const points = trkpts.map((pt) => ({
    lat: parseFloat(pt.getAttribute("lat")),
    lon: parseFloat(pt.getAttribute("lon")),
    ele: parseFloat(pt.querySelector("ele")?.textContent || 0),
    time: pt.querySelector("time")?.textContent || null,
  }));

  // Total distance
  let totalDist = 0;
  const cumDist = [0];
  for (let i = 1; i < points.length; i++) {
    const d = haversine(points[i - 1], points[i]);
    totalDist += d;
    cumDist.push(totalDist);
  }

  // Elevation stats
  let ascent = 0, descent = 0;
  for (let i = 1; i < points.length; i++) {
    const diff = points[i].ele - points[i - 1].ele;
    if (diff > 0.5) ascent += diff;
    else if (diff < -0.5) descent += Math.abs(diff);
  }
  const eles = points.map((p) => p.ele);
  const minEle = Math.min(...eles);
  const maxEle = Math.max(...eles);

  // Duration
  let duration = null;
  if (points[0].time && points[points.length - 1].time) {
    duration = Math.round(
      (new Date(points[points.length - 1].time) - new Date(points[0].time)) / 60000
    );
  }

  const distKm = Math.round(totalDist / 100) / 10;
  const avgSpeed = duration ? Math.round((distKm / (duration / 60)) * 10) / 10 : null;

  // Elevation profile (50 points)
  const profileCount = 50;
  const step = Math.max(1, Math.floor(points.length / profileCount));
  const elevProfile = [];
  for (let i = 0; i < points.length; i += step) {
    elevProfile.push({
      dist: Math.round((cumDist[i] / 1000) * 10) / 10,
      ele: Math.round(points[i].ele),
    });
  }
  if (elevProfile[elevProfile.length - 1].dist !== distKm) {
    elevProfile.push({ dist: distKm, ele: Math.round(points[points.length - 1].ele) });
  }

  // Gradient segments (500m buckets)
  const segmentSize = 500;
  const gradients = [];
  let segStartIdx = 0;
  for (let i = 1; i < points.length; i++) {
    const segDist = cumDist[i] - cumDist[segStartIdx];
    if (segDist >= segmentSize || i === points.length - 1) {
      const eleDiff = points[i].ele - points[segStartIdx].ele;
      const grad = segDist > 0 ? (eleDiff / segDist) * 100 : 0;
      gradients.push({
        distKm: Math.round((cumDist[i] / 1000) * 10) / 10,
        gradient: Math.round(grad * 10) / 10,
        ele: Math.round(points[i].ele),
      });
      segStartIdx = i;
    }
  }

  // Gradient distribution
  const gradDist = {
    descent: gradients.filter((g) => g.gradient < -2).length * 0.5,
    flat: gradients.filter((g) => g.gradient >= -2 && g.gradient < 2).length * 0.5,
    easy: gradients.filter((g) => g.gradient >= 2 && g.gradient < 5).length * 0.5,
    moderate: gradients.filter((g) => g.gradient >= 5 && g.gradient < 8).length * 0.5,
    hard: gradients.filter((g) => g.gradient >= 8 && g.gradient < 12).length * 0.5,
    extreme: gradients.filter((g) => g.gradient >= 12).length * 0.5,
  };

  const maxGrad = Math.max(...gradients.map((g) => g.gradient));
  const avgGrad = gradients.length
    ? Math.round((gradients.reduce((a, b) => a + b.gradient, 0) / gradients.length) * 10) / 10
    : 0;
  const avgUphillGrad =
    gradients.filter((g) => g.gradient > 0).length > 0
      ? Math.round(
          (gradients.filter((g) => g.gradient > 0).reduce((a, b) => a + b.gradient, 0) /
            gradients.filter((g) => g.gradient > 0).length) *
            10
        ) / 10
      : 0;

  const name =
    doc.querySelector("name")?.textContent ||
    doc.querySelector("trk > name")?.textContent ||
    fileName?.replace(".gpx", "") ||
    "Traseu GPX";

  return {
    name,
    distKm,
    ascent: Math.round(ascent),
    descent: Math.round(descent),
    minEle: Math.round(minEle),
    maxEle: Math.round(maxEle),
    startEle: Math.round(points[0].ele),
    endEle: Math.round(points[points.length - 1].ele),
    duration,
    avgSpeed,
    elevProfile,
    gradients,
    gradDist,
    maxGrad: Math.round(maxGrad * 10) / 10,
    avgGrad,
    avgUphillGrad,
    pointCount: points.length,
  };
}

// ─── Elevation Chart (SVG) ────────────────────────────────────────────────────
function ElevChart({ profile, T, hoveredIdx, onHover }) {
  if (!profile?.length) return null;
  const W = 400, H = 100;
  const eles = profile.map((p) => p.ele);
  const minE = Math.min(...eles) - 20;
  const maxE = Math.max(...eles) + 20;
  const range = maxE - minE || 1;

  const toX = (i) => (i / (profile.length - 1)) * W;
  const toY = (ele) => H - ((ele - minE) / range) * (H - 10) - 5;

  const pts = profile.map((p, i) => `${toX(i)},${toY(p.ele)}`).join(" ");
  const polyPts = `0,${H} ${pts} ${W},${H}`;

  return (
    <div
      style={{
        background: T.hi,
        borderRadius: 12,
        padding: "12px 13px",
        marginBottom: 14,
        position: "relative",
      }}
    >
      <div
        style={{
          color: T.muted,
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          marginBottom: 8,
          letterSpacing: "0.08em",
        }}
      >
        Profil elevație
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: "block", cursor: "crosshair" }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W;
          const idx = Math.min(profile.length - 1, Math.max(0, Math.round((x / W) * (profile.length - 1))));
          onHover(idx);
        }}
        onMouseLeave={() => onHover(null)}
      >
        <defs>
          <linearGradient id="elev-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={T.accent} stopOpacity="0.5" />
            <stop offset="100%" stopColor={T.accent} stopOpacity="0.03" />
          </linearGradient>
        </defs>
        <polygon points={polyPts} fill="url(#elev-grad)" />
        <polyline points={pts} fill="none" stroke={T.accent} strokeWidth="2" strokeLinejoin="round" />
        {hoveredIdx !== null && (
          <>
            <line
              x1={toX(hoveredIdx)}
              y1={0}
              x2={toX(hoveredIdx)}
              y2={H}
              stroke={T.yellow}
              strokeWidth="1"
              strokeDasharray="3,3"
            />
            <circle
              cx={toX(hoveredIdx)}
              cy={toY(profile[hoveredIdx].ele)}
              r="4"
              fill={T.yellow}
              stroke={T.bg}
              strokeWidth="2"
            />
          </>
        )}
      </svg>
      {hoveredIdx !== null ? (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ color: T.yellow, fontSize: 11, fontWeight: 700 }}>
            {profile[hoveredIdx].dist} km
          </span>
          <span style={{ color: T.yellow, fontSize: 11, fontWeight: 700 }}>
            {profile[hoveredIdx].ele} m
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ color: T.muted, fontSize: 10 }}>{Math.round(minE + 20)} m</span>
          <span style={{ color: T.yellow, fontSize: 10, fontWeight: 700 }}>
            ↑ {profile[profile.length - 1]?.dist} km
          </span>
          <span style={{ color: T.muted, fontSize: 10 }}>{Math.round(maxE - 20)} m</span>
        </div>
      )}
    </div>
  );
}

// ─── Gradient Bar Chart ───────────────────────────────────────────────────────
function GradientChart({ gpx, T }) {
  const bars = [
    { label: "Coborâre\n<-2%", km: gpx.gradDist.descent, color: "#3b82f6" },
    { label: "Plat\n-2–2%", km: gpx.gradDist.flat, color: T.muted },
    { label: "Ușor\n2–5%", km: gpx.gradDist.easy, color: T.green },
    { label: "Moderat\n5–8%", km: gpx.gradDist.moderate, color: T.yellow },
    { label: "Dur\n8–12%", km: gpx.gradDist.hard, color: T.orange },
    { label: "Extrem\n>12%", km: gpx.gradDist.extreme, color: T.red },
  ];
  const maxKm = Math.max(...bars.map((b) => b.km), 1);

  return (
    <div style={{ background: T.hi, borderRadius: 12, padding: "12px 13px", marginBottom: 14 }}>
      <div
        style={{
          color: T.muted,
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          marginBottom: 10,
          letterSpacing: "0.08em",
        }}
      >
        Distribuție pante
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {bars.map((b, i) => (
          <div key={i}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 3,
              }}
            >
              <span style={{ color: T.text, fontSize: 11 }}>
                {b.label.split("\n")[0]}{" "}
                <span style={{ color: T.muted, fontSize: 10 }}>({b.label.split("\n")[1]})</span>
              </span>
              <span style={{ color: b.km > 0 ? b.color : T.muted, fontWeight: 700, fontSize: 11 }}>
                {b.km.toFixed(1)} km
              </span>
            </div>
            <div style={{ background: T.border, borderRadius: 4, height: 7, overflow: "hidden" }}>
              <div
                style={{
                  width: `${(b.km / maxKm) * 100}%`,
                  height: "100%",
                  background: b.color,
                  borderRadius: 4,
                  transition: "width 0.4s ease",
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Gradient Heatmap (mini) ──────────────────────────────────────────────────
function GradientHeatmap({ gradients, T }) {
  if (!gradients?.length) return null;
  const max = Math.max(...gradients.map((g) => Math.abs(g.gradient)), 1);

  const getColor = (g) => {
    if (g < -2) return "#3b82f6";
    if (g < 2) return T.muted;
    if (g < 5) return T.green;
    if (g < 8) return T.yellow;
    if (g < 12) return T.orange;
    return T.red;
  };

  return (
    <div style={{ background: T.hi, borderRadius: 12, padding: "12px 13px", marginBottom: 14 }}>
      <div
        style={{
          color: T.muted,
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          marginBottom: 8,
          letterSpacing: "0.08em",
        }}
      >
        Hartă pantă pe traseu
      </div>
      <div style={{ display: "flex", gap: 1, height: 20, borderRadius: 6, overflow: "hidden" }}>
        {gradients.map((g, i) => (
          <div
            key={i}
            title={`km ${g.distKm}: ${g.gradient}%`}
            style={{
              flex: 1,
              background: getColor(g.gradient),
              opacity: 0.7 + (Math.abs(g.gradient) / max) * 0.3,
            }}
          />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 5,
          flexWrap: "wrap",
          gap: 4,
        }}
      >
        {[
          { c: "#3b82f6", l: "Coborâre" },
          { c: T.green, l: "Ușor" },
          { c: T.yellow, l: "Moderat" },
          { c: T.orange, l: "Dur" },
          { c: T.red, l: "Extrem" },
        ].map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div
              style={{ width: 8, height: 8, borderRadius: 2, background: item.c, flexShrink: 0 }}
            />
            <span style={{ color: T.muted, fontSize: 9 }}>{item.l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── AI Analysis via Claude API ───────────────────────────────────────────────
async function getAIAnalysis(gpx, user) {
  const prompt = `Ești un antrenor de ciclism expert. Analizează acest traseu GPX și oferă recomandări CONCISE în română.

TRASEU: ${gpx.name}
- Distanță: ${gpx.distKm} km
- Urcare totală (D+): ${gpx.ascent} m  
- Coborâre (D-): ${gpx.descent} m
- Altitudine: ${gpx.startEle}m start → ${gpx.endEle}m finish (max ${gpx.maxEle}m)
- Pantă medie urcare: ${gpx.avgUphillGrad}%
- Pantă maximă: ${gpx.maxGrad}%
- Durată: ${gpx.duration ? gpx.duration + " min" : "necunoscută"}
- Distribuție pante: Plat=${gpx.gradDist.flat.toFixed(1)}km, Ușor=${gpx.gradDist.easy.toFixed(1)}km, Moderat=${gpx.gradDist.moderate.toFixed(1)}km, Dur=${gpx.gradDist.hard.toFixed(1)}km, Extrem=${gpx.gradDist.extreme.toFixed(1)}km

CICLIST: ${user?.name || "amator"}, ${user?.sex || "masculin"}, ${user?.age || 30} ani, ${user?.weight || 75}kg
HR Max: ${user?.hrMax || 185} bpm | FTP: ${user?.ftp || 220}W | Nivel: ${user?.level || "intermediar"}
Cursa țintă: ${user?.targetRace || "nespecificată"}

Răspunde STRICT în acest format JSON (fără markdown, fără explicații extra):
{
  "dificultate": "Ușor|Moderat|Dificil|Extrem",
  "scor_dificultate": 7,
  "rezumat": "2-3 propoziții despre caracter traseu",
  "puncte_cheie": ["aspect1", "aspect2", "aspect3"],
  "strategie": "tactică pentru acest traseu specific",
  "nutritie": "recomandare nutriție specifică distanței și D+",
  "zone_hr": "recomandare zone HR pentru acest traseu",
  "antrenament_rec": "1 antrenament specific pentru a te pregăti mai bine",
  "timp_estimat": "HH:MM",
  "timp_nota": "explicație scurtă estimare"
}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await resp.json();
  const text = data.content?.find((c) => c.type === "text")?.text || "";
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ─── Main AITab component ─────────────────────────────────────────────────────
export default function AITab({ user, T, Card, Badge, Pill, Btn, Divider }) {
  const [stage, setStage] = useState("upload"); // upload | parsing | stats | ai_loading | done
  const [gpx, setGpx] = useState(null);
  const [aiData, setAiData] = useState(null);
  const [aiError, setAiError] = useState(null);
  const [activeTab, setActiveTab] = useState("stats");
  const [hoveredElevIdx, setHoveredElevIdx] = useState(null);
  const fileRef = useRef();

  const reset = () => {
    setStage("upload");
    setGpx(null);
    setAiData(null);
    setAiError(null);
    setActiveTab("stats");
  };

  const handleFile = (file) => {
    setStage("parsing");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const result = parseGPX(e.target.result, file.name);
        if (!result) {
          setStage("upload");
          return;
        }
        setGpx(result);
        setStage("stats");
      } catch {
        setStage("upload");
      }
    };
    reader.readAsText(file);
  };

  const runAI = async () => {
    if (!gpx) return;
    setStage("ai_loading");
    setAiError(null);
    try {
      const result = await getAIAnalysis(gpx, user);
      setAiData(result);
      setStage("done");
      setActiveTab("ai");
    } catch (err) {
      setAiError("Analiza AI nu a putut fi finalizată. Verifică conexiunea.");
      setStage("stats");
    }
  };

  // ── Upload screen ────────────────────────────────────────────────────────────
  if (stage === "upload") {
    return (
      <div>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🗺️</div>
          <div style={{ color: T.white, fontWeight: 800, fontSize: 17, marginBottom: 5 }}>
            Analizator GPX
            {user?.sex === "feminin" ? " ♀" : ""}
          </div>
          <div style={{ color: T.muted, fontSize: 13, lineHeight: 1.6 }}>
            Încarcă orice fișier GPX și primești<br />
            analiză completă + recomandări AI personalizate.
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".gpx"
          style={{ display: "none" }}
          onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
        />

        <button
          onClick={() => fileRef.current.click()}
          style={{
            width: "100%",
            background: T.dim,
            border: `2px dashed ${T.accent}`,
            borderRadius: 16,
            padding: "24px 16px",
            cursor: "pointer",
            marginBottom: 12,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 6 }}>📂</div>
          <div style={{ color: T.white, fontWeight: 700, fontSize: 15, marginBottom: 3 }}>
            Alege fișier GPX
          </div>
          <div style={{ color: T.muted, fontSize: 12 }}>
            Garmin Connect · Strava · Geoid CC700 Pro · Komoot
          </div>
        </button>

        {/* Feature pills */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, justifyContent: "center", marginTop: 16 }}>
          {[
            "📊 Profil elevație",
            "📐 Analiză pante",
            "🗺️ Hartă gradient",
            "🤖 Plan AI",
            "⏱️ Estimare timp",
            "🍌 Nutriție specifică",
          ].map((f, i) => (
            <div
              key={i}
              style={{
                background: T.card,
                border: `1px solid ${T.border}`,
                borderRadius: 20,
                padding: "5px 11px",
                color: T.text,
                fontSize: 11,
              }}
            >
              {f}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Parsing / AI loading ─────────────────────────────────────────────────────
  if (stage === "parsing" || stage === "ai_loading") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 280,
        }}
      >
        <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
        <div style={{ fontSize: 36, marginBottom: 14, animation: "spin 1.2s linear infinite" }}>
          {stage === "parsing" ? "⚙️" : "🤖"}
        </div>
        <div style={{ color: T.white, fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
          {stage === "parsing" ? "Analizez traseul..." : "Generez analiza AI..."}
        </div>
        <div style={{ color: T.muted, fontSize: 12 }}>
          {stage === "parsing"
            ? "Calcul distanță, altitudine și pante"
            : "Claude analizează traseul și profilul tău"}
        </div>
      </div>
    );
  }

  // ── Stats + AI done ──────────────────────────────────────────────────────────
  if ((stage === "stats" || stage === "done") && gpx) {
    const tabs = [
      { k: "stats", l: "Statistici", e: "📊" },
      { k: "pante", l: "Pante", e: "📐" },
      ...(aiData ? [{ k: "ai", l: "Analiză AI", e: "🤖" }] : []),
    ];

    const getDifficultyColor = (d) => {
      if (!d) return T.muted;
      if (d === "Ușor") return T.green;
      if (d === "Moderat") return T.yellow;
      if (d === "Dificil") return T.orange;
      return T.red;
    };

    return (
      <div>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 14,
          }}
        >
          <div style={{ flex: 1, minWidth: 0, marginRight: 10 }}>
            <div
              style={{
                color: T.white,
                fontWeight: 800,
                fontSize: 15,
                marginBottom: 3,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {gpx.name}
            </div>
            <div style={{ color: T.green, fontSize: 11 }}>✓ GPX analizat cu succes</div>
          </div>
          <button
            onClick={reset}
            style={{
              background: "none",
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              padding: "5px 10px",
              color: T.muted,
              fontSize: 12,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ↺ Alt fișier
          </button>
        </div>

        {/* Key stats grid */}
        <div
          style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 9, marginBottom: 14 }}
        >
          <div
            style={{
              background: T.hi,
              borderRadius: 12,
              padding: "12px 14px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 16, marginBottom: 2 }}>📏</div>
            <div style={{ color: T.accent, fontWeight: 800, fontSize: 20, lineHeight: 1 }}>
              {gpx.distKm} km
            </div>
            <div style={{ color: T.muted, fontSize: 10, marginTop: 3, fontWeight: 600 }}>
              DISTANȚĂ
            </div>
          </div>
          <div
            style={{
              background: T.hi,
              borderRadius: 12,
              padding: "12px 14px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 16, marginBottom: 2 }}>⛰️</div>
            <div style={{ color: T.yellow, fontWeight: 800, fontSize: 20, lineHeight: 1 }}>
              {gpx.ascent} m
            </div>
            <div style={{ color: T.muted, fontSize: 10, marginTop: 3, fontWeight: 600 }}>D+</div>
          </div>
          <div
            style={{
              background: T.hi,
              borderRadius: 12,
              padding: "12px 14px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 16, marginBottom: 2 }}>📐</div>
            <div style={{ color: T.orange, fontWeight: 800, fontSize: 20, lineHeight: 1 }}>
              {gpx.maxGrad}%
            </div>
            <div style={{ color: T.muted, fontSize: 10, marginTop: 3, fontWeight: 600 }}>
              PANTĂ MAX
            </div>
          </div>
          <div
            style={{
              background: T.hi,
              borderRadius: 12,
              padding: "12px 14px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 16, marginBottom: 2 }}>🏔️</div>
            <div style={{ color: T.red, fontWeight: 800, fontSize: 20, lineHeight: 1 }}>
              {gpx.startEle}→{gpx.endEle}m
            </div>
            <div style={{ color: T.muted, fontSize: 10, marginTop: 3, fontWeight: 600 }}>
              ALTITUDINE
            </div>
          </div>
        </div>

        {/* Tab navigation */}
        <div
          style={{
            display: "flex",
            gap: 6,
            marginBottom: 14,
            overflowX: "auto",
            paddingBottom: 2,
          }}
        >
          {tabs.map((t) => (
            <button
              key={t.k}
              onClick={() => setActiveTab(t.k)}
              style={{
                flexShrink: 0,
                padding: "7px 13px",
                borderRadius: 20,
                border: `1px solid ${activeTab === t.k ? T.accent : T.border}`,
                background: activeTab === t.k ? T.accent : "transparent",
                color: activeTab === t.k ? "#fff" : T.muted,
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {t.e} {t.l}
            </button>
          ))}
        </div>

        {/* Tab: Statistici */}
        {activeTab === "stats" && (
          <div>
            <ElevChart
              profile={gpx.elevProfile}
              T={T}
              hoveredIdx={hoveredElevIdx}
              onHover={setHoveredElevIdx}
            />

            {/* Extra stats */}
            <div
              style={{
                background: T.card,
                borderRadius: 14,
                border: `1px solid ${T.border}`,
                overflow: "hidden",
                marginBottom: 14,
              }}
            >
              {[
                { l: "Pantă medie urcare", v: `${gpx.avgUphillGrad}%`, c: T.orange },
                { l: "Pantă medie generală", v: `${gpx.avgGrad}%`, c: T.text },
                { l: "Coborâre totală (D-)", v: `${gpx.descent} m`, c: "#3b82f6" },
                { l: "Altitudine maximă", v: `${gpx.maxEle} m`, c: T.yellow },
                { l: "Altitudine minimă", v: `${gpx.minEle} m`, c: T.muted },
                ...(gpx.avgSpeed ? [{ l: "Viteză medie", v: `${gpx.avgSpeed} km/h`, c: T.green }] : []),
                ...(gpx.duration
                  ? [
                      {
                        l: "Durată înregistrată",
                        v: `${Math.floor(gpx.duration / 60)}h ${String(gpx.duration % 60).padStart(2, "0")}min`,
                        c: T.accent,
                      },
                    ]
                  : []),
                { l: "Puncte GPS", v: gpx.pointCount.toLocaleString(), c: T.muted },
              ].map((row, i, arr) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 14px",
                    borderBottom: i < arr.length - 1 ? `1px solid ${T.border}` : "none",
                  }}
                >
                  <span style={{ color: T.muted, fontSize: 13 }}>{row.l}</span>
                  <span style={{ color: row.c, fontWeight: 700, fontSize: 13 }}>{row.v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab: Pante */}
        {activeTab === "pante" && (
          <div>
            <GradientHeatmap gradients={gpx.gradients} T={T} />
            <GradientChart gpx={gpx} T={T} />

            {/* Hardest segments */}
            {gpx.gradients.filter((g) => g.gradient > 8).length > 0 && (
              <div
                style={{
                  background: T.card,
                  borderRadius: 14,
                  border: `1px solid ${T.border}`,
                  padding: "13px 14px",
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    color: T.red,
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 10,
                  }}
                >
                  🔴 Sectoare critice (&gt;8%)
                </div>
                {gpx.gradients
                  .filter((g) => g.gradient > 8)
                  .sort((a, b) => b.gradient - a.gradient)
                  .slice(0, 5)
                  .map((g, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 0",
                        borderBottom:
                          i <
                          Math.min(
                            4,
                            gpx.gradients.filter((g) => g.gradient > 8).length - 1
                          )
                            ? `1px solid ${T.border}`
                            : "none",
                      }}
                    >
                      <div>
                        <div style={{ color: T.text, fontSize: 12, fontWeight: 600 }}>
                          km {g.distKm}
                        </div>
                        <div style={{ color: T.muted, fontSize: 10 }}>{g.ele} m altitudine</div>
                      </div>
                      <div
                        style={{
                          background: g.gradient > 12 ? T.red + "22" : T.orange + "22",
                          border: `1px solid ${g.gradient > 12 ? T.red : T.orange}44`,
                          borderRadius: 8,
                          padding: "4px 10px",
                          color: g.gradient > 12 ? T.red : T.orange,
                          fontWeight: 800,
                          fontSize: 14,
                        }}
                      >
                        +{g.gradient}%
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {/* Gradient guide */}
            <div
              style={{
                background: T.hi,
                borderRadius: 12,
                padding: "12px 14px",
              }}
            >
              <div
                style={{
                  color: T.accent,
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 8,
                }}
              >
                💡 Ghid strategie pante
              </div>
              {[
                { g: "2–5%", tip: "Cadență normală 85-90 rpm, HR Z2-Z3.", c: T.green },
                { g: "5–8%", tip: "Cadență 75-80 rpm, HR sub Z4.", c: T.yellow },
                { g: "8–12%", tip: "Cadență 65-75 rpm, stai în șa.", c: T.orange },
                { g: ">12%", tip: "Cadență 55-65 rpm, nu ataca.", c: T.red },
              ].map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    marginBottom: i < 3 ? 7 : 0,
                  }}
                >
                  <div
                    style={{
                      background: item.c + "22",
                      color: item.c,
                      fontWeight: 800,
                      fontSize: 11,
                      padding: "2px 7px",
                      borderRadius: 6,
                      flexShrink: 0,
                      minWidth: 48,
                      textAlign: "center",
                    }}
                  >
                    {item.g}
                  </div>
                  <div style={{ color: T.text, fontSize: 12, lineHeight: 1.5 }}>{item.tip}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab: Analiză AI */}
        {activeTab === "ai" && aiData && (
          <div>
            {/* Difficulty badge */}
            <div
              style={{
                background: `${getDifficultyColor(aiData.dificultate)}22`,
                border: `1px solid ${getDifficultyColor(aiData.dificultate)}44`,
                borderRadius: 14,
                padding: "14px",
                marginBottom: 14,
                textAlign: "center",
              }}
            >
              <div style={{ color: T.muted, fontSize: 11, marginBottom: 4 }}>
                Dificultate traseu
              </div>
              <div
                style={{
                  color: getDifficultyColor(aiData.dificultate),
                  fontWeight: 900,
                  fontSize: 22,
                  marginBottom: 6,
                }}
              >
                {aiData.dificultate}
              </div>
              {aiData.scor_dificultate && (
                <div style={{ display: "flex", justifyContent: "center", gap: 3 }}>
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div
                      key={i}
                      style={{
                        width: 18,
                        height: 4,
                        borderRadius: 2,
                        background:
                          i < aiData.scor_dificultate
                            ? getDifficultyColor(aiData.dificultate)
                            : T.border,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Estimated time */}
            {aiData.timp_estimat && (
              <div
                style={{
                  background: T.dim,
                  border: `1px solid ${T.accent}44`,
                  borderRadius: 14,
                  padding: "14px",
                  marginBottom: 14,
                  textAlign: "center",
                }}
              >
                <div style={{ color: T.muted, fontSize: 11, marginBottom: 4 }}>
                  Timp estimat pentru tine
                </div>
                <div style={{ color: T.accent, fontWeight: 900, fontSize: 30 }}>
                  {aiData.timp_estimat}
                </div>
                {aiData.timp_nota && (
                  <div style={{ color: T.muted, fontSize: 11, marginTop: 5 }}>
                    {aiData.timp_nota}
                  </div>
                )}
              </div>
            )}

            {/* Summary */}
            <div
              style={{
                background: T.card,
                border: `1px solid ${T.border}`,
                borderRadius: 14,
                padding: "13px 14px",
                marginBottom: 14,
              }}
            >
              <div style={{ color: T.text, fontSize: 13, lineHeight: 1.7 }}>{aiData.rezumat}</div>
            </div>

            {/* Key points */}
            {aiData.puncte_cheie?.length > 0 && (
              <div
                style={{
                  background: T.card,
                  border: `1px solid ${T.border}`,
                  borderRadius: 14,
                  padding: "13px 14px",
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    color: T.accent,
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 9,
                  }}
                >
                  ⚡ Puncte cheie
                </div>
                {aiData.puncte_cheie.map((p, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: i < aiData.puncte_cheie.length - 1 ? 7 : 0 }}>
                    <span style={{ color: T.accent, fontWeight: 700 }}>→</span>
                    <span style={{ color: T.text, fontSize: 13, lineHeight: 1.5 }}>{p}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Strategy + Nutrition */}
            {[
              { icon: "🎯", label: "Strategie", key: "strategie", color: T.yellow },
              { icon: "🍌", label: "Nutriție", key: "nutritie", color: T.orange },
              { icon: "❤️", label: "Zone HR", key: "zone_hr", color: T.red },
              { icon: "💪", label: "Antrenament recomandat", key: "antrenament_rec", color: T.green },
            ].map(
              (item) =>
                aiData[item.key] && (
                  <div
                    key={item.key}
                    style={{
                      background: T.card,
                      border: `1px solid ${T.border}`,
                      borderLeft: `3px solid ${item.color}`,
                      borderRadius: 14,
                      padding: "12px 14px",
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        color: item.color,
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        marginBottom: 5,
                      }}
                    >
                      {item.icon} {item.label}
                    </div>
                    <div style={{ color: T.text, fontSize: 13, lineHeight: 1.6 }}>
                      {aiData[item.key]}
                    </div>
                  </div>
                )
            )}
          </div>
        )}

        {/* Error message */}
        {aiError && (
          <div
            style={{
              background: T.red + "11",
              border: `1px solid ${T.red}44`,
              borderRadius: 12,
              padding: "10px 13px",
              marginBottom: 12,
              color: T.red,
              fontSize: 12,
            }}
          >
            ⚠️ {aiError}
          </div>
        )}

        {/* AI CTA */}
        {!aiData && stage !== "ai_loading" && (
          <div style={{ marginTop: 16 }}>
            <button
              onClick={runAI}
              style={{
                width: "100%",
                background: T.accent,
                border: "none",
                borderRadius: 14,
                padding: "15px 20px",
                color: "#fff",
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              🤖 Analizează cu AI — Plan personalizat
            </button>
            <div style={{ color: T.muted, fontSize: 11, textAlign: "center", marginTop: 8 }}>
              Claude analizează traseul și profilul tău
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
