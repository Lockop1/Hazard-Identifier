"use client";


import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const REFRESH_MS = 10_000;

type Likelihood = { p_this_hour: number; reports_30d: number };
type ActiveIncident = { type: string; since: string; expires_at: string; reports: number };
type RoadProps = {
  road_place_id: string;
  road_name: string | null;
  p_any_hazard_this_hour: number;
  top_type: string | null;
  reports_30d: number;
  active_incidents: ActiveIncident[];
  likelihood: Record<string, Likelihood>;
};
type RoadFeature = { type: "Feature"; geometry: { type: "Point"; coordinates: [number, number] }; properties: RoadProps };
type MapData = { type: "FeatureCollection"; hour_of_day: number; features: RoadFeature[] };
type MarkerEntry = { marker: maplibregl.Marker; el: HTMLElement; active: boolean; sig: string };

type RouteHazard = {
  kind: "confirmed" | "potential";
  type: string;
  road_place_id: string;
  road_name: string | null;
  lat: number;
  lon: number;
  position: number;
  distance_mi: number;
  eta_min: number;
  reports?: number;
  p_this_hour?: number;
};
type RouteResult = {
  rank: number;
  duration_min: number;
  distance_mi: number;
  risk_this_hour: number;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  hazards: RouteHazard[];
};

const TYPES: Record<string, { label: string; short: string; icon: string }> = {
  collision: { label: "Collision", short: "Collision", icon: "💥" },
  road_obstruction: { label: "Road obstruction", short: "Obstruction", icon: "🚧" },
  flooding: { label: "Flooding", short: "Flooding", icon: "🌊" },
  traffic_signal_issue: { label: "Signal outage", short: "Signal", icon: "🚦" },
  other: { label: "Other hazard", short: "Other", icon: "⚠️" },
};

const PLACES: Record<string, string> = {
  FIU: "25.7563,-80.3752",
  "South Beach": "25.7790,-80.1405",
  Brickell: "25.7650,-80.1920",
  Doral: "25.8105,-80.3120",
  Aventura: "25.9530,-80.1430",
};
const DESTINATIONS = ["South Beach", "Brickell", "Doral", "Aventura"];

// Full-screen Miami hazard map: live incidents, risk hotspots, per-type heatmap, and directions with hazards along the route.
export default function Home() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, MarkerEntry>>(new Map());
  const myLocRef = useRef<string | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [showActive, setShowActive] = useState(true);
  const [showHotspots, setShowHotspots] = useState(true);
  const [showHeat, setShowHeat] = useState(false);
  const [heatType, setHeatType] = useState("all");
  const [hour, setHour] = useState<number | null>(null);
  const [counts, setCounts] = useState({ roads: 0, active: 0 });
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const [from, setFrom] = useState("FIU");
  const [to, setTo] = useState("");
  const [routes, setRoutes] = useState<RouteResult[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [focused, setFocused] = useState<RouteHazard | null>(null);
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => {
    if (window.innerWidth < 640) setPanelOpen(false);
  }, []);

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
    let inFlight = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const applyData = (data: MapData) => {
      const s = stateRef.current;

      for (const f of data.features) {
        const props = f.properties as any;
        props.p_all = f.properties.p_any_hazard_this_hour ?? 0;
        for (const t of Object.keys(TYPES)) props[`p_${t}`] = f.properties.likelihood?.[t]?.p_this_hour ?? 0;
      }

      const source = map.getSource("roads") as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(data as any);
      } else {
        map.addSource("roads", { type: "geojson", data: data as any });
        map.addLayer(
          {
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
          },
          map.getLayer("route-alt") ? "route-alt" : undefined
        );
      }

      const seen = new Set<string>();
      for (const f of data.features) {
        const p = f.properties;
        const id = p.road_place_id;
        seen.add(id);
        const active = p.active_incidents.length > 0;

        let entry = markersRef.current.get(id);
        if (!entry) {
          const el = document.createElement("div");
          const popup = new maplibregl.Popup({ offset: 22, className: "hz-popup", maxWidth: "300px" });
          const marker = new maplibregl.Marker({ element: el }).setLngLat(f.geometry.coordinates).setPopup(popup).addTo(map);
          entry = { marker, el, active, sig: "" };
          markersRef.current.set(id, entry);
        }

        const { dot, sig } = buildDot(p);
        if (sig !== entry.sig) {
          entry.el.replaceChildren(dot);
          entry.sig = sig;
        }
        entry.active = active;
        entry.el.style.zIndex = active ? "2" : "";
        entry.el.style.display = (active ? s.showActive : s.showHotspots) ? "" : "none";
        entry.marker.setLngLat(f.geometry.coordinates);
        entry.marker.getPopup()?.setHTML(popupHtml(p));
      }

      for (const [id, entry] of markersRef.current) {
        if (!seen.has(id)) {
          entry.marker.remove();
          markersRef.current.delete(id);
        }
      }

      setHour(data.hour_of_day);
      setCounts({
        roads: data.features.length,
        active: data.features.filter((f) => f.properties.active_incidents.length > 0).length,
      });
      setUpdatedAt(new Date());
    };

    const load = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const res = await fetch("/api/map", { cache: "no-store" });
        if (res.ok) {
          const data: MapData = await res.json();
          if (!cancelled) applyData(data);
        }
      } catch (err) {
        console.error("failed to load /api/map", err);
      } finally {
        inFlight = false;
      }
    };

    const onVisible = () => { if (!document.hidden) load(); };

    map.on("load", () => {
      setMapReady(true);
      load();
      timer = setInterval(load, REFRESH_MS);
      document.addEventListener("visibilitychange", onVisible);
    });

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      markersRef.current.clear();
      map.remove();
    };
  }, []);

  useEffect(() => {
    for (const { el, active } of markersRef.current.values()) {
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const data = {
      type: "FeatureCollection",
      features: (routes ?? []).map((r, i) => ({
        type: "Feature",
        geometry: r.geometry,
        properties: { idx: i, selected: i === selected },
      })),
    };

    const src = map.getSource("routes") as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data as any);
    } else {
      map.addSource("routes", { type: "geojson", data: data as any });
      const layout = { "line-cap": "round" as const, "line-join": "round" as const };
      map.addLayer({
        id: "route-alt", type: "line", source: "routes", filter: ["!", ["get", "selected"]], layout,
        paint: { "line-color": "#9ca3af", "line-width": 5, "line-opacity": 0.85 },
      });
      map.addLayer({
        id: "route-casing", type: "line", source: "routes", filter: ["get", "selected"], layout,
        paint: { "line-color": "#ffffff", "line-width": 10 },
      });
      map.addLayer({
        id: "route-main", type: "line", source: "routes", filter: ["get", "selected"], layout,
        paint: { "line-color": "#2563eb", "line-width": 6 },
      });
      map.on("click", "route-alt", (e) => {
        const idx = e.features?.[0]?.properties?.idx;
        if (typeof idx === "number") {
          setSelected(idx);
          setFocused(null);
        }
      });
      map.on("mouseenter", "route-alt", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "route-alt", () => (map.getCanvas().style.cursor = ""));
    }

    const r = routes?.[selected];
    if (r) {
      const bounds = new maplibregl.LngLatBounds();
      for (const c of r.geometry.coordinates) bounds.extend(c);
      map.fitBounds(bounds, { padding: { top: 60, bottom: 230, left: 60, right: 60 }, maxZoom: 14 });
    }
  }, [routes, selected, mapReady]);

  const resolvePlace = (text: string) => {
    if (text === "My location" && myLocRef.current) return myLocRef.current;
    return PLACES[text] ?? text;
  };

  const getDirections = async (dest = to) => {
    if (!from.trim() || !dest.trim()) return;
    setRouting(true);
    setRouteError(null);
    setFocused(null);
    try {
      const url = `/api/directions?from=${encodeURIComponent(resolvePlace(from))}&to=${encodeURIComponent(resolvePlace(dest))}`;
      const data = await (await fetch(url, { cache: "no-store" })).json();
      if (!data.ok) {
        setRoutes(null);
        setRouteError("Couldn't find a route. Try a fuller address.");
        return;
      }
      setRoutes(data.routes);
      setSelected(0);
      if (window.innerWidth < 640) setPanelOpen(false);
    } catch {
      setRouteError("Couldn't reach the server.");
    } finally {
      setRouting(false);
    }
  };

  const locateMe = () => {
    if (!navigator.geolocation) {
      setRouteError("Location isn't available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        myLocRef.current = `${pos.coords.latitude},${pos.coords.longitude}`;
        setFrom("My location");
      },
      () => setRouteError("Location unavailable (needs HTTPS and permission)."),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const focusHazard = (h: RouteHazard) => {
    setFocused(h);
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [h.lon, h.lat], zoom: 14 });
    const entry = markersRef.current.get(h.road_place_id);
    const popup = entry?.marker.getPopup();
    if (entry && popup && !popup.isOpen()) entry.marker.togglePopup();
  };

  const route = routes?.[selected];

  return (
    <>
    <style>{CSS}</style>
    <div ref={container} style={{ position: "fixed", inset: 0 }} />

    {/* Feedback Toast Notification */}
    {toastMessage && (
      <div className="hz-toast">
        <span className="hz-toast-icon">✅</span>
        <span className="hz-toast-text">{toastMessage}</span>
      </div>
    )}
      <style>{CSS}</style>
      <div ref={container} style={{ position: "fixed", inset: 0 }} />

      <div></div>

      <div className="hz-panel">
        <div className="hz-title">Road Hazard Map</div>
        <div className="hz-sub">
          {counts.active} active incident{counts.active === 1 ? "" : "s"} · {counts.roads} roads
          {hour !== null && ` · ${formatHour(hour)}`}
        </div>

        <div className="hz-body">
          <div className="hz-body-inner">
            <form className="hz-dir" onSubmit={(e) => { e.preventDefault(); getDirections(); }}>
              <div className="hz-input-row">
                <input className="hz-input" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Start" />
                <button type="button" className="hz-icon-btn" onClick={locateMe} title="Use my location">📍</button>
              </div>
              <div className="hz-input-row">
                <input className="hz-input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Where to?" />
                <button type="submit" className="hz-go" disabled={routing}>{routing ? "…" : "Go"}</button>
              </div>
              <div className="hz-chips">
                {DESTINATIONS.map((d) => (
                  <button type="button" key={d} className="hz-chip" onClick={() => { setTo(d); getDirections(d); }}>
                    {d}
                  </button>
                ))}
              </div>
              {routeError && <div className="hz-error">{routeError}</div>}
            </form>

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
        </div>

        <button
          className="hz-handle"
          onClick={() => setPanelOpen((v) => !v)}
          aria-label={panelOpen ? "Collapse panel" : "Expand panel"}
        >
          {panelOpen ? "▴" : "▾"}
        </button>
      </div>

<div className = "alertpopup">
  <div className = "circle">
<img src="\fluentui-system-icons_warning.svg" alt="Alert" />
            
  </div>
  
  <p>Collision Detected Ahead</p>
</div>



      {routes && route && (
        <div className="hz-sheet">
          <div className="hz-sheet-top">
            <div className="hz-route-pills">
              {routes.map((r, i) => (
                <button
                  key={i}
                  className={`hz-route-pill ${i === selected ? "on" : ""}`}
                  onClick={() => { setSelected(i); setFocused(null); }}
                >
                  {r.duration_min} min <span>{r.distance_mi} mi</span>
                  {i === 0 && <em>Safest</em>}
                </button>
              ))}
            </div>
            <button className="hz-close" aria-label="Close" onClick={() => { setRoutes(null); setFocused(null); }}>×</button>
          </div>

          <div className="hz-track">
            <div className="hz-track-line" />
            <span className="hz-track-start" />
            <span className="hz-track-end">🏁</span>
            {route.hazards.map((h, i) => (
              <button
                key={i}
                className={`hz-track-hz ${h.kind}`}
                style={{ left: `${4 + h.position * 88}%` }}
                onClick={() => focusHazard(h)}
                title={`${label(h.type)} · ${h.distance_mi} mi`}
              >
                {icon(h.type)}
                {h.kind === "potential" && <span className="hz-badge">{pct(h.p_this_hour)}%</span>}
              </button>
            ))}
          </div>

          {focused && (
            <div className="hz-caption">
              {icon(focused.type)} <b>{label(focused.type)}</b>
              {focused.road_name && ` on ${focused.road_name}`} · in {focused.distance_mi} mi (~{focused.eta_min} min)
            </div>
          )}
        </div>
      )}
    </>
  );
}

// Toast notification system for reporting incidents
// Inside your Home component in page.tsx
const [toastMessage, setToastMessage] = useState<string | null>(null);

// Helper function to trigger the popup
const showToast = (message: string) => {
  setToastMessage(message);
  setTimeout(() => {
    setToastMessage(null);
  }, 3000);
};

// Example report incident handler
const handleReportIncident = async (type: string) => {
  try {
    // Perform your API call to save the report
    // await fetch('/api/report', { method: 'POST', body: JSON.stringify({ type }) });

    // Show feedback popup on success
    showToast(`Report submitted! Thank you for updating the road conditions.`);
  } catch (err) {
    showToast("Failed to submit report. Please try again.");
  }
};




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

// Builds the visible dot for one road plus a signature string used to skip redraws when nothing changed.
function buildDot(p: RoadProps): { dot: HTMLElement; sig: string } {
  const inc = topIncident(p);
  const risk = pct(p.p_any_hazard_this_hour);
  const size = inc ? 34 : Math.round((12 + Math.min(p.p_any_hazard_this_hour ?? 0, 0.5) * 40) * 1.5);

  const dot = document.createElement("div");
  dot.className = inc ? "hz-dot active" : "hz-dot";
  dot.style.width = `${size}px`;
  dot.style.height = `${size}px`;

  if (inc) {
    dot.textContent = icon(inc.type);
  } else {
    const badge = document.createElement("span");
    badge.className = "hz-badge";
    badge.textContent = `${risk}%`;
    dot.appendChild(badge);
  }

  return { dot, sig: inc ? `a|${inc.type}` : `h|${size}|${risk}` };
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
.hz-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.hz-title { font-weight: 700; font-size: 15px; }
.hz-sub { color: #6b7280; font-size: 12px; margin: 2px 0 4px; }
.hz-live { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #059669; }
.hz-live-dot { width: 7px; height: 7px; border-radius: 50%; background: #10b981; animation: hz-blink 2s ease-in-out infinite; }
@keyframes hz-blink { 50% { opacity: .3; } }

.hz-body { display: grid; grid-template-rows: 1fr; transition: grid-template-rows .25s ease; }
.hz-panel.closed .hz-body { grid-template-rows: 0fr; }
.hz-body-inner { min-height: 0; overflow: hidden; }

.hz-handle {
  position: absolute; left: 50%; bottom: -18px; transform: translateX(-50%);
  width: 48px; height: 18px; padding: 0; border: none;
  border-radius: 0 0 10px 10px; background: rgba(255,255,255,.95);
  box-shadow: 0 4px 8px rgba(0,0,0,.12); color: #6b7280;
  font-size: 12px; line-height: 18px; cursor: pointer;
}

.hz-dir { margin: 6px 0 4px; padding-bottom: 10px; border-bottom: 1px solid #e5e7eb; }
.hz-input-row { display: flex; gap: 6px; margin-top: 6px; }
.hz-input {
  flex: 1; min-width: 0; padding: 8px 10px; border-radius: 10px; border: 1px solid #e5e7eb;
  font: 13px system-ui, sans-serif; color: #111827; background: #fff;
}
.hz-input:focus { outline: none; border-color: #2563eb; }
.hz-icon-btn { width: 36px; border: 1px solid #e5e7eb; background: #fff; border-radius: 10px; cursor: pointer; }
.hz-go {
  padding: 0 14px; border: none; border-radius: 10px; background: #2563eb; color: #fff;
  font: 600 13px system-ui, sans-serif; cursor: pointer;
}
.hz-go:disabled { opacity: .6; }
.hz-error { color: #dc2626; font-size: 12px; margin-top: 6px; }

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

.hz-sheet {
  position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 2;
  width: min(560px, calc(100% - 24px)); padding: 12px 14px;
  background: #fff; border-radius: 16px; box-shadow: 0 8px 30px rgba(0,0,0,.2);
  font: 13px/1.4 system-ui, sans-serif; color: #111827;
}
.hz-sheet-top { display: flex; align-items: center; gap: 8px; }
.hz-route-pills { display: flex; gap: 6px; flex: 1; overflow-x: auto; }
.hz-route-pill {
  display: flex; align-items: baseline; gap: 6px; padding: 6px 10px; white-space: nowrap;
  border-radius: 10px; border: 1px solid #e5e7eb; background: #fff; color: #111827;
  font: 700 14px system-ui, sans-serif; cursor: pointer;
}
.hz-route-pill span { font-weight: 500; font-size: 12px; color: #6b7280; }
.hz-route-pill em { font-style: normal; font-weight: 600; font-size: 11px; color: #059669; }
.hz-route-pill.on { border-color: #2563eb; background: #eff6ff; }
.hz-close {
  width: 28px; height: 28px; flex: none; border: none; border-radius: 50%;
  background: #f3f4f6; font-size: 18px; line-height: 1; cursor: pointer;
}

.hz-track { position: relative; height: 58px; margin: 6px 4px 0; }
.hz-track-line {
  position: absolute; left: 4%; right: 8%; top: 50%; height: 6px; margin-top: -3px;
  border-radius: 3px; background: #2563eb;
}
.hz-track-start {
  position: absolute; left: 4%; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px;
  border-radius: 50%; background: #2563eb; border: 3px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,.3);
}
.hz-track-end { position: absolute; left: 96%; top: 50%; transform: translate(-50%, -50%); font-size: 18px; }
.hz-track-hz {
  position: absolute; top: 50%; transform: translate(-50%, -50%); padding: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.35);
  cursor: pointer; transition: transform .15s;
}
.hz-track-hz:hover { transform: translate(-50%, -50%) scale(1.15); }
.hz-track-hz.confirmed { width: 30px; height: 30px; background: #e11d48; font-size: 15px; z-index: 2; }
.hz-track-hz.potential { width: 22px; height: 22px; background: #f59e0b; font-size: 11px; z-index: 1; }
.hz-caption { margin-top: 2px; text-align: center; font-size: 12px; color: #374151; }

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

.hz-toast {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  background-color: #111827;
  color: #ffffff;
  border-radius: 999px;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
  font: 600 14px/1.4 system-ui, -apple-system, sans-serif;
  animation: hz-toast-in 0.25s ease-out;
  pointer-events: none;
}

.hz-toast-icon {
  font-size: 16px;
}

@keyframes hz-toast-in {
  from {
    opacity: 0;
    transform: translate(-50%, -12px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}


@media (max-width: 640px) {
  .hz-panel { left: 8px; right: 8px; top: 8px; width: auto; padding: 10px 12px; }
  .hz-sheet { bottom: 8px; }
}
`;