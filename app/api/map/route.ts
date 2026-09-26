// GET for the front end (active incidents and the heat map)
import { NextResponse } from "next/server";

// Placeholder so the file is a valid module; real query comes with lib/incidents.ts.
export async function GET() {
  return NextResponse.json({ incidents: [] });
}
