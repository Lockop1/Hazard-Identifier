import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { classifyIncident } from "@/lib/reports/classify";

export const dynamic = "force-dynamic";

const REPORTS_TO_CONFIRM = 5;

// Reads ?transcript=&lat=&lon=&reporter_id= from the URL, classifies it, finds the road, saves the report, and updates incidents. No params = health check.
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;

  if (!p.has("transcript")) {
    return NextResponse.json({ ok: true, message: "report endpoint is reachable" });
  }

  const transcript = p.get("transcript") ?? "";
  const lat = parseFloat(p.get("lat") ?? "");
  const lon = parseFloat(p.get("lon") ?? "");
  const reporter_id = p.get("reporter_id") ?? "";

  const errors: string[] = [];
  if (!transcript.trim()) errors.push("transcript must be non-empty");
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) errors.push("lat must be a number in [-90, 90]");
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) errors.push("lon must be a number in [-180, 180]");
  if (!reporter_id.trim()) errors.push("reporter_id must be non-empty");
  if (errors.length) return NextResponse.json({ ok: false, errors }, { status: 400 });

  const result = classifyIncident(transcript);
  if (result.status !== "classified") {
    return NextResponse.json({ ok: false, reason: result.reason, prompt: result.prompt }, { status: 422 });
  }
  const incidentType = result.incidentType;

  try {
    const roadId = await getRoadId(lat, lon);

    await sql`INSERT INTO reporters (reporter_id) VALUES (${reporter_id}) ON CONFLICT DO NOTHING`;
    await sql`
      INSERT INTO reports (time, incident_type, reporter_id, geom, road_place_id, transcript)
      VALUES (now(), ${incidentType}, ${reporter_id},
              ST_SetSRID(ST_MakePoint(${lon}::float8, ${lat}::float8), 4326),
              ${roadId}, ${transcript})`;

    const incident = roadId ? await updateIncident(roadId, incidentType) : "none";

    return NextResponse.json({ ok: true, incident_type: incidentType, road_place_id: roadId, incident });
  } catch (err) {
    console.error("report failed:", err);
    return NextResponse.json({ ok: false, error: "server error" }, { status: 500 });
  }
}

// Returns the Google road segment ID for a location: reuses a nearby report's ID if one exists within ~20 m, otherwise asks Google.
async function getRoadId(lat: number, lon: number): Promise<string | null> {
  const [hit] = await sql`
    SELECT road_place_id FROM reports
    WHERE road_place_id IS NOT NULL
      AND time > now() - interval '30 days'
      AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint(${lon}::float8, ${lat}::float8), 4326), 0.0002)
    ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${lon}::float8, ${lat}::float8), 4326)
    LIMIT 1`;
  if (hit) return hit.road_place_id as string;

  const key = process.env.GOOGLE_MAPS_KEY;
  if (!key) {
    console.warn("GOOGLE_MAPS_KEY is not set");
    return null;
  }

  const res = await fetch(`https://roads.googleapis.com/v1/nearestRoads?points=${lat},${lon}&key=${key}`);
  const data = await res.json();
  const placeId: string | undefined = data.snappedPoints?.[0]?.placeId;
  if (!placeId) {
    console.warn("Google Roads returned no road:", res.status, JSON.stringify(data));
    return null;
  }

  await sql`INSERT INTO roads (place_id) VALUES (${placeId}) ON CONFLICT DO NOTHING`;
  return placeId;
}

// Extends an active incident on this road + type, or creates one if 5+ reports landed within the type's time window.
async function updateIncident(roadId: string, incidentType: string): Promise<"created" | "extended" | "none"> {
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${roadId + ":" + incidentType}))`;

    const extended = await tx`
      UPDATE incidents i
      SET expires_at = now() + make_interval(mins => t.ttl_minutes),
          report_count = i.report_count + 1
      FROM incident_types t
      WHERE t.incident_type = i.incident_type
        AND i.road_place_id = ${roadId}
        AND i.incident_type = ${incidentType}
        AND i.expires_at > now()
      RETURNING i.id`;
    if (extended.length) return "extended";

    const [agg] = await tx`
      SELECT count(*)::int AS n, min(r.time) AS first_reported,
             avg(ST_Y(r.geom)) AS lat, avg(ST_X(r.geom)) AS lon
      FROM reports r
      JOIN incident_types t ON t.incident_type = r.incident_type
      WHERE r.road_place_id = ${roadId}
        AND r.incident_type = ${incidentType}
        AND r.time > now() - make_interval(mins => t.window_minutes)`;
    if (!agg || agg.n < REPORTS_TO_CONFIRM) return "none";

    await tx`
      INSERT INTO incidents (road_place_id, incident_type, first_reported, expires_at, report_count, lat, lon)
      SELECT ${roadId}, ${incidentType}, ${agg.first_reported},
             now() + make_interval(mins => t.ttl_minutes), ${agg.n}, ${agg.lat}, ${agg.lon}
      FROM incident_types t WHERE t.incident_type = ${incidentType}`;
    return "created";
  });
}