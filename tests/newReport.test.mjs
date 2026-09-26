import assert from "node:assert/strict";
import test from "node:test";
import { newReport } from "../lib/reports/newReport.ts";
import { classifyIncident } from "../lib/reports/classify.ts";
import { INCIDENT_TYPES } from "../lib/reports/types.ts";

const validInput = () => ({
  TimeStamp: 1790415000000,
  UserID: 123,
  Location: { latitude: 40.7128, longitude: -74.006 },
  googlePlaceID: "example-place-id",
  incidentID: "incident-123",
  incidentType: "road_obstruction",
});

function assertInvalid(input, field) {
  const result = newReport(input);
  assert.equal(result.status, "invalid");
  assert.equal("report" in result, false, "Invalid input must never return a partial report");
  assert.ok(result.errors.some((error) => error.field === field));
}

test("Creates the exact report fields with an empty eventID", () => {
  const input = validInput();
  assert.deepEqual(newReport(input), {
    status: "created", report: { ...input, eventID: null },
  });
});

test("Does not mutate input, share location state, or accept an injected eventID", () => {
  const input = { ...validInput(), eventID: "existing-event", extra: "ignored" };
  Object.freeze(input.Location);
  Object.freeze(input);
  const result = newReport(input);
  assert.equal(result.status, "created");
  assert.equal(result.report.eventID, null);
  assert.equal("extra" in result.report, false);
  result.report.Location.latitude = 0;
  assert.equal(input.Location.latitude, 40.7128);
  assert.equal(input.eventID, "existing-event");
});

for (const category of INCIDENT_TYPES) {
  test(`Accepts resolved category: ${category}`, () => {
    const result = newReport({ ...validInput(), incidentType: category });
    assert.equal(result.status, "created");
    assert.equal(result.report.incidentType, category);
  });
}

for (const field of Object.keys(validInput())) {
  test(`Rejects missing required field: ${field}`, () => {
    const input = validInput();
    delete input[field];
    assertInvalid(input, field);
  });
}

const malformed = {
  TimeStamp: [null, undefined, "1790415000000", "2026-09-26", NaN, Infinity, -1, 1.5, 8_640_000_000_000_001],
  UserID: [null, undefined, "123", NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1],
  Location: [null, undefined, "Main Street", [], {}, { latitude: 0 }, { longitude: 0 },
    { latitude: "40", longitude: 0 }, { latitude: 0, longitude: "10" },
    { latitude: NaN, longitude: 0 }, { latitude: 0, longitude: Infinity },
    { latitude: 91, longitude: 0 }, { latitude: -91, longitude: 0 },
    { latitude: 0, longitude: 181 }, { latitude: 0, longitude: -181 }],
  googlePlaceID: [null, undefined, "", "  ", 123, {}],
  incidentID: [null, undefined, "", "\t", 123, {}],
  incidentType: [null, undefined, "", "COLLISION", "a car crashed", "unknown", 123, {}],
};

for (const [field, values] of Object.entries(malformed)) {
  test(`Rejects malformed ${field}`, () => {
    for (const value of values) assertInvalid({ ...validInput(), [field]: value }, field);
  });
}

test("Rejects non-object input without throwing", () => {
  for (const input of [null, undefined, [], "report", 123, true]) assertInvalid(input, "input");
});

test("Reports all missing fields without assembling a report", () => {
  const result = newReport({});
  assert.equal(result.status, "invalid");
  assert.equal("report" in result, false);
  assert.deepEqual(result.errors.map((error) => error.field).sort(), Object.keys(validInput()).sort());
});

test("Rejects clarification states, including actual classifier output", () => {
  const clarification = classifyIncident("No crash, just debris");
  assert.equal(clarification.status, "needs_clarification");
  for (const incidentType of ["needs_clarification", { status: "needs_clarification" }, clarification]) {
    assertInvalid({ ...validInput(), incidentType }, "incidentType");
  }
});

test("Accepts the resolved category from upstream classification", () => {
  const classified = classifyIncident("Debris in the lane");
  assert.equal(classified.status, "classified");
  assert.equal(newReport({ ...validInput(), incidentType: classified.incidentType }).status, "created");
});

test("Accepts zero values and coordinate boundaries", () => {
  for (const Location of [{ latitude: 0, longitude: 0 }, { latitude: -90, longitude: -180 }, { latitude: 90, longitude: 180 }]) {
    assert.equal(newReport({ ...validInput(), TimeStamp: 0, UserID: 0, Location }).status, "created");
  }
});
