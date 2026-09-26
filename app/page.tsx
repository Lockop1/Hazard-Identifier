"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Full-screen Miami map: dots per road (click for details), a toggleable risk heatmap, and an active-only filter.
export default function Home() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [showHeat, setShowHeat] = useState(false);
  const [activeOnly, setActiveOnly] = useState(false);

  useEffect(() => {
    maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

    const map = new maplibregl.Map({
      container: container.current!,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [-80.3, 25.76],
      zoom: 11,
    });
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("roads", { type: "geojson", data: "/api/map" });

      map.addLayer({
        id: "road-heat",
        type: "heatmap",
        source: "roads",
        layout: { visibility: "none" },
        paint: {
          "heatmap-weight": [
            "interpolate", ["linear"],
            ["coalesce", ["get", "p_any_hazard_this_hour"], 0],
            0, 0.05,
            0.5, 1,
          ],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 9, 1, 15, 3],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 25, 15, 70],
          "heatmap-opacity": 0.8,
        },
      });

      map.addLayer({
        id: "road-dots",
        type: "circle",
        source: "roads",
        paint: {
          "circle-radius": [
            "interpolate", ["linear"],
            ["coalesce", ["get", "p_any_hazard_this_hour"], 0],
            0, 5,
            1, 18,
          ],
          "circle-color": [
            "case",
            ["to-boolean", ["get", "active_type"]], "#e11d48",
            "#f59e0b",
          ],
          "circle-opacity": 0.85,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.on("click", "road-dots", (e) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;

        const risk = Math.round((p.p_any_hazard_this_hour ?? 0) * 100);
        const active = p.active_type
          ? `<div style="color:#e11d48"><b>Active:</b> ${p.active_type} (${p.active_reports} reports)</div>`
          : "<div>No active incident</div>";

        new maplibregl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(`
            <b>${p.road_name ?? "Unnamed road"}</b>
            ${active}
            <div><b>Risk this hour:</b> ${risk}%</div>
            <div><b>Most common:</b> ${p.top_type ?? "n/a"}</div>
            <div><b>Reports (30d):</b> ${p.reports_30d ?? 0}</div>
          `)
          .addTo(map);
      });

      map.on("mouseenter", "road-dots", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "road-dots", () => (map.getCanvas().style.cursor = ""));
    });

    return () => map.remove();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("road-heat")) return;
    map.setLayoutProperty("road-heat", "visibility", showHeat ? "visible" : "none");
  }, [showHeat]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("road-dots")) return;
    map.setFilter("road-dots", activeOnly ? ["to-boolean", ["get", "active_type"]] : null);
  }, [activeOnly]);

  const buttonStyle: React.CSSProperties = {
    padding: "8px 12px", borderRadius: 8, border: "1px solid #ccc",
    background: "#fff", cursor: "pointer", fontWeight: 600,
  };

  return (
    <>
      <div ref={container} style={{ position: "fixed", inset: 0 }} />
      <div style={{ position: "fixed", top: 12, left: 12, zIndex: 1, display: "flex", gap: 8 }}>
        <button onClick={() => setShowHeat((v) => !v)} style={buttonStyle}>
          {showHeat ? "Hide heatmap" : "Show heatmap"}
        </button>
        <button onClick={() => setActiveOnly((v) => !v)} style={buttonStyle}>
          {activeOnly ? "Show all roads" : "Active incidents only"}
        </button>
      </div>
    </>
  );
}