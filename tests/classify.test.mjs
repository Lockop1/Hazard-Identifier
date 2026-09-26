import assert from "node:assert/strict";
import test from "node:test";
import { classifyIncident } from "../lib/reports/classify.ts";

const examples = [
  ["Two cars crashed at the intersection", "collision"],
  ["A crash is blocking the lane", "collision"],
  ["A FALLEN TREE is blocking the road!", "road_obstruction"],
  ["There is debris on the street", "road_obstruction"],
  ["A truck is blocking both lanes", "road_obstruction"],
  ["The street is flooded", "flooding"],
  ["Standing water is blocking the road", "flooding"],
  ["The traffic lights aren't working", "traffic_signal_issue"],
  ["The traffic light isn’t working", "traffic_signal_issue"],
  ["Broken traffic signals at the junction", "traffic_signal_issue"],
  ["The traffic signal is not working", "traffic_signal_issue"],
  ["The traffic lights are out", "traffic_signal_issue"],
  ["There is a large pothole", "other"],
];
for (const [input, expected] of examples) {
  test(input, () => {
    assert.deepEqual(classifyIncident(input), {
      status: "classified", incidentType: expected, transcript: input,
    });
  });
}

for (const input of ["", "Something is wrong", "I am at the traffic light"]) {
  test(`Unclear: ${input}`, () => {
    assert.equal(classifyIncident(input).reason, "no_match");
  });
}

for (const input of ["There is no crash", "The fallen tree was cleared", "The flood is gone", "The lights are not broken"]) {
  test(`Negative/resolved: ${input}`, () => {
    assert.equal(classifyIncident(input).reason, "negated_or_resolved");
  });
}

for (const input of ["A collision and flooding", "Crash crash crash and floodwater", "Debris and a broken traffic light"]) {
  test(`Multiple hazards: ${input}`, () => {
    assert.equal(classifyIncident(input).reason, "ambiguous");
  });
}

// These must never produce a category merely because a hazard word appears.
for (const input of [
  "My phone crashed",
  "The app crashed while I was driving on the road",
  "My computer crashed",
  "The crash report on my phone is not working",
  "The cars didn't crash",
  "The cars didn’t crash",
  "There hasn't been a collision",
  "There hadn’t been flooding",
  "I can't see debris",
  "I cannot see debris",
  "No crash, just debris",
  "Not sure if it's a crash or debris",
  "The traffic lights are working, my phone is out",
  "The traffic light isn't not working",
  "The crash report is not working",
  "The traffic lights are working, the shop is out of power",
  "The traffic lights are working but the streetlights are broken",
  "The traffic lights are not working but there is no crash",
]) {
  test(`Do not misclassify: ${input}`, () => {
    const result = classifyIncident(input);
    assert.equal(result.status, "needs_clarification");
    assert.equal("incidentType" in result, false);
  });
}

test("Device context stays distinct from negation", () => {
  assert.equal(classifyIncident("My phone crashed").reason, "non_road_context");
  assert.equal(classifyIncident("The cars didn't crash").reason, "negated_or_resolved");
});
