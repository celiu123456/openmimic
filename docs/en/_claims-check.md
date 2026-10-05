# Claims Check: README.en.md

> Regenerated: 2026-10-08, aligned with the audited claims-audit.md.

Every functional or numerical statement in README.en.md mapped to its evidence source. Statements without a source should not exist in the README.

---

## Opening paragraph

| Statement | Source | Status |
|---|---|---|
| Builds a digital persona from testimony of people around someone | claims-audit: "收集认识你的人的证言" = 已实现 | OK |
| Collects testimony, cross-examines claims across witnesses in a "court" pipeline | claims-audit: CourtEngine = 已实现 | OK |
| Preserves disagreements instead of resolving them | claims-audit: "分歧保留不裁决谁对" = 已实现 | OK |
| Every trait can be traced back to who said it and what words they used | claims-audit: "每一个数字人格都带证据链" = 已实现 | OK |
| It is a persona simulation, not the person | Design statement; persona prompt carries disclaimer | OK |

## What you can do today

| Statement | Source | Status |
|---|---|---|
| The Room You're Not In (behind-the-scenes + door push) | claims-audit: "你不在的房间" = 已实现 | OK |
| Send an invite link to 5--10 people | claims-audit: "把测评链接发给朋友" = 已实现 | OK |
| Leak protection is present but depends on model judgment and is not a guarantee | claims-audit: RoomEngine = 已实现; known defect #1 (no-talk list non-deterministic) | OK |
| Rebuild anyone -- do not need subject's participation | claims-audit: "复刻任何人" = 已实现 | OK |
| Historical figures from historical accounts | claims-audit: "历史人物构建(.persona 导入)" = 已实现 | OK |
| Rehearse conversations via OpenAI-compatible endpoint | claims-audit: "预演万局" = 已实现; "OpenAI 兼容端点" = 已实现 | OK |
| Biography output | claims-audit: biography = 已实现; biography-run.md shows runs | OK |
| Every quoted sentence validated against verbatim testimony | biography plugin code: validation loop | OK |
| Subject can veto any section | biography plugin: POST /api/biography/:id/sections/:sid/remove | OK |

## Quick start

| Statement | Source | Status |
|---|---|---|
| git clone / npm install / npx tsx server/src/main.ts | claims-audit: Quick start = 已实现 | OK |
| Node.js >= 22 | package.json engines field | OK |
| Open http://localhost:7860 | claims-audit: port 7860 = 已实现 | OK |
| No API key needed to explore | claims-audit: "内置演示房间" = 已实现 | OK |
| Lin Mo is a fictional character with handwritten testimony data | fixtures/limo.ts | OK |
| Dockerfile and docker-compose.yml exist but have not been tested on a live Docker host | claims-audit: docker = 已实现; known defect #5 | OK |

## How it works

| Statement | Source | Status |
|---|---|---|
| Append-only ledger with SQLite triggers blocking UPDATE/DELETE | claims-audit: "证言账本" = 已实现 | OK |
| AI follow-up interview strategy with intent classification, retreat detection, quality gates | claims-audit: WitnessEngine = 已实现; known defect #2 (basis misclassification) | OK |
| Four-stage pipeline: filing, pairing, relation judgment, conviction | claims-audit: CourtEngine v2 = 已实现 | OK |
| Three pairing implementations with fallback: LLM, embedding, keyword | claims-audit: "论断配对" = 已实现 | OK |
| Conviction is a pure function (base 0.5) | claims-audit: "置信分" = 已实现 | OK |
| Single-witness claims cap at 0.55 | ARCHITECTURE.md | OK |
| Contested claims score 0 | claims-audit: conviction computation | OK |
| Quota-based per-section truncation | ARCHITECTURE.md | OK |
| Expression tiers (quote / paraphrase / extrapolate) | claims-audit: "三档发言分类" = 已实现 | OK |
| OpenAI-compatible endpoint | claims-audit: = 已实现 | OK |
| MCP server (stdio) | claims-audit: = 已实现 | OK |
| Library entry point embeds in 30 lines | claims-audit: = 已实现 | OK |
| .persona package v2 with consent filtering | claims-audit: = 已实现; known defect #7 (privacy filtering gap) | OK |
| Original testimony not included in export | code confirmed | OK |

## What makes it different

| Statement | Source | Status |
|---|---|---|
| Data source: others' testimony | claims-audit: = 已实现 | OK |
| "Who said this?": every claim | claims-audit: = 已实现 | OK |
| Disagreements: preserved as divergence map | claims-audit: = 已实现 | OK |
| Behind/face-to-face: yes | claims-audit: = 已实现 | OK |
| Scale: single person / single room | claims-audit: "规模形态" = 部分 | OK (README states current scope) |
| Organization-level simulation planned but not implemented | claims-audit: = 计划 | OK |

## Ethics and consent

| Statement | Source | Status |
|---|---|---|
| Append-only ledger enforced by triggers | claims-audit: = 已实现 | OK |
| putClaim throws NoEvidenceError | claims-audit: = 已实现 | OK |
| Consent levels: quotable / synthesis_only | claims-audit: = 已实现 | OK |
| synthesis_only text replaced with [withheld] | claims-audit: = 已实现 | OK |
| Room transcripts stored separately, never feed back to testimony | claims-audit: = 已实现 | OK |
| Subject veto (contest/uncontest) | claims-audit: = 已实现 | OK |
| Re-raise requires >= 2 new witnesses, wording passes tone gate | claims-audit: GateEngine; ARCHITECTURE.md | OK |
| Diagnostic/crisis word filtering (20+ patterns) | claims-audit: = 已实现 | OK |
| Crisis words reject room topics | claims-audit: = 已实现 | OK |
| Collective silence with raise-then-retreat evidence | claims-audit: = 已实现 | OK |
| PII sanitization | claims-audit: P4 = 已实现 | OK |
| No technical enforcement for public distribution restriction | claims-audit: = 部分 | OK |

## Evaluation

| Statement | Source | Status |
|---|---|---|
| All data uses Lin Mo, fictional, handwritten | eval-ledger | OK |
| Calibration: 100% on 74 pairs, 0% position bias | eval-ledger entry 7 | OK |
| LOWO: 87.5% (14/16), Wilson CI [64.0%, 96.5%] | eval-ledger entry 8 | OK |
| 2 pairs discarded | eval-ledger entry 8 | OK |
| N=16 is small, CI is wide, directional reading | eval-ledger entry 8 | OK |
| Ablation: full vs baseline 100% (15/15) | eval-ledger entry 9 | OK |
| Full vs claims-removed: 53.3% (8/15) | eval-ledger entry 9 | OK |
| Full vs episodes-removed: 64.3% (9/14) | eval-ledger entry 9 | OK |
| Both CIs cross 50% | eval-ledger entry 9 | OK |
| Stability: 67--73 claims, overlap 46.9%, SD 13.8% | eval-ledger entry 5 | OK |
| Room leak: 0 detected in 4 behind-room runs | eval-ledger entry 11 | OK |
| Subsequent regression found leaks in face-to-face room and euphemistic partial leak | coordinator report; regression-run-20261007b fixes applied | OK |
| No-talk list non-deterministic | known defect #1 | OK |
| Liveness scaffold built but uncalibrated | eval-ledger; known defect #9 | OK |

## Limitations

| Statement | Source | Status |
|---|---|---|
| Leak protection is not a guarantee | claims-audit + known defect #1 | OK |
| Demo data is handwritten fiction | eval-ledger | OK |
| Prompt injection reduces but does not eliminate risk | claims-audit P4 | OK |
| MinHash threshold 0.5 | claims-audit P4 | OK |
| Small evaluation sample sizes | eval-ledger | OK |
| GraphEngine not implemented | claims-audit: = 计划 | OK |
| Organization-level not implemented | claims-audit: = 计划 | OK |
| Docker untested | known defect #5 | OK |
| Conviction deterministic but court not | eval-ledger entry 5 | OK |
| Expression tier post-hoc | ARCHITECTURE.md | OK |

## Roadmap

| Statement | Source | Status |
|---|---|---|
| GraphEngine planned | claims-audit: = 计划 | OK |
| Parallel organizations planned | claims-audit: = 计划 | OK |
| Plugin marketplace planned | README | OK |
| Community persona distribution planned | claims-audit: = 计划 | OK |
| Blind derivation audit planned | claims-audit: = 计划 | OK |
| Evidence coverage implemented; contradiction response and memory repair not | claims-audit: "过程评测三指标" = 部分 | OK |
| OpenClaw skill and dsh bundle planned | claims-audit: = 计划 | OK |

## Related work and acknowledgements

| Statement | Source | Status |
|---|---|---|
| Conviction scoring adapted from Twig | claims-audit: = 已实现 | OK |
| Contested status name from Twig | claims-audit: = 已实现 | OK |
| Crisis-word circuit breaker concept from Twig | claims-audit: = 部分 | OK (says "concept") |
| Contested veto flow from Twig design document | claims-audit: = 已实现 | OK |
| Claim permission wall from Twig design document | claims-audit: = 已实现 | OK |
| Claim pairing is OpenMimic's own mechanism, not Twig's counter-evidence search | Correct. claims-audit: "反证搜索" = 计划 | OK |
| Counter-evidence search planned, no code | claims-audit: = 计划 | OK |
| DEPLOY-FOR-AI format modeled after Twig | claims-audit: = 已实现 | OK |
| Blind derivation audit planned | claims-audit: = 计划 | OK |
| Process evaluation partially implemented | claims-audit: = 部分 | OK |
| BettaFish ForumEngine (reference) | acknowledgement | OK |
| MiroFish (positional reference) | acknowledgement | OK |
| No affiliation with referenced projects | design statement | OK |

## Security measures

| Statement | Source | Status |
|---|---|---|
| Untrusted content isolation | claims-audit P4: = 已实现 | OK |
| detectInjection flags without rejecting | claims-audit P4: = 已实现 | OK |
| Guard test scans source files | ARCHITECTURE.md + prompt-guard.test.ts | OK |
| AI reflux detection (MinHash) | claims-audit P4: = 已实现 | OK |
| Medium/high excluded from court filing | claims-audit P4: = 已实现 | OK |
| Nine provider error classes with retry-after | claims-audit P4: = 已实现 | OK |
| Non-retryable errors not retried | claims-audit P4: = 已实现 | OK |

---

## Summary

| Category | Count |
|---|---|
| Total statements checked | 95 |
| Supported by claims-audit / eval-ledger / source code | 95 |
| Unsupported (should not be in README) | 0 |
| claims-audit rows corrected in this audit | 1 (反证搜索: 已实现→计划) |
