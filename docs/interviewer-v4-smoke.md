# Interviewer v4 Smoke Test

> Date: 2026-10-10
> Baseline: main (66d5a4f) + v4 interviewer commit

## 1. Test Suite Results

```
$ npm run typecheck && npm test

> openmimic@0.0.2 typecheck
> tsc -p tsconfig.json --noEmit && tsc -p web/tsconfig.json --noEmit

 Test Files  69 passed (69)
      Tests  1509 passed (1509)
```

Before v4: 1470 tests. After: 1509 tests (+39 new, 0 removed).

### New test files

- `engines/witness/test/interviewer-v4.test.ts` -- 32 tests
- `server/test/chat-api.test.ts` -- 7 tests

## 2. Chat Flow (FakeLLM, from test output)

The server-level tests in `server/test/chat-api.test.ts` exercise the full HTTP flow with FakeLLM:

### Start chat session

```
POST /api/invites/:token/chat
→ 201 { sessionId: "...", message: { id: "...", text: "..." } }
```

### Say (normal turn)

```
POST /api/chat/:sid/say { text: "大学认识的" }
→ 200 { message: { id: "...", text: "大学啊，那你们经常一起做什么？" } }
```

### Say (generation failure -- both attempts fail guards)

```
POST /api/chat/:sid/say { text: "他人挺好的" }
→ 503 { error: { code: "interview_generation_failed" } }
```

### Finish

```
POST /api/chat/:sid/finish { consentLevel: "quotable", relation: "大学同学" }
→ 201 { count: 1 }
```

### Get history (refresh recovery)

```
GET /api/chat/:sid
→ 200 { turns: [...], mode: "informant" }
```

### Deprecated routes still work

```
POST /api/invites/:token/interview
→ 201 { total: 10, ... }
```

### Chat routes without LLM return 404

```
POST /api/invites/:token/chat (no LLM configured)
→ 404
```

## 3. Guard Tests (from unit tests)

All guards verified via FakeLLM scripted responses:

| Guard | Input | Result |
|-------|-------|--------|
| Double question mark | `你喜欢什么？你们怎么认识的？` | Rejected: not_single_question |
| No question mark | `他人挺好的` | Rejected: not_single_question |
| Closing language | `最后再问一个问题，你觉得...` | Rejected: premature_ending |
| Duplicate (Jaccard) | Same as previous question | Rejected: duplicate |
| Forbidden prefix | `抱歉，我不太理解` | Rejected: not_single_question |
| Acknowledgement has question | `是吗？那后来你们怎么样了？` | Rejected: acknowledgement_has_question |
| Code fence wrapper | `` ```你们怎么认识的？``` `` | Sanitised, passes |
| JSON wrapper | `{"question":"你们怎么认识的？"}` | Extracted, passes |
| Repair chain (1st fail, 2nd pass) | 2 calls total | Passes on retry |
| Repair chain (both fail) | 2 calls total | interview_generation_failed |

## 4. Grep Proof

```
$ grep -rn 'questionnaires/' engines/witness/src/interviewer-v4/
engines/witness/src/interviewer-v4/interviewer.ts:16:import { OBSERVER_DIMENSIONS, WITNESS_V2_QUESTIONNAIRES } from '../questionnaires/witness-v2';
```

Note: This import is for coverage dimension names (OBSERVER_DIMENSIONS) and
computeCoverage() input (WITNESS_V2_QUESTIONNAIRES), not for fixed questions.
The v4 path uses these only as reference metadata for the "uncovered aspects"
hint in the system prompt.

```
$ grep -rn 'OPENING_EXPECTATION' engines/witness/src/interviewer-v4/ server/src/mount-rest.ts web/src/views/ChatView.vue
(none)

$ grep -rn 'closingSuggested' engines/witness/src/interviewer-v4/ server/src/mount-rest.ts web/src/views/ChatView.vue
(none)

$ grep -rn 'navigator' engines/witness/src/interviewer-v4/
engines/witness/src/interviewer-v4/prompt.ts:5: * No questionnaire, no navigator, no planning.
engines/witness/src/interviewer-v4/interviewer.ts:4: * No questionnaire, no navigator, no planning. The model sees the
```

Only comment references (stating "no navigator"). No functional usage.

## 5. Web Build

```
$ npm run build --prefix web
```

Pre-existing failure: `shared/src/sanitize.ts` imports `node:crypto` which
cannot be bundled for the browser. This failure exists on the baseline commit
(66d5a4f) before any v4 changes. The v4 web components (`ChatView.vue`,
`api.ts` additions, `InterviewView.vue` integration) pass typecheck cleanly.

## 6. Checklist

- [x] Zero new dependencies
- [x] Zero uncommitted files (after final commit)
- [x] `testimonies` table triggers untouched
- [x] No real model invocations (all FakeLLM)
- [x] Old interview routes preserved (deprecated)
- [x] v4 path does not reference OPENING_EXPECTATION, closingSuggested, navigator (functionally)
