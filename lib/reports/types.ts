/** Supported categories; extend this list and classification rules together. */
export const INCIDENT_TYPES = [
  "collision",
  "road_obstruction",
  "flooding",
  "traffic_signal_issue",
  "other",
] as const;

export type IncidentType = (typeof INCIDENT_TYPES)[number];

/** WGS84 coordinates. Validate latitude [-90, 90] and longitude [-180, 180]. */
export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Submitted coordinates enriched by the server with Google place data. */
export interface ReportLocation extends Coordinates {
  googlePlaceId: string;
  label: string;
}

/** Unix milliseconds since 1970-01-01T00:00:00Z, matching Date.now().
 * Keep numeric in API data; format for readability only when displaying.
 */
export type Timestamp = number;

/** A report accepted for persistence in TigerData after submission. */
export interface Report {
  id: string;
  userId: number;
  source: "apple_shortcut" | "manual";
  incidentType: IncidentType;
  location: ReportLocation;
  /** Original transcript for voice reports; optional description for manual. */
  description: string | null;
  /** Client-supplied report time, retained separately from server creation time. */
  timeStamp: Timestamp;
  createdAt: Timestamp;
  /** Null until event processing associates the report with an event. */
  eventId: string | null;
}
