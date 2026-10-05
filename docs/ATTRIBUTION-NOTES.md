# Attribution Notes

Detailed notes on what OpenMimic borrows from external projects, what it
implements independently, and what remains planned.

## Twig (衔枝)

Source: https://github.com/qimingjiu/twig-memory (MIT)
Canonical definitions: [ATTRIBUTION.md](https://github.com/qimingjiu/twig-memory/blob/main/ATTRIBUTION.md)

### Implemented (borrowed concept, independent code)

| Concept | Twig origin | OpenMimic implementation | Files |
|---|---|---|---|
| Conviction score | Twig's trust levels for memories | `computeConviction` pure function (base 0.5, per-witness increment, caps for episode/elicited/paired/contested) | `engines/court/src/court.ts` |
| `contested` status | Twig's challenged-memory state | ClaimStatus enum value; contest/uncontest flow with re-raise | `shared/src/schemas.ts`, `engines/gate/src/gate.ts` |
| Contested veto flow | Twig's subject-initiated challenge | GateEngine: contest → retired from persona; uncontest to restore; re-raise after new evidence | `engines/gate/src/gate.ts`, `engines/gate/src/plugin.ts` |
| Permission wall | Twig's diagnosis/crisis word filtering | GateEngine: diagnosis + crisis word lists → auto-retire matching claims | `engines/gate/src/gate.ts`, `engines/room/src/wordlist.ts` |
| Crisis protocol | Twig §7 three principles | GateEngine crisis service: word list pre-scan (zh/en/ja/ko), crisis mode system prompt (warm/present/never push away/never fabricate hotlines), static help resources, 10-min quiet period, zero-cache path, interview safety branch, audit table (time+type only) | `engines/gate/src/crisis.ts`, `engines/gate/src/plugin.ts`, `server/src/mount-openai.ts` |
| Process evaluation | Twig §6 three metrics | Evidence Coverage (three-element: support/counter/context), Contradiction Responsiveness (12 scenarios x 8 behavior types), Memory Repair (6 supersede scenarios). FakeLLM structural tests only; not yet run with real models | `eval/src/process-eval/` |
| DEPLOY-FOR-AI | Twig's onboarding documentation pattern | Docker / systemd / reverse proxy / access control | `docs/DEPLOY-FOR-AI.md` |

### Not borrowed (OpenMimic-original)

| Mechanism | Why it is not Twig's | Files |
|---|---|---|
| Claim pairing (cross-witness semantic matching) | Twig's counter-evidence search generates counter-hypotheses then retrieves evidence. OpenMimic's pairing finds semantically related claims across witnesses using LLM/embedding/keyword three-tier fallback. Different design intent. | `engines/court/src/conflict.ts` |
| Reflux detection (MinHash + rare phrase) | Not in Twig. MinHash shingle fingerprinting + v2 rare phrase/proper noun extraction + optional LLM confirmation for paraphrase detection. | `kernel/src/reflux.ts` |
| Multi-witness court pipeline | Twig operates on single-AI longitudinal understanding. OpenMimic's court is cross-witness adversarial (filing → pairing → relation → confrontation → conviction). | `engines/court/src/court.ts` |
| Room engine (behind/front dual mode) | Not in Twig. Persona-driven conversation with leak protection. | `engines/room/src/room.ts` |
| Witness interview engine | Not in Twig. Questionnaire + AI follow-up with 9 intents, retreat detection, evidence basis. | `engines/witness/src/interview.ts` |

### Planned (not yet implemented)

| Concept | Twig origin |
|---|---|
| Counter-evidence search | Twig's adversarial retrieval: generate counter-hypothesis → HyDE-style retrieval → force response |
| Blind derivation audit | Twig's consistency check: derive conclusions independently, compare with stored claims |

## BettaFish / MiroFish

Source: https://github.com/666ghj/BettaFish, https://github.com/666ghj/MiroFish

Referenced as engineering and architectural inspirations in the README
acknowledgments section. No code borrowed. BettaFish's ForumEngine
informed the multi-step pipeline design; MiroFish's organizational
simulation is the positional reference for planned "parallel organization"
features.

---

_Last updated: 2026-10-06_
