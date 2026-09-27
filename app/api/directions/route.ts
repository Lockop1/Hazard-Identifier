import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const BUFFER_M = 150;
const POTENTIAL_MIN = 0.03;
const MAX_POTENTIAL = 8;
const WINDOW_DAYS = 30;
const WINDOW_HOURS = WINDOW_DAYS * 24;
const PRIOR_DAYS = 10;
const METERS_PER_MILE = 1609.34;

type Hazard = {
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
  since?: string;
  expires_at?: string;
  p_this_hour?: number;
};

// GET /api/directions?from=...&to=...  (addresses or "lat,lon"; optional &hour=0-23). Returns routes, safest first, with hazards along each.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const from = params.get("from")?.trim();
  const to = params.get("to")?.trim();
  if (!from || !to) {
    return NextResponse.json({ ok: false, error: "from and to are required" }, { status: 400 });
  }

  const hourParam = params.get("hour");
  const hour = hourParam !== null && /^\d+$/.test(hourParam) && +hourParam < 24 ? +hourParam : currentMiamiHour();

  const key = process.env.GOOGLE_MAPS_KEY;
  if (!key) return NextResponse.json({ ok: false, error: "GOOGLE_MAPS_KEY is not set" }, { status: 500 });

  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
    },
    body: JSON.stringify({
      origin: toWaypoint(from),
      destination: toWaypoint(to),
      travelMode: "DRIVE",
      computeAlternativeRoutes: true,
    }),
  });
  const google = await res.json();
  if (!res.ok) {
    console.error("Routes API error:", res.status, JSON.stringify(google));
    return NextResponse.json({ ok: false, error: google?.error?.message ?? "Routes API error" }, { status: 502 });
  }
  if (!google.routes?.length) {
    return NextResponse.json({ ok: false, error: "No route found" }, { status: 404 });
  }

  try {
    const routes = await Promise.all(
      google.routes.map((r: any) =>
        analyzeRoute(r.polyline.encodedPolyline, r.distanceMeters ?? 0, parseInt(r.duration ?? "0", 10), hour)
      )
    );

    routes.sort((a, b) =>
      a.confirmed_count - b.confirmed_count ||
      a.risk_this_hour - b.risk_this_hour ||
      a.duration_min - b.duration_min
    );

    return NextResponse.json({
      ok: true,
      hour_of_day: hour,
      routes: routes.map(({ confirmed_count, ...r }, i) => ({ rank: i + 1, ...r })),
    });
  } catch (err) {
    console.error("directions failed:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

// Decodes one Google route in PostGIS and finds confirmed incidents and high-risk roads along it.
async function analyzeRoute(polyline: string, distanceM: number, durationS: number, hour: number) {
  const [[geo], confirmedRows, historyRows] = await Promise.all([
    sql`SELECT ST_AsGeoJSON(ST_LineFromEncodedPolyline(${polyline}))::json AS geometry`,
    sql`
      WITH line AS (SELECT ST_LineFromEncodedPolyline(${polyline}) AS g)
      SELECT i.road_place_id, i.incident_type, i.report_count, i.first_reported, i.expires_at,
             i.lat, i.lon, r.name AS road_name,
             ST_LineLocatePoint(line.g, ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326)) AS position
      FROM incidents i
      CROSS JOIN line
      LEFT JOIN roads r ON r.place_id = i.road_place_id
      WHERE i.expires_at > now()
        AND ST_DWithin(line.g::geography, ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326)::geography, ${BUFFER_M})`,
    sql`
      WITH line AS (SELECT ST_LineFromEncodedPolyline(${polyline}) AS g),
      near AS (
        SELECT h.road_place_id, h.incident_type,
               count(*)::int AS hazard_hours,
               count(*) FILTER (
                 WHERE extract(hour FROM h.bucket AT TIME ZONE 'America/New_York') = ${hour}
               )::int AS hazard_hours_at_hour,
               sum(h.n)::int AS reports,
               avg(h.lat) AS lat, avg(h.lon) AS lon
        FROM report_heat h, line
        WHERE h.bucket > now() - interval '30 days'
          AND h.road_place_id IS NOT NULL
          AND ST_DWithin(line.g::geography, ST_SetSRID(ST_MakePoint(h.lon, h.lat), 4326)::geography, ${BUFFER_M})
        GROUP BY h.road_place_id, h.incident_type
      )
      SELECT n.*, r.name AS road_name,
             ST_LineLocatePoint(line.g, ST_SetSRID(ST_MakePoint(n.lon, n.lat), 4326)) AS position
      FROM near n
      CROSS JOIN line
      LEFT JOIN roads r ON r.place_id = n.road_place_id`,
  ]);

  const distanceMi = distanceM / METERS_PER_MILE;
  const durationMin = durationS / 60;
  const place = (position: number) => ({
    position: round(position, 3),
    distance_mi: round(position * distanceMi, 1),
    eta_min: Math.round(position * durationMin),
  });

  const confirmed: Hazard[] = confirmedRows.map((r) => ({
    kind: "confirmed",
    type: r.incident_type,
    road_place_id: r.road_place_id,
    road_name: r.road_name,
    lat: r.lat,
    lon: r.lon,
    ...place(r.position ?? 0),
    reports: r.report_count,
    since: r.first_reported,
    expires_at: r.expires_at,
  }));
  const confirmedRoads = new Set(confirmed.map((h) => h.road_place_id));

  const byRoad = new Map<string, { rows: any[]; pNone: number; top: any; topP: number }>();
  for (const r of historyRows) {
    const p = (r.hazard_hours_at_hour + PRIOR_DAYS * (r.hazard_hours / WINDOW_HOURS)) / (WINDOW_DAYS + PRIOR_DAYS);
    const road = byRoad.get(r.road_place_id) ?? { rows: [], pNone: 1, top: r, topP: -1 };
    road.rows.push(r);
    road.pNone *= 1 - p;
    if (p > road.topP) {
      road.top = r;
      road.topP = p;
    }
    byRoad.set(r.road_place_id, road);
  }

  let routeNone = 1;
  const potential: Hazard[] = [];
  for (const [roadId, road] of byRoad) {
    const pRoad = 1 - road.pNone;
    routeNone *= road.pNone;
    if (confirmedRoads.has(roadId) || pRoad < POTENTIAL_MIN) continue;
    potential.push({
      kind: "potential",
      type: road.top.incident_type,
      road_place_id: roadId,
      road_name: road.top.road_name,
      lat: road.top.lat,
      lon: road.top.lon,
      ...place(road.top.position ?? 0),
      p_this_hour: round(pRoad, 3),
    });
  }
  potential.sort((a, b) => (b.p_this_hour ?? 0) - (a.p_this_hour ?? 0));

  const hazards = [...confirmed, ...potential.slice(0, MAX_POTENTIAL)].sort((a, b) => a.position - b.position);

  return {
    duration_min: Math.round(durationMin),
    distance_mi: round(distanceMi, 1),
    risk_this_hour: round(1 - routeNone, 3),
    confirmed_count: confirmed.length,
    geometry: geo.geometry,
    hazards,
  };
}

// Turns "lat,lon" into a coordinate waypoint; anything else is sent to Google as an address.
function toWaypoint(input: string) {
  const m = input.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) return { location: { latLng: { latitude: +m[1], longitude: +m[2] } } };
  return { address: input };
}

// Current hour of day (0-23) in Miami time.
function currentMiamiHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/New_York" }).format(new Date())
  );
}

// Rounds to a given number of decimals.
function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}