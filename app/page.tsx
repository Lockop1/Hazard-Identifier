"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Full-screen Miami map with a dot per road from /api/map; click a dot for its details.
export default function Home() {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

    const map = new maplibregl.Map({
      container: container.current!,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [-80.3, 25.76],
      zoom: 11,
    });

    map.on("load", () => {
      map.addSource("roads", { type: "geojson", data: "/api/map" });

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

  return <div ref={container} style={{ position: "fixed", inset: 0 }} />;
}