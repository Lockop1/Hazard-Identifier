# Incident classification — checkpoint 2

Status: the five categories and phrase-based approach are approved. The first
classifier is implemented in `lib/reports/classify.ts`, awaiting checkpoint review.
It is not yet connected to an API endpoint.

The shortcut sends a free-text `incidentType`. The server preserves that text
and matches known phrases to one supported category. Manual submissions already
contain a selected category and do not need text classification.

## Supported categories

| Stored category | Spoken label | Example description |
| --- | --- | --- |
| `collision` | Collision | Two cars crashed at the intersection. |
| `road_obstruction` | Road obstruction | A fallen tree is blocking the lane. |
| `flooding` | Flooding | The road is covered in floodwater. |
| `traffic_signal_issue` | Traffic signal issue | The traffic lights are not working. |
| `other` | Other hazard | There is a large pothole in the road. |

Extend the category list and classifier rules together when adding categories.

## Interpretation rules

- Match normalized words and phrases using word boundaries. Specific hazard
  rules score 4; generic obstruction rules score 2. Each rule scores only once.
- One clear, current hazard produces one category for spoken confirmation.
- A recognized miscellaneous hazard (such as a pothole) becomes `other`, with its
  description included in playback so the user can confirm what is being reported.
- An unclear description such as "something is wrong" prompts for clarification;
  it must not silently become `other`.
- A negated or resolved hazard such as "there is no crash" or "the tree has been
  cleared" must not become a new positive hazard report. Ask the user to describe
  a current hazard or cancel.
- If separate hazards are described, ask which to report first. Do not silently
  create multiple reports. For a single incident with consequences, prefer the
  explicit cause: "a crash is blocking the lane" maps to `collision`.
- Preserve the original text independently of the category for playback and review.
- Voice results always require the agreed spoken confirmation before submission.

## Verification and limitations

Run `npm test` with Node.js 24 (which supports importing these TypeScript files)
and run `npx tsc --noEmit --incremental false` for type checking.

Tests cover the five categories, case/punctuation, signal-failure contractions,
cause versus generic obstruction, unclear text, negative/resolved reports, and
multiple specific hazards. Results preserve the original transcript and return
either a classified category or a clarification reason and spoken prompt.

This is a bounded English phrase matcher. It does not understand arbitrary
speech, complex negation, historical context, or all non-road meanings of keywords.
Recognized device/software context (for example, a phone or computer crash)
requests clarification, including mixed road/device descriptions. Negative
contractions and `cannot` normalize to `not`. Negative/resolved wording
conservatively asks for clarification for the whole description; `not working`
is exempt only when directly attached to a traffic signal. Signal failures must
be attached to the signal phrase, not merely nearby in the text. Unknown
hazards also ask for clarification rather than silently becoming `other`.
Multiple specific categories prompt for clarification even if scores differ.
Spoken confirmation remains required; classification itself never submits a report.
