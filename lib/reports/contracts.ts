import type {
  Coordinates,
  IncidentType,
  Report,
  ReportLocation,
  Timestamp,
} from "./types";

/** POST /api/reports/interpret — prepares playback, never submits a report. */
export interface InterpretReportRequest extends Coordinates {
  /** Raw spoken text; the server filters/classifies this into IncidentType. */
  incidentType: string;
  userID: number;
  timeStamp: Timestamp;
}

export type InterpretReportResponse =
  | {
      status: "awaiting_confirmation";
      /** Opaque ID of a server-held draft, bound to the authenticated user. */
      draftId: string;
      expiresAt: Timestamp;
      incidentType: IncidentType;
      location: ReportLocation;
      transcript: string;
      /** Read aloud by the shortcut, including category, location and yes/no. */
      playbackText: string;
    }
  | {
      status: "needs_clarification";
      field: "incident_type" | "location" | "description";
      /** Read aloud; corrected input is sent as a new interpretation request. */
      prompt: string;
    };

/** POST /api/reports — both sources converge here. */
export type SubmitReportRequest =
  | {
      source: "apple_shortcut";
      draftId: string;
      /** Only send after an explicit yes to this draft's playback. */
      confirmed: true;
    }
  | {
      source: "manual";
      incidentType: IncidentType;
      userID: number;
      timeStamp: Timestamp;
      /** Server validates/resolves the selected place before persistence. */
      googlePlaceId: string;
      description?: string;
    };

/** Required submission header; reuse the same key when retrying a request. */
export interface SubmitReportHeaders {
  "Idempotency-Key": string;
}

export interface SubmitReportResponse {
  status: "submitted";
  report: Report;
}

export type ReportApiErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHENTICATED"
  | "DRAFT_NOT_FOUND"
  | "DRAFT_EXPIRED"
  | "PLACE_NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "SERVICE_UNAVAILABLE";

export interface ReportApiError {
  error: {
    code: ReportApiErrorCode;
    message: string;
  };
}
