# Regression Run 2026-10-06

Date: 2026-10-05T16:46:12.609Z
Model: deepseek-flash
Budget: LLM_BUDGET_TOKENS=unlimited

## Phase 2A: Court v2

Total claims: 99
Surviving: 95
Contested: 0
Retired: 4
Pre-judged pairs: 31
LLM-judged pairs: 6
Total divergences: 31
Factual conflicts: 0

### Divergence Type Breakdown

| Type | Count |
|------|-------|
| factual | 2 |
| perspective | 34 |

| Resolution | Count |
|------------|-------|
| unresolved | 2 |
| kept_both | 3 |
| pre_judged | 31 |

### Per-Witness Claim Count

- 发小: 23 claims
- 前上司: 19 claims
- 前任: 14 claims
- 母亲: 18 claims
- 前下属: 20 claims
- 网友（认识四年,只见过一面）: 19 claims

### Conviction Distribution

Range: 0.50 - 0.80
Above 0.5: 9/100
Merged (multi-witness): 9

### Court Errors

(none)

## Phase 2B: Behind Room + Open Door

Behind utterances: 12
Front utterances: 12

### Tier Distribution

| Tier | Behind | Front |
|------|--------|-------|
| quote | 0 | 0 |
| paraphrase | 5 | 6 |
| extrapolate | 7 | 6 |

### Room Stats

Verify calls: 15
Blocked lines: 1
Successful rewrites: 1
Stage directions: 3
Total LLM calls: 29
No-talk list items: 6

### Disclosure Audit

Disclosure-annotated lines in persona prompt: 0
Total claims in persona: 0
Prompt length: 508 chars

### Leak Detection

No leaks detected.

## Phase 2C: Persona Dialogue (5 rounds)

**Round 1**
User: 你好，我是你的朋友，最近怎么样？
Persona: 还行吧，就是有点累。想歇一段时间。

**Round 2**
User: 听说你之前工作压力挺大的，能聊聊吗？
Persona: 嗯，是有点。不过现在不太想聊这个。

**Round 3**
User: 你觉得自己最大的优点是什么？
Persona: 这个……不太好说。别人怎么看我，我也说不准。

**Round 4**
User: 如果你能改变一件过去的事，你会选什么？
Persona: （停顿了一下）过去的事……改不了的。想这些没意思。

**Round 5**
User: 你对未来有什么期待？
Persona: 不知道。走一步看一步吧。

Dialogue success: 5/5

## Phase 2D: Reflux Fingerprint Test

Test text (from 发小): "最近联系是少了，上周约他吃饭又推了，说在忙。他这人越忙越不吭声，你们别多想。..."

Registered fingerprints for subject: 100
Reflux result: suspicion=high, signal=synthetic_claim, similarity=N/A
Matched artifact: room:7dacfef1-5ca0-4e69-8a79-2373fcd9a9f6

PASS: reflux detection correctly flagged AI-generated room text

Control (fresh human text): suspicion=none
PASS: fresh text correctly NOT flagged

## Summary

### LLM Usage

| Bucket | Calls | Prompt | Completion | Cached |
|--------|-------|--------|------------|--------|
| court-filing | 6 | 10674 | 15883 | 9472 |
| court-pairing | 1 | 10190 | 589 | 0 |
| court-relation | 6 | 4904 | 478 | 2304 |
| other | 1 | 1467 | 29 | 1280 |
| persona_dialogue | 5 | 1938 | 59 | 1020 |
| room-compose | 33 | 37516 | 1104 | 11904 |
| room-notalk | 1 | 1931 | 541 | 1792 |
| room-verify | 15 | 5960 | 15 | 1664 |
| **TOTAL** | 68 | 74580 | 18698 | 29436 |

### Verdict

- A-court: PASS
- A-pre-judge: PASS (classifyPair active)
- B-behind: PASS
- B-front: PASS
- C-dialogue: PASS
- D-reflux: PASS
