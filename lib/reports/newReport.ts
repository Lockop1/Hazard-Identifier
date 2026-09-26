import { INCIDENT_TYPES } from "./types.ts";
import type { Coordinates, IncidentType, Timestamp } from "./types";

/** Field names follow the design document. IDs are supplied by the caller. */
export interface NewReportInput {
  TimeStamp: Timestamp;
  UserID: number;
  Location: Coordinates;
  googlePlaceID: string;
  incidentID: string;
  incidentType: IncidentType;
}

/** Ready for future potentialIncident storage; no event exists on creation. */
export interface PotentialIncidentReport extends NewReportInput {
  eventID: null;
}

export type NewReportResult =
  | { status: "created"; report: PotentialIncidentReport }
  | {
      status: "invalid";
      errors: { field: keyof NewReportInput | "input"; message: string }[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCoordinate(value: unknown, limit: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;
}

function isNonblankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIncidentType(value: unknown): value is IncidentType {
  return typeof value === "string" && INCIDENT_TYPES.some((category) => category === value);
}

/** Validate and assemble only. Does not classify text, write storage, or create events. */
export function newReport(input: unknown): NewReportResult {
  if (!isRecord(input)) {
    return { status: "invalid", errors: [{ field: "input", message: "Expected a report object." }] };
  }

  const errors: Extract<NewReportResult, { status: "invalid" }>["errors"] = [];
  const { TimeStamp, UserID, Location, googlePlaceID, incidentID, incidentType } = input;

  if (typeof TimeStamp !== "number" || !Number.isSafeInteger(TimeStamp) ||
      TimeStamp < 0 || TimeStamp > 8_640_000_000_000_000) {
    errors.push({ field: "TimeStamp", message: "Expected nonnegative Unix milliseconds within the supported Date range." });
  }
  if (typeof UserID !== "number" || !Number.isSafeInteger(UserID) || UserID < 0) {
    errors.push({ field: "UserID", message: "Expected a nonnegative safe integer user ID." });
  }
  if (!isRecord(Location) || !isCoordinate(Location.latitude, 90) || !isCoordinate(Location.longitude, 180)) {
    errors.push({ field: "Location", message: "Expected numeric latitude [-90, 90] and longitude [-180, 180]." });
  }
  if (!isNonblankString(googlePlaceID)) {
    errors.push({ field: "googlePlaceID", message: "Expected a nonblank place ID string." });
  }
  if (!isNonblankString(incidentID)) {
    errors.push({ field: "incidentID", message: "Expected a nonblank incident ID string." });
  }
  if (!isIncidentType(incidentType)) {
    errors.push({ field: "incidentType", message: "Expected an already resolved, supported incident category." });
  }

  if (errors.length > 0) return { status: "invalid", errors };

  // The checks above validate all fields before any report is assembled.
  const valid = input as unknown as NewReportInput;
  return {
    status: "created",
    report: {
      TimeStamp: valid.TimeStamp,
      UserID: valid.UserID,
      Location: { latitude: valid.Location.latitude, longitude: valid.Location.longitude },
      googlePlaceID: valid.googlePlaceID,
      incidentID: valid.incidentID,
      incidentType: valid.incidentType,
      eventID: null,
    },
  };
}
