"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Likelihood = { p_this_hour: number; reports_30d: number };
type ActiveIncident = { type: string; since: string; expires_at: string; reports: number };
type RoadProps = {
  road_name: string | null;
  p_any_hazard_this_hour: number;
  top_type: string | null;
  reports_30d: number;
  active_incidents: ActiveIncident[];
  likelihood: Record<string, Likelihood>;
};
type RoadFeature = { type: "Feature"; geometry: { type: "Point"; coordinates: [number, number] }; properties: RoadProps };
type MapData = { type: "FeatureCollection"; hour_of_day: number; features: RoadFeature[] };

const TYPES: Record<string, { label: string; short: string; icon: string }> = {
  collision: { label: "Collision", short: "Collision", icon: "💥" },
  road_obstruction: { label: "Road obstruction", short: "Obstruction", icon: "🚧" },
  flooding: { label: "Flooding", short: "Flooding", icon: "🌊" },
  traffic_signal_issue: { label: "Signal outage", short: "Signal", icon: "🚦" },
  other: { label: "Other hazard", short: "Other", icon: "⚠️" },
};

// Full-screen Miami hazard map: active incidents, risk hotspots with % badges, a per-type heatmap, and a legend.
export default function Home() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<{ el: HTMLElement; active: boolean }[]>([]);

  const [showActive, setShowActive] = useState(true);
  const [showHotspots, setShowHotspots] = useState(true);
  const [showHeat, setShowHeat] = useState(false);
  const [heatType, setHeatType] = useState("all");
  const [hour, setHour] = useState<number | null>(null);
  const [counts, setCounts] = useState({ roads: 0, active: 0 });

  const stateRef = useRef({ showActive, showHotspots, showHeat, heatType });
  stateRef.current = { showActive, showHotspots, showHeat, heatType };

  useEffect(() => {
    maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

    const map = new maplibregl.Map({
      container: container.current!,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [-80.3, 25.76],
      zoom: 11,
    });
    mapRef.current = map;
    let cancelled = false;

    map.on("load", async () => {
      let data: MapData;
      try {
        data = await (await fetch("/api/map")).json();
      } catch (err) {
        console.error("failed to load /api/map", err);
        return;
      }
      if (cancelled) return;

      setHour(data.hour_of_day);
      setCounts({
        roads: data.features.length,
        active: data.features.filter((f) => f.properties.active_incidents.length > 0).length,
      });

      for (const f of data.features) {
        const props = f.properties as any;
        props.p_all = f.properties.p_any_hazard_this_hour ?? 0;
        for (const t of Object.keys(TYPES)) props[`p_${t}`] = f.properties.likelihood?.[t]?.p_this_hour ?? 0;
      }

      const s = stateRef.current;
      map.addSource("roads", { type: "geojson", data: data as any });
      map.addLayer({
        id: "road-heat",
        type: "heatmap",
        source: "roads",
        layout: { visibility: s.showHeat ? "visible" : "none" },
        paint: {
          "heatmap-weight": heatWeight(s.heatType),
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 9, 1, 15, 3],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 25, 15, 70],
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(0,0,0,0)",
            0.2, "#fde68a",
            0.5, "#f59e0b",
            0.8, "#ef4444",
            1, "#991b1b",
          ],
          "heatmap-opacity": 0.75,
        },
      });

      for (const f of data.features) {
        const { el, active } = buildMarker(f.properties);
        const popup = new maplibregl.Popup({ offset: 22, className: "hz-popup", maxWidth: "300px" })
          .setHTML(popupHtml(f.properties));
        new maplibregl.Marker({ element: el }).setLngLat(f.geometry.coordinates).setPopup(popup).addTo(map);
        el.style.display = (active ? s.showActive : s.showHotspots) ? "" : "none";
        markersRef.current.push({ el, active });
      }
    });

    return () => {
      cancelled = true;
      markersRef.current = [];
      map.remove();
    };
  }, []);

  useEffect(() => {
    for (const { el, active } of markersRef.current) {
      el.style.display = (active ? showActive : showHotspots) ? "" : "none";
    }
  }, [showActive, showHotspots]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("road-heat")) return;
    map.setLayoutProperty("road-heat", "visibility", showHeat ? "visible" : "none");
  }, [showHeat]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("road-heat")) return;
    map.setPaintProperty("road-heat", "heatmap-weight", heatWeight(heatType));
  }, [heatType]);

  return (
    <>
      <style>{CSS}</style>
      <div ref={container} style={{ position: "fixed", inset: 0 }} />

      <div></div>

      <div className="hz-panel">
        <div className="hz-title">Road Hazard Map</div>
        <div className="hz-sub">
          {counts.active} active incident{counts.active === 1 ? "" : "s"} · {counts.roads} roads tracked
          {hour !== null && ` · risk for ${formatHour(hour)}`}
        </div>

        <Toggle label="Active incidents" on={showActive} onClick={() => setShowActive((v) => !v)} />
        <Toggle label="Hotspot dots" on={showHotspots} onClick={() => setShowHotspots((v) => !v)} />
        <Toggle label="Risk heatmap" on={showHeat} onClick={() => setShowHeat((v) => !v)} />

        {showHeat && (
          <div className="hz-chips">
            {[["all", "All"], ...Object.entries(TYPES).map(([k, v]) => [k, v.short])].map(([key, text]) => (
              <button
                key={key}
                className={`hz-chip ${heatType === key ? "on" : ""}`}
                onClick={() => setHeatType(key)}
              >
                {key !== "all" && `${TYPES[key].icon} `}{text}
              </button>
            ))}
          </div>
        )}

        <div className="hz-legend">
          <div className="hz-row"><span className="hz-sw hz-sw-active" />Active incident (5+ live reports)</div>
          <div className="hz-row"><span className="hz-sw hz-sw-risk" />Hotspot, bigger = riskier now</div>
          <div className="hz-row"><span className="hz-sw-badge">23%</span>Chance of any hazard this hour</div>
        </div>
      </div>

      
      <div className="alertpopup">
        <img src="/path/to/alert-icon.png" alt="Alert" />
        <p>Collison Detected Ahead</p>
      </div>
    </>
  );
}

// On/off row button used in the panel.
function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button className={`hz-toggle ${on ? "on" : ""}`} onClick={onClick}>
      {label} <span>{on ? "On" : "Off"}</span>
    </button>
  );
}

// Heatmap weight expression for "all" or a single incident type.
function heatWeight(type: string): any {
  const key = type === "all" ? "p_all" : `p_${type}`;
  return ["interpolate", ["linear"], ["coalesce", ["get", key], 0], 0, 0, 0.01, 0.05, 0.5, 1];
}

// Builds the DOM element for one road: red pulsing icon if active, orange risk-sized dot with a % badge otherwise.
function buildMarker(p: RoadProps): { el: HTMLElement; active: boolean } {
  const active = p.active_incidents.length > 0;
  const el = document.createElement("div");
  if (active) el.style.zIndex = "2";

  const dot = document.createElement("div");
  dot.className = active ? "hz-dot active" : "hz-dot";
  const size = active ? 34 : Math.round((12 + Math.min(p.p_any_hazard_this_hour ?? 0, 0.5) * 40) * 1.5);
  dot.style.width = `${size}px`;
  dot.style.height = `${size}px`;

  if (active) {
    dot.textContent = icon(topIncident(p)!.type);
  } else {
    const badge = document.createElement("span");
    badge.className = "hz-badge";
    badge.textContent = `${pct(p.p_any_hazard_this_hour)}%`;
    dot.appendChild(badge);
  }

  el.appendChild(dot);
  return { el, active };
}

// Builds the popup HTML: active incident details, overall risk, and a per-type breakdown for this hour.
function popupHtml(p: RoadProps): string {
  const inc = topIncident(p);
  const activeBlock = inc
    ? `<div class="hz-pop-active">
         <b>${icon(inc.type)} Active ${label(inc.type).toLowerCase()}</b> · ${inc.reports} reports<br>
         First reported ${clock(inc.since)} (${minsAgo(inc.since)} min ago)<br>
         Clears ${clock(inc.expires_at)} if no new reports
       </div>`
    : "";

  const rows = Object.entries(p.likelihood ?? {})
    .sort((a, b) => b[1].p_this_hour - a[1].p_this_hour)
    .map(([t, l]) => `
      <div class="hz-type"><span>${icon(t)} ${label(t)}</span><span>${pct(l.p_this_hour)}%</span></div>
      <div class="hz-bar"><div style="width:${Math.min(100, pct(l.p_this_hour))}%"></div></div>`)
    .join("");

  return `
    <div class="hz-pop-title">${p.road_name ?? "Unnamed road"}</div>
    ${activeBlock}
    <div class="hz-pop-risk"><span>Chance of a hazard this hour</span><b>${pct(p.p_any_hazard_this_hour)}%</b></div>
    ${rows ? `<div class="hz-pop-section">By type, this hour</div>${rows}` : ""}
    <div class="hz-pop-foot">${p.reports_30d} reports in the last 30 days</div>`;
}

// Picks the active incident with the most reports, if any.
function topIncident(p: RoadProps): ActiveIncident | undefined {
  return [...p.active_incidents].sort((a, b) => b.reports - a.reports)[0];
}

// Small formatting helpers.
function pct(n: number | null | undefined) { return Math.round((n ?? 0) * 100); }
function label(t: string) { return TYPES[t]?.label ?? t; }
function icon(t: string) { return TYPES[t]?.icon ?? "⚠️"; }
function clock(iso: string) { return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
function minsAgo(iso: string) { return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); }
function formatHour(h: number) { return `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`; }

const CSS = `
.hz-dot {
  position: relative; border-radius: 50%; background: #f59e0b;
  border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.35);
  cursor: pointer; transition: transform .15s;
}
.hz-dot:hover { transform: scale(1.15); }
.hz-dot.active {
  background: #e11d48; border-width: 3px;
  display: flex; align-items: center; justify-content: center; font-size: 16px;
}
.hz-dot.active::before {
  content: ""; position: absolute; inset: -3px; border-radius: 50%;
  border: 3px solid #e11d48; animation: hz-pulse 1.6s ease-out infinite;
}
@keyframes hz-pulse { from { transform: scale(1); opacity: .56; } to { transform: scale(1.84); opacity: 0; } }
.hz-badge {
  position: absolute; top: -9px; right: -16px; min-width: 22px; padding: 0 5px;
  border-radius: 999px; background: #111827; color: #fff; border: 1.5px solid #fff;
  font: 600 10px/15px system-ui, sans-serif; text-align: center; pointer-events: none;
}

.hz-panel {
  position: fixed; top: 12px; left: 12px; z-index: 1; width: 260px; padding: 14px;
  background: rgba(255,255,255,.95); backdrop-filter: blur(6px);
  border-radius: 14px; box-shadow: 0 4px 20px rgba(0,0,0,.15);
  font: 13px/1.4 system-ui, sans-serif; color: #111827;
}
.hz-title { font-weight: 700; font-size: 15px; }
.hz-sub { color: #6b7280; font-size: 12px; margin: 2px 0 10px; }
.hz-toggle {
  display: flex; justify-content: space-between; align-items: center; width: 100%;
  margin-top: 6px; padding: 8px 10px; border-radius: 10px; border: 1px solid #e5e7eb;
  background: #fff; color: #111827; cursor: pointer; font: 600 13px system-ui, sans-serif;
}
.hz-toggle span { font-weight: 500; color: #9ca3af; font-size: 12px; }
.hz-toggle.on { background: #111827; border-color: #111827; color: #fff; }
.hz-toggle.on span { color: #d1d5db; }
.hz-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.hz-chip {
  padding: 4px 8px; border-radius: 999px; border: 1px solid #e5e7eb; background: #fff;
  color: #374151; cursor: pointer; font: 500 12px system-ui, sans-serif;
}
.hz-chip.on { background: #f59e0b; border-color: #f59e0b; color: #fff; }
.hz-legend {
  margin-top: 12px; padding-top: 10px; border-top: 1px solid #e5e7eb;
  display: grid; gap: 7px; color: #374151; font-size: 12px;
}
.hz-row { display: flex; align-items: center; gap: 8px; }
.hz-sw { width: 12px; height: 12px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px #d1d5db; flex: none; }
.hz-sw-active { background: #e11d48; }
.hz-sw-risk { background: #f59e0b; }
.hz-sw-badge {
  flex: none; padding: 0 5px; border-radius: 999px; background: #111827; color: #fff;
  font: 600 10px/15px system-ui, sans-serif;
}

.hz-popup .maplibregl-popup-content {
  border-radius: 12px; padding: 12px 14px; min-width: 230px;
  box-shadow: 0 6px 24px rgba(0,0,0,.18); font: 13px/1.45 system-ui, sans-serif; color: #111827;
}
.hz-pop-title { font-weight: 700; font-size: 14px; margin: 0 16px 8px 0; }
.hz-pop-active { background: #fef2f2; color: #b91c1c; border-radius: 8px; padding: 7px 9px; margin-bottom: 8px; font-size: 12px; }
.hz-pop-risk { display: flex; justify-content: space-between; gap: 12px; }
.hz-pop-risk b { font-size: 15px; }
.hz-pop-section { margin: 8px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #9ca3af; }
.hz-type { display: flex; justify-content: space-between; font-size: 12px; }
.hz-bar { height: 5px; background: #f3f4f6; border-radius: 3px; margin: 2px 0 6px; overflow: hidden; }
.hz-bar > div { height: 100%; background: #f59e0b; }
.hz-pop-foot { margin-top: 6px; font-size: 11px; color: #6b7280; }
`;