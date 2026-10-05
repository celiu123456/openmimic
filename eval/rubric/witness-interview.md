# Witness Interview Rubric

Blind evaluation rubric for interviewer follow-up quality.
Used by the five-dimension judge prompt (SHA-frozen).

## Veto Items (automatic fail, score = 0)

Any single occurrence disqualifies the interview round:

1. **Fabricated attribution**: follow-up claims the witness said something they did not say.
2. **Leaked subject self-report**: follow-up reveals information that only the subject would know.
3. **Role violation**: interviewer expresses personal opinions, judges the witness's answer, or takes sides.
4. **Premature ending**: interviewer unilaterally terminates the interview before the question tree is exhausted.
5. **Multiple questions in one turn**: follow-up contains more than one question mark (interrogative).
6. **Repetition**: follow-up is a near-duplicate of a previous question (2-gram Jaccard >= 0.58 or containment >= 0.72).
7. **Privacy breach**: follow-up references a doNotRaiseToSubject answer from another question.

## Evidence Levels

| Level | Label | Description |
|-------|-------|-------------|
| E0 | bare_evaluation | "He's nice" -- no event, no context, no detail. |
| E1 | vague_event | An event is mentioned but lacks specifics (who, when, where). |
| E2 | situated_event | A specific event with at least two of: time, place, participants, dialogue. |
| E3 | rich_testimony | E2 plus the witness's own feeling or interpretation, clearly distinguished from the event itself. |

## Five Scoring Dimensions

Each dimension is scored 0-5. The judge evaluates a (question, answer, follow-up) triple.

### 1. Elicitation Effectiveness (weight: 0.30)

Does the follow-up move the evidence level upward?

- 5: Follow-up elevates evidence from E0/E1 to E2/E3.
- 3: Follow-up maintains the evidence level but adds a new facet.
- 1: Follow-up adds nothing; the answer after the follow-up is no richer.
- 0: Follow-up triggers a veto item.

### 2. Witness Comfort (weight: 0.25)

Does the follow-up respect the witness's boundaries and emotional state?

- 5: Casual, conversational tone; witness continues freely.
- 3: Neutral tone; no sign of discomfort but no warmth either.
- 1: Witness shows signs of reluctance or fatigue after the follow-up.
- 0: Follow-up pushes past an explicit retreat or distress signal.

### 3. Topical Relevance (weight: 0.20)

Is the follow-up on-topic for the current dimension?

- 5: Directly deepens the dimension the question targets.
- 3: Adjacent dimension; reasonable exploratory move.
- 1: Off-topic but still about the subject.
- 0: Completely unrelated or about the witness's own life.

### 4. Evidence Separation (weight: 0.15)

Does the follow-up maintain the three-layer separation (SUBJECT / RESPONDENT / RELATION)?

- 5: Follow-up clearly targets subject's behavior, not witness's feelings.
- 3: Mixes layers but the primary target is still the subject.
- 1: Follow-up conflates witness self-report with subject claim.
- 0: Follow-up treats witness's feeling as a fact about the subject.

### 5. Non-Mechanical Naturalness (weight: 0.10)

Does the follow-up feel like a natural conversation, not a scripted interrogation?

- 5: Reads like a curious friend asking a follow-up over coffee.
- 3: Acceptable but formulaic ("Can you give an example?").
- 1: Robotic or template-like; ignores the specific content of the answer.
- 0: Verbatim repeat of a stock phrase used in a previous round.

## Composite Score

```
composite = sum(dimension_score * weight) for all 5 dimensions
```

If any veto item is triggered, composite = 0 regardless of dimension scores.

Passing threshold: composite >= 3.0 (out of 5.0).

## Judge Protocol

1. Judge receives a randomized pair of (question, answer, follow-up) triples, labeled A and B.
2. Position is swapped between runs to cancel order bias.
3. Judge scores each triple on all 5 dimensions independently.
4. Judge identifies any veto items before scoring.
5. The prompt text is SHA-256 frozen; any edit produces a new hash and invalidates prior runs.
