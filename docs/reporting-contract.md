# Reporting contract — checkpoint 1

This is a proposed API contract, not implemented endpoints. Shared TypeScript
definitions are in `lib/reports/types.ts` and `lib/reports/contracts.ts`.
The application uses TypeScript, Next.js, React, and TigerData. Database schema,
authentication, classifier, and place lookup integration are later checkpoints.

## Agreed input flow

Apple Shortcuts sends raw incident text, longitude, latitude, numeric `userID`,
and `timeStamp`. The server filters the text into a category and calls the Google
API with the coordinates to resolve a place ID and location label. The shortcut reads the
interpreted category and location aloud and asks for confirmation. Only an
explicit yes submits the report. No lets the user retry or cancel. Manual input
uses category and location selections with a Submit button and no extra prompt.

The input field is named `userID`; the stored report uses numeric `userId`.
The submitted ID identifies the reporting user; it is not itself authentication.
The authentication mechanism and verification of the submitted ID are still
to be chosen. Drafts must be bound to the verified reporting user.

## Interpret a voice report

`POST /api/reports/interpret`

```json
{
  "incidentType": "There is a fallen tree blocking the road",
  "longitude": -74.006,
  "latitude": 40.7128,
  "userID": 123,
  "timeStamp": 1790415000000
}
```

On success, return HTTP 200 with `status: "awaiting_confirmation"`, an opaque
`draftId`, `expiresAt`, the original `transcript`, interpreted `incidentType`,
resolved `location`, and `playbackText`. For example:

> Report a road obstruction at Main Street. Is that correct?

If category or location cannot be resolved, return HTTP 200 with
`status: "needs_clarification"`, `field`, and a spoken `prompt`. The shortcut
collects clarification and sends a new complete request with corrected input.
The request's `incidentType` is free text, not a trusted category. Preserve it as
the response's `transcript` and the submitted report's `description`.
Latitude and longitude are required top-level numbers. The shortcut does not
provide a Google place ID. Preserve the submitted coordinates and enrich them
with the place ID and label returned by the server's Google API lookup before
playback. Google endpoint and place-selection rules are a later checkpoint.

`timeStamp` is supplied by the shortcut as Unix milliseconds: a JSON number
counting milliseconds since 1970-01-01T00:00:00Z, matching JavaScript `Date.now()`.
All API timestamps, including `createdAt` and draft `expiresAt`, use this unit.
Do not send Unix seconds or formatted date strings. Format values for display
using `new Date(timeStamp)` and the user's locale/timezone; retain the numeric
value in API data. Database timestamp conversion belongs at the persistence boundary.
Retain this value in the draft and report, separately from the server-generated
`createdAt`. Which timestamp drives event windows remains an open decision.

Interpretation creates a temporary draft, not a submitted report. It does not
count toward events or points. Store the draft server-side and bind it to the
authenticated user. Draft lifetime and storage are not decided yet.

## Submit a report

`POST /api/reports` with a required `Idempotency-Key` header.

Confirmed voice input:

```json
{
  "source": "apple_shortcut",
  "draftId": "example-draft-id",
  "confirmed": true
}
```

The shortcut sends this only after explicit confirmation. No, cancel, and
unrecognized responses must not submit. The server submits the exact draft
that was played back, checks ownership and expiry, and accepts it at most once.
Changing the interpretation requires a new draft and another confirmation.

Manual input:

```json
{
  "source": "manual",
  "incidentType": "road_obstruction",
  "userID": 123,
  "timeStamp": 1790415000000,
  "googlePlaceId": "example-selected-place-id",
  "description": "Fallen tree blocking the right lane"
}
```

The server validates the category and resolves the selected place to its label
and coordinates. It creates the report ID and server `createdAt` timestamp,
retains the client's `timeStamp`, persists the report in
TigerData, and passes it to the shared event-processing flow. Event processing
and point rules are outside this checkpoint and remain unapproved.

Return HTTP 201 with `{ "status": "submitted", "report": ... }` after successful
persistence. Scope idempotency keys to the authenticated user. Retrying a
successful request returns the same report; reusing the key with different input
returns HTTP 409. Repeated submission of the same voice draft must also return
the original report rather than create another, even with a different key.

## Validation and errors

TypeScript types do not validate incoming JSON. Endpoint implementation must add
runtime validation for request variants, nonempty text and IDs, allowed categories,
finite coordinate ranges, numeric integer user IDs, finite safe-integer timestamps
in milliseconds within the supported date range, and explicit
voice confirmation. Validate referenced
places and draft ownership on the server.

Errors use `{ "error": { "code": "...", "message": "..." } }`:

| HTTP status | Code |
| --- | --- |
| 400 | `INVALID_REQUEST` |
| 401 | `UNAUTHENTICATED` |
| 404 | `DRAFT_NOT_FOUND` (also for drafts owned by another user) |
| 410 | `DRAFT_EXPIRED` |
| 422 | `PLACE_NOT_FOUND` |
| 409 | `IDEMPOTENCY_CONFLICT` |
| 503 | `SERVICE_UNAVAILABLE` |

## Decisions for review

- Approved categories: collision, road obstruction, flooding, traffic
  signal issue, other. Phrase-based classification is implemented separately.
- Voice confirmation covers both category and location.
- Voice location uses submitted coordinates, resolved to a Google place ID on
  the server before playback. The manual selected-place contract remains a
  proposal; handling hazards between named places needs design.
- Unix milliseconds are agreed; which timestamp drives event windows remains open.
- Authentication, draft expiry/storage, Google integration, database schema,
  event thresholds, refresh limits, and point amounts remain open.
