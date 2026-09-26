import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;
const WINDOW_HOURS = WINDOW_DAYS * 24;

type Likelihood = { p_any_hour: number; p_this_hour: number; reports_30d: number; confidence: "low" | "medium" | "high" };
type ActiveIncident = { type: string; since: Date; expires_at: Date; reports: number };
type RoadFeature = {
  road_place_id: string;
  road_name: string | null;
  latSum: number;
  lonSum: number;
  weight: number;
  likelihood: Record<string, Likelihood>;
  active_incidents: ActiveIncident[];
};

// Returns every road with activity as GeoJSON: live incidents plus per-type likelihood for the given hour (?hour=0-23, defaults to now in Miami).
export async function GET(req: Request) {
  const hourParam = new URL(req.url).searchParams.get("hour");
  const hour = hourParam !== null && /^\d+$/.test(hourParam) && +hourParam < 24 ? +hourParam : currentMiamiHour();

  const [history, live] = await Promise.all([
    sql`
      SELECT h.road_place_id, h.incident_type, r.name AS road_name,
             count(*)::int AS hazard_hours,
             count(*) FILTER (
               WHERE extract(hour FROM h.bucket AT TIME ZONE 'America/New_York') = ${hour}
             )::int AS hazard_hours_at_hour,
             sum(h.n)::int AS reports,
             avg(h.lat) AS lat, avg(h.lon) AS lon
      FROM report_heat h
      LEFT JOIN roads r ON r.place_id = h.road_place_id
      WHERE h.bucket > now() - make_interval(days => ${WINDOW_DAYS})
        AND h.road_place_id IS NOT NULL
      GROUP BY h.road_place_id, h.incident_type, r.name`,
    sql`
      SELECT i.road_place_id, i.incident_type, i.first_reported, i.expires_at,
             i.report_count, i.lat, i.lon, r.name AS road_name
      FROM incidents i
      LEFT JOIN roads r ON r.place_id = i.road_place_id
      WHERE i.expires_at > now()`,
  ]);

  const roads = new Map<string, RoadFeature>();

  for (const row of history) {
    const road = getRoad(roads, row.road_place_id, row.road_name);
    road.latSum += row.lat * row.reports;
    road.lonSum += row.lon * row.reports;
    road.weight += row.reports;
    road.likelihood[row.incident_type] = {
      p_any_hour: round(row.hazard_hours / WINDOW_HOURS),
      p_this_hour: round(row.hazard_hours_at_hour / WINDOW_DAYS),
      reports_30d: row.reports,
      confidence: row.reports >= 20 ? "high" : row.reports >= 5 ? "medium" : "low",
    };
  }

  for (const row of live) {
    const road = getRoad(roads, row.road_place_id, row.road_name);
    if (road.weight === 0) {
      road.latSum = row.lat;
      road.lonSum = row.lon;
      road.weight = 1;
    }
    road.active_incidents.push({
      type: row.incident_type,
      since: row.first_reported,
      expires_at: row.expires_at,
      reports: row.report_count,
    });
  }

  const features = [...roads.values()].map(toFeature);

  return NextResponse.json({
    type: "FeatureCollection",
    generated_at: new Date().toISOString(),
    window_days: WINDOW_DAYS,
    hour_of_day: hour,
    features,
  });
}

// Finds or creates the working record for a road.
function getRoad(roads: Map<string, RoadFeature>, id: string, name: string | null): RoadFeature {
  let road = roads.get(id);
  if (!road) {
    road = { road_place_id: id, road_name: name, latSum: 0, lonSum: 0, weight: 0, likelihood: {}, active_incidents: [] };
    roads.set(id, road);
  }
  return road;
}

// Turns a road record into a GeoJSON feature with flat popup fields and nested AI fields.
function toFeature(road: RoadFeature) {
  const types = Object.entries(road.likelihood);
  const pAny = 1 - types.reduce((acc, [, l]) => acc * (1 - l.p_this_hour), 1);
  const top = types.sort((a, b) => b[1].reports_30d - a[1].reports_30d)[0];
  const active = [...road.active_incidents].sort((a, b) => b.reports - a.reports)[0];

  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [road.lonSum / road.weight, road.latSum / road.weight] },
    properties: {
      road_place_id: road.road_place_id,
      road_name: road.road_name,
      p_any_hazard_this_hour: round(pAny),
      active_type: active?.type ?? null,
      active_reports: active?.reports ?? 0,
      top_type: top?.[0] ?? null,
      reports_30d: types.reduce((sum, [, l]) => sum + l.reports_30d, 0),
      active_incidents: road.active_incidents,
      likelihood: road.likelihood,
    },
  };
}

// Current hour of day (0-23) in Miami time.
function currentMiamiHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/New_York" }).format(new Date())
  );
}

// Rounds a probability to 3 decimals.
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}