import type { IncidentType } from "./types";

type Rule = { category: IncidentType; weight: number; pattern: RegExp };

// Keep the failure attached to the signal, not an arbitrary nearby sentence.
const SIGNAL_FAILURE = /\b(?:traffic (?:lights?|signals?)|stoplights?)\s+(?:(?:is|are|was|were)\s+)?(?:(?:currently|still)\s+)?(?:not working|out(?: of order)?|broken|malfunctioning|stuck|flashing)\b/;

// Specific hazard terms outweigh generic effects such as "blocking traffic".
// Each rule contributes once, so repeating a word does not increase its score.
const RULES: readonly Rule[] = [
  { category: "collision", weight: 4, pattern: /\b(crash(?:ed|es)?|collision|accident|pileup|rear ended)\b/ },
  { category: "collision", weight: 4, pattern: /\b(?:cars?|vehicles?|trucks?)\s+(?:hit|collided|crashed into)\b/ },
  { category: "road_obstruction", weight: 4, pattern: /\b(fallen tree|downed tree|debris|road obstruction|stalled (?:car|vehicle)|broken down (?:car|vehicle))\b/ },
  { category: "road_obstruction", weight: 2, pattern: /\b(block(?:ed|ing)?|obstruct(?:ed|ing)?)\s+(?:(?:the|a|both|all|right|left)\s+)*(road|lane|lanes|street|traffic)\b/ },
  { category: "flooding", weight: 4, pattern: /\b(flood(?:ed|ing|water|s)?|underwater)\b/ },
  { category: "flooding", weight: 4, pattern: /\b(?:standing|rising|deep) water\b|\bwater (?:covering|across|over) (?:the )?(?:road|street|lanes?)\b/ },
  { category: "traffic_signal_issue", weight: 4, pattern: SIGNAL_FAILURE },
  { category: "traffic_signal_issue", weight: 4, pattern: /\b(?:broken|malfunctioning|flashing) (?:traffic (?:lights?|signals?)|stoplights?)\b/ },
  { category: "other", weight: 4, pattern: /\b(potholes?|sinkholes?|road damage|icy road|black ice)\b/ },
];

export type ClassificationResult =
  | { status: "classified"; incidentType: IncidentType; transcript: string }
  | {
      status: "needs_clarification";
      reason: "no_match" | "ambiguous" | "negated_or_resolved" | "non_road_context";
      transcript: string;
      prompt: string;
    };

/** A conservative phrase matcher, not a general natural-language interpreter. */
export function classifyIncident(transcript: string): ClassificationResult {
  const text = transcript
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\b[a-z]+n't\b|\bcannot\b/g, "not")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Mixed road/device descriptions are intentionally clarified too: a road
  // keyword alone does not turn a software crash into a vehicle collision.
  if (/\b(phones?|smartphones?|iphones?|apps?|applications?|computers?|laptops?|software|browsers?|websites?|servers?|games?)\b/.test(text)) {
    return {
      status: "needs_clarification",
      reason: "non_road_context",
      transcript,
      prompt: "Please describe the hazard on the road, rather than a device or software problem.",
    };
  }

  // Exempt "not working" only when directly attached to a traffic signal.
  // Other negation (including a second "not") still requests clarification.
  const negationText = text.replace(new RegExp(SIGNAL_FAILURE.source, "g"),
    (match) => match.replace(/\bnot working\b/, "malfunctioning"));
  if (/\b(no|not|never|without|cleared|resolved|removed|reopened|fixed)\b|\b(?:gone|no longer)\b/.test(negationText)) {
    return {
      status: "needs_clarification",
      reason: "negated_or_resolved",
      transcript,
      prompt: "Please describe a hazard that is currently present, or cancel the report.",
    };
  }

  const scores = new Map<IncidentType, number>();
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      scores.set(rule.category, (scores.get(rule.category) ?? 0) + rule.weight);
    }
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const best = ranked[0];
  if (!best) {
    return {
      status: "needs_clarification",
      reason: "no_match",
      transcript,
      prompt: "What hazard do you see? Please describe what happened or what is blocking the road.",
    };
  }

  // Multiple specific hazards need a choice even if one has more synonyms.
  const specificCategories = new Set(
    RULES.filter((rule) => rule.weight >= 4 && rule.pattern.test(text))
      .map((rule) => rule.category),
  );
  if (specificCategories.size > 1 || (ranked[1] && ranked[1][1] === best[1])) {
    return {
      status: "needs_clarification",
      reason: "ambiguous",
      transcript,
      prompt: "I heard more than one kind of hazard. Which single hazard would you like to report first?",
    };
  }

  return { status: "classified", incidentType: best[0], transcript };
}
